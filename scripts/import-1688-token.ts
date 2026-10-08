import { readFile } from 'node:fs/promises'
import { db } from '../server/db.js'
import { appCredentials, recordOperation, saveConnection, testMember, type Grant } from '../server/integrations/1688.js'

try {
  const input = JSON.parse(await readFile('.1688-token.local', 'utf8')) as Grant & { appKey: string; obtainedAt: string }
  if (input.appKey !== appCredentials().appKey) throw new Error('Local token belongs to a different app')
  const actor = (await db.query(`SELECT u.id,u.tenant_id FROM users u JOIN tenants t ON t.id=u.tenant_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE t.slug=$1 AND r.code='super_admin' AND u.status='active' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1`, [process.env.CRM_TENANT || 'default'])).rows[0]
  if (!actor) throw new Error('An active tenant administrator is required')
  const time = Date.parse(input.obtainedAt)
  if (!Number.isFinite(time)) throw new Error('Invalid local token timestamp')
  const start = Date.now()
  const row = await saveConnection(actor.tenant_id, actor.id, input, time)
  await recordOperation(actor.tenant_id, row.id, actor.id, 'oauth.local.import', start)
  console.log(JSON.stringify({ imported: true, connectionId: row.id, encrypted: true, expiresAt: row.access_expires_at }))
  try {
    await testMember(row.id, actor.tenant_id, actor.id)
    console.log(JSON.stringify({ accountApiVerified: true }))
  } catch (error) { console.log(JSON.stringify({ accountApiVerified: false, error: error instanceof Error ? error.message : 'Unknown error' })) }
} finally { await db.end() }
