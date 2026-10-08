import { createHash, randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { IntegrationError } from './1688.js';
import { inspectPublishingImages, publishingImages } from './1688-agent.js';
import { createDraftFromProduct } from './1688-drafts.js';
import { collectedSkuAttributes } from './1688-collected-skus.js';
import { runAgentDraft } from '../routes/1688-agent.js';
import { publishDraft } from '../routes/1688.js';
const escapeHtml = (value) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const sourceSku = (source) => `COL-${createHash('sha256').update(`${source.tenant_id}:${source.source}:${source.source_product_id}`).digest('hex').slice(0, 24).toUpperCase()}`;
export async function enqueueCollectedProduct(client, source, actorId) {
    if (source.source !== '1688' || source.product_id)
        return null;
    const target = (await client.query(`SELECT q.connection_id FROM integration_1688_collection_queue_settings q JOIN integration_1688_agent_settings a ON a.connection_id=q.connection_id JOIN integration_1688_connections c ON c.id=q.connection_id WHERE q.tenant_id=$1 AND q.enabled AND a.enabled AND c.status='connected' LIMIT 1`, [source.tenant_id])).rows[0];
    if (!target)
        return null;
    const job = (await client.query(`INSERT INTO integration_1688_collection_queue_jobs(tenant_id,connection_id,collected_product_id,actor_id,source_updated_at)VALUES($1,$2,$3,$4,$5) ON CONFLICT(collected_product_id) DO NOTHING RETURNING id`, [source.tenant_id, target.connection_id, source.id, actorId, source.updated_at])).rows[0];
    if (job)
        await client.query("UPDATE collected_products SET processing_status='ai_processing' WHERE id=$1", [source.id]);
    return job?.id || null;
}
function checkedSource(source, variants) {
    if (source.source !== '1688' || !/^[0-9]{1,20}$/.test(String(source.source_category_id || '')))
        throw new IntegrationError('QUEUE_CATEGORY', '来源类目 ID 缺失或不适用于 1688 发布，请人工核对。', 400);
    if (source.currency !== 'CNY' || !variants.length)
        throw new IntegrationError('QUEUE_PRICE', '自动上品需要人民币报价和明确的 SKU 价格、库存；请人工核对。', 400);
    if (variants.some(v => v.price == null || v.stock == null || !Number.isFinite(Number(v.price)) || Number(v.price) <= 0 || !Number.isInteger(Number(v.stock)) || Number(v.stock) < 0))
        throw new IntegrationError('QUEUE_SKU', '来源 SKU 价格或库存缺失、非整数或不合法，请人工核对。', 400);
    if (!source.main_image_url || !Array.isArray(source.gallery_images) || !Array.isArray(source.detail_images) || !source.detail_images.length)
        throw new IntegrationError('QUEUE_IMAGES', '来源主图或详情图缺失，不能自动上品。', 400);
    const all = publishingImages({ main: source.main_image_url, gallery: source.gallery_images, details: source.detail_images, variants: variants.map(v => v.image_url).filter(Boolean) });
    const main = publishingImages({ main: source.main_image_url })[0];
    const gallery = (source.gallery_images || []).map((url) => publishingImages({ image: url })[0]);
    const details = source.detail_images.map((url) => publishingImages({ image: url })[0]);
    return { all, main, gallery, details };
}
async function claim(workerId) {
    const result = await db.query(`WITH next AS (SELECT j.id FROM integration_1688_collection_queue_jobs j JOIN integration_1688_collection_queue_settings q ON q.connection_id=j.connection_id AND q.enabled JOIN integration_1688_agent_settings a ON a.connection_id=j.connection_id AND a.enabled JOIN integration_1688_connections c ON c.id=j.connection_id AND c.status='connected' WHERE j.status='queued' AND j.available_at<=now() ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1) UPDATE integration_1688_collection_queue_jobs j SET status='processing',phase='screening',attempts=attempts+1,worker_id=$1,lease_until=now()+interval '2 minutes',updated_at=now() FROM next WHERE j.id=next.id RETURNING j.*`, [workerId]);
    return result.rows[0];
}
async function finish(job, status, message, report = {}) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('UPDATE integration_1688_collection_queue_jobs SET status=$3,message=$4,report=$5::jsonb,worker_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND worker_id=$2 AND status=\'processing\' RETURNING collected_product_id', [job.id, job.worker_id, status, message, JSON.stringify(report)]);
        if (result.rows.length)
            await client.query('UPDATE collected_products SET processing_status=$2,updated_at=now() WHERE id=$1', [job.collected_product_id, status === 'published' ? 'published' : 'failed']);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
async function processJob(job) {
    const source = (await db.query('SELECT * FROM collected_products WHERE id=$1 AND tenant_id=$2', [job.collected_product_id, job.tenant_id])).rows[0];
    if (!source || source.product_id || new Date(source.updated_at).getTime() !== new Date(job.source_updated_at).getTime())
        throw new IntegrationError('QUEUE_SOURCE_CHANGED', '采集商品已变化或已转正式产品，请人工核对后再处理。', 409);
    const actor = (await db.query("SELECT id,email::text,display_name FROM users WHERE id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL", [job.actor_id, job.tenant_id])).rows[0];
    if (!actor)
        throw new IntegrationError('QUEUE_ACTOR', '入队账号已停用，不能自动发布。', 409);
    const allowed = (await db.query(`SELECT 1 FROM integration_1688_collection_queue_settings q JOIN integration_1688_agent_settings a ON a.connection_id=q.connection_id JOIN integration_1688_connections c ON c.id=q.connection_id WHERE q.connection_id=$1 AND q.tenant_id=$2 AND q.enabled AND a.enabled AND c.status='connected'`, [job.connection_id, job.tenant_id])).rows[0];
    if (!allowed)
        throw new IntegrationError('QUEUE_DISABLED', '队列或 Agent 模式已关闭，任务未发布。', 409);
    const variants = (await db.query('SELECT * FROM collected_product_variants WHERE collected_product_id=$1 AND tenant_id=$2 ORDER BY position', [source.id, job.tenant_id])).rows;
    const images = checkedSource(source, variants);
    const findings = await inspectPublishingImages(images.all);
    const report = { images: findings, sourceTitle: source.title, sourceCategoryId: source.source_category_id };
    const risky = findings.filter(item => !item.readable || item.watermark || item.rightsRisk || item.uncertain);
    if (risky.length) {
        await finish(job, 'blocked', `图片检查未通过：${risky.map(item => item.reason || '图片无法读取或存在明确标识').join('；')}。请核对原图或更换图片。`, report);
        return;
    }
    const client = await db.connect();
    let product;
    try {
        await client.query('BEGIN');
        const locked = (await client.query('SELECT * FROM collected_products WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [source.id, job.tenant_id])).rows[0];
        if (!locked || locked.product_id || new Date(locked.updated_at).getTime() !== new Date(job.source_updated_at).getTime())
            throw new IntegrationError('QUEUE_SOURCE_CHANGED', '筛查期间采集商品已变化，本次未发布。', 409);
        const description = `<p>${escapeHtml(source.title)}</p>${images.details.map(url => `<p><img src="${escapeHtml(url)}" alt="商品详情"></p>`).join('')}`;
        const price = Math.min(...variants.map(v => Number(v.price)));
        product = (await client.query(`INSERT INTO products(tenant_id,sku,name,category,description,specifications,base_price,base_currency,status,images,detail_images)VALUES($1,$2,$3,$4,$5,$6,$7,'CNY','active',$8,$9) RETURNING *`, [job.tenant_id, sourceSku(source), source.title.slice(0, 200), source.category_path?.slice(0, 120) || null, description, JSON.stringify(source.attributes || {}), price, JSON.stringify([...new Set([images.main, ...images.gallery])]), JSON.stringify(images.details)])).rows[0];
        for (const variant of variants)
            await client.query('INSERT INTO product_variants(tenant_id,product_id,source_variant_id,position,label,attributes,image_url,unit_price,stock)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [job.tenant_id, product.id, variant.id, variant.position, variant.label, JSON.stringify({ ...variant.attributes, ...collectedSkuAttributes(source, variant) }), variant.image_url, Number(variant.price), Number(variant.stock)]);
        await client.query("UPDATE collected_products SET product_id=$2,processing_status='ready',updated_at=now() WHERE id=$1", [source.id, product.id]);
        await client.query("UPDATE integration_1688_collection_queue_jobs SET phase='materializing',product_id=$2,report=$3::jsonb,updated_at=now() WHERE id=$1 AND worker_id=$4 AND status='processing'", [job.id, product.id, JSON.stringify(report), job.worker_id]);
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505')
            throw new IntegrationError('QUEUE_SKU_CONFLICT', '来源商品货号已存在，请人工核对重复商品。', 409);
        throw error;
    }
    finally {
        client.release();
    }
    const draft = await createDraftFromProduct({ tenantId: job.tenant_id, actorId: job.actor_id, requestId: job.id, connectionId: job.connection_id, product, catId: String(source.source_category_id), scene: 'cbu', reuse: true });
    await db.query("UPDATE integration_1688_collection_queue_jobs SET phase='publishing',draft_id=$2,updated_at=now() WHERE id=$1 AND worker_id=$3 AND status='processing'", [job.id, draft.id, job.worker_id]);
    const result = await runAgentDraft({ params: { id: draft.id }, body: { revision: draft.revision }, authUser: { sub: actor.id, tenantId: job.tenant_id, email: actor.email, displayName: actor.display_name, roles: [], permissions: [] }, id: job.id }, publishDraft, { id: job.id, workerId: job.worker_id });
    const agent = result.data;
    await finish(job, agent.status === 'published' ? 'published' : agent.status === 'unknown' ? 'unknown' : agent.status === 'blocked' ? 'blocked' : 'failed', agent.message || 'Agent 任务未完成。', { ...report, agentJobId: agent.id, agentReport: agent.report });
}
export async function runClaimedCollectionQueueJob(id, workerId) {
    const job = (await db.query("SELECT * FROM integration_1688_collection_queue_jobs WHERE id=$1 AND worker_id=$2 AND status='processing'", [id, workerId])).rows[0];
    if (!job)
        return false;
    const heartbeat = setInterval(() => void db.query("UPDATE integration_1688_collection_queue_jobs SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND worker_id=$2 AND status='processing'", [job.id, workerId]).catch(() => { }), 30_000);
    try {
        await processJob(job);
    }
    catch (error) {
        const state = (await db.query('SELECT phase FROM integration_1688_collection_queue_jobs WHERE id=$1', [job.id])).rows[0];
        const known = error instanceof IntegrationError;
        const message = known ? error.message : 'Agent 队列处理异常；未确认发布结果，请人工核对。';
        if (state?.phase === 'screening' && !known && job.attempts < 3) {
            await db.query("UPDATE integration_1688_collection_queue_jobs SET status='queued',available_at=now()+($3::int * interval '15 seconds'),message=$4,worker_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND worker_id=$2", [job.id, workerId, 2 ** (job.attempts - 1), message]);
        }
        else
            await finish(job, state?.phase === 'publishing' ? 'unknown' : known ? 'blocked' : 'failed', message);
    }
    finally {
        clearInterval(heartbeat);
    }
    return true;
}
export async function runCollectionQueueOnce(workerId = randomUUID()) {
    const job = await claim(workerId);
    if (!job)
        return false;
    return runClaimedCollectionQueueJob(job.id, workerId);
}
export async function recoverCollectionQueue(tenantId) {
    await db.query(`UPDATE integration_1688_collection_queue_jobs SET status=CASE WHEN phase='screening' AND attempts<3 THEN 'queued' WHEN phase='screening' THEN 'failed' ELSE 'unknown' END,message=CASE WHEN phase='screening' THEN '执行进程中断，等待重试或人工核对。' ELSE '执行进程中断且可能已创建产品或提交平台，请人工核对，禁止自动重试。' END,available_at=now()+interval '15 seconds',worker_id=NULL,lease_until=NULL,updated_at=now() WHERE status='processing' AND lease_until<now() AND ($1::uuid IS NULL OR tenant_id=$1)`, [tenantId || null]);
}
export function startCollectionQueue(onError = () => { }) {
    let running = 0, stopped = false, ticking = false;
    const active = new Set();
    const tick = async () => {
        if (stopped || ticking)
            return;
        ticking = true;
        try {
            await recoverCollectionQueue();
            while (!stopped && running < config.AGENT_QUEUE_CONCURRENCY) {
                running++;
                const task = runCollectionQueueOnce().catch(onError).finally(() => { running--; active.delete(task); });
                active.add(task);
            }
        }
        finally {
            ticking = false;
        }
    };
    const timer = setInterval(() => void tick().catch(onError), config.AGENT_QUEUE_POLL_MS);
    void tick().catch(onError);
    return async () => {
        stopped = true;
        clearInterval(timer);
        let timeout;
        try {
            await Promise.race([Promise.allSettled([...active]), new Promise(resolve => { timeout = setTimeout(resolve, 30_000); })]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
    };
}
