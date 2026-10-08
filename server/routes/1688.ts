import { deleteListingRoutes } from './1688-delete.js'
import { validateLogistics } from '../../shared/1688-logistics.js'
import { titleLength, titleLimit } from '../../shared/1688-title.js'
import { publishTemplateRoutes } from './1688-publish-template.js'
import { fillPublishTemplate } from '../integrations/1688-publish-template.js'
import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../auth.js'
import { db } from '../db.js'
import { listingBindingRoutes } from './1688-bindings.js'
import { agent1688Routes } from './1688-agent.js'
import { agentImageRoutes } from './1688-images.js'
import { collectionQueueRoutes } from './1688-queue.js'
import { buildSkuRows, mapReviewedVariants, saleDimensions, skuKey, type SkuRow } from '../../shared/1688-skus.js'
import { appCredentials, callProductApi, connectionToken, getGrant, IntegrationError, parseBusinessData, parsePlatformJson, publicConnectionColumns, recordOperation, saveConnection, stateHash, testMember, uploadPhoto } from '../integrations/1688.js'
import { createDraftFromProduct } from '../integrations/1688-drafts.js'

const idSchema = z.object({ id: z.string().uuid() })
const digitId = z.string().regex(/^\d{1,20}$/)
const scene = z.enum(['cbu','popular','industry','processing'])
const listInput = z.object({ connectionId: z.string().uuid().optional(), search: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1) })
const draftInput = z.object({ connectionId: z.string().uuid(), productId: z.string().uuid(), catId: digitId, scene })
type Json = Record<string, any>

async function connectionExists(id: string, tenantId: string) {
  const row = (await db.query('SELECT id FROM integration_1688_connections WHERE id=$1 AND tenant_id=$2', [id, tenantId])).rows[0]
  if (!row) throw new IntegrationError('NOT_FOUND', '店铺连接不存在。', 404)
}
async function audit(tenantId: string, actorId: string, id: string, action: string, requestId: string) {
  await db.query('INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,request_id)VALUES($1,$2,$3,\'1688_connection\',$4,$5)', [tenantId, actorId, action, id, requestId])
}

export function validatePublishBody(schema: Json, body: Json): string[] {
  const values = body.formValues || {}
  const missing: string[] = []
  for (const [key, component] of Object.entries(schema.data || {}) as [string, Json][]) {
    const fields = component.fields || {}
    if (fields.visible === false || fields.readonly === true) continue
    const value = values[key]
    const empty = value == null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)
    if (fields.required && empty) missing.push(fields.label || key)
    if(key==='officialLogistics')missing.push(...validateLogistics(fields,value,values.skuTable))
    if (key !== 'title' && typeof value === 'string' && fields.maxLength && value.length > fields.maxLength) missing.push(`${fields.label || key}超过字数限制`)
    if (typeof value === 'number' && (!Number.isFinite(value) || value < (fields.min ?? 0))) missing.push(`${fields.label || key}数值不合法`)
    if (key === 'catProp' && Array.isArray(fields.dataSource)) {
      for (const prop of fields.dataSource) {
        const selected = value?.[prop.name]
        if (prop.required && prop.visible !== false && (selected == null || selected === '' || (Array.isArray(selected) && !selected.length) || (typeof selected === 'object' && !Array.isArray(selected) && selected.value == null))) missing.push(prop.label || prop.name)
      }
    }
    if (Array.isArray(fields.column) && Array.isArray(value)) {
      value.forEach((row: Json, index: number) => {
        for (const column of fields.column) {
          if (column.visible === false) continue
          const cell = row?.[column.name]
          if (column.required && (cell == null || cell === '')) missing.push(`${fields.label || key}第${index + 1}行${column.label}`)
          if (column.uiType === 'cbunumber' && cell != null && (typeof cell !== 'number' || !Number.isFinite(cell) || cell < 0)) missing.push(`${fields.label || key}第${index + 1}行${column.label}数值不合法`)
        }
      })
    }
  }
  if (typeof values.title !== 'string' || !values.title.trim()) missing.push('商品标题')
  else if(titleLength(values.title)>titleLimit(schema))missing.push(`商品标题超过 ${titleLimit(schema)} 个长度单位（中文计 2，英文和数字计 1）`)
  if (!Array.isArray(values.primaryPicture?.imageList) || !values.primaryPicture.imageList.length) missing.push('商品主图')
  else {
    const max = schema.data?.primaryPicture?.fields?.maxItems
    if (max && values.primaryPicture.imageList.length > max) missing.push('商品主图数量超限')
    if (values.primaryPicture.imageList.some((image: Json) => typeof image?.url !== 'string' || !/^(https:\/\/|img\/)/.test(image.url))) missing.push('商品主图地址')
  }
  if (Array.isArray(values.skuTable)) {
    if (values.skuTable.length > 2000) missing.push('SKU 数量超限')
    for (const row of values.skuTable) if (!row || !Array.isArray(row.sku_props) || !row.sku_props.length || !Number.isInteger(row.sku_amountOnSale) || row.sku_amountOnSale < 0) { missing.push('SKU 规格和库存'); break }
  }
  const dimensions = saleDimensions(schema)
  if (dimensions.length) {
    try {
      const expected = buildSkuRows(dimensions, values.saleProp || {})
      const rows = Array.isArray(values.skuTable) ? values.skuTable as SkuRow[] : []
      const expectedKeys = new Set(expected.map(row => skuKey(row.sku_props)))
      const actualKeys = new Set(rows.filter(row => Array.isArray(row?.sku_props)).map(row => skuKey(row.sku_props)))
      if (rows.length !== actualKeys.size || (expected.length && !rows.length) || [...actualKeys].some(key => !expectedKeys.has(key))) missing.push('销售规格与 SKU 组合不一致')
    } catch (error) { missing.push(error instanceof Error ? error.message : '销售规格不合法') }
  }
  if (String(values.quotationType?.value) === '1' && (!Array.isArray(values.skuTable) || !values.skuTable.length || values.skuTable.some((row:Json) => typeof row.sku_price !== 'number' || row.sku_price <= 0))) missing.push('按规格报价的 SKU 单价')
  if (Array.isArray(values.priceRange)) for (const row of values.priceRange) if (!row || !Number.isInteger(row.pricerange_beginAmount) || row.pricerange_beginAmount < 1 || typeof row.pricerange_price !== 'number' || row.pricerange_price <= 0) { missing.push('阶梯报价与起批量'); break }
  return [...new Set(missing)]
}

async function saveListing(tenantId: string, connectionId: string, info: Json, productId?: string) {
  const offerId = String(info.productID || info.itemId || '')
  if (!/^\d+$/.test(offerId)) throw new IntegrationError('INVALID_PRODUCT', '平台商品缺少有效 ID。')
  const image = info.image?.images?.[0] || null
  const saved = await db.query(`INSERT INTO integration_1688_listings(tenant_id,connection_id,offer_id,product_id,title,status,image_url,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(connection_id,offer_id) DO UPDATE SET product_id=coalesce(excluded.product_id,integration_1688_listings.product_id),title=excluded.title,status=excluded.status,image_url=excluded.image_url,snapshot=excluded.snapshot,synced_at=now(),binding_revision=integration_1688_listings.binding_revision+CASE WHEN excluded.product_id IS NOT NULL AND integration_1688_listings.product_id IS DISTINCT FROM excluded.product_id THEN 1 ELSE 0 END,sku_bindings=CASE WHEN excluded.product_id IS NOT NULL AND integration_1688_listings.product_id IS DISTINCT FROM excluded.product_id THEN '[]'::jsonb ELSE integration_1688_listings.sku_bindings END
    WHERE excluded.product_id IS NULL OR integration_1688_listings.product_id IS NULL OR integration_1688_listings.product_id=excluded.product_id RETURNING id`,
    [tenantId, connectionId, offerId, productId || null, String(info.subject || ''), String(info.status || 'unknown'), typeof image === 'string' ? image : null, JSON.stringify(info)])
  if (!saved.rows.length) throw new IntegrationError('BINDING_CONFLICT', '平台商品已关联其他正式产品，不能覆盖。', 409)
}

export async function publishDraft(request: Pick<FastifyRequest,'params'|'body'|'authUser'|'id'>, agent?:{jobId:string;settingsRevision:number;queue?:{id:string;workerId:string}}) {
    const { id } = idSchema.parse(request.params)
    const { revision } = z.object({ revision: z.number().int().positive(), confirmed: z.literal(true) }).parse(request.body)
    const row = (await db.query('SELECT * FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2', [id, request.authUser.tenantId])).rows[0]
    if (!row) throw new IntegrationError('NOT_FOUND', '草稿不存在。', 404)
    if (row.status === 'published') return { data: { offerId: row.offer_id, status: row.status } }
    const product = (await db.query("SELECT id FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND status='active'", [row.product_id, request.authUser.tenantId])).rows[0]
    if (!product) throw new IntegrationError('PRODUCT_INACTIVE', '正式产品已停用或删除，不能发布。', 409)
    const variantCount=Number((await db.query('SELECT count(*) AS count FROM product_variants WHERE product_id=$1 AND tenant_id=$2',[row.product_id,request.authUser.tenantId])).rows[0].count)
    const skuCount=Array.isArray(row.data_body.formValues?.skuTable)?row.data_body.formValues.skuTable.length:0
    if(variantCount>0&&(saleDimensions(row.platform_schema).length>0||variantCount>1)&&skuCount!==variantCount)throw new IntegrationError('SKU_COVERAGE_MISSING',`正式产品有 ${variantCount} 个 SKU，发布草稿只有 ${skuCount} 个。请在销售规格中映射正式 SKU，并核对各规格库存后再发布。`,400)
    const missing = validatePublishBody(row.platform_schema, row.data_body)
    if (missing.length) throw new IntegrationError('MISSING_FIELDS', `请补全：${missing.join('、')}`, 400)
    const claim = await db.connect()
    try {
      await claim.query('BEGIN')
      await claim.query('SELECT id FROM integration_1688_connections WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[row.connection_id,request.authUser.tenantId])
      if(agent){
        const settings=(await claim.query('SELECT enabled,revision FROM integration_1688_agent_settings WHERE connection_id=$1 AND tenant_id=$2 FOR UPDATE',[row.connection_id,request.authUser.tenantId])).rows[0]
        const job=(await claim.query('SELECT status FROM integration_1688_agent_jobs WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[agent.jobId,request.authUser.tenantId])).rows[0]
        if(!settings?.enabled||settings.revision!==agent.settingsRevision||job?.status!=='publishing')throw new IntegrationError('AGENT_STOPPED','Agent 模式已关闭、配置变化或任务已取消，本次未发布。',409)
        if(agent.queue){
          const queued=(await claim.query('SELECT status,worker_id,lease_until FROM integration_1688_collection_queue_jobs WHERE id=$1 AND tenant_id=$2 AND connection_id=$3 FOR UPDATE',[agent.queue.id,request.authUser.tenantId,row.connection_id])).rows[0]
          const mode=(await claim.query('SELECT enabled FROM integration_1688_collection_queue_settings WHERE connection_id=$1',[row.connection_id])).rows[0]
          if(!mode?.enabled||queued?.status!=='processing'||queued.worker_id!==agent.queue.workerId||!queued.lease_until||new Date(queued.lease_until).getTime()<=Date.now())throw new IntegrationError('QUEUE_STOPPED','采集队列已停用或任务租约失效，本次未发布。',409)
        }
      }
      const binding=(await claim.query('SELECT id FROM integration_1688_listings WHERE connection_id=$1 AND product_id=$2 AND tenant_id=$3',[row.connection_id,row.product_id,request.authUser.tenantId])).rows[0]
      if(binding)throw new IntegrationError('PRODUCT_ALREADY_BOUND','该产品已关联平台商品，不能再新建发布。',409)
      const claimed = await claim.query("UPDATE integration_1688_publish_drafts SET status='submitting',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$3 AND status IN ('draft','failed') RETURNING id", [id, request.authUser.tenantId, revision])
      if (!claimed.rows.length) throw new IntegrationError('DRAFT_CONFLICT', '草稿已变更或正在提交，不能重复发布。', 409)
      await claim.query('COMMIT')
    }catch(error){await claim.query('ROLLBACK');throw error}finally{claim.release()}
    let platformResponded = false
    try {
      const args: Json = { scene: row.scene, dataBody: row.data_body }
      if (row.scene === 'industry') args.bizParam = { industryCategoryId: row.cat_id }
      else args.catId = row.cat_id
      const result = await callProductApi(row.connection_id, request.authUser.tenantId, request.authUser.sub, 'alibaba.new.product.add', args, request.id)
      platformResponded = true
      const data = parseBusinessData(result)
      const value = typeof data.dataJson === 'string' ? parsePlatformJson(data.dataJson) : data.dataJson as Json
      const offerId = value?.itemId && String(value.itemId)
      if (!offerId || !/^\d+$/.test(offerId)) throw new IntegrationError('PUBLISH_UNKNOWN', '平台接受了请求但未返回商品 ID，请在店铺核对结果。')
      await db.query("UPDATE integration_1688_publish_drafts SET status='published',offer_id=$2,last_error_code=NULL,updated_at=now() WHERE id=$1", [id, offerId])
      await saveListing(request.authUser.tenantId, row.connection_id, { productID: offerId, subject: row.data_body.formValues.title, status: value.offerStatus || 'submitted', image: { images: row.data_body.formValues.primaryPicture.imageList.map((image: Json) => image.url) } }, row.product_id)
      await audit(request.authUser.tenantId, request.authUser.sub, row.connection_id, '1688.publish', request.id)
      return { data: { offerId, status: 'published' } }
    } catch (error) {
      const unknown = platformResponded || !(error instanceof IntegrationError) || ['NETWORK_ERROR','INVALID_RESPONSE','PUBLISH_UNKNOWN','INVALID_SCHEMA','EMPTY_SCHEMA'].includes(error.code)
      await db.query('UPDATE integration_1688_publish_drafts SET status=$2,last_error_code=$3,updated_at=now() WHERE id=$1', [id, unknown ? 'unknown' : 'failed', error instanceof IntegrationError ? error.code : 'INTERNAL_ERROR'])
      throw error
    }
}

export async function integration1688Routes(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IntegrationError) return reply.code(error.statusCode).send({ error: error.code, message: error.message })
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '字段格式不正确。', details: error.flatten() })
    request.log.error({ error: error instanceof Error ? error.name : 'UnknownError' }, '1688 integration failed')
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: '1688 集成处理失败，请稍后重试。' })
  })
  await listingBindingRoutes(app)
  await deleteListingRoutes(app)
  await publishTemplateRoutes(app)
  await agent1688Routes(app, publishDraft)
  await collectionQueueRoutes(app)
  await agentImageRoutes(app)

  app.get('/connections', { preHandler: requirePermission('integration:read') }, async request => {
    const rows = await db.query(`SELECT ${publicConnectionColumns} FROM integration_1688_connections WHERE tenant_id=$1 ORDER BY created_at`, [request.authUser.tenantId])
    return { data: rows.rows, configured: Boolean(process.env.ALI1688_APP_KEY && process.env.ALI1688_APP_SECRET && process.env.ALI1688_REDIRECT_URI) }
  })
  app.post('/authorizations', { preHandler: requirePermission('integration:manage') }, async request => {
    const credentials = appCredentials()
    const state = randomBytes(32).toString('hex')
    await db.query('INSERT INTO integration_1688_oauth_states(state_hash,tenant_id,created_by,app_key,redirect_uri,expires_at)VALUES($1,$2,$3,$4,$5,now()+interval \'10 minutes\')', [stateHash(state), request.authUser.tenantId, request.authUser.sub, credentials.appKey, credentials.redirect])
    const url = new URL('https://auth.1688.com/oauth/authorize')
    url.search = new URLSearchParams({ client_id: credentials.appKey, site: '1688', redirect_uri: credentials.redirect, state }).toString()
    return { data: { authorizationUrl: url.href } }
  })
  app.post('/authorizations/complete', { preHandler: requirePermission('integration:manage') }, async (request, reply) => {
    const input = z.object({ callbackUrl: z.string().url().max(8192) }).parse(request.body)
    const credentials = appCredentials()
    const callback = new URL(input.callbackUrl), expected = new URL(credentials.redirect)
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.searchParams.getAll('code').length !== 1 || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.has('error')) throw new IntegrationError('INVALID_CALLBACK', '请填写本次成功授权的完整回跳地址。', 400)
    const code = callback.searchParams.get('code'), state = callback.searchParams.get('state')
    if (!code || !state) throw new IntegrationError('INVALID_CALLBACK', '回跳地址缺少授权码或 state。', 400)
    const consumed = await db.query(`UPDATE integration_1688_oauth_states SET consumed_at=now() WHERE state_hash=$1 AND tenant_id=$2 AND created_by=$3 AND app_key=$4 AND redirect_uri=$5 AND consumed_at IS NULL AND expires_at>now() RETURNING state_hash`, [stateHash(state), request.authUser.tenantId, request.authUser.sub, credentials.appKey, credentials.redirect])
    if (!consumed.rows.length) throw new IntegrationError('INVALID_STATE', '授权状态无效、过期或已使用，请重新发起。', 409)
    const start = Date.now()
    try {
      const row = await saveConnection(request.authUser.tenantId, request.authUser.sub, await getGrant({ code }))
      await recordOperation(request.authUser.tenantId, row.id, request.authUser.sub, 'oauth.authorize', start, undefined, request.id)
      await audit(request.authUser.tenantId, request.authUser.sub, row.id, '1688.authorize', request.id)
      return reply.code(201).send({ data: row })
    } catch (error) { await recordOperation(request.authUser.tenantId, null, request.authUser.sub, 'oauth.authorize', start, error, request.id); throw error }
  })
  app.post('/connections/:id/test', { preHandler: requirePermission('integration:manage') }, async request => {
    const { id } = idSchema.parse(request.params)
    return { data: await testMember(id, request.authUser.tenantId, request.authUser.sub, request.id) }
  })
  app.post('/connections/:id/refresh', { preHandler: requirePermission('integration:manage') }, async request => {
    const { id } = idSchema.parse(request.params)
    await connectionToken(id, request.authUser.tenantId, request.authUser.sub, true)
    return { data: { refreshed: true } }
  })
  app.post('/connections/:id/disable', { preHandler: requirePermission('integration:manage') }, async request => {
    const { id } = idSchema.parse(request.params)
    const result = await db.query("UPDATE integration_1688_connections SET status='disabled',updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id", [id, request.authUser.tenantId])
    if (!result.rows.length) throw new IntegrationError('NOT_FOUND', '连接不存在。', 404)
    await audit(request.authUser.tenantId, request.authUser.sub, id, '1688.disable', request.id)
    return { data: { disabled: true } }
  })
  app.get('/operations', { preHandler: requirePermission('integration:read') }, async request => {
    const { page } = listInput.parse(request.query)
    return { data: (await db.query('SELECT o.id,o.api_name,o.outcome,o.error_code,o.duration_ms,o.created_at,c.display_name FROM integration_1688_operations o LEFT JOIN integration_1688_connections c ON c.id=o.connection_id WHERE o.tenant_id=$1 ORDER BY o.created_at DESC LIMIT 50 OFFSET $2', [request.authUser.tenantId, (page - 1) * 50])).rows }
  })
  app.post('/connections/:id/sync', { preHandler: requirePermission('integration:manage') }, async request => {
    const { id } = idSchema.parse(request.params)
    const input = z.object({ pageNo: z.number().int().min(1).max(10000).default(1) }).parse(request.body || {})
    const response = await callProductApi(id, request.authUser.tenantId, request.authUser.sub, 'alibaba.product.list.get', { pageNo: input.pageNo, pageSize: 20, orderByCondition: 'ID', orderByType: 'ASC', needDetail: true }, request.id)
    const page = (response.result as Json)?.pageResult as Json
    if (!page || !Array.isArray(page.resultList)) throw new IntegrationError('INVALID_LIST', '平台商品列表格式不正确。')
    for (const info of page.resultList) await saveListing(request.authUser.tenantId, id, info)
    return { data: { count: page.resultList.length, total: Number(page.totalRecords || 0), pageNo: input.pageNo, hasMore: page.resultList.length === 20 && (!page.totalRecords || input.pageNo * 20 < Number(page.totalRecords)) } }
  })
  app.get('/listings', { preHandler: requirePermission('integration:read') }, async request => {
    const input = listInput.parse(request.query)
    const rows = await db.query(`SELECT l.id,l.connection_id,l.offer_id,l.product_id,l.title,l.status,l.deletion_state,l.image_url,l.synced_at,c.display_name,p.sku FROM integration_1688_listings l JOIN integration_1688_connections c ON c.id=l.connection_id LEFT JOIN products p ON p.id=l.product_id WHERE l.tenant_id=$1 AND ($2::uuid IS NULL OR l.connection_id=$2) AND ($3::text IS NULL OR l.title ILIKE '%'||$3||'%' OR l.offer_id=$3) ORDER BY l.synced_at DESC,l.offer_id LIMIT 20 OFFSET $4`, [request.authUser.tenantId, input.connectionId || null, input.search || null, (input.page - 1) * 20])
    return { data: rows.rows }
  })
  app.get('/listings/:id', { preHandler: requirePermission('integration:read') }, async request => {
    const { id } = idSchema.parse(request.params)
    const row = (await db.query('SELECT l.*,c.display_name FROM integration_1688_listings l JOIN integration_1688_connections c ON c.id=l.connection_id WHERE l.id=$1 AND l.tenant_id=$2', [id, request.authUser.tenantId])).rows[0]
    if (!row) throw new IntegrationError('NOT_FOUND', '平台商品不存在。', 404)
    return { data: row }
  })
  app.post('/listings/:id/refresh', { preHandler: requirePermission('integration:manage') }, async request => {
    const { id } = idSchema.parse(request.params)
    const row = (await db.query('SELECT l.*,c.display_name FROM integration_1688_listings l JOIN integration_1688_connections c ON c.id=l.connection_id WHERE l.id=$1 AND l.tenant_id=$2', [id, request.authUser.tenantId])).rows[0]
    if (!row) throw new IntegrationError('NOT_FOUND', '平台商品不存在。', 404)
    const data = await callProductApi(row.connection_id, request.authUser.tenantId, request.authUser.sub, 'alibaba.product.get', { productID: row.offer_id, webSite: '1688' }, request.id)
    if (!data.productInfo || typeof data.productInfo !== 'object') throw new IntegrationError('INVALID_PRODUCT', '平台没有返回商品详情。')
    await saveListing(request.authUser.tenantId, row.connection_id, data.productInfo)
    return { data: { refreshed: true } }
  })
  app.get('/connections/:id/categories', { preHandler: requirePermission('integration:read') }, async request => {
    const { id } = idSchema.parse(request.params)
    const { keyword } = z.object({ keyword: z.string().trim().min(1).max(50) }).parse(request.query)
    const result = await callProductApi(id, request.authUser.tenantId, request.authUser.sub, 'alibaba.category.searchByKeyword', { keyword }, request.id)
    return { data: result.products || [] }
  })
  app.post('/connections/:id/photos', { preHandler: requirePermission('integration:publish'), bodyLimit: 3_000_000 }, async request => {
    const { id } = idSchema.parse(request.params)
    const input = z.object({ albumId: digitId, name: z.string().trim().min(1).max(30), content: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(2_800_000), mime: z.enum(['image/jpeg','image/png','image/gif','image/bmp']) }).parse(request.body)
    const bytes = Buffer.from(input.content, 'base64')
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new IntegrationError('IMAGE_SIZE', '图片大小须在 2MB 内。', 400)
    const signatures: Record<string, boolean> = { 'image/jpeg': bytes[0] === 255 && bytes[1] === 216, 'image/png': bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'image/gif': /^GIF8[79]a$/.test(bytes.subarray(0,6).toString()), 'image/bmp': bytes.subarray(0,2).toString() === 'BM' }
    if (!signatures[input.mime]) throw new IntegrationError('IMAGE_FORMAT', '图片格式与文件内容不一致。', 400)
    return { data: await uploadPhoto(id, request.authUser.tenantId, request.authUser.sub, input.albumId, input.name, bytes, input.mime, request.id) }
  })
  app.post('/listings/:id/stock', { preHandler: requirePermission('integration:publish') }, async request => {
    const { id } = idSchema.parse(request.params)
    const input = z.object({ confirmed: z.literal(true), stocks: z.array(z.object({ specId: z.string().max(100).nullable(), before: z.number().int().nonnegative(), after: z.number().int().nonnegative() })).min(1).max(2000) }).parse(request.body)
    const row = (await db.query('SELECT l.*,c.display_name FROM integration_1688_listings l JOIN integration_1688_connections c ON c.id=l.connection_id WHERE l.id=$1 AND l.tenant_id=$2', [id, request.authUser.tenantId])).rows[0]
    if (!row) throw new IntegrationError('NOT_FOUND', '平台商品不存在。', 404)
    if(row.deletion_state!=='active')throw new IntegrationError('LISTING_UNAVAILABLE','商品已删除或删除结果待核对，不能修改库存。',409)
    const current = await callProductApi(row.connection_id, request.authUser.tenantId, request.authUser.sub, 'alibaba.product.get', { productID: row.offer_id, webSite: '1688' }, request.id)
    const info = current.productInfo as Json
    if (!info) throw new IntegrationError('INVALID_PRODUCT', '无法读取最新库存。')
    const skus = Array.isArray(info.skuInfos) ? info.skuInfos as Json[] : []
    const unique = new Set(input.stocks.map(stock => stock.specId))
    if (unique.size !== input.stocks.length || (skus.length && input.stocks.some(stock => !stock.specId)) || (!skus.length && (input.stocks.length !== 1 || input.stocks[0].specId !== null))) throw new IntegrationError('INVALID_STOCKS', '请使用平台商品的实际规格更新库存。', 400)
    for (const stock of input.stocks) {
      const amount = stock.specId ? skus.find(sku => String(sku.specId) === stock.specId)?.amountOnSale : info.saleInfo?.amountOnSale
      if (amount == null || Number(amount) !== stock.before) throw new IntegrationError('STOCK_CONFLICT', '平台库存已变化，请刷新后重新确认。', 409)
    }
    const changes = input.stocks.filter(stock => stock.before !== stock.after)
    if (!changes.length) throw new IntegrationError('NO_CHANGE', '库存没有变更。', 400)
    const change = skus.length ? { productId: row.offer_id, skuStocks: changes.map(stock => ({ skuId: stock.specId, stockChange: stock.after })) } : { productId: row.offer_id, productAmountChange: changes[0].after }
    await callProductApi(row.connection_id, request.authUser.tenantId, request.authUser.sub, 'alibaba.product.modifyStock', { webSite: '1688', increaceModify: false, productStockChange: [change] }, request.id)
    await audit(request.authUser.tenantId, request.authUser.sub, row.connection_id, '1688.stock.update', request.id)
    return { data: { updated: true } }
  })
  app.get('/drafts', { preHandler: requirePermission('integration:read') }, async request => ({ data: (await db.query('SELECT d.id,d.connection_id,d.product_id,d.cat_id,d.scene,d.revision,d.status,d.offer_id,d.last_error_code,d.updated_at,p.name,p.sku,c.display_name FROM integration_1688_publish_drafts d JOIN products p ON p.id=d.product_id JOIN integration_1688_connections c ON c.id=d.connection_id WHERE d.tenant_id=$1 ORDER BY d.updated_at DESC LIMIT 100', [request.authUser.tenantId])).rows }))
  app.post('/drafts', { preHandler: [requirePermission('integration:publish'), requirePermission('product:read')] }, async (request, reply) => {
    const input = draftInput.parse(request.body)
    const product = (await db.query("SELECT * FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND status='active'", [input.productId, request.authUser.tenantId])).rows[0]
    if (!product) throw new IntegrationError('NOT_FOUND', '请先审核并启用正式产品。', 404)
    await connectionExists(input.connectionId, request.authUser.tenantId)
    const row=await createDraftFromProduct({tenantId:request.authUser.tenantId,actorId:request.authUser.sub,requestId:request.id,connectionId:input.connectionId,product,catId:input.catId,scene:input.scene})
    return reply.code(201).send({ data: row, missing: validatePublishBody(row.platform_schema,row.data_body) })
  })
  app.get('/drafts/:id', { preHandler: requirePermission('integration:read') }, async request => {
    const { id } = idSchema.parse(request.params)
    const row = (await db.query('SELECT * FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2', [id, request.authUser.tenantId])).rows[0]
    if (!row) throw new IntegrationError('NOT_FOUND', '发布草稿不存在。', 404)
    return { data: row, missing: validatePublishBody(row.platform_schema, row.data_body) }
  })
  app.patch('/drafts/:id', { preHandler: requirePermission('integration:publish'), bodyLimit: 2_000_000 }, async request => {
    const { id } = idSchema.parse(request.params)
    const input = z.object({ revision: z.number().int().positive(), formValues: z.record(z.string(), z.unknown()) }).parse(request.body)
    const row = (await db.query(`UPDATE integration_1688_publish_drafts SET data_body=jsonb_set(data_body,'{formValues}',$4::jsonb),revision=revision+1,status='draft',last_error_code=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$3 AND status IN ('draft','failed') RETURNING *`, [id, request.authUser.tenantId, input.revision, JSON.stringify(input.formValues)])).rows[0]
    if (!row) throw new IntegrationError('DRAFT_CONFLICT', '草稿已被修改或不可编辑，请重新加载。', 409)
    return { data: row, missing: validatePublishBody(row.platform_schema, row.data_body) }
  })
  app.post('/drafts/:id/apply-template', { preHandler: requirePermission('integration:publish') }, async request => {
    const {id}=idSchema.parse(request.params),{revision}=z.object({revision:z.number().int().positive()}).parse(request.body)
    const tenant=request.authUser.tenantId
    const draft=(await db.query('SELECT * FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2',[id,tenant])).rows[0]
    if(!draft)throw new IntegrationError('NOT_FOUND','发布草稿不存在。',404)
    const values=await fillPublishTemplate(tenant,draft.platform_schema,draft.data_body.formValues)
    const row=(await db.query("UPDATE integration_1688_publish_drafts SET data_body=jsonb_set(data_body,'{formValues}',$4::jsonb),revision=revision+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$3 AND status IN ('draft','failed') RETURNING *",[id,tenant,revision,JSON.stringify(values)])).rows[0]
    if(!row)throw new IntegrationError('DRAFT_CONFLICT','草稿已变化或不可编辑，请重新加载。',409)
    return {data:row,missing:validatePublishBody(row.platform_schema,row.data_body)}
  })
  app.get('/drafts/:id/variants', { preHandler: [requirePermission('integration:read'), requirePermission('product:read')] }, async request => {
    const { id } = idSchema.parse(request.params)
    const draft = (await db.query('SELECT product_id FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2', [id, request.authUser.tenantId])).rows[0]
    if (!draft) throw new IntegrationError('NOT_FOUND', '发布草稿不存在。', 404)
    return { data: (await db.query('SELECT id,label,attributes,unit_price,stock,image_url FROM product_variants WHERE product_id=$1 AND tenant_id=$2 ORDER BY position', [draft.product_id, request.authUser.tenantId])).rows }
  })
  app.post('/drafts/:id/map-variants', { preHandler: [requirePermission('integration:publish'), requirePermission('product:read')] }, async request => {
    const { id } = idSchema.parse(request.params)
    const input = z.object({ revision: z.number().int().positive(), mapping: z.record(z.string(),z.string().trim().min(1).max(100)), confirmed: z.literal(true) }).parse(request.body)
    const draft = (await db.query("SELECT * FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2", [id, request.authUser.tenantId])).rows[0]
    if (!draft) throw new IntegrationError('NOT_FOUND', '发布草稿不存在。', 404)
    if (draft.revision !== input.revision || !['draft','failed'].includes(draft.status)) throw new IntegrationError('DRAFT_CONFLICT', '草稿已变化或不可编辑。', 409)
    const variants = (await db.query('SELECT id,label,attributes,unit_price,stock,image_url FROM product_variants WHERE product_id=$1 AND tenant_id=$2 ORDER BY position', [draft.product_id, request.authUser.tenantId])).rows
    let mapped
    try { mapped = mapReviewedVariants(saleDimensions(draft.platform_schema), variants, input.mapping) } catch (error) { throw new IntegrationError('INVALID_MAPPING', error instanceof Error ? error.message : '规格映射不合法。', 400) }
    const formValues = { ...draft.data_body.formValues, ...mapped }
    const row = (await db.query("UPDATE integration_1688_publish_drafts SET data_body=jsonb_set(data_body,'{formValues}',$4::jsonb),revision=revision+1,status='draft',last_error_code=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$3 AND status IN ('draft','failed') RETURNING *", [id, request.authUser.tenantId, input.revision, JSON.stringify(formValues)])).rows[0]
    if (!row) throw new IntegrationError('DRAFT_CONFLICT', '草稿已被其他人修改，请重新加载。', 409)
    await audit(request.authUser.tenantId,request.authUser.sub,row.connection_id,'1688.draft.map-variants',request.id)
    return { data: row, missing: validatePublishBody(row.platform_schema,row.data_body) }
  })
  app.post('/drafts/:id/sku-rules', { preHandler: requirePermission('integration:publish') }, async request => {
    const { id } = idSchema.parse(request.params)
    const input = z.object({ revision:z.number().int().positive() }).parse(request.body)
    const draft = (await db.query('SELECT * FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2', [id,request.authUser.tenantId])).rows[0]
    if (!draft) throw new IntegrationError('NOT_FOUND','发布草稿不存在。',404)
    if (draft.revision !== input.revision || !['draft','failed'].includes(draft.status)) throw new IntegrationError('DRAFT_CONFLICT','草稿已变化或不可编辑。',409)
    const component = draft.platform_schema.data?.skuTable
    if (!(component?.supportLevelProp === true || component?.fields?.supportLevelProp === true)) throw new IntegrationError('CASCADE_UNSUPPORTED','平台未声明 SKU 组件支持级联规则。',400)
    const args:Json = {catId:draft.cat_id,scene:draft.scene,dataBody:{global:draft.data_body.global,data:{skuTable:{}}}}
    if (draft.scene === 'industry') args.bizParam = {industryCategoryId:draft.cat_id}
    const partial = parseBusinessData(await callProductApi(draft.connection_id,request.authUser.tenantId,request.authUser.sub,'alibaba.new.product.getSubSchema',args,request.id)) as Json
    if (partial.reload === true) throw new IntegrationError('SCHEMA_RELOAD_REQUIRED','平台要求重新获取完整类目规则，本次未修改草稿。',409)
    if (!partial.data?.skuTable?.fields || !Array.isArray(partial.data.skuTable.fields.column)) throw new IntegrationError('INVALID_SCHEMA','平台未返回有效 SKU 子规则。')
    const schema = {...draft.platform_schema,data:{...draft.platform_schema.data,skuTable:{...component,...partial.data.skuTable,fields:{...component.fields,...partial.data.skuTable.fields}}}}
    const row = (await db.query("UPDATE integration_1688_publish_drafts SET platform_schema=$4::jsonb,revision=revision+1,status='draft',last_error_code=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$3 AND status IN ('draft','failed') RETURNING *",[id,request.authUser.tenantId,input.revision,JSON.stringify(schema)])).rows[0]
    if (!row) throw new IntegrationError('DRAFT_CONFLICT','规则读取期间草稿已被修改，请重新加载。',409)
    return {data:row,missing:validatePublishBody(schema,row.data_body)}
  })
  app.post('/drafts/:id/publish', { preHandler: requirePermission('integration:publish') }, request => publishDraft(request))
  app.post('/drafts/:id/reconcile', { preHandler: requirePermission('integration:publish') }, async request => {
    const { id } = idSchema.parse(request.params)
    const { offerId } = z.object({ offerId: digitId }).parse(request.body)
    const row = (await db.query("SELECT * FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2 AND (status='unknown' OR (status='submitting' AND updated_at<now()-interval '2 minutes'))", [id, request.authUser.tenantId])).rows[0]
    if (!row) throw new IntegrationError('DRAFT_CONFLICT', '该草稿没有需要核对的未知发布结果。', 409)
    const result = await callProductApi(row.connection_id, request.authUser.tenantId, request.authUser.sub, 'alibaba.product.get', { productID: offerId, webSite: '1688' }, request.id)
    const info = result.productInfo as Json
    if (!info || String(info.productID) !== offerId || info.subject !== row.data_body.formValues.title) throw new IntegrationError('PRODUCT_MISMATCH', '该平台商品与草稿标题不一致，不能关联。', 409)
    await saveListing(request.authUser.tenantId, row.connection_id, info, row.product_id)
    await db.query("UPDATE integration_1688_publish_drafts SET status='published',offer_id=$2,last_error_code=NULL,updated_at=now() WHERE id=$1", [id, offerId])
    return { data: { offerId, status: 'published' } }
  })
}
