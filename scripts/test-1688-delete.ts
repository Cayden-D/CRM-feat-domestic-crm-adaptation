import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {buildApp} from '../server/app.js'
import {db} from '../server/db.js'
import {saveConnection} from '../server/integrations/1688.js'
const app=await buildApp(),tenants:string[]=[],original=globalThis.fetch
let calls=0,mode='success',release:(()=>void)|undefined
try{
 for(let i=0;i<2;i++)tenants.push((await db.query('INSERT INTO tenants(name,slug)VALUES($1,$2)RETURNING id',['delete test',randomUUID()])).rows[0].id)
 const tenant=tenants[0],actor=(await db.query("INSERT INTO users(tenant_id,email,display_name,status)VALUES($1,$2,'删除测试','active')RETURNING id",[tenant,`${randomUUID()}@fixture.local`])).rows[0].id
 const connection=await saveConnection(tenant,actor,{aliId:randomUUID(),access_token:'fixture',expires_in:36000})
 const token=(tid=tenant,permissions=['*'])=>app.jwt.sign({sub:actor,tenantId:tid,email:'fixture',displayName:'fixture',permissions,roles:[]})
 const listing=async()=> (await db.query("INSERT INTO integration_1688_listings(tenant_id,connection_id,offer_id,title,status,snapshot)VALUES($1,$2,$3,'删除测试','published','{}')RETURNING *",[tenant,connection.id,String(Date.now())+String(Math.floor(Math.random()*100000))])).rows[0]
 const request=(row:any,payload:any={confirmed:true,offerId:row.offer_id,syncedAt:row.synced_at.toISOString()},bearer=token())=>app.inject({method:'POST',url:`/api/integrations/1688/listings/${row.id}/delete`,headers:{authorization:`Bearer ${bearer}`},payload})
 globalThis.fetch=async(input,init)=>{
  assert.ok(String(input).includes('/alibaba.product.delete/'))
  const params=init?.body as URLSearchParams;assert.ok(/^\d+$/.test(params.get('productID')!));assert.equal(params.has('webSite'),false);calls++
  if(mode==='waiting')await new Promise<void>(resolve=>{release=resolve})
  if(mode==='timeout')throw Error('mock timeout')
  return new Response(JSON.stringify(mode==='failure'?{isSuccess:false,reason:'重复删除'}:mode==='malformed'?{}:{isSuccess:true,reason:'操作成功!'}),{status:200})
 }
 const first=await listing()
 assert.equal((await request(first,{},token())).statusCode,400)
 assert.equal((await request(first,undefined,token(tenant,['integration:read']))).statusCode,403)
 assert.equal((await request(first,undefined,token(tenants[1]))).statusCode,404)
 assert.equal((await request(first,{confirmed:true,offerId:'999',syncedAt:first.synced_at.toISOString()})).statusCode,409)
 assert.equal((await request(first,{confirmed:true,offerId:first.offer_id,syncedAt:'2000-01-01T00:00:00.000Z'})).statusCode,409)
 assert.equal(calls,0)
 assert.equal((await request(first)).statusCode,200);assert.equal(calls,1)
 assert.equal((await request(first)).statusCode,200);assert.equal(calls,1)
 assert.equal((await db.query('SELECT deletion_state FROM integration_1688_listings WHERE id=$1',[first.id])).rows[0].deletion_state,'deleted')
 const concurrent=await listing();mode='waiting';const pending=request(concurrent);const running=Promise.resolve(pending)
 while(!release)await new Promise(r=>setTimeout(r,10))
 assert.equal((await request(concurrent)).statusCode,409);release();assert.equal((await running).statusCode,200)
 mode='failure';const failed=await listing();assert.equal((await request(failed)).statusCode,400)
 assert.equal((await db.query('SELECT deletion_state FROM integration_1688_listings WHERE id=$1',[failed.id])).rows[0].deletion_state,'active')
 for(const next of ['timeout','malformed']){mode=next;const row=await listing();assert.equal((await request(row)).statusCode,409);const before:number=calls;assert.equal((await request(row)).statusCode,409);assert.equal(calls,before)}
 assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND action='1688.delete.success'",[tenant])).rows[0].n,2)
 console.log(JSON.stringify({confirmation:'ok',tenantIsolation:'ok',permissions:'ok',staleGuard:'ok',success:'ok',duplicate:'ok',concurrent:'ok',falseResult:'ok',unknownNoRetry:'ok',audit:'ok',mockDeleteCalls:calls,livePlatformDeletes:0}))
}finally{globalThis.fetch=original;for(const tenant of tenants){await db.query('DELETE FROM audit_logs WHERE tenant_id=$1',[tenant]);await db.query('DELETE FROM tenants WHERE id=$1',[tenant])}await app.close();await db.end()}
