import { buildApp } from '../server/app.js'
import { db } from '../server/db.js'
import { callProductApi, parseBusinessData } from '../server/integrations/1688.js'

const app = await buildApp()
try {
  const row = (await db.query(`SELECT c.id,c.tenant_id,u.id AS actor_id FROM integration_1688_connections c JOIN tenants t ON t.id=c.tenant_id JOIN users u ON u.tenant_id=t.id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE t.slug=$1 AND c.status='connected' AND r.code='super_admin' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1`, [process.env.CRM_TENANT || 'default'])).rows[0]
  if (!row) throw new Error('An active shop connection and administrator are required')
  const token = app.jwt.sign({ sub: row.actor_id, tenantId: row.tenant_id, email: 'internal-sync', displayName: '内部同步', permissions: ['*'], roles: ['super_admin'] })
  const result = await app.inject({ method: 'POST', url: `/api/integrations/1688/connections/${row.id}/sync`, headers: { authorization: `Bearer ${token}` }, payload: { pageNo: 1 } })
  if (result.statusCode !== 200) { console.log(JSON.stringify({ syncVerified: false, error: result.json().error, message: result.json().message })); process.exitCode = 1 }
  else {
    console.log(JSON.stringify({ syncVerified: true, ...result.json().data }))
    const categoryId = (await db.query("SELECT snapshot->>'categoryID' AS cat FROM integration_1688_listings WHERE connection_id=$1 LIMIT 1", [row.id])).rows[0]?.cat
    if (categoryId) {
      const category = await callProductApi(row.id, row.tenant_id, row.actor_id, 'alibaba.category.get', { categoryID: categoryId })
      const info = (category.categoryInfo as Record<string, unknown>[] | undefined)?.[0]
      const scene = String(info?.categoryType) === '3' ? 'popular' : 'cbu'
      const schema = parseBusinessData(await callProductApi(row.id, row.tenant_id, row.actor_id, 'alibaba.new.product.getSchema', { catId: categoryId, scene }))
      console.log(JSON.stringify({ schemaVerified: true, categoryId, scene, fields: Object.keys(schema.data || {}) }))
    }
  }
} finally { await app.close(); await db.end() }
