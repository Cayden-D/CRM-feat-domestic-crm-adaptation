import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildApp } from '../server/app.js'
import { db } from '../server/db.js'
import { saveConnection } from '../server/integrations/1688.js'
import { comparison, numericDifference } from '../server/integrations/1688-comparison.js'

const app=await buildApp(),tenants:string[]=[],originalFetch=globalThis.fetch
let externalCalls=0
globalThis.fetch=async()=>{externalCalls++;throw new Error('This suite must not call the platform')}
try{
  const marker=randomUUID()
  for(let i=0;i<2;i++)tenants.push((await db.query('INSERT INTO tenants(name,slug)VALUES($1,$2)RETURNING id',['binding-test',`binding-${marker}-${i}`])).rows[0].id)
  const tenant=tenants[0],actor=(await db.query("INSERT INTO users(tenant_id,email,display_name,status)VALUES($1,$2,'关联测试','active')RETURNING id",[tenant,`${marker}@integration.local`])).rows[0].id
  const token=(tenantId=tenant,permissions=['*'])=>app.jwt.sign({sub:actor,tenantId,email:'test',displayName:'test',permissions,roles:[]})
  const request=(method:'GET'|'POST',url:string,payload?:object,bearer=token())=>app.inject({method,url,headers:{authorization:`Bearer ${bearer}`},...(payload?{payload}:{})})
  const connection=await saveConnection(tenant,actor,{aliId:`bindings-${marker}`,access_token:'fixture',expires_in:36000})
  const product=(await db.query("INSERT INTO products(tenant_id,sku,name,base_price,base_currency,status,images)VALUES($1,$2,'CRM 产品',12,'CNY','active','[\"https://cbu01.alicdn.com/img/example.jpg\"]')RETURNING *",[tenant,`binding-${marker}`])).rows[0]
  const other=(await db.query("INSERT INTO products(tenant_id,sku,name,base_price,base_currency,status)VALUES($1,$2,'其它产品',1,'CNY','active')RETURNING id",[tenant,`other-${marker}`])).rows[0]
  const foreign=(await db.query("INSERT INTO products(tenant_id,sku,name,base_price,base_currency,status)VALUES($1,$2,'foreign',1,'CNY','active')RETURNING id",[tenants[1],`foreign-${marker}`])).rows[0]
  const red=(await db.query("INSERT INTO product_variants(tenant_id,product_id,position,label,unit_price,stock)VALUES($1,$2,0,'红色',15,7)RETURNING id",[tenant,product.id])).rows[0]
  const blue=(await db.query("INSERT INTO product_variants(tenant_id,product_id,position,label,unit_price,stock)VALUES($1,$2,1,'蓝色',8,NULL)RETURNING id",[tenant,product.id])).rows[0]
  const snapshot={saleInfo:{currency:'CNY',priceRanges:[{startQuantity:1,price:12}]},skuInfos:[{specId:'spec-red',price:12,amountOnSale:9,attributes:[{attributeDisplayName:'颜色',attributeValue:'红色'}]},{specId:'spec-blue',amountOnSale:4}]}
  const listing=(await db.query("INSERT INTO integration_1688_listings(tenant_id,connection_id,offer_id,title,status,image_url,snapshot)VALUES($1,$2,'9007199254740993123','平台产品','published','img/example.jpg',$3)RETURNING *",[tenant,connection.id,JSON.stringify(snapshot)])).rows[0]
  const url=`/api/integrations/1688/listings/${listing.id}`
  const input=(revision:number,productId:string|null,bindings:Array<{specId:string;variantId:string}>=[])=>({revision,productId,bindings,confirmed:true,syncedAt:new Date(listing.synced_at).toISOString()})
  assert.equal((await request('GET',`${url}/comparison`,undefined,token(tenants[1]))).statusCode,404)
  assert.equal((await request('GET',`${url}/comparison`,undefined,token(tenant,['integration:read']))).statusCode,403)
  assert.equal((await request('POST',`${url}/binding`,input(1,product.id),token(tenant,['product:read','integration:read']))).statusCode,403)
  assert.equal((await request('POST',`${url}/binding`,{...input(1,product.id),confirmed:false})).statusCode,400)
  assert.equal((await request('POST',`${url}/binding`,input(1,foreign.id))).statusCode,404)
  const preview=await request('GET',`${url}/comparison?productId=${product.id}`)
  assert.equal(preview.statusCode,200);assert.equal(preview.json().data.product.id,product.id);assert.equal(preview.json().data.variants.length,2)
  assert.equal(preview.json().data.listing.productId,null)
  assert.equal((await request('GET',`${url}/comparison?productId=${foreign.id}`)).statusCode,404)
  assert.equal((await db.query('SELECT product_id,binding_revision FROM integration_1688_listings WHERE id=$1',[listing.id])).rows[0].binding_revision,1)
  const bind=await request('POST',`${url}/binding`,input(1,product.id));assert.equal(bind.statusCode,200,bind.body)
  assert.equal((await request('POST',`${url}/binding`,input(1,product.id))).statusCode,409)
  assert.equal((await request('POST',`${url}/binding`,input(2,other.id))).statusCode,409)
  assert.equal((await request('POST',`${url}/binding`,{...input(2,product.id),syncedAt:'2000-01-01T00:00:00Z'})).statusCode,409)
  const mappings=[{specId:'spec-red',variantId:red.id},{specId:'spec-blue',variantId:blue.id}]
  assert.equal((await request('POST',`${url}/binding`,input(2,product.id,[mappings[0],mappings[0]]))).statusCode,400)
  assert.equal((await request('POST',`${url}/binding`,input(2,product.id,[{specId:'missing',variantId:red.id}]))).statusCode,400)
  assert.equal((await request('POST',`${url}/binding`,input(2,product.id,[{specId:'spec-red',variantId:randomUUID()}]))).statusCode,400)
  const map=await request('POST',`${url}/binding`,input(2,product.id,mappings));assert.equal(map.statusCode,200,map.body)
  const report=(await request('GET',`${url}/comparison`)).json().data
  assert.equal(report.summary.mapped,2);assert.equal(report.summary.changedPrice,1);assert.equal(report.summary.changedStock,1);assert.equal(report.summary.unknown,1)
  assert.equal(report.fields.basePrice.status,'equal');assert.equal(report.fields.image.status,'equal');assert.equal(report.fields.title.status,'changed')
  assert.equal(report.rows[1].stock.crm,null);assert.equal(report.rows[1].price.platform,null)
  const second=(await db.query("INSERT INTO integration_1688_listings(tenant_id,connection_id,offer_id,title,status,snapshot)VALUES($1,$2,'2','second','published',$3)RETURNING *",[tenant,connection.id,JSON.stringify(snapshot)])).rows[0]
  const duplicate=await request('POST',`/api/integrations/1688/listings/${second.id}/binding`,{...input(1,product.id),syncedAt:new Date(second.synced_at).toISOString()});assert.equal(duplicate.statusCode,409)
  const draft=(await db.query("INSERT INTO integration_1688_publish_drafts(tenant_id,connection_id,product_id,cat_id,scene,platform_schema,data_body,status)VALUES($1,$2,$3,'101','cbu','{}',$4,'draft')RETURNING id",[tenant,connection.id,product.id,JSON.stringify({formValues:{title:'测试发布',primaryPicture:{imageList:[{url:'https://example.org/a.png'}]}}})])).rows[0]
  const blockedPublish=await request('POST',`/api/integrations/1688/drafts/${draft.id}/publish`,{revision:1,confirmed:true});assert.equal(blockedPublish.statusCode,409);assert.equal(blockedPublish.json().error,'PRODUCT_ALREADY_BOUND')
  await db.query("UPDATE integration_1688_publish_drafts SET status='published' WHERE id=$1",[draft.id])
  const protectedUnlink=await request('POST',`${url}/binding`,input(3,null));assert.equal(protectedUnlink.statusCode,409);assert.equal(protectedUnlink.json().error,'PUBLISH_BINDING_LOCKED')
  await db.query("UPDATE integration_1688_publish_drafts SET status='draft' WHERE id=$1",[draft.id])
  const concurrent=await Promise.all([request('POST',`${url}/binding`,input(3,product.id,mappings)),request('POST',`${url}/binding`,input(3,product.id,mappings))]);assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[200,409])
  assert.equal((await request('POST',`${url}/binding`,input(4,null))).statusCode,200)
  assert.equal((await request('GET',`${url}/comparison`)).json().data.product,null)
  assert.equal(Number((await db.query('SELECT base_price FROM products WHERE id=$1',[product.id])).rows[0].base_price),12)
  assert.equal(Number((await db.query('SELECT stock FROM product_variants WHERE id=$1',[red.id])).rows[0].stock),7)
  assert.equal(numericDifference('9007199254740993.01','9007199254740993.0100').status,'equal')
  assert.equal(numericDifference(null,0).status,'unknown')
  const changedCurrency=comparison({...listing,product_id:product.id,sku_bindings:mappings,snapshot:{...snapshot,saleInfo:{currency:'USD',priceRanges:[{startQuantity:1,price:12}]}}},product,[{id:red.id,unit_price:12,stock:9}]);assert.equal(changedCurrency.rows[0].price.status,'unknown')
  const tiered=comparison({...listing,snapshot:{saleInfo:{priceRanges:[{startQuantity:2,price:12}]}}},product,[]);assert.equal(tiered.fields.basePrice.status,'unknown')
  assert.equal(externalCalls,0)
  console.log(JSON.stringify({tenantIsolation:'ok',permissions:'ok',explicitConfirmation:'ok',bindingRevision:'ok',snapshotConflict:'ok',uniqueProductBinding:'ok',skuMappingValidation:'ok',differenceReport:'ok',unknownValues:'ok',decimalPrecision:'ok',currencyGuard:'ok',tieredPricingGuard:'ok',duplicatePublishGuard:'ok',publishedBindingProtection:'ok',concurrentBinding:'ok',unlink:'ok',crmUnchanged:'ok',externalCalls}))
}finally{globalThis.fetch=originalFetch;for(const id of tenants){await db.query('DELETE FROM audit_logs WHERE tenant_id=$1',[id]);await db.query('DELETE FROM tenants WHERE id=$1',[id])}await app.close();await db.end()}
