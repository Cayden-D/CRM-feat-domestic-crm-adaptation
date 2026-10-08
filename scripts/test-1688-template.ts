import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../server/app.js'
import { db } from '../server/db.js'
import { saveConnection } from '../server/integrations/1688.js'
import { applyPublishTemplate } from '../server/integrations/1688-publish-template.js'
import { publishTemplateFields } from '../shared/1688-publish-template.js'

const app=await buildApp(),tenants:string[]=[],originalFetch=globalThis.fetch
const schema:any={global:{systemParam:{catId:101}},data:{title:{fields:{required:true}},primaryPicture:{fields:{required:true}},...Object.fromEntries(publishTemplateFields.map(field=>[field.key,{fields:{label:field.label,required:true,dataSource:field.options.map(option=>({value:field.key==='invReduce'?option.value:Number(option.value),text:option.text,help:'<img src="https://img.alicdn.com/help.png">',...(option.value==='-1'?{disabled:true}:{})}))}}]))}}
schema.data.officialLogistics={fields:{logisticsRequired:true}}
const logistics={showLogisticsCategory:'item',offerInfo:{weight:900,length:20,width:10,height:5,volume:1000}} as const
const values={officialLogistics:logistics,cbuUnit:'件',invReduce:'2',supplyType:'1',onlineTrade:'17410',quotationType:'2'} as const
let schemaCalls=0
// Fail closed on every unexpected outbound call; no real platform writes.
globalThis.fetch=async input=>{assert.ok(String(input).includes('/alibaba.new.product.getSchema/'));schemaCalls++;return new Response(JSON.stringify({result:{success:true,bizData:schema}}),{status:200})}
try{
  for(let i=0;i<2;i++)tenants.push((await db.query('INSERT INTO tenants(name,slug)VALUES($1,$2)RETURNING id',['template test',`template-${randomUUID()}`])).rows[0].id)
  const tenant=tenants[0],actor=(await db.query("INSERT INTO users(tenant_id,email,display_name,status)VALUES($1,$2,'模板测试','active')RETURNING id",[tenant,`${randomUUID()}@fixture.local`])).rows[0].id
  const token=(tenantId=tenant,permissions=['*'])=>app.jwt.sign({sub:actor,tenantId,permissions,roles:[],email:'template@fixture.local',displayName:'模板测试'})
  const request=(method:'GET'|'PUT'|'POST',path:string,payload?:object,bearer=token())=>app.inject({method,url:`/api/integrations/1688${path}`,headers:{authorization:`Bearer ${bearer}`},...(payload?{payload}:{})})
  assert.deepEqual((await request('GET','/publish-template')).json().data,{values:{},revision:0})
  assert.equal((await request('PUT','/publish-template',{revision:0,values},token(tenant,['integration:read']))).statusCode,403)
  assert.equal((await request('PUT','/publish-template',{revision:0,values:{...values,price:99}})).statusCode,400)
  assert.equal((await request('PUT','/publish-template',{revision:0,values:{cbuUnit:'   '}})).statusCode,400)
  assert.equal((await request('PUT','/publish-template',{revision:0,values:{invReduce:'999'}})).statusCode,400)
  for(const info of [{weight:0},{weight:1.5},{width:21},{length:20.12},{height:0},{volume:1}])assert.equal((await request('PUT','/publish-template',{revision:0,values:{officialLogistics:{...logistics,offerInfo:{...logistics.offerInfo,...info}}}})).statusCode,400)
  const result=await request('PUT','/publish-template',{revision:0,values});assert.equal(result.statusCode,200,result.body)
  assert.equal((await request('PUT','/publish-template',{revision:0,values})).statusCode,409)
  assert.deepEqual((await request('GET','/publish-template',undefined,token(tenants[1]))).json().data.values,{})
  const filled=applyPublishTemplate(schema,{},values)
  assert.deepEqual(filled.officialLogistics,logistics)
  assert.deepEqual(applyPublishTemplate(schema,{officialLogistics:{showLogisticsCategory:'sku',skuInfo:[],offerInfo:{weight:0,length:0,width:0,height:0,volume:0},measuredImageVerify:false}},values).officialLogistics,{...logistics,measuredImageVerify:false})
  for(const manual of [{showLogisticsCategory:'item',offerInfo:{weight:1200}}, {showLogisticsCategory:'item',offerInfo:{length:15}}, {showLogisticsCategory:'sku',skuInfo:[{weight:100}]}])assert.deepEqual(applyPublishTemplate(schema,{officialLogistics:manual},values).officialLogistics,manual)
  assert.equal(applyPublishTemplate({data:{officialLogistics:{fields:{readonly:true}}}},{},values).officialLogistics,undefined)
  assert.equal(applyPublishTemplate({data:{officialLogistics:{fields:{visible:false}}}},{},values).officialLogistics,undefined)
  assert.deepEqual(filled.cbuUnit,{unit:'件'});assert.deepEqual(filled.invReduce,{value:'2',text:'支付时扣减'})
  assert.deepEqual(filled.quotationType,{value:2,text:'按产品数量报价'})
  assert.equal(filled.onlineTrade.help,undefined)
  assert.deepEqual(applyPublishTemplate(schema,{cbuUnit:{unit:'套'},invReduce:{value:'1',text:'下单时扣减'}},values).cbuUnit,{unit:'套'})
  assert.equal(applyPublishTemplate(schema,{invReduce:{value:'1'}},values).invReduce.value,'1')
  assert.equal(applyPublishTemplate(schema,{cbuUnit:{},invReduce:{value:null}},values).invReduce.value,'2')
  assert.deepEqual(applyPublishTemplate({data:{}},{},values),{})
  assert.deepEqual(applyPublishTemplate({data:{invReduce:{fields:{readonly:true}}}},{},values),{})
  assert.throws(()=>applyPublishTemplate(schema,{}, {...values,onlineTrade:'-1'}),/网上订购/)
  assert.throws(()=>applyPublishTemplate({...schema,data:{...schema.data,supplyType:{fields:{dataSource:[]}}}},{},values),/供货方式/)
  const connection=await saveConnection(tenant,actor,{aliId:`template-${randomUUID()}`,access_token:'fixture',expires_in:36000})
  const product=(await db.query("INSERT INTO products(tenant_id,sku,name,base_price,base_currency,status,images)VALUES($1,$2,'模板商品',12,'CNY','active',$3)RETURNING id",[tenant,randomUUID(),JSON.stringify(['https://cbu01.alicdn.com/img/fixture.png'])])).rows[0]
  const created=await request('POST','/drafts',{connectionId:connection.id,productId:product.id,catId:'101',scene:'cbu'});assert.equal(created.statusCode,201,created.body)
  const draft=created.json().data;assert.deepEqual(created.json().missing,[]);assert.deepEqual(draft.data_body.formValues.cbuUnit,{unit:'件'})
  assert.deepEqual(draft.data_body.formValues.officialLogistics,logistics)
  const overridden={...logistics,offerInfo:{...logistics.offerInfo,weight:1200}}
  const saved=await app.inject({method:'PATCH',url:`/api/integrations/1688/drafts/${draft.id}`,headers:{authorization:`Bearer ${token()}`},payload:{revision:draft.revision,formValues:{...draft.data_body.formValues,officialLogistics:overridden}}})
  assert.equal(saved.statusCode,200,saved.body)
  const preserved=await request('POST',`/drafts/${draft.id}/apply-template`,{revision:saved.json().data.revision});assert.equal(preserved.statusCode,200,preserved.body)
  assert.deepEqual(preserved.json().data.data_body.formValues.officialLogistics,overridden)
  draft.revision=preserved.json().data.revision
  await db.query("UPDATE integration_1688_publish_drafts SET data_body=jsonb_set(data_body,'{formValues}', $2::jsonb) WHERE id=$1",[draft.id,JSON.stringify({title:'模板商品',primaryPicture:draft.data_body.formValues.primaryPicture,cbuUnit:{unit:'套'}})])
  assert.equal((await request('POST',`/drafts/${draft.id}/apply-template`,{revision:draft.revision},token(tenants[1]))).statusCode,404)
  assert.equal((await request('POST',`/drafts/${draft.id}/apply-template`,{revision:draft.revision},token(tenant,['integration:read']))).statusCode,403)
  const applied=await request('POST',`/drafts/${draft.id}/apply-template`,{revision:draft.revision});assert.equal(applied.statusCode,200,applied.body)
  assert.equal(applied.json().data.data_body.formValues.cbuUnit.unit,'套');assert.deepEqual(applied.json().missing,[])
  assert.equal((await request('POST',`/drafts/${draft.id}/apply-template`,{revision:draft.revision})).statusCode,409)
  await db.query("UPDATE integration_1688_publish_drafts SET status='unknown' WHERE id=$1",[draft.id])
  assert.equal((await request('POST',`/drafts/${draft.id}/apply-template`,{revision:applied.json().data.revision})).statusCode,409)
  assert.equal((await request('PUT','/publish-template',{revision:1,values:{}})).statusCode,200)
  assert.deepEqual((await request('GET','/publish-template')).json().data.values,{})
  assert.equal((await db.query("SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=$1 AND action='1688.publish-template.update'",[tenant])).rows[0].count,2)
  console.log(JSON.stringify({templateCrud:'ok',permissions:'ok',tenantIsolation:'ok',revisionConflict:'ok',invalidValues:'ok',platformCompatibility:'ok',preserveExisting:'ok',logisticsValidation:'ok',manualLogisticsOverride:'ok',newDraft:'ok',existingDraft:'ok',unknownDraftBlocked:'ok',audit:'ok',schemaCalls,livePlatformWrites:0}))
}finally{globalThis.fetch=originalFetch;for(const tenant of tenants){await db.query('DELETE FROM audit_logs WHERE tenant_id=$1',[tenant]);await db.query('DELETE FROM tenants WHERE id=$1',[tenant])}await app.close();await db.end()}
