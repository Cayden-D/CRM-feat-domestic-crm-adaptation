import { z } from 'zod';
import { db } from '../db.js';
import { hasPermission, requireAuth, requirePermission } from '../auth.js';
const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['open', 'won', 'lost', 'cancelled']).optional(),
    ownerId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
});
const opportunitySchema = z.object({
    accountId: z.string().uuid(),
    primaryContactId: z.string().uuid().optional().nullable(),
    ownerId: z.string().uuid().optional().nullable(),
    stageId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).optional().nullable(),
    amount: z.coerce.number().min(0).max(9999999999999999.99).default(0),
    expectedCloseDate: z.string().date().optional().nullable(),
    probability: z.coerce.number().min(0).max(100).optional().nullable(),
    lostReason: z.string().trim().max(200).optional().nullable(),
});
const updateSchema = opportunitySchema.partial();
const stageSchema = z.object({
    stageId: z.string().uuid(),
    note: z.string().trim().min(1).max(10000),
    nextAction: z.string().trim().max(240).optional().nullable(),
    nextActionAt: z.string().datetime({ offset: true }).optional().nullable(),
    lostReason: z.string().trim().max(200).optional().nullable(),
});
const activitySchema = z.object({
    activityType: z.enum(['note', 'call', 'email', 'meeting', 'wechat']).default('note'),
    content: z.string().trim().min(1).max(10000),
    nextAction: z.string().trim().max(240).optional().nullable(),
    nextActionAt: z.string().datetime({ offset: true }).optional().nullable(),
});
function accessAll(permissions) {
    return hasPermission(permissions, 'opportunity:*') || hasPermission(permissions, 'opportunity:read');
}
export async function opportunityRoutes(app) {
    app.get('/stages', { preHandler: requireAuth }, async (request) => {
        const result = await db.query(`SELECT id,name,code,position,default_probability,is_won,is_lost FROM opportunity_stages WHERE tenant_id=$1 ORDER BY position`, [request.authUser.tenantId]);
        return { data: result.rows };
    });
    app.get('/', { preHandler: requireAuth }, async (request, reply) => {
        const input = listSchema.safeParse(request.query);
        if (!input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', details: input.error.flatten() });
        const { tenantId, sub, permissions } = request.authUser;
        const values = [tenantId, accessAll(permissions), sub];
        const where = ['o.tenant_id=$1', 'o.deleted_at IS NULL', '($2::boolean OR o.owner_id=$3::uuid)'];
        if (input.data.search) {
            values.push(`%${input.data.search}%`);
            where.push(`(o.name ILIKE $${values.length} OR a.name ILIKE $${values.length})`);
        }
        if (input.data.status) {
            values.push(input.data.status);
            where.push(`o.status=$${values.length}`);
        }
        if (input.data.ownerId) {
            values.push(input.data.ownerId);
            where.push(`o.owner_id=$${values.length}`);
        }
        if (input.data.accountId) {
            values.push(input.data.accountId);
            where.push(`o.account_id=$${values.length}`);
        }
        const opportunities = await db.query(`SELECT o.id,o.account_id,o.primary_contact_id,o.owner_id,o.stage_id,o.name,o.description,o.amount,o.currency,o.expected_close_date,o.probability,o.ai_predicted_probability,o.ai_recommended_action,o.status,o.lost_reason,o.created_at,o.updated_at,a.name AS account_name,a.province,c.full_name AS primary_contact_name,u.display_name AS owner_name,s.name AS stage_name,s.code AS stage_code,s.position AS stage_position,s.default_probability,s.is_won,s.is_lost FROM opportunities o JOIN accounts a ON a.id=o.account_id LEFT JOIN contacts c ON c.id=o.primary_contact_id LEFT JOIN users u ON u.id=o.owner_id JOIN opportunity_stages s ON s.id=o.stage_id WHERE ${where.join(' AND ')} ORDER BY s.position,o.expected_close_date NULLS LAST,o.created_at DESC LIMIT 300`, values);
        const stageResult = await db.query(`SELECT id,name,code,position,default_probability,is_won,is_lost FROM opportunity_stages WHERE tenant_id=$1 ORDER BY position`, [tenantId]);
        const summarize = (rows) => rows.reduce((totals, row) => ({
            totalAmount: totals.totalAmount + Number(row.amount),
            weightedAmount: totals.weightedAmount + Number(row.amount) * Number(row.probability ?? row.default_probability) / 100,
        }), { totalAmount: 0, weightedAmount: 0 });
        const stages = stageResult.rows.map(stage => {
            const rows = opportunities.rows.filter(row => row.stage_id === stage.id);
            return { ...stage, opportunity_count: rows.length, total_amount: summarize(rows).totalAmount, weighted_amount: summarize(rows).weightedAmount };
        });
        const totals = summarize(opportunities.rows);
        const today = new Date();
        return { data: opportunities.rows, stages, summary: { totalCount: opportunities.rowCount, ...totals, closingThisMonth: opportunities.rows.filter(row => { const close = row.expected_close_date ? new Date(row.expected_close_date) : null; return row.status === 'open' && close && close.getUTCMonth() === today.getUTCMonth() && close.getUTCFullYear() === today.getUTCFullYear(); }).length } };
    });
    app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        if (!id.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const { tenantId, sub, permissions } = request.authUser;
        const opportunity = await db.query(`SELECT o.*,a.name AS account_name,c.full_name AS primary_contact_name,u.display_name AS owner_name,s.name AS stage_name,s.code AS stage_code,s.position AS stage_position,s.default_probability,s.is_won,s.is_lost FROM opportunities o JOIN accounts a ON a.id=o.account_id LEFT JOIN contacts c ON c.id=o.primary_contact_id LEFT JOIN users u ON u.id=o.owner_id JOIN opportunity_stages s ON s.id=o.stage_id WHERE o.id=$1 AND o.tenant_id=$2 AND o.deleted_at IS NULL AND ($3::boolean OR o.owner_id=$4::uuid)`, [id.data.id, tenantId, accessAll(permissions), sub]);
        if (!opportunity.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND', message: '商机不存在。' });
        const [history, activities, tasks] = await Promise.all([
            db.query(`SELECT h.id,h.note,h.created_at,fs.name AS from_stage_name,ts.name AS to_stage_name,ts.code AS to_stage_code,u.display_name AS changed_by_name FROM opportunity_stage_history h LEFT JOIN opportunity_stages fs ON fs.id=h.from_stage_id JOIN opportunity_stages ts ON ts.id=h.to_stage_id LEFT JOIN users u ON u.id=h.changed_by WHERE h.opportunity_id=$1 AND h.tenant_id=$2 ORDER BY h.created_at DESC`, [id.data.id, tenantId]),
            db.query(`SELECT a.id,a.activity_type,a.subject,a.content,a.occurred_at,a.next_action,a.next_action_at,a.ai_generated,u.display_name AS actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.opportunity_id=$1 AND a.tenant_id=$2 ORDER BY a.occurred_at DESC LIMIT 100`, [id.data.id, tenantId]),
            db.query(`SELECT t.id,t.title,t.description,t.priority,t.status,t.due_at,t.completed_at,u.display_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.opportunity_id=$1 AND t.tenant_id=$2 ORDER BY t.status,t.due_at NULLS LAST LIMIT 100`, [id.data.id, tenantId]),
        ]);
        return { data: { opportunity: opportunity.rows[0], history: history.rows, activities: activities.rows, tasks: tasks.rows } };
    });
    app.post('/', { preHandler: requirePermission('opportunity:create') }, async (request, reply) => {
        const input = opportunitySchema.safeParse(request.body);
        if (!input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '商机字段格式不正确。', details: input.error.flatten() });
        const d = input.data;
        if (d.ownerId && !hasPermission(request.authUser.permissions, 'opportunity:*'))
            return reply.code(403).send({ error: 'FORBIDDEN', message: '当前账号没有分配商机的权限。' });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const account = await client.query('SELECT id FROM accounts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [d.accountId, request.authUser.tenantId, accessAll(request.authUser.permissions), request.authUser.sub]);
            if (!account.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND', message: '客户不存在或不在当前权限范围内。' });
            }
            const stage = await client.query('SELECT * FROM opportunity_stages WHERE id=$1 AND tenant_id=$2', [d.stageId, request.authUser.tenantId]);
            if (!stage.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(400).send({ error: 'INVALID_STAGE', message: '销售阶段不存在。' });
            }
            if (d.primaryContactId) {
                const contact = await client.query('SELECT 1 FROM contacts WHERE id=$1 AND account_id=$2 AND tenant_id=$3 AND deleted_at IS NULL', [d.primaryContactId, d.accountId, request.authUser.tenantId]);
                if (!contact.rows[0]) {
                    await client.query('ROLLBACK');
                    return reply.code(400).send({ error: 'INVALID_CONTACT', message: '联系人不属于当前客户。' });
                }
            }
            const status = stage.rows[0].is_won ? 'won' : stage.rows[0].is_lost ? 'lost' : 'open';
            const result = await client.query(`INSERT INTO opportunities (tenant_id,account_id,primary_contact_id,owner_id,stage_id,name,description,amount,currency,expected_close_date,probability,status,lost_reason,created_by,closed_at) VALUES ($1,$2,$3,coalesce($4::uuid,$5::uuid),$6,$7,$8,$9,'CNY',$10,coalesce($11::numeric,$12::numeric),$13::varchar,$14,$5,CASE WHEN $13::text IN ('won','lost') THEN now() ELSE NULL END) RETURNING *`, [request.authUser.tenantId, d.accountId, d.primaryContactId, d.ownerId, request.authUser.sub, d.stageId, d.name, d.description, d.amount, d.expectedCloseDate, d.probability, stage.rows[0].default_probability, status, d.lostReason]);
            const opportunity = result.rows[0];
            await client.query(`INSERT INTO opportunity_stage_history (tenant_id,opportunity_id,to_stage_id,changed_by,note) VALUES ($1,$2,$3,$4,'创建商机')`, [request.authUser.tenantId, opportunity.id, d.stageId, request.authUser.sub]);
            await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'opportunity.create','opportunity',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, opportunity.id, JSON.stringify(opportunity), request.id]);
            await client.query('COMMIT');
            return reply.code(201).send({ data: opportunity });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.patch('/:id', { preHandler: requirePermission('opportunity:update') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        const input = updateSchema.omit({ stageId: true, accountId: true, primaryContactId: true }).safeParse(request.body);
        if (!id.success || !input.success || Object.keys(input.data).length === 0)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        if (input.data.ownerId && !hasPermission(request.authUser.permissions, 'opportunity:*'))
            return reply.code(403).send({ error: 'FORBIDDEN' });
        const mapping = { accountId: 'account_id', primaryContactId: 'primary_contact_id', ownerId: 'owner_id', name: 'name', description: 'description', amount: 'amount', expectedCloseDate: 'expected_close_date', probability: 'probability', lostReason: 'lost_reason' };
        const values = [id.data.id, request.authUser.tenantId, accessAll(request.authUser.permissions), request.authUser.sub];
        const sets = Object.entries(input.data).map(([key, value]) => { values.push(value); return `${mapping[key]}=$${values.length}`; });
        const result = await db.query(`UPDATE opportunities SET ${sets.join(',')},updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) RETURNING *`, values);
        if (!result.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND' });
        await db.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'opportunity.update','opportunity',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(result.rows[0]), request.id]);
        return { data: result.rows[0] };
    });
    app.post('/:id/stage', { preHandler: requirePermission('opportunity:advance') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        const input = stageSchema.safeParse(request.body);
        if (!id.success || !input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', details: input.success ? undefined : input.error.flatten() });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const current = await client.query('SELECT * FROM opportunities WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [id.data.id, request.authUser.tenantId, accessAll(request.authUser.permissions), request.authUser.sub]);
            if (!current.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'NOT_FOUND' });
            }
            const stage = await client.query('SELECT * FROM opportunity_stages WHERE id=$1 AND tenant_id=$2', [input.data.stageId, request.authUser.tenantId]);
            if (!stage.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(400).send({ error: 'INVALID_STAGE' });
            }
            if (current.rows[0].stage_id === input.data.stageId) {
                await client.query('ROLLBACK');
                return reply.code(409).send({ error: 'SAME_STAGE', message: '商机已经处于该阶段。' });
            }
            const status = stage.rows[0].is_won ? 'won' : stage.rows[0].is_lost ? 'lost' : 'open';
            const updated = await client.query(`UPDATE opportunities SET stage_id=$1,probability=$2::numeric,status=$3::varchar,lost_reason=CASE WHEN $3::text='lost' THEN $4::varchar ELSE NULL END,closed_at=CASE WHEN $3::text IN ('won','lost') THEN now() ELSE NULL END,updated_at=now() WHERE id=$5 RETURNING *`, [input.data.stageId, stage.rows[0].default_probability, status, input.data.lostReason, id.data.id]);
            await client.query(`INSERT INTO opportunity_stage_history (tenant_id,opportunity_id,from_stage_id,to_stage_id,changed_by,note) VALUES ($1,$2,$3,$4,$5,$6)`, [request.authUser.tenantId, id.data.id, current.rows[0].stage_id, input.data.stageId, request.authUser.sub, input.data.note]);
            await client.query(`INSERT INTO activities (tenant_id,actor_id,account_id,opportunity_id,activity_type,subject,content,next_action,next_action_at) VALUES ($1,$2,$3,$4,'stage_change','商机阶段推进',$5,$6,$7)`, [request.authUser.tenantId, request.authUser.sub, current.rows[0].account_id, id.data.id, input.data.note, input.data.nextAction, input.data.nextActionAt]);
            if (input.data.nextAction && input.data.nextActionAt)
                await client.query(`INSERT INTO tasks (tenant_id,assignee_id,created_by,account_id,opportunity_id,title,description,due_at) VALUES ($1,$2,$2,$3,$4,$5,$6,$7)`, [request.authUser.tenantId, current.rows[0].owner_id ?? request.authUser.sub, current.rows[0].account_id, id.data.id, input.data.nextAction, `跟进商机 ${current.rows[0].name}`, input.data.nextActionAt]);
            await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,request_id) VALUES ($1,$2,'opportunity.stage.change','opportunity',$3,$4,$5,$6)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify({ stageId: current.rows[0].stage_id }), JSON.stringify({ stageId: input.data.stageId, status }), request.id]);
            await client.query('COMMIT');
            return { data: updated.rows[0] };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.post('/:id/activities', { preHandler: requirePermission('opportunity:update') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        const input = activitySchema.safeParse(request.body);
        if (!id.success || !input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', details: input.success ? undefined : input.error.flatten() });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const opportunity = await client.query('SELECT * FROM opportunities WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [id.data.id, request.authUser.tenantId, accessAll(request.authUser.permissions), request.authUser.sub]);
            if (!opportunity.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'NOT_FOUND' });
            }
            const d = input.data;
            const activity = await client.query(`INSERT INTO activities (tenant_id,actor_id,account_id,opportunity_id,activity_type,content,next_action,next_action_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [request.authUser.tenantId, request.authUser.sub, opportunity.rows[0].account_id, id.data.id, d.activityType, d.content, d.nextAction, d.nextActionAt]);
            if (d.nextAction && d.nextActionAt)
                await client.query(`INSERT INTO tasks (tenant_id,assignee_id,created_by,account_id,opportunity_id,title,description,due_at) VALUES ($1,$2,$2,$3,$4,$5,$6,$7)`, [request.authUser.tenantId, opportunity.rows[0].owner_id ?? request.authUser.sub, opportunity.rows[0].account_id, id.data.id, d.nextAction, `跟进商机 ${opportunity.rows[0].name}`, d.nextActionAt]);
            await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'opportunity.activity.create','opportunity',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(activity.rows[0]), request.id]);
            await client.query('COMMIT');
            return reply.code(201).send({ data: activity.rows[0] });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.delete('/:id', { preHandler: requirePermission('opportunity:delete') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        if (!id.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const result = await db.query('UPDATE opportunities SET deleted_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) RETURNING id', [id.data.id, request.authUser.tenantId, accessAll(request.authUser.permissions), request.authUser.sub]);
        if (!result.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND' });
        await db.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,request_id) VALUES ($1,$2,'opportunity.delete','opportunity',$3,$4)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, request.id]);
        return reply.code(204).send();
    });
}
