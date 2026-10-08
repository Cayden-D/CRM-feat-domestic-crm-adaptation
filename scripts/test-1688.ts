import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { buildApp } from '../server/app.js'
import { db } from '../server/db.js'
import { appCredentials, connectionToken, decryptGrant, encryptGrant, parsePlatformJson, parseRefreshExpiry, saveConnection, signApi } from '../server/integrations/1688.js'
import { validatePublishBody } from '../server/routes/1688.js'

// All platform requests are intercepted; this suite cannot publish to a real shop.
const originalFetch=globalThis.fetch
const marker=randomUUID(),tenantIds:string[]=[]
const app=await buildApp()
let refreshCalls=0,publishCalls=0,unknownPublish=false,stockPayload:Record<string,unknown>|null=null
let currentAliId=''
let subReload=false,subInvalid=false,onSubSchema:(()=>Promise<void>)|null=null
const schema={global:{systemParam:{catId:'101'}},data:{title:{fields:{label:'标题',required:true,maxLength:100}},primaryPicture:{fields:{label:'主图',required:true,maxItems:5}},catProp:{fields:{label:'属性',dataSource:[{name:'p-1',label:'材质',required:true}]}},priceRange:{fields:{label:'报价',column:[{name:'pricerange_beginAmount',label:'起批量',uiType:'cbunumber',required:true},{name:'pricerange_price',label:'单价',uiType:'cbunumber',required:true}]}}}}
const platformProduct={productID:'9007199254740993123',subject:'测试发布商品',status:'published',categoryID:101,image:{images:['https://example.org/photo.png']},skuInfos:[{specId:'spec-red',skuId:123,amountOnSale:20,price:12}]}
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200})
globalThis.fetch=async(input,init)=>{
  const url=String(input)
  assert.ok(url.startsWith('https://gw.open.1688.com/openapi/'),'unexpected network destination')
  assert.equal(init?.method,'POST');assert.equal(init?.redirect,'error')
  const params=init?.body instanceof URLSearchParams?init.body:null
  if(url.includes('system.oauth2/getToken')){
    assert.ok(params);assert.equal(params.has('_aop_signature'),false)
    if(params.get('grant_type')==='refresh_token'){refreshCalls++;await new Promise(resolve=>setTimeout(resolve,20))}
    return response({access_token:'mock-access-new',refresh_token:'mock-refresh-new',aliId:currentAliId,expires_in:36000,refresh_token_timeout:'20990101000000000+0800'})
  }
  if(init?.body instanceof FormData){
    const form=init.body,flat=Object.fromEntries([...form.entries()].filter(([,v])=>typeof v==='string')) as Record<string,string>
    assert.equal(flat._aop_signature,signApi(url.split('/openapi/')[1],flat,appCredentials().secret))
    assert.ok(form.get('imageBytes') instanceof Blob)
    return response({success:true,image:{id:'photo-1',url:'https://example.org/uploaded.png'}})
  }
  assert.ok(params)
  const flat=Object.fromEntries(params.entries())
  assert.equal(flat._aop_signature,signApi(url.split('/openapi/')[1],flat,appCredentials().secret))
  if(url.includes('alibaba.product.list.get'))return response({result:{pageResult:{resultList:[platformProduct],totalRecords:1}}})
  if(url.includes('alibaba.product.get/'))return response({productInfo:platformProduct})
  if(url.includes('alibaba.new.product.getSchema'))return response({result:{success:true,bizData:JSON.stringify(schema)}})
  if(url.includes('alibaba.new.product.getSubSchema')){
    assert.equal(flat.catId,'101');assert.deepEqual(JSON.parse(flat.dataBody).data,{skuTable:{}})
    if(onSubSchema)await onSubSchema()
    return response({result:{success:true,bizData:{reload:subReload,data:subInvalid?{}:{skuTable:{fields:{column:[{name:'sku_price',label:'单价',uiType:'cbunumber',visible:true}],value:[]}}}}}})
  }
  if(url.includes('alibaba.new.product.add')){
    publishCalls++;if(unknownPublish)throw new Error('simulated timeout after acceptance')
    return response({result:{success:true,bizData:{dataJson:'{"itemId":9007199254740993123,"offerStatus":"published"}'}}})
  }
  if(url.includes('alibaba.product.modifyStock')){stockPayload=flat;return response({success:true,result:[{productId:platformProduct.productID,result:true}]})}
  if(url.includes('alibaba.account.basic'))return response({result:{companyName:'测试店铺'}})
  if(url.includes('alibaba.category.searchByKeyword'))return response({products:[{categoryID:101,name:'测试类目'}]})
  throw new Error('Unmocked API')
}

try{
  for(let i=0;i<2;i++)tenantIds.push((await db.query('INSERT INTO tenants(name,slug)VALUES($1,$2)RETURNING id',['1688 isolated integration test',`test-1688-${marker}-${i}`])).rows[0].id)
  const tenantId=tenantIds[0]
  const actor=(await db.query("INSERT INTO users(tenant_id,email,password_hash,display_name,status)VALUES($1,$2,'unused','测试账号','active')RETURNING id",[tenantId,`1688-${marker}@integration.local`])).rows[0].id
  const token=(tenant:string,permissions:string[])=>app.jwt.sign({sub:actor,tenantId:tenant,email:'test',displayName:'测试账号',roles:[],permissions})
  const headers={authorization:`Bearer ${token(tenantId,['*'])}`}
  const request=(method:'GET'|'POST'|'PATCH',url:string,payload?:object,auth=headers)=>app.inject({method,url,headers:auth,...(payload?{payload}:{})})
  const grant={access_token:'mock-access',refresh_token:'mock-refresh',expires_in:36000,aliId:`test-${marker}`,refresh_token_timeout:'20990101000000000+0800'}
  currentAliId=grant.aliId
  const encrypted=await encryptGrant(grant);assert.ok(!encrypted.includes(grant.access_token));assert.deepEqual(await decryptGrant(encrypted),grant)
  const connection=await saveConnection(tenantId,actor,grant)
  const other=await request('GET',`/api/integrations/1688/listings/${randomUUID()}`,undefined,{authorization:`Bearer ${token(tenantIds[1],['*'])}`});assert.equal(other.statusCode,404)
  const denied=await request('GET','/api/integrations/1688/connections',undefined,{authorization:`Bearer ${token(tenantId,[])}`});assert.equal(denied.statusCode,403)
  const exposed=await request('GET','/api/integrations/1688/connections');assert.equal(exposed.statusCode,200);assert.ok(!/token_ciphertext|mock-access|mock-refresh/.test(exposed.body))
  assert.equal(parsePlatformJson('{"id":9007199254740993123}').id,'9007199254740993123')
  assert.equal(parseRefreshExpiry('20261009113546000+0800')?.toISOString(),'2026-10-09T03:35:46.000Z')
  assert.equal(signApi('param2/path',{b:'中文',a:'1'},'secret'),createHmac('sha1','secret').update('param2/patha1b中文').digest('hex').toUpperCase())
  await db.query("UPDATE integration_1688_connections SET access_expires_at=now()-interval '1 minute' WHERE id=$1",[connection.id])
  await Promise.all([connectionToken(connection.id,tenantId,actor),connectionToken(connection.id,tenantId,actor)])
  assert.equal(refreshCalls,1,'concurrent refresh must reuse the newly persisted grant')
  const ciphertext=(await db.query('SELECT token_ciphertext FROM integration_1688_connections WHERE id=$1',[connection.id])).rows[0].token_ciphertext
  assert.equal((await decryptGrant(ciphertext)).refresh_token,'mock-refresh-new')
  const wrong=await request('POST',`/api/integrations/1688/connections/${connection.id}/sync`,{}, {authorization:`Bearer ${token(tenantIds[1],['*'])}`});assert.equal(wrong.statusCode,404)
  const synced=await request('POST',`/api/integrations/1688/connections/${connection.id}/sync`,{pageNo:1});assert.equal(synced.statusCode,200,synced.body)
  const listing=(await db.query('SELECT id FROM integration_1688_listings WHERE connection_id=$1',[connection.id])).rows[0]
  const stale=await request('POST',`/api/integrations/1688/listings/${listing.id}/stock`,{confirmed:true,stocks:[{specId:'spec-red',before:19,after:30}]});assert.equal(stale.statusCode,409);assert.equal(stockPayload,null)
  const stock=await request('POST',`/api/integrations/1688/listings/${listing.id}/stock`,{confirmed:true,stocks:[{specId:'spec-red',before:20,after:30}]});assert.equal(stock.statusCode,200,stock.body)
  assert.equal(stockPayload!['increaceModify'],'false');assert.equal(JSON.parse(stockPayload!['productStockChange'] as string)[0].skuStocks[0].skuId,'spec-red')
  const upload=await request('POST',`/api/integrations/1688/connections/${connection.id}/photos`,{albumId:'1',name:'test.png',mime:'image/png',content:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')});assert.equal(upload.statusCode,200,upload.body)
  const state=await request('POST','/api/integrations/1688/authorizations');assert.equal(state.statusCode,200)
  const url=new URL(state.json().data.authorizationUrl),callback=new URL(appCredentials().redirect)
  currentAliId=`oauth-${marker}`;callback.searchParams.set('state',url.searchParams.get('state')!);callback.searchParams.set('code','mock-code')
  const authorized=await request('POST','/api/integrations/1688/authorizations/complete',{callbackUrl:callback.href});assert.equal(authorized.statusCode,201,authorized.body)
  const replay=await request('POST','/api/integrations/1688/authorizations/complete',{callbackUrl:callback.href});assert.equal(replay.statusCode,409)
  const key=await request('POST','/api/product-collections/access-key');assert.equal(key.statusCode,200,key.body)
  const imported=await app.inject({method:'POST',url:'/api/product-collections/import',headers:{'x-collector-key':key.json().data.key},payload:{source:'1688',sourceProductId:`test-${marker}`,sourceUrl:'https://detail.1688.com/offer/1.html',title:'测试发布商品',currency:'CNY',mainImageUrl:'https://example.org/photo.png',attributes:{材质:'棉'},variants:[{label:'红色',price:12,stock:20,attributes:{颜色:'红色'}}]}});assert.equal(imported.statusCode,201,imported.body)
  const collectionId=imported.json().data.id
  const sourceVariant=(await db.query('SELECT id FROM collected_product_variants WHERE collected_product_id=$1',[collectionId])).rows[0]
  const reviewed={reviewed:true,sku:`test-${marker}`,name:'测试发布商品',basePrice:15,variants:[{id:sourceVariant.id,price:16,stock:30}]}
  const promoted=await request('POST',`/api/product-collections/${collectionId}/promote`,reviewed);assert.equal(promoted.statusCode,201,promoted.body)
  const repeat=await request('POST',`/api/product-collections/${collectionId}/promote`,reviewed);assert.equal(repeat.statusCode,409)
  const productId=promoted.json().data.id
  const variant=(await db.query('SELECT unit_price,stock FROM product_variants WHERE product_id=$1',[productId])).rows[0];assert.equal(Number(variant.unit_price),16)
  await db.query('UPDATE collected_product_variants SET price=99 WHERE id=$1',[sourceVariant.id]);assert.equal(Number((await db.query('SELECT unit_price FROM product_variants WHERE product_id=$1',[productId])).rows[0].unit_price),16)
  const create=await request('POST','/api/integrations/1688/drafts',{connectionId:connection.id,productId,catId:'101',scene:'cbu'});assert.equal(create.statusCode,201,create.body)
  const draft=create.json().data,values={...draft.data_body.formValues,catProp:{'p-1':{value:1,text:'棉'}}}
  assert.ok(validatePublishBody(schema,draft.data_body).includes('材质'))
  const saved=await request('PATCH',`/api/integrations/1688/drafts/${draft.id}`,{revision:1,formValues:values});assert.equal(saved.statusCode,200,saved.body);assert.deepEqual(saved.json().missing,[])
  const conflict=await request('PATCH',`/api/integrations/1688/drafts/${draft.id}`,{revision:1,formValues:values});assert.equal(conflict.statusCode,409)
  const skuSchema={...schema,data:{...schema.data,saleProp:{fields:{dataSource:[{name:'p-2',propertyId:2,label:'颜色',required:true,dataSource:[{value:10,text:'红色'}]}]}},skuTable:{supportLevelProp:true,fields:{label:'规格报价',column:[]}}}}
  await db.query('UPDATE integration_1688_publish_drafts SET platform_schema=$2::jsonb WHERE id=$1',[draft.id,JSON.stringify(skuSchema)])
  const variantsRead=await request('GET',`/api/integrations/1688/drafts/${draft.id}/variants`);assert.equal(variantsRead.statusCode,200);assert.equal(variantsRead.json().data.length,1)
  const foreignVariants=await request('GET',`/api/integrations/1688/drafts/${draft.id}/variants`,undefined,{authorization:`Bearer ${token(tenantIds[1],['*'])}`});assert.equal(foreignVariants.statusCode,404)
  const noRead=await request('GET',`/api/integrations/1688/drafts/${draft.id}/variants`,undefined,{authorization:`Bearer ${token(tenantId,['integration:read'])}`});assert.equal(noRead.statusCode,403)
  const noConfirm=await request('POST',`/api/integrations/1688/drafts/${draft.id}/map-variants`,{revision:2,mapping:{'p-2':'颜色'},confirmed:false});assert.equal(noConfirm.statusCode,400)
  const invalidMapping=await request('POST',`/api/integrations/1688/drafts/${draft.id}/map-variants`,{revision:2,mapping:{'p-2':'不存在'},confirmed:true});assert.equal(invalidMapping.statusCode,400)
  const mapped=await request('POST',`/api/integrations/1688/drafts/${draft.id}/map-variants`,{revision:2,mapping:{'p-2':'颜色'},confirmed:true});assert.equal(mapped.statusCode,200,mapped.body);assert.equal(mapped.json().data.revision,3);assert.equal(mapped.json().data.data_body.formValues.skuTable[0].sku_price,16);assert.equal(mapped.json().data.data_body.formValues.skuTable[0].sku_amountOnSale,30)
  const staleMapping=await request('POST',`/api/integrations/1688/drafts/${draft.id}/map-variants`,{revision:2,mapping:{'p-2':'颜色'},confirmed:true});assert.equal(staleMapping.statusCode,409)
  const rules=await request('POST',`/api/integrations/1688/drafts/${draft.id}/sku-rules`,{revision:3});assert.equal(rules.statusCode,200,rules.body);assert.equal(rules.json().data.revision,4);assert.equal(rules.json().data.data_body.formValues.skuTable[0].sku_price,16);assert.equal(rules.json().data.platform_schema.data.skuTable.fields.column.length,1)
  subReload=true
  const reload=await request('POST',`/api/integrations/1688/drafts/${draft.id}/sku-rules`,{revision:4});assert.equal(reload.statusCode,409);subReload=false;subInvalid=true
  const invalidRules=await request('POST',`/api/integrations/1688/drafts/${draft.id}/sku-rules`,{revision:4});assert.equal(invalidRules.statusCode,502);subInvalid=false
  onSubSchema=async()=>{await db.query('UPDATE integration_1688_publish_drafts SET revision=revision+1 WHERE id=$1',[draft.id])}
  const rulesRace=await request('POST',`/api/integrations/1688/drafts/${draft.id}/sku-rules`,{revision:4});assert.equal(rulesRace.statusCode,409);onSubSchema=null
  await db.query('UPDATE integration_1688_publish_drafts SET platform_schema=$2::jsonb,data_body=jsonb_set(data_body,\'{formValues}\',$3::jsonb),revision=2 WHERE id=$1',[draft.id,JSON.stringify(schema),JSON.stringify(values)])
  const publish=await request('POST',`/api/integrations/1688/drafts/${draft.id}/publish`,{revision:2,confirmed:true});assert.equal(publish.statusCode,200,publish.body);assert.equal(publish.json().data.offerId,'9007199254740993123')
  const repeated=await request('POST',`/api/integrations/1688/drafts/${draft.id}/publish`,{revision:2,confirmed:true});assert.equal(repeated.statusCode,200);assert.equal(publishCalls,1)
  await db.query("UPDATE integration_1688_publish_drafts SET status='draft',offer_id=NULL WHERE id=$1",[draft.id]);unknownPublish=true
  await db.query('UPDATE integration_1688_listings SET product_id=NULL,sku_bindings=\'[]\'::jsonb,binding_revision=binding_revision+1 WHERE id=$1',[listing.id])
  const timeout=await request('POST',`/api/integrations/1688/drafts/${draft.id}/publish`,{revision:2,confirmed:true});assert.equal(timeout.statusCode,502)
  assert.equal((await db.query('SELECT status FROM integration_1688_publish_drafts WHERE id=$1',[draft.id])).rows[0].status,'unknown')
  const retry=await request('POST',`/api/integrations/1688/drafts/${draft.id}/publish`,{revision:2,confirmed:true});assert.equal(retry.statusCode,409);assert.equal(publishCalls,2)
  const reconcile=await request('POST',`/api/integrations/1688/drafts/${draft.id}/reconcile`,{offerId:platformProduct.productID});assert.equal(reconcile.statusCode,200,reconcile.body)
  console.log(JSON.stringify({encryption:'ok',losslessIdentifiers:'ok',signature:'ok',refreshExpiry:'ok',concurrentRefresh:'ok',tenantIsolation:'ok',permissions:'ok',oauthReplay:'ok',collectionPromotion:'ok',independentVariants:'ok',draftRevision:'ok',requiredProperties:'ok',publishIdempotency:'ok',uncertainPublishGuard:'ok',reconciliation:'ok',absoluteStockSpecId:'ok',staleStockGuard:'ok',photoMultipartSignature:'ok',skuMapping:'ok',mappingRevision:'ok',skuRuleRefresh:'ok',rulePreservation:'ok',ruleReloadGuard:'ok',ruleResponseGuard:'ok',ruleRaceGuard:'ok',livePlatformWrites:0}))
}finally{
  globalThis.fetch=originalFetch
  for(const id of tenantIds){await db.query('DELETE FROM audit_logs WHERE tenant_id=$1',[id]);await db.query('DELETE FROM tenants WHERE id=$1',[id])}
  await app.close();await db.end()
}
