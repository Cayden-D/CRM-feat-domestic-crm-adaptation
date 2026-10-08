import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

process.env.DASHSCOPE_API_KEY='queue-fixture-key'
process.env.DASHSCOPE_BASE_URL='https://queue-fixture.invalid/compatible-mode/v1'
const [{buildApp},{db},{saveConnection},{runClaimedCollectionQueueJob,recoverCollectionQueue},{collectedCategoryDefaults}]=await Promise.all([import('../server/app.js'),import('../server/db.js'),import('../server/integrations/1688.js'),import('../server/integrations/1688-collection-queue.js'),import('../server/integrations/1688-collected-attributes.js')])
const app=await buildApp(),originalFetch=globalThis.fetch,tenant=(await db.query('INSERT INTO tenants(name,slug)VALUES($1,$2)RETURNING id',['queue fixture',`queue-${randomUUID()}`])).rows[0].id
let imageRisk=false,vision=0,text=0,published=0,stopOnAgent=false,stopVision=0,uncertainPublish=false
let disableQueue:()=>Promise<void>=async()=>{}
const schema={global:{systemParam:{catId:'101'}},data:{title:{fields:{label:'标题',required:true,maxLength:100}},primaryPicture:{fields:{label:'主图',required:true,maxItems:5}},description:{fields:{label:'详情',required:true}},catProp:{fields:{label:'属性',dataSource:[{name:'p-1',propertyId:1,label:'材质',required:true,dataSource:[{value:1,text:'棉'},{value:2,text:'涤纶'}]},{name:'p-2',propertyId:2,label:'功率',required:false,uiType:'input'},{name:'p-3',propertyId:3,label:'风量',required:false,uiType:'input'}]}},priceRange:{fields:{label:'报价',required:true,column:[{name:'pricerange_beginAmount',required:true,uiType:'cbunumber'},{name:'pricerange_price',required:true,uiType:'cbunumber'}]}}}}
const response=(body:any)=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})
globalThis.fetch=async(input,init)=>{
  const url=String(input)
  if(url==='https://queue-fixture.invalid/compatible-mode/v1/chat/completions'){
    const body=JSON.parse(String(init?.body)),content=body.messages.at(-1).content
    if(Array.isArray(content)){
      vision++;if(stopOnAgent&&++stopVision===2)await disableQueue();const images=content.filter((item:any)=>item.type==='image_url')
      return response({model:'qwen3.8-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({images:images.map((_:unknown,index:number)=>({index,readable:true,companyWatermark:{detected:imageRisk,name:imageRisk?'测试店铺有限公司':'',confidence:imageRisk?0.99:0},famousBrandLogo:{detected:false,name:'',confidence:0}}))})}}]})
    }
    text++;return response({model:'qwen3.8-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'AI 棉质测试商品',catProp:{},unknown:['风量']})}}]})
  }
  assert.ok(url.startsWith('https://gw.open.1688.com/openapi/'),'unexpected external request')
  if(url.includes('alibaba.new.product.getSchema'))return response({result:{success:true,bizData:schema}})
  if(url.includes('alibaba.new.product.add')){published++;if(uncertainPublish)throw new Error('fixture platform timeout');return response({result:{success:true,bizData:{dataJson:JSON.stringify({itemId:String(990000+published),offerStatus:'auditing'})}}})}
  throw new Error('unexpected gateway endpoint')
}
try{
  const actor=(await db.query("INSERT INTO users(tenant_id,email,display_name,status)VALUES($1,$2,'队列测试','active') RETURNING id,email::text,display_name",[tenant,`${randomUUID()}@fixture.local`])).rows[0]
  const token=app.jwt.sign({sub:actor.id,tenantId:tenant,email:actor.email,displayName:actor.display_name,roles:[],permissions:['*']})
  const request=(method:'GET'|'PUT'|'POST',path:string,payload?:object)=>app.inject({method,url:`/api/integrations/1688${path}`,headers:{authorization:`Bearer ${token}`},...(payload?{payload}:{})})
  disableQueue=async()=>{const setting=(await request('GET','/agent/queue')).json().data.settings.find((item:any)=>item.id===connection.id);assert.equal((await request('PUT',`/connections/${connection.id}/agent-queue-settings`,{enabled:false,revision:setting.revision,confirmed:true})).statusCode,200)}
  const connection=await saveConnection(tenant,actor.id,{aliId:`queue-${randomUUID()}`,access_token:'fixture',expires_in:36000})
  const other=await saveConnection(tenant,actor.id,{aliId:`queue-${randomUUID()}`,access_token:'fixture',expires_in:36000})
  assert.equal((await request('GET','/agent/queue')).json().data.settings[0].enabled,false)
  assert.equal((await request('PUT',`/connections/${connection.id}/agent-queue-settings`,{enabled:true,revision:0,confirmed:true})).statusCode,409)
  assert.equal((await request('PUT',`/connections/${connection.id}/agent-settings`,{enabled:true,revision:0,confirmed:true})).statusCode,200)
  assert.equal((await request('PUT',`/connections/${other.id}/agent-settings`,{enabled:true,revision:0,confirmed:true})).statusCode,200)
  assert.equal((await request('PUT',`/connections/${connection.id}/agent-queue-settings`,{enabled:true,revision:0,confirmed:true})).statusCode,200)
  assert.equal((await request('PUT',`/connections/${other.id}/agent-queue-settings`,{enabled:true,revision:0,confirmed:true})).statusCode,409)
  assert.deepEqual(collectedCategoryDefaults(schema,{source:'1688',source_category_id:'999',source_category_attributes:[{attrName:'材质',attrValue:'棉'}]}),{})
  assert.equal(collectedCategoryDefaults(schema,{source:'1688',source_category_id:'101',source_category_attributes:[{attrName:'材质',attrNameId:'1',attrValue:'棉',attrValueIds:['1']}],attributes:{}})['p-1'].value,1)
  assert.deepEqual(collectedCategoryDefaults(schema,{source:'1688',source_category_id:'101',source_category_attributes:[],attributes:{材质:'棉',功率:'120',风量:'详情可咨询客服'}}),{'p-1':{value:1,text:'棉'},'p-2':'120'})
  async function fixture(stock:number|null,categoryId:string|null='101'){
    const client=await db.connect(),workerId=randomUUID()
    try{
      await client.query('BEGIN')
      const source=(await client.query(`INSERT INTO collected_products(tenant_id,source,source_product_id,source_url,title,main_image_url,gallery_images,detail_images,currency,price_min,price_max,attributes,source_category_id,source_category_attributes,collected_by)VALUES($1,'1688',$2,$3,'棉质测试商品','https://cbu01.alicdn.com/img/main.jpg',$4,$5,'CNY',12,12,$6,$7,$8,$9) RETURNING *`,[tenant,randomUUID(),`https://detail.1688.com/offer/${randomUUID()}.html`,JSON.stringify(['https://cbu01.alicdn.com/img/main.jpg']),JSON.stringify(['https://cbu01.alicdn.com/img/detail.jpg','https://img.alicdn.com/imgextra/i1/2200734520446/detail-extra.jpg']),JSON.stringify({材质:'棉',功率:'120',风量:'详情可咨询客服'}),categoryId,JSON.stringify([{attrName:'材质',attrNameId:'1',attrValue:'棉',attrValueIds:['1']}]),actor.id])).rows[0]
      await client.query(`INSERT INTO collected_product_variants(tenant_id,collected_product_id,position,label,attributes,image_url,price,stock)VALUES($1,$2,0,'红色',$3,'https://cbu01.alicdn.com/img/variant.jpg',12,$4)`,[tenant,source.id,JSON.stringify({颜色:'红色'}),stock])
      const job=(await client.query("UPDATE integration_1688_collection_queue_jobs SET status='processing',worker_id=$2,lease_until=now()+interval '1 hour',attempts=1 WHERE collected_product_id=$1 RETURNING *",[source.id,workerId])).rows[0]
      assert.ok(job,'collection trigger must enqueue in the same transaction')
      await client.query('COMMIT')
      return {source,job,workerId}
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  const clean=await fixture(7)
  assert.equal(await runClaimedCollectionQueueJob(clean.job.id,clean.workerId),true)
  const completed=(await db.query('SELECT * FROM integration_1688_collection_queue_jobs WHERE id=$1',[clean.job.id])).rows[0]
  assert.equal(completed.status,'published');assert.ok(completed.product_id);assert.ok(completed.draft_id);assert.equal(published,1)
  const draft=(await db.query('SELECT * FROM integration_1688_publish_drafts WHERE id=$1',[completed.draft_id])).rows[0]
  assert.equal(draft.data_body.formValues.title,'AI 棉质测试商品')
  assert.equal(draft.data_body.formValues.catProp['p-1'].text,'棉')
  assert.equal(draft.data_body.formValues.catProp['p-2'],'120')
  assert.equal(draft.data_body.formValues.catProp['p-3'],undefined)
  assert.match(draft.data_body.formValues.description.detailList[0].content,/detail.jpg/)
  imageRisk=true;const risky=await fixture(7);await runClaimedCollectionQueueJob(risky.job.id,risky.workerId)
  const blocked=(await db.query('SELECT status,product_id,message FROM integration_1688_collection_queue_jobs WHERE id=$1',[risky.job.id])).rows[0]
  assert.equal(blocked.status,'blocked');assert.equal(blocked.product_id,null);assert.match(blocked.message,/水印/);assert.equal(published,1)
  imageRisk=false;const missing=await fixture(null);const seenVision=vision;await runClaimedCollectionQueueJob(missing.job.id,missing.workerId)
  const incomplete=(await db.query('SELECT status,message FROM integration_1688_collection_queue_jobs WHERE id=$1',[missing.job.id])).rows[0]
  assert.equal(incomplete.status,'blocked');assert.match(incomplete.message,/库存/);assert.equal(vision,seenVision);assert.equal(published,1)
  const uncategorized=await fixture(7,null);await runClaimedCollectionQueueJob(uncategorized.job.id,uncategorized.workerId)
  assert.match((await db.query('SELECT message FROM integration_1688_collection_queue_jobs WHERE id=$1',[uncategorized.job.id])).rows[0].message,/类目 ID 缺失/)
  await db.query("UPDATE collected_products SET source_category_id='101',updated_at=now()+interval '1 second' WHERE id=$1",[uncategorized.source.id])
  const recategorized=(await db.query('SELECT status,attempts,source_updated_at FROM integration_1688_collection_queue_jobs WHERE id=$1',[uncategorized.job.id])).rows[0]
  assert.equal(recategorized.status,'queued');assert.equal(recategorized.attempts,0)
  assert.equal((await request('GET','/agent/queue')).json().data.jobs.length,4)
  const interrupted=await fixture(7)
  await db.query("UPDATE integration_1688_collection_queue_jobs SET phase='publishing',lease_until=now()-interval '1 second' WHERE id=$1",[interrupted.job.id])
  await recoverCollectionQueue(tenant)
  assert.equal((await db.query('SELECT status FROM integration_1688_collection_queue_jobs WHERE id=$1',[interrupted.job.id])).rows[0].status,'unknown')
  const retryable=await fixture(7)
  await db.query("UPDATE integration_1688_collection_queue_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[retryable.job.id])
  await recoverCollectionQueue(tenant)
  assert.equal((await db.query('SELECT status FROM integration_1688_collection_queue_jobs WHERE id=$1',[retryable.job.id])).rows[0].status,'queued')
  assert.equal((await request('PUT',`/connections/${connection.id}/agent-queue-settings`,{enabled:false,revision:1,confirmed:true})).statusCode,200)
  assert.equal((await db.query('SELECT status FROM integration_1688_collection_queue_jobs WHERE id=$1',[retryable.job.id])).rows[0].status,'cancelled')
  assert.equal((await request('PUT',`/connections/${connection.id}/agent-queue-settings`,{enabled:true,revision:2,confirmed:true})).statusCode,200)
  stopOnAgent=true;const stopped=await fixture(7);await runClaimedCollectionQueueJob(stopped.job.id,stopped.workerId)
  const halted=(await db.query('SELECT status,message FROM integration_1688_collection_queue_jobs WHERE id=$1',[stopped.job.id])).rows[0]
  assert.equal(halted.status,'blocked');assert.match(halted.message,/队列已停用/);assert.equal(published,1)
  stopOnAgent=false
  assert.equal((await request('PUT',`/connections/${connection.id}/agent-queue-settings`,{enabled:true,revision:4,confirmed:true})).statusCode,200)
  uncertainPublish=true;const uncertain=await fixture(7);await runClaimedCollectionQueueJob(uncertain.job.id,uncertain.workerId)
  assert.equal((await db.query('SELECT status FROM integration_1688_collection_queue_jobs WHERE id=$1',[uncertain.job.id])).rows[0].status,'unknown')
  assert.equal(await runClaimedCollectionQueueJob(uncertain.job.id,uncertain.workerId),false)
  assert.equal(published,2)
  const firstPage=(await request('GET','/agent/queue?page=1&pageSize=2')).json().data
  const secondPage=(await request('GET','/agent/queue?page=2&pageSize=2')).json().data
  assert.ok(firstPage.total>2);assert.equal(firstPage.jobs.length,2);assert.equal(secondPage.page,2)
  assert.ok(secondPage.jobs.every((j:any)=>!firstPage.jobs.some((a:any)=>a.id===j.id)))
  const filtered=(await request('GET','/agent/queue?status=unknown&pageSize=2')).json().data
  assert.equal(filtered.total,Number((await db.query("SELECT count(*) FROM integration_1688_collection_queue_jobs WHERE tenant_id=$1 AND status='unknown'",[tenant])).rows[0].count));assert.ok(filtered.jobs.every((j:any)=>j.status==='unknown'))
  const empty=(await request('GET','/agent/queue?search=does-not-exist&page=99')).json().data
  assert.equal(empty.total,0);assert.equal(empty.page,1);assert.equal(empty.jobs.length,0)
  assert.equal((await request('GET',`/agent/queue?connectionId=${randomUUID()}`)).json().data.total,0)
  assert.equal((await request('GET','/agent/queue?page=0')).statusCode,400)
  assert.equal((await request('GET','/agent/queue?pageSize=101')).statusCode,400)
  assert.equal((await request('GET','/agent/queue?status=invalid')).statusCode,400)
  console.log(JSON.stringify({queueDefaultOff:'ok',singleTarget:'ok',transactionalEnqueue:'ok',categoryDefaults:'ok',categoryRecollect:'ok',imageScreening:'ok',safePublish:'ok',watermarkBlocked:'ok',missingStockBlocked:'ok',expiredLeaseNoRetry:'ok',safeScreeningRetry:'ok',disableCancelsQueued:'ok',stopBeforePublish:'ok',platformUnknownNoRetry:'ok',mockGatewayPublishCalls:published,livePlatformWrites:0,textCalls:text,visionCalls:vision}))
}finally{globalThis.fetch=originalFetch;await db.query('DELETE FROM audit_logs WHERE tenant_id=$1',[tenant]);await db.query('DELETE FROM tenants WHERE id=$1',[tenant]);await app.close();await db.end()}
