import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { hasPermission, requireAuth, requirePermission } from '../auth.js'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().max(24).optional(),
  search: z.string().trim().max(100).optional(),
})

const leadSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(160).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  website: z.string().url().max(255).optional().nullable(),
  province: z.string().trim().max(50).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  source: z.string().trim().max(80).optional().nullable(),
  interestedProducts: z.string().trim().max(2000).optional().nullable(),
  inquiryText: z.string().trim().max(10000).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  nextFollowUpAt: z.string().datetime({ offset: true }).optional().nullable(),
  ownerId: z.string().uuid().optional().nullable(),
})

const updateLeadSchema = leadSchema.partial().extend({
  status: z.enum(['new', 'unassigned', 'contacted', 'nurturing', 'qualified', 'converted', 'disqualified', 'public_pool']).optional(),
})
const idSchema = z.object({ id: z.string().uuid() })

export async function leadRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const input = listSchema.safeParse(request.query)
    if (!input.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '线索字段格式不正确。', details: input.error.flatten() })
    const { tenantId, sub, permissions } = request.authUser
    const params: unknown[] = [tenantId]
    const where = ['l.tenant_id = $1', 'l.deleted_at IS NULL']
    if (!hasPermission(permissions, 'lead:read') && !hasPermission(permissions, 'lead:*')) {
      params.push(sub); where.push(`l.owner_id = $${params.length}`)
    }
    if (input.data.status) { params.push(input.data.status); where.push(`l.status = $${params.length}`) }
    if (input.data.search) {
      params.push(`%${input.data.search}%`)
      where.push(`(l.company_name ILIKE $${params.length} OR l.contact_name ILIKE $${params.length} OR l.email::text ILIKE $${params.length})`)
    }
    const offset = (input.data.page - 1) * input.data.pageSize
    params.push(input.data.pageSize, offset)
    const result = await db.query(`
      SELECT l.id, l.company_name, l.contact_name, l.email::text, l.phone, l.province, l.city,
        l.source, l.interested_products, l.status, l.priority, l.allocation_score, l.owner_id,
        l.next_follow_up_at, l.created_at, u.display_name AS owner_name, count(*) OVER()::int AS total_count
      FROM leads l LEFT JOIN users u ON u.id = l.owner_id
      WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params)
    const total = result.rows[0]?.total_count ?? 0
    return { data: result.rows.map(({ total_count: _, ...row }) => row), pagination: { ...input.data, total } }
  })

  app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = idSchema.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR' })
    const { tenantId, sub, permissions } = request.authUser
    const canReadAll = hasPermission(permissions, 'lead:read') || hasPermission(permissions, 'lead:*')
    const result = await db.query('SELECT * FROM leads WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND ($3::boolean OR owner_id = $4)', [parsed.data.id, tenantId, canReadAll, sub])
    if (!result.rows[0]) return reply.code(404).send({ error: 'NOT_FOUND', message: '线索不存在。' })
    return { data: result.rows[0] }
  })

  app.post('/', { preHandler: requirePermission('lead:create') }, async (request, reply) => {
    const input = leadSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '线索字段格式不正确。', details: input.error.flatten() })
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const d = input.data
      const result = await client.query(`
        INSERT INTO leads (tenant_id, owner_id, company_name, contact_name, email, phone, website, province, city, source, interested_products, inquiry_text, priority, next_follow_up_at, created_by)
        VALUES ($1, coalesce($2::uuid, $3::uuid), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $3::uuid) RETURNING *
      `, [request.authUser.tenantId, d.ownerId, request.authUser.sub, d.companyName, d.contactName, d.email?.toLowerCase(), d.phone, d.website, d.province, d.city, d.source, d.interestedProducts, d.inquiryText, d.priority, d.nextFollowUpAt])
      const lead = result.rows[0]
      await client.query(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, entity_id, after_data, request_id) VALUES ($1,$2,'lead.create','lead',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, lead.id, JSON.stringify(lead), request.id])
      await client.query('COMMIT')
      return reply.code(201).send({ data: lead })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  app.patch('/:id', { preHandler: requirePermission('lead:update') }, async (request, reply) => {
    const id = idSchema.safeParse(request.params)
    const input = updateLeadSchema.safeParse(request.body)
    if (!id.success || !input.success || Object.keys(input.data).length === 0) return reply.code(400).send({ error: 'VALIDATION_ERROR' })
    if (input.data.ownerId && !hasPermission(request.authUser.permissions, 'lead:assign') && !hasPermission(request.authUser.permissions, 'lead:*')) return reply.code(403).send({ error: 'FORBIDDEN', message: '当前账号没有分配线索的权限。' })
    const mapping: Record<string, string> = { companyName:'company_name', contactName:'contact_name', email:'email', phone:'phone', website:'website', province:'province', city:'city', source:'source', interestedProducts:'interested_products', inquiryText:'inquiry_text', priority:'priority', nextFollowUpAt:'next_follow_up_at', ownerId:'owner_id', status:'status' }
    const canManageAll = hasPermission(request.authUser.permissions, 'lead:*')
    const values: unknown[] = [id.data.id, request.authUser.tenantId, canManageAll, request.authUser.sub]
    const sets = Object.entries(input.data).map(([key, value]) => { values.push(value); return `${mapping[key]} = $${values.length}` })
    const result = await db.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND ($3::boolean OR owner_id = $4::uuid) RETURNING *`, values)
    if (!result.rows[0]) return reply.code(404).send({ error: 'NOT_FOUND' })
    await db.query(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, entity_id, after_data, request_id) VALUES ($1,$2,'lead.update','lead',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(result.rows[0]), request.id])
    return { data: result.rows[0] }
  })

  app.delete('/:id', { preHandler: requirePermission('lead:delete') }, async (request, reply) => {
    const parsed = idSchema.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR' })
    const canManageAll = hasPermission(request.authUser.permissions, 'lead:*')
    const result = await db.query('UPDATE leads SET deleted_at = now() WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND ($3::boolean OR owner_id = $4::uuid) RETURNING id', [parsed.data.id, request.authUser.tenantId, canManageAll, request.authUser.sub])
    if (!result.rows[0]) return reply.code(404).send({ error: 'NOT_FOUND' })
    await db.query(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, entity_id, request_id) VALUES ($1,$2,'lead.delete','lead',$3,$4)`, [request.authUser.tenantId, request.authUser.sub, parsed.data.id, request.id])
    return reply.code(204).send()
  })
}
