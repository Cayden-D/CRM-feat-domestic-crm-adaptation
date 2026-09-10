import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { db } from '../server/db.js'

export async function createTestAdmin(label:string){
  const password=process.env.CRM_ADMIN_PASSWORD
  if(!password||password.length<12)throw new Error('CRM_ADMIN_PASSWORD must contain at least 12 characters')
  const email=`${label}.${randomUUID().slice(0,8)}@integration.local`
  const hash=await bcrypt.hash(password,4)
  const user=(await db.query(`INSERT INTO users(tenant_id,email,password_hash,display_name,status) SELECT id,$1,$2,'集成测试管理员','active' FROM tenants WHERE slug='default' RETURNING id`,[email,hash])).rows[0]
  if(!user)throw new Error('Default tenant not found')
  await db.query(`INSERT INTO user_roles(user_id,role_id) SELECT $1,r.id FROM roles r JOIN tenants t ON t.id=r.tenant_id WHERE t.slug='default' AND r.code='super_admin'`,[user.id])
  return{email,password,userId:user.id as string}
}

export async function deleteTestAdmin(userId:string){if(userId)await db.query('DELETE FROM users WHERE id=$1',[userId])}
