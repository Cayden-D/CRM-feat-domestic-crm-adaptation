import { z } from 'zod';
import { db } from '../db.js';
import { hasPermission, requireAuth, requirePermission } from '../auth.js';
const idSchema = z.object({ id: z.string().uuid() });
const contactIdSchema = z.object({ id: z.string().uuid(), contactId: z.string().uuid() });
const listSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    lifecycleStatus: z.enum(['active', 'silent', 'public_pool', 'lost']).optional(),
    creditLevel: z.enum(['A', 'B', 'C', 'D']).optional(),
});
const accountSchema = z.object({
    name: z.string().trim().min(1).max(200),
    website: z.string().url().max(255).optional().nullable(),
    domain: z.string().trim().max(255).optional().nullable(),
    province: z.string().trim().max(50).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    district: z.string().trim().max(100).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    industry: z.string().trim().max(120).optional().nullable(),
    taxId: z.string().trim().max(100).optional().nullable(),
    creditLevel: z.enum(['A', 'B', 'C', 'D']).optional().nullable(),
    lifecycleStatus: z.enum(['active', 'silent', 'public_pool', 'lost']).default('active'),
    source: z.string().trim().max(80).optional().nullable(),
    ownerId: z.string().uuid().optional().nullable(),
});
const updateAccountSchema = accountSchema.partial();
const contactSchema = z.object({
    fullName: z.string().trim().min(1).max(160),
    jobTitle: z.string().trim().max(120).optional().nullable(),
    department: z.string().trim().max(120).optional().nullable(),
    email: z.string().email().max(255).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    wechat: z.string().trim().max(50).optional().nullable(),
    preferredChannel: z.enum(['email', 'phone', 'wechat', 'meeting']).optional().nullable(),
    employmentStatus: z.enum(['active', 'left', 'unknown']).default('active'),
    isPrimary: z.boolean().default(false),
});
const updateContactSchema = contactSchema.partial();
function canAccessAll(permissions) {
    return hasPermission(permissions, 'account:*') || hasPermission(permissions, 'account:read');
}
async function findAccessibleAccount(id, tenantId, userId, permissions, forUpdate = false) {
    return db.query(`SELECT a.*,u.display_name AS owner_name FROM accounts a LEFT JOIN users u ON u.id=a.owner_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.deleted_at IS NULL AND ($3::boolean OR a.owner_id=$4::uuid)${forUpdate ? ' FOR UPDATE OF a' : ''}`, [id, tenantId, canAccessAll(permissions), userId]);
}
export async function accountRoutes(app) {
    app.get('/', { preHandler: requireAuth }, async (request, reply) => {
        const input = listSchema.safeParse(request.query);
        if (!input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '客户筛选条件格式不正确。', details: input.error.flatten() });
        const { tenantId, sub, permissions } = request.authUser;
        const values = [tenantId, canAccessAll(permissions), sub];
        const where = ['a.tenant_id=$1', 'a.deleted_at IS NULL', '($2::boolean OR a.owner_id=$3::uuid)'];
        if (input.data.search) {
            values.push(`%${input.data.search}%`);
            where.push(`(a.name ILIKE $${values.length} OR a.domain::text ILIKE $${values.length} OR a.city ILIKE $${values.length})`);
        }
        if (input.data.lifecycleStatus) {
            values.push(input.data.lifecycleStatus);
            where.push(`a.lifecycle_status=$${values.length}`);
        }
        if (input.data.creditLevel) {
            values.push(input.data.creditLevel);
            where.push(`a.credit_level=$${values.length}`);
        }
        const offset = (input.data.page - 1) * input.data.pageSize;
        values.push(input.data.pageSize, offset);
        const result = await db.query(`
      SELECT a.id,a.owner_id,a.name,a.website,a.domain::text,a.province,a.city,a.district,a.address,a.industry,a.tax_id,
        a.credit_level,a.lifecycle_status,a.source,
        a.last_contact_at,a.created_at,a.updated_at,u.display_name AS owner_name,
        (SELECT count(*)::int FROM contacts c WHERE c.account_id=a.id AND c.deleted_at IS NULL) AS contact_count,
        (SELECT count(*)::int FROM opportunities o WHERE o.account_id=a.id AND o.deleted_at IS NULL AND o.status='open') AS open_opportunity_count,
        (SELECT coalesce(sum(o.amount),0) FROM opportunities o WHERE o.account_id=a.id AND o.deleted_at IS NULL AND o.status='open') AS pipeline_amount,
        (SELECT coalesce(sum(o.total_amount),0) FROM orders o WHERE o.account_id=a.id AND o.status <> 'cancelled') AS order_total,
        count(*) OVER()::int AS total_count
      FROM accounts a LEFT JOIN users u ON u.id=a.owner_id
      WHERE ${where.join(' AND ')} ORDER BY coalesce(a.last_contact_at,a.created_at) DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
        const total = result.rows[0]?.total_count ?? 0;
        return { data: result.rows.map(({ total_count: _, ...row }) => row), pagination: { page: input.data.page, pageSize: input.data.pageSize, total } };
    });
    app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        if (!id.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const { tenantId, sub, permissions } = request.authUser;
        const account = await findAccessibleAccount(id.data.id, tenantId, sub, permissions);
        if (!account.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' });
        const [contacts, opportunities, activities, tasks, orders, paymentSummary] = await Promise.all([
            db.query(`SELECT id,full_name,job_title,department,email::text,phone,wechat,preferred_channel,employment_status,is_primary,created_at,updated_at FROM contacts WHERE account_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY is_primary DESC,created_at`, [id.data.id, tenantId]),
            db.query(`SELECT o.id,o.name,o.amount,o.currency,o.expected_close_date,o.probability,o.ai_predicted_probability,o.status,o.created_at,s.name AS stage_name,s.code AS stage_code FROM opportunities o JOIN opportunity_stages s ON s.id=o.stage_id WHERE o.account_id=$1 AND o.tenant_id=$2 AND o.deleted_at IS NULL ORDER BY o.created_at DESC`, [id.data.id, tenantId]),
            db.query(`SELECT DISTINCT a.id,a.activity_type,a.subject,a.content,a.occurred_at,a.next_action,a.next_action_at,a.ai_generated,u.display_name AS actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN leads l ON l.id=a.lead_id LEFT JOIN opportunities o ON o.id=a.opportunity_id WHERE a.tenant_id=$2 AND (a.account_id=$1 OR l.converted_account_id=$1 OR o.account_id=$1) ORDER BY a.occurred_at DESC LIMIT 100`, [id.data.id, tenantId]),
            db.query(`SELECT DISTINCT t.id,t.title,t.description,t.priority,t.status,t.due_at,t.completed_at,u.display_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN leads l ON l.id=t.lead_id LEFT JOIN opportunities o ON o.id=t.opportunity_id WHERE t.tenant_id=$2 AND (t.account_id=$1 OR l.converted_account_id=$1 OR o.account_id=$1) ORDER BY t.status,t.due_at NULLS LAST LIMIT 100`, [id.data.id, tenantId]),
            db.query(`SELECT id,order_number,status,currency,total_amount,delivery_date,created_at FROM orders WHERE account_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 50`, [id.data.id, tenantId]),
            db.query(`SELECT coalesce(sum(p.amount),0) AS planned_amount,coalesce(sum(p.received_amount),0) AS received_amount,count(*) FILTER (WHERE p.status='overdue')::int AS overdue_count FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.account_id=$1 AND p.tenant_id=$2`, [id.data.id, tenantId]),
        ]);
        const openPipeline = opportunities.rows.filter(row => row.status === 'open').reduce((sum, row) => sum + Number(row.amount), 0);
        const orderTotal = orders.rows.filter(row => row.status !== 'cancelled').reduce((sum, row) => sum + Number(row.total_amount), 0);
        return { data: { account: account.rows[0], contacts: contacts.rows, opportunities: opportunities.rows, activities: activities.rows, tasks: tasks.rows, orders: orders.rows, summary: { contactCount: contacts.rowCount, openOpportunityCount: opportunities.rows.filter(row => row.status === 'open').length, openPipeline, orderTotal, ...paymentSummary.rows[0] } } };
    });
    app.post('/', { preHandler: requirePermission('account:create') }, async (request, reply) => {
        const input = accountSchema.safeParse(request.body);
        if (!input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '客户字段格式不正确。', details: input.error.flatten() });
        const d = input.data;
        if (d.ownerId && !hasPermission(request.authUser.permissions, 'account:*'))
            return reply.code(403).send({ error: 'FORBIDDEN', message: '当前账号没有分配客户的权限。' });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`INSERT INTO accounts (tenant_id,owner_id,name,normalized_name,website,domain,province,city,district,address,industry,tax_id,credit_level,lifecycle_status,source,created_by) VALUES ($1,coalesce($2::uuid,$3::uuid),$4::varchar,lower($4::text),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$3) RETURNING *`, [request.authUser.tenantId, d.ownerId, request.authUser.sub, d.name, d.website, d.domain?.toLowerCase(), d.province, d.city, d.district, d.address, d.industry, d.taxId, d.creditLevel, d.lifecycleStatus, d.source]);
            await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'account.create','account',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, result.rows[0].id, JSON.stringify(result.rows[0]), request.id]);
            await client.query('COMMIT');
            return reply.code(201).send({ data: result.rows[0] });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.patch('/:id', { preHandler: requirePermission('account:update') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        const input = updateAccountSchema.safeParse(request.body);
        if (!id.success || !input.success || Object.keys(input.data).length === 0)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        if (input.data.ownerId && !hasPermission(request.authUser.permissions, 'account:*'))
            return reply.code(403).send({ error: 'FORBIDDEN', message: '当前账号没有分配客户的权限。' });
        const mapping = { name: 'name', website: 'website', domain: 'domain', province: 'province', city: 'city', district: 'district', address: 'address', industry: 'industry', taxId: 'tax_id', creditLevel: 'credit_level', lifecycleStatus: 'lifecycle_status', source: 'source', ownerId: 'owner_id' };
        const values = [id.data.id, request.authUser.tenantId, canAccessAll(request.authUser.permissions), request.authUser.sub];
        const sets = Object.entries(input.data).map(([key, value]) => { values.push(key === 'domain' && typeof value === 'string' ? value.toLowerCase() : value); return `${mapping[key]}=$${values.length}${key === 'name' ? '::varchar' : ''}`; });
        if (input.data.name)
            sets.push(`normalized_name=lower($${4 + Object.keys(input.data).indexOf('name') + 1})`);
        const result = await db.query(`UPDATE accounts SET ${sets.join(',')},updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) RETURNING *`, values);
        if (!result.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' });
        await db.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'account.update','account',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(result.rows[0]), request.id]);
        return { data: result.rows[0] };
    });
    app.delete('/:id', { preHandler: requirePermission('account:delete') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        if (!id.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const result = await db.query('UPDATE accounts SET deleted_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) RETURNING id', [id.data.id, request.authUser.tenantId, canAccessAll(request.authUser.permissions), request.authUser.sub]);
        if (!result.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND' });
        await db.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,request_id) VALUES ($1,$2,'account.delete','account',$3,$4)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, request.id]);
        return reply.code(204).send();
    });
    app.post('/:id/contacts', { preHandler: requirePermission('account:contact') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        const input = contactSchema.safeParse(request.body);
        if (!id.success || !input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', details: input.success ? undefined : input.error.flatten() });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const account = await client.query('SELECT id FROM accounts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [id.data.id, request.authUser.tenantId, canAccessAll(request.authUser.permissions), request.authUser.sub]);
            if (!account.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'NOT_FOUND' });
            }
            const d = input.data;
            if (d.isPrimary)
                await client.query('UPDATE contacts SET is_primary=false,updated_at=now() WHERE account_id=$1 AND deleted_at IS NULL', [id.data.id]);
            const result = await client.query(`INSERT INTO contacts (tenant_id,account_id,full_name,job_title,department,email,phone,wechat,preferred_channel,employment_status,is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [request.authUser.tenantId, id.data.id, d.fullName, d.jobTitle, d.department, d.email?.toLowerCase(), d.phone, d.wechat, d.preferredChannel, d.employmentStatus, d.isPrimary]);
            await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'contact.create','contact',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, result.rows[0].id, JSON.stringify(result.rows[0]), request.id]);
            await client.query('COMMIT');
            return reply.code(201).send({ data: result.rows[0] });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.patch('/:id/contacts/:contactId', { preHandler: requirePermission('account:contact') }, async (request, reply) => {
        const ids = contactIdSchema.safeParse(request.params);
        const input = updateContactSchema.safeParse(request.body);
        if (!ids.success || !input.success || Object.keys(input.data).length === 0)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const account = await client.query('SELECT id FROM accounts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [ids.data.id, request.authUser.tenantId, canAccessAll(request.authUser.permissions), request.authUser.sub]);
            if (!account.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'NOT_FOUND' });
            }
            if (input.data.isPrimary)
                await client.query('UPDATE contacts SET is_primary=false,updated_at=now() WHERE account_id=$1 AND deleted_at IS NULL', [ids.data.id]);
            const mapping = { fullName: 'full_name', jobTitle: 'job_title', department: 'department', email: 'email', phone: 'phone', wechat: 'wechat', preferredChannel: 'preferred_channel', employmentStatus: 'employment_status', isPrimary: 'is_primary' };
            const values = [ids.data.contactId, ids.data.id, request.authUser.tenantId];
            const sets = Object.entries(input.data).map(([key, value]) => { values.push(value); return `${mapping[key]}=$${values.length}`; });
            const result = await client.query(`UPDATE contacts SET ${sets.join(',')},updated_at=now() WHERE id=$1 AND account_id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING *`, values);
            if (!result.rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'NOT_FOUND' });
            }
            await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'contact.update','contact',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, ids.data.contactId, JSON.stringify(result.rows[0]), request.id]);
            await client.query('COMMIT');
            return { data: result.rows[0] };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.delete('/:id/contacts/:contactId', { preHandler: requirePermission('account:contact') }, async (request, reply) => {
        const ids = contactIdSchema.safeParse(request.params);
        if (!ids.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const account = await findAccessibleAccount(ids.data.id, request.authUser.tenantId, request.authUser.sub, request.authUser.permissions);
        if (!account.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND' });
        const result = await db.query('UPDATE contacts SET deleted_at=now(),updated_at=now() WHERE id=$1 AND account_id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING id', [ids.data.contactId, ids.data.id, request.authUser.tenantId]);
        if (!result.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND' });
        await db.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,request_id) VALUES ($1,$2,'contact.delete','contact',$3,$4)`, [request.authUser.tenantId, request.authUser.sub, ids.data.contactId, request.id]);
        return reply.code(204).send();
    });
}
