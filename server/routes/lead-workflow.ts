import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { hasPermission, requireAuth, requirePermission } from '../auth.js'

const duplicateSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  website: z.string().url().max(255).optional().nullable(),
  excludeLeadId: z.string().uuid().optional(),
})
const idSchema = z.object({ id: z.string().uuid() })
const activitySchema = z.object({
  activityType: z.enum(['note', 'call', 'email', 'meeting', 'wechat']).default('note'),
  subject: z.string().trim().max(200).optional().nullable(),
  content: z.string().trim().min(1).max(10000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  nextAction: z.string().trim().max(240).optional().nullable(),
  nextActionAt: z.string().datetime({ offset: true }).optional().nullable(),
})
const conversionSchema = z.object({
  accountName: z.string().trim().min(1).max(200).optional(),
  createOpportunity: z.boolean().default(true),
  opportunityName: z.string().trim().min(1).max(200).optional(),
  amount: z.coerce.number().min(0).default(0),
  expectedCloseDate: z.string().date().optional().nullable(),
  force: z.boolean().default(false),
})

function canAccessAll(permissions: string[]) {
  return hasPermission(permissions, 'lead:*') || hasPermission(permissions, 'lead:read')
}

export async function leadWorkflowRoutes(app: FastifyInstance) {
  app.post('/check-duplicates', { preHandler: requireAuth }, async (request, reply) => {
    const input = duplicateSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '查重字段格式不正确。', details: input.error.flatten() })
    const d = input.data
    const result = await db.query(`
      WITH candidates AS (
        SELECT l.id, 'lead'::text AS entity_type, l.company_name AS name, l.email::text, l.phone, l.status,
          greatest(similarity(lower(l.company_name), lower($2)),
            CASE WHEN $3::text IS NOT NULL AND lower(l.email::text) = lower($3) THEN 1 ELSE 0 END,
            CASE WHEN $4::text IS NOT NULL AND regexp_replace(l.phone, '\\D', '', 'g') = regexp_replace($4, '\\D', '', 'g') THEN .98 ELSE 0 END,
            CASE WHEN $5::text IS NOT NULL AND lower(l.website) = lower($5) THEN .95 ELSE 0 END) AS score,
          CASE WHEN $3::text IS NOT NULL AND lower(l.email::text) = lower($3) THEN '邮箱完全一致'
            WHEN $4::text IS NOT NULL AND regexp_replace(l.phone, '\\D', '', 'g') = regexp_replace($4, '\\D', '', 'g') THEN '电话完全一致'
            WHEN $5::text IS NOT NULL AND lower(l.website) = lower($5) THEN '网站完全一致'
            ELSE '公司名称相似' END AS match_reason
        FROM leads l WHERE l.tenant_id = $1 AND l.deleted_at IS NULL
          AND ($6::uuid IS NULL OR l.id <> $6) AND (similarity(lower(l.company_name), lower($2)) >= .55
            OR ($3::text IS NOT NULL AND lower(l.email::text) = lower($3))
            OR ($4::text IS NOT NULL AND regexp_replace(l.phone, '\\D', '', 'g') = regexp_replace($4, '\\D', '', 'g'))
            OR ($5::text IS NOT NULL AND lower(l.website) = lower($5)))
        UNION ALL
        SELECT a.id, 'account', a.name, c.email::text, c.phone, a.lifecycle_status,
          greatest(similarity(lower(a.name), lower($2)),
            CASE WHEN $3::text IS NOT NULL AND lower(c.email::text) = lower($3) THEN 1 ELSE 0 END,
            CASE WHEN $5::text IS NOT NULL AND lower(a.website) = lower($5) THEN .95 ELSE 0 END) AS score,
          CASE WHEN $3::text IS NOT NULL AND lower(c.email::text) = lower($3) THEN '客户联系人邮箱一致'
            WHEN $5::text IS NOT NULL AND lower(a.website) = lower($5) THEN '客户网站一致'
            ELSE '客户名称相似' END
        FROM accounts a LEFT JOIN contacts c ON c.account_id = a.id AND c.deleted_at IS NULL
        WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND (similarity(lower(a.name), lower($2)) >= .55
          OR ($3::text IS NOT NULL AND lower(c.email::text) = lower($3))
          OR ($5::text IS NOT NULL AND lower(a.website) = lower($5)))
      )
      SELECT DISTINCT ON (entity_type, id) * FROM candidates ORDER BY entity_type, id, score DESC
    `, [request.authUser.tenantId, d.companyName, d.email ?? null, d.phone ?? null, d.website ?? null, d.excludeLeadId ?? null])
    return { data: result.rows.sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 8) }
  })

  app.get('/:id/activities', { preHandler: requireAuth }, async (request, reply) => {
    const id = idSchema.safeParse(request.params)
    if (!id.success) return reply.code(400).send({ error: 'VALIDATION_ERROR' })
    const all = canAccessAll(request.authUser.permissions)
    const access = await db.query('SELECT 1 FROM leads WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid)', [id.data.id, request.authUser.tenantId, all, request.authUser.sub])
    if (!access.rows[0]) return reply.code(404).send({ error: 'NOT_FOUND' })
    const result = await db.query(`SELECT a.id, a.activity_type, a.subject, a.content, a.occurred_at, a.next_action, a.next_action_at, a.ai_generated, u.display_name AS actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.lead_id=$1 AND a.tenant_id=$2 ORDER BY a.occurred_at DESC LIMIT 100`, [id.data.id, request.authUser.tenantId])
    return { data: result.rows }
  })

  app.post('/:id/activities', { preHandler: requirePermission('lead:update') }, async (request, reply) => {
    const id = idSchema.safeParse(request.params)
    const input = activitySchema.safeParse(request.body)
    if (!id.success || !input.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: input.success ? undefined : input.error.flatten() })
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const all = canAccessAll(request.authUser.permissions)
      const lead = await client.query('SELECT id, company_name FROM leads WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [id.data.id, request.authUser.tenantId, all, request.authUser.sub])
      if (!lead.rows[0]) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'NOT_FOUND' }) }
      const d = input.data
      const activity = await client.query(`INSERT INTO activities (tenant_id,actor_id,lead_id,activity_type,subject,content,occurred_at,next_action,next_action_at) VALUES ($1,$2,$3,$4,$5,$6,coalesce($7,now()),$8,$9) RETURNING *`, [request.authUser.tenantId, request.authUser.sub, id.data.id, d.activityType, d.subject, d.content, d.occurredAt, d.nextAction, d.nextActionAt])
      if (d.nextAction && d.nextActionAt) await client.query(`INSERT INTO tasks (tenant_id,assignee_id,created_by,lead_id,title,description,due_at) VALUES ($1,$2,$2,$3,$4,$5,$6)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, d.nextAction, `跟进 ${lead.rows[0].company_name}`, d.nextActionAt])
      await client.query('UPDATE leads SET last_contact_at=$1, next_follow_up_at=$2, status=CASE WHEN status IN (\'new\',\'unassigned\') THEN \'contacted\' ELSE status END WHERE id=$3', [d.occurredAt ?? new Date().toISOString(), d.nextActionAt, id.data.id])
      await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'lead.activity.create','lead',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(activity.rows[0]), request.id])
      await client.query('COMMIT')
      return reply.code(201).send({ data: activity.rows[0] })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  app.post('/:id/convert', { preHandler: requirePermission('lead:convert') }, async (request, reply) => {
    const id = idSchema.safeParse(request.params)
    const input = conversionSchema.safeParse(request.body)
    if (!id.success || !input.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: input.success ? undefined : input.error.flatten() })
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const all = canAccessAll(request.authUser.permissions)
      const leadResult = await client.query('SELECT * FROM leads WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [id.data.id, request.authUser.tenantId, all, request.authUser.sub])
      const lead = leadResult.rows[0]
      if (!lead) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'NOT_FOUND' }) }
      if (lead.status === 'converted') { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'ALREADY_CONVERTED', message: '该线索已经完成转化。' }) }
      const accountName = input.data.accountName ?? lead.company_name
      const duplicate = await client.query(`SELECT id,name,similarity(lower(name),lower($2)) AS score FROM accounts WHERE tenant_id=$1 AND deleted_at IS NULL AND similarity(lower(name),lower($2))>=.72 ORDER BY score DESC LIMIT 3`, [request.authUser.tenantId, accountName])
      if (duplicate.rows.length && !input.data.force) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'DUPLICATE_ACCOUNT', message: '发现名称相似的现有客户，请确认后再转化。', details: duplicate.rows }) }
      const account = await client.query(`INSERT INTO accounts (tenant_id,owner_id,name,normalized_name,website,province,city,source,created_by) VALUES ($1::uuid,$2::uuid,$3::varchar,lower($3::text),$4::varchar,$5::varchar,$6::varchar,$7::varchar,$2::uuid) RETURNING *`, [request.authUser.tenantId, lead.owner_id ?? request.authUser.sub, accountName, lead.website, lead.province, lead.city, lead.source])
      let contact = null
      if (lead.contact_name || lead.email || lead.phone) {
        contact = (await client.query(`INSERT INTO contacts (tenant_id,account_id,full_name,email,phone,is_primary) VALUES ($1,$2,$3,$4,$5,true) RETURNING *`, [request.authUser.tenantId, account.rows[0].id, lead.contact_name ?? lead.company_name, lead.email, lead.phone])).rows[0]
      }
      let opportunity = null
      if (input.data.createOpportunity) {
        const stage = await client.query(`SELECT id FROM opportunity_stages WHERE tenant_id=$1 AND code='initial_contact'`, [request.authUser.tenantId])
        opportunity = (await client.query(`INSERT INTO opportunities (tenant_id,account_id,primary_contact_id,owner_id,source_lead_id,stage_id,name,amount,currency,expected_close_date,probability,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CNY',$9,20,$4) RETURNING *`, [request.authUser.tenantId, account.rows[0].id, contact?.id ?? null, lead.owner_id ?? request.authUser.sub, lead.id, stage.rows[0].id, input.data.opportunityName ?? `${accountName} 首次商机`, input.data.amount, input.data.expectedCloseDate])).rows[0]
      }
      await client.query(`UPDATE leads SET status='converted',converted_account_id=$1,converted_opportunity_id=$2,converted_at=now() WHERE id=$3`, [account.rows[0].id, opportunity?.id ?? null, lead.id])
      await client.query(`INSERT INTO audit_logs (tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES ($1,$2,'lead.convert','lead',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, lead.id, JSON.stringify({ accountId: account.rows[0].id, opportunityId: opportunity?.id ?? null }), request.id])
      await client.query('COMMIT')
      return reply.code(201).send({ data: { account: account.rows[0], contact, opportunity } })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })
}
