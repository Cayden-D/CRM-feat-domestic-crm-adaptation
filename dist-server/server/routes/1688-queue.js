import { z } from 'zod';
import { db } from '../db.js';
import { requirePermission } from '../auth.js';
import { IntegrationError } from '../integrations/1688.js';
import { enqueueCollectedProduct } from '../integrations/1688-collection-queue.js';
const idSchema = z.object({ id: z.string().uuid() });
export async function collectionQueueRoutes(app) {
    app.get('/agent/queue', { preHandler: requirePermission('integration:read') }, async (request) => {
        const tenant = request.authUser.tenantId;
        const settings = (await db.query(`SELECT c.id,c.display_name,c.status AS connection_status,coalesce(a.enabled,false) AS agent_enabled,coalesce(q.enabled,false) AS enabled,coalesce(q.revision,0) AS revision FROM integration_1688_connections c LEFT JOIN integration_1688_agent_settings a ON a.connection_id=c.id LEFT JOIN integration_1688_collection_queue_settings q ON q.connection_id=c.id WHERE c.tenant_id=$1 ORDER BY c.created_at`, [tenant])).rows;
        const jobs = (await db.query(`SELECT j.id,j.collected_product_id,j.connection_id,j.status,j.phase,j.attempts,j.message,j.report,j.product_id,j.draft_id,j.created_at,j.updated_at,p.title,c.display_name FROM integration_1688_collection_queue_jobs j JOIN collected_products p ON p.id=j.collected_product_id JOIN integration_1688_connections c ON c.id=j.connection_id WHERE j.tenant_id=$1 ORDER BY j.created_at DESC LIMIT 100`, [tenant])).rows;
        return { data: { settings, jobs } };
    });
    app.put('/connections/:id/agent-queue-settings', { preHandler: [requirePermission('integration:manage'), requirePermission('integration:publish')] }, async (request) => {
        const { id } = idSchema.parse(request.params), input = z.object({ enabled: z.boolean(), revision: z.number().int().nonnegative(), confirmed: z.literal(true) }).parse(request.body);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const connection = (await client.query('SELECT id,status FROM integration_1688_connections WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, request.authUser.tenantId])).rows[0];
            if (!connection)
                throw new IntegrationError('NOT_FOUND', '店铺不存在。', 404);
            const agent = (await client.query('SELECT enabled FROM integration_1688_agent_settings WHERE connection_id=$1', [id])).rows[0];
            if (input.enabled && (!agent?.enabled || connection.status !== 'connected'))
                throw new IntegrationError('QUEUE_NOT_READY', '先开启并连接该店铺的 Agent 上品模式。', 409);
            const previous = (await client.query('SELECT revision FROM integration_1688_collection_queue_settings WHERE connection_id=$1', [id])).rows[0];
            if ((previous?.revision || 0) !== input.revision)
                throw new IntegrationError('SETTINGS_CONFLICT', '队列设置已变化，请刷新。', 409);
            const saved = (await client.query(`INSERT INTO integration_1688_collection_queue_settings(connection_id,tenant_id,enabled,updated_by)VALUES($1,$2,$3,$4) ON CONFLICT(connection_id) DO UPDATE SET enabled=excluded.enabled,revision=integration_1688_collection_queue_settings.revision+1,updated_by=excluded.updated_by,updated_at=now() RETURNING *`, [id, request.authUser.tenantId, input.enabled, request.authUser.sub])).rows[0];
            if (!input.enabled)
                await client.query("UPDATE integration_1688_collection_queue_jobs SET status='cancelled',message='队列已关闭，未开始的任务已取消。',updated_at=now() WHERE connection_id=$1 AND tenant_id=$2 AND status='queued'", [id, request.authUser.tenantId]);
            await client.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'1688.agent.queue.settings','1688_connection',$3,$4,$5)", [request.authUser.tenantId, request.authUser.sub, id, JSON.stringify({ enabled: input.enabled, revision: saved.revision }), request.id]);
            await client.query('COMMIT');
            return { data: saved };
        }
        catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505')
                throw new IntegrationError('QUEUE_TARGET_EXISTS', '每个租户只能开启一个采集自动上品目标店铺。', 409);
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.post('/agent/queue/:id', { preHandler: [requirePermission('integration:publish'), requirePermission('collection:read')] }, async (request) => {
        const { id } = idSchema.parse(request.params), client = await db.connect();
        try {
            await client.query('BEGIN');
            const source = (await client.query('SELECT * FROM collected_products WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, request.authUser.tenantId])).rows[0];
            if (!source)
                throw new IntegrationError('NOT_FOUND', '采集商品不存在。', 404);
            if (source.product_id)
                throw new IntegrationError('ALREADY_PROMOTED', '该采集商品已转正式产品。', 409);
            const jobId = await enqueueCollectedProduct(client, source, request.authUser.sub);
            if (!jobId)
                throw new IntegrationError('QUEUE_DISABLED', '没有启用采集自动上品的店铺，或该商品已入队。', 409);
            await client.query('COMMIT');
            return { data: { id: jobId, status: 'queued' } };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.post('/agent/queue-jobs/:id/retry', { preHandler: [requirePermission('integration:publish'), requirePermission('collection:read')] }, async (request) => {
        const { id } = idSchema.parse(request.params);
        const row = (await db.query(`UPDATE integration_1688_collection_queue_jobs j SET status='queued',phase='screening',attempts=0,available_at=now(),source_updated_at=p.updated_at,actor_id=$3,message=NULL,report='{}'::jsonb,worker_id=NULL,lease_until=NULL,updated_at=now() FROM collected_products p JOIN integration_1688_collection_queue_settings q ON q.tenant_id=p.tenant_id AND q.enabled WHERE j.id=$1 AND j.tenant_id=$2 AND j.collected_product_id=p.id AND j.connection_id=q.connection_id AND j.status IN ('blocked','failed') AND j.product_id IS NULL AND j.draft_id IS NULL AND p.product_id IS NULL RETURNING j.id`, [id, request.authUser.tenantId, request.authUser.sub])).rows[0];
        if (!row)
            throw new IntegrationError('QUEUE_CANNOT_RETRY', '任务已生成产品、结果待核对或队列未启用，不能自动重试。', 409);
        await db.query("UPDATE collected_products SET processing_status='ai_processing' WHERE id=(SELECT collected_product_id FROM integration_1688_collection_queue_jobs WHERE id=$1)", [id]);
        return { data: { id: row.id, status: 'queued' } };
    });
}
