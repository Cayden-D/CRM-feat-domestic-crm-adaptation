import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { generateQwenText, LlmRequestError } from '../llm/qwen.js';
import { requirePermission } from '../auth.js';
import { IntegrationError } from '../integrations/1688.js';
import { inspectPublishingImages, prepareAgentFields, publishingImages } from '../integrations/1688-agent.js';
import { collectedCategoryDefaults } from '../integrations/1688-collected-attributes.js';
import { collectedSkuAttributes } from '../integrations/1688-collected-skus.js';
import { validatePublishBody } from './1688.js';
const idSchema = z.object({ id: z.string().uuid() });
export async function agent1688Routes(app, publish) {
    app.post('/agent/test', { preHandler: [requirePermission('integration:manage'), requirePermission('integration:publish')] }, async () => {
        if (!config.DASHSCOPE_API_KEY)
            throw new IntegrationError('LLM_NOT_CONFIGURED', '请先配置百炼 API Key。', 503);
        try {
            const result = await generateQwenText({ model: 'qwen3.8-flash', messages: [{ role: 'user', content: '只回复 OK，不调用任何工具。' }], maxTokens: 100 });
            return { data: { model: result.model, connected: true } };
        }
        catch (error) {
            throw new IntegrationError('LLM_CONNECTION_FAILED', `模型连通测试失败${error instanceof LlmRequestError ? `（HTTP ${error.status}）` : ''}，请检查业务空间地址、API Key 归属及模型权限。`, 502);
        }
    });
    app.get('/agent/settings', { preHandler: requirePermission('integration:read') }, async (request) => ({ data: (await db.query(`SELECT c.id,c.display_name,c.status,coalesce(s.enabled,false) AS enabled,coalesce(s.revision,0) AS revision FROM integration_1688_connections c LEFT JOIN integration_1688_agent_settings s ON s.connection_id=c.id WHERE c.tenant_id=$1 ORDER BY c.created_at`, [request.authUser.tenantId])).rows, model: 'qwen3.8-flash', configured: Boolean(config.DASHSCOPE_API_KEY), imageRepairAvailable: true }));
    app.put('/connections/:id/agent-settings', { preHandler: [requirePermission('integration:manage'), requirePermission('integration:publish')] }, async (request) => {
        const { id } = idSchema.parse(request.params), input = z.object({ enabled: z.boolean(), revision: z.number().int().nonnegative(), confirmed: z.literal(true) }).parse(request.body);
        if (input.enabled && !config.DASHSCOPE_API_KEY)
            throw new IntegrationError('LLM_NOT_CONFIGURED', '请先配置百炼 API Key。', 503);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const connection = (await client.query('SELECT id,status FROM integration_1688_connections WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, request.authUser.tenantId])).rows[0];
            if (!connection)
                throw new IntegrationError('NOT_FOUND', '店铺不存在。', 404);
            if (input.enabled && connection.status !== 'connected')
                throw new IntegrationError('CONNECTION_UNAVAILABLE', '请先连接店铺。', 409);
            const previous = (await client.query('SELECT * FROM integration_1688_agent_settings WHERE connection_id=$1', [id])).rows[0];
            if ((previous?.revision || 0) !== input.revision)
                throw new IntegrationError('SETTINGS_CONFLICT', '配置已变化，请刷新。', 409);
            const saved = (await client.query(`INSERT INTO integration_1688_agent_settings(connection_id,tenant_id,enabled,updated_by)VALUES($1,$2,$3,$4) ON CONFLICT(connection_id) DO UPDATE SET enabled=excluded.enabled,revision=integration_1688_agent_settings.revision+1,updated_by=excluded.updated_by,updated_at=now() RETURNING *`, [id, request.authUser.tenantId, input.enabled, request.authUser.sub])).rows[0];
            if (!input.enabled) {
                await client.query('UPDATE integration_1688_collection_queue_settings SET enabled=false,revision=revision+1,updated_at=now() WHERE connection_id=$1 AND enabled', [id]);
                await client.query("UPDATE integration_1688_collection_queue_jobs SET status='cancelled',message='Agent 模式已关闭，未开始的任务已取消。',updated_at=now() WHERE connection_id=$1 AND tenant_id=$2 AND status='queued'", [id, request.authUser.tenantId]);
            }
            await client.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'1688.agent.settings','1688_connection',$3,$4,$5)", [request.authUser.tenantId, request.authUser.sub, id, JSON.stringify({ enabled: input.enabled, revision: saved.revision }), request.id]);
            await client.query('COMMIT');
            return { data: saved };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.get('/drafts/:id/agent-job', { preHandler: requirePermission('integration:read') }, async (request) => {
        const { id } = idSchema.parse(request.params);
        return { data: (await db.query('SELECT id,status,report,message,created_at,updated_at FROM integration_1688_agent_jobs WHERE draft_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 1', [id, request.authUser.tenantId])).rows[0] || null };
    });
    app.post('/agent-jobs/:id/cancel', { preHandler: requirePermission('integration:publish') }, async (request) => {
        const { id } = idSchema.parse(request.params), client = await db.connect();
        try {
            await client.query('BEGIN');
            const identity = (await client.query('SELECT connection_id FROM integration_1688_agent_jobs WHERE id=$1 AND tenant_id=$2', [id, request.authUser.tenantId])).rows[0];
            if (!identity)
                throw new IntegrationError('NOT_FOUND', '任务不存在。', 404);
            await client.query('SELECT id FROM integration_1688_connections WHERE id=$1 FOR UPDATE', [identity.connection_id]);
            const job = (await client.query('SELECT * FROM integration_1688_agent_jobs WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, request.authUser.tenantId])).rows[0];
            const draft = (await client.query('SELECT status FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [job.draft_id, request.authUser.tenantId])).rows[0];
            if (!['analyzing', 'publishing'].includes(job.status) || !['draft', 'failed'].includes(draft?.status))
                throw new IntegrationError('AGENT_CANNOT_CANCEL', '请求已提交或结果未知，请使用发布结果核对，不能取消重发。', 409);
            await client.query("UPDATE integration_1688_agent_jobs SET status='cancelled',message='已取消未提交的任务。',updated_at=now() WHERE id=$1", [id]);
            await client.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,request_id)VALUES($1,$2,'1688.agent.cancel','1688_agent_job',$3,$4)", [request.authUser.tenantId, request.authUser.sub, id, request.id]);
            await client.query('COMMIT');
            return { data: { cancelled: true } };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.post('/drafts/:id/agent', { preHandler: [requirePermission('integration:publish'), requirePermission('product:read')] }, request => runAgentDraft(request, publish));
}
export async function runAgentDraft(request, publish, queue) {
    const { id } = idSchema.parse(request.params), { revision } = z.object({ revision: z.number().int().positive() }).parse(request.body);
    const tenant = request.authUser.tenantId;
    const draft = (await db.query('SELECT * FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2', [id, tenant])).rows[0];
    if (!draft)
        throw new IntegrationError('NOT_FOUND', '发布草稿不存在。', 404);
    if (draft.revision !== revision || !['draft', 'failed'].includes(draft.status))
        throw new IntegrationError('DRAFT_CONFLICT', '草稿已变化或不能发布。', 409);
    const settings = (await db.query('SELECT * FROM integration_1688_agent_settings WHERE connection_id=$1 AND tenant_id=$2', [draft.connection_id, tenant])).rows[0];
    if (!settings?.enabled)
        throw new IntegrationError('AGENT_DISABLED', '请先在系统设置开启该店铺 Agent 上品模式。', 409);
    const product = (await db.query("SELECT * FROM products WHERE id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL", [draft.product_id, tenant])).rows[0];
    if (!product)
        throw new IntegrationError('PRODUCT_INACTIVE', '请选择已启用的正式产品。', 409);
    const variants = (await db.query('SELECT * FROM product_variants WHERE product_id=$1 AND tenant_id=$2 ORDER BY position', [draft.product_id, tenant])).rows;
    let job;
    try {
        job = (await db.query("INSERT INTO integration_1688_agent_jobs(tenant_id,connection_id,draft_id,actor_id,settings_revision,draft_revision,status)VALUES($1,$2,$3,$4,$5,$6,'analyzing')RETURNING *", [tenant, draft.connection_id, id, request.authUser.sub, settings.revision, revision])).rows[0];
    }
    catch (error) {
        if (error.code === '23505')
            throw new IntegrationError('AGENT_BUSY', '已有 Agent 任务，请查看任务或发布核对结果，不要重复提交。', 409);
        throw error;
    }
    let report = { model: 'qwen3.8-flash', imageRepairAvailable: true };
    try {
        const source = (await db.query('SELECT * FROM collected_products WHERE tenant_id=$1 AND product_id=$2 ORDER BY updated_at DESC LIMIT 1', [tenant, product.id])).rows[0] || null;
        const sourceVariants = source ? (await db.query('SELECT id,label,attributes FROM collected_product_variants WHERE tenant_id=$1 AND collected_product_id=$2', [tenant, source.id])).rows : [];
        const sourceById = new Map(sourceVariants.map(variant => [variant.id, variant]));
        const reviewed = variants.map(variant => {
            const original = sourceById.get(variant.source_variant_id);
            return original ? { ...variant, attributes: { ...variant.attributes, ...collectedSkuAttributes(source, original) } } : variant;
        });
        const defaults = collectedCategoryDefaults(draft.platform_schema, source);
        const current = draft.data_body.formValues;
        const catProp = { ...(current.catProp || {}) };
        for (const [name, value] of Object.entries(defaults))
            if (catProp[name] == null || catProp[name] === '' || typeof catProp[name] === 'object' && catProp[name].value == null)
                catProp[name] = value;
        const formValues = await prepareAgentFields(draft.platform_schema, { ...current, catProp }, product, reviewed);
        report = { ...report, title: formValues.title };
        const images = publishingImages(formValues);
        const findings = await inspectPublishingImages(images);
        report = { ...report, images: findings };
        const risky = findings.filter(i => !i.readable || i.watermark || i.rightsRisk || i.uncertain);
        if (risky.length)
            throw new IntegrationError('AGENT_IMAGE_RISK', `图片检查未通过：${risky.map(i => i.reason || '图片无法读取或存在明确标识').join('；')}。请核对原图或替换图片；不能通过编辑原图消除明确的公司水印或品牌 Logo。`, 400);
        const missing = validatePublishBody(draft.platform_schema, { ...draft.data_body, formValues });
        if (missing.length)
            throw new IntegrationError('AGENT_MISSING_FIELDS', `发布规则未通过：${missing.join('、')}`, 400);
        // CAS keeps an image inspection tied to the exact body that will be published.
        const updated = (await db.query("UPDATE integration_1688_publish_drafts SET data_body=jsonb_set(data_body,'{formValues}',$4::jsonb),revision=revision+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$3 AND status IN ('draft','failed') RETURNING revision", [id, tenant, revision, JSON.stringify(formValues)])).rows[0];
        if (!updated)
            throw new IntegrationError('DRAFT_CONFLICT', 'AI 检测期间草稿已变化，请重新检测。', 409);
        const claimed = await db.query("UPDATE integration_1688_agent_jobs SET status='publishing',report=$2,updated_at=now() WHERE id=$1 AND status='analyzing' RETURNING id", [job.id, JSON.stringify(report)]);
        if (!claimed.rows.length)
            throw new IntegrationError('AGENT_STOPPED', '任务已取消，本次未发布。', 409);
        await publish({ ...request, params: { id }, body: { revision: updated.revision, confirmed: true } }, { jobId: job.id, settingsRevision: settings.revision, queue });
        await db.query("UPDATE integration_1688_agent_jobs SET status='published',message='已提交平台；审核状态以平台为准。',updated_at=now() WHERE id=$1", [job.id]);
    }
    catch (error) {
        const state = (await db.query('SELECT status FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2', [id, tenant])).rows[0]?.status;
        const status = state === 'unknown' || state === 'submitting' ? 'unknown' : error instanceof IntegrationError ? 'blocked' : 'failed';
        const message = error instanceof IntegrationError ? error.message : 'AI 检测或生成失败，本次未自动重试。请检查模型配置与返回结果。';
        await db.query("UPDATE integration_1688_agent_jobs SET status=$2,report=$3,message=$4,updated_at=now() WHERE id=$1 AND status<>'cancelled'", [job.id, status, JSON.stringify(report), message]);
    }
    await db.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,request_id)VALUES($1,$2,'1688.agent.run','1688_agent_job',$3,$4)", [tenant, request.authUser.sub, job.id, request.id]);
    return { data: (await db.query('SELECT id,status,report,message,created_at,updated_at FROM integration_1688_agent_jobs WHERE id=$1 AND tenant_id=$2', [job.id, tenant])).rows[0] };
}
