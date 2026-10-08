import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { buildApp } from '../dist-server/server/app.js'
import { db } from '../dist-server/server/db.js'
import { comparison } from '../dist-server/server/integrations/1688-comparison.js'

if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const app=await buildApp(),browser=await chromium.launch({headless:true,channel:'chrome'})
const output='/tmp/crm-1688-binding-ui'
await mkdir(output,{recursive:true})
try{
  const user=(await db.query("SELECT id,tenant_id,email,display_name FROM users WHERE tenant_id=(SELECT id FROM tenants WHERE slug='default') AND status='active' AND deleted_at IS NULL LIMIT 1")).rows[0]
  const connection=(await db.query('SELECT id FROM integration_1688_connections WHERE tenant_id=$1 LIMIT 1',[user.tenant_id])).rows[0]
  const token=app.jwt.sign({sub:user.id,tenantId:user.tenant_id,email:user.email,displayName:user.display_name,roles:['ui-test'],permissions:['*']},{expiresIn:'5m'})
  const product={id:randomUUID(),sku:'UI-BINDING',name:'关联界面正式产品',status:'active',base_currency:'CNY',base_price:12,images:[],updated_at:new Date().toISOString()}
  const variants=[{id:randomUUID(),label:'红色',attributes:{颜色:'红色'},unit_price:15,stock:7},{id:randomUUID(),label:'蓝色',attributes:{颜色:'蓝色'},unit_price:8,stock:null}]
  let listing={id:randomUUID(),connection_id:connection.id,offer_id:'9007199254740993123',title:'关联界面测试商品',status:'published',image_url:null,product_id:null,binding_revision:1,sku_bindings:[],synced_at:new Date().toISOString(),snapshot:{saleInfo:{currency:'CNY',priceRanges:[{startQuantity:1,price:12}]},skuInfos:[{specId:'spec-red',price:12,amountOnSale:9,attributes:[{attributeDisplayName:'颜色',attributeValue:'红色'}]},{specId:'spec-blue',amountOnSale:4,attributes:[{attributeDisplayName:'颜色',attributeValue:'蓝色'}]}]}}
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  let bindingWrites=0,platformWrites=0
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(value=>localStorage.setItem('ai_crm_access_token',value),token)
  await page.route('**/api/products**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:[product],total:1})}))
  await page.route('**/api/integrations/1688/listings**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname
    const fulfill=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
    if(path.endsWith('/binding')){
      const payload=req.postDataJSON();assert.equal(payload.confirmed,true);assert.equal(payload.revision,listing.binding_revision);assert.equal(payload.syncedAt,listing.synced_at)
      listing={...listing,product_id:payload.productId,sku_bindings:payload.bindings,binding_revision:listing.binding_revision+1};bindingWrites++
      return fulfill({data:{id:listing.id,productId:listing.product_id,bindingRevision:listing.binding_revision}})
    }
    if(req.method()!=='GET'){platformWrites++;return fulfill({error:'BLOCKED'},418)}
    if(path.endsWith('/comparison')){
      const chosen=listing.product_id||url.searchParams.get('productId')
      return fulfill({data:comparison(listing,chosen?product:null,chosen?variants:[])})
    }
    return fulfill(path.endsWith('/listings')?{data:[listing],total:1}:{data:listing})
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('button',{name:'1688 店铺',exact:true}).click()
  await page.getByRole('button',{name:'查看 关联界面测试商品',exact:true}).click()
  const panel=page.getByRole('region',{name:'CRM 关联与差异'})
  await page.getByRole('button',{name:'关联正式产品',exact:true}).click()
  await page.getByLabel('关联正式产品选择').selectOption(product.id)
  await page.getByLabel('平台 SKU 对应 1').selectOption(variants[0].id)
  await page.getByLabel('平台 SKU 对应 2').selectOption(variants[1].id)
  assert.equal(await page.getByRole('button',{name:'保存关联',exact:true}).isEnabled(),false)
  await panel.getByRole('checkbox').check()
  await page.getByRole('button',{name:'保存关联',exact:true}).click()
  await panel.getByText('价格不同 1',{exact:true}).waitFor()
  await panel.getByText('库存不同 1',{exact:true}).waitFor()
  await panel.getByText('待核对 1',{exact:true}).waitFor()
  await panel.scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/desktop.png`})
  await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded()
  await page.screenshot({path:`${output}/mobile.png`})
  const dialog=await page.getByRole('dialog',{name:'平台商品详情'}).boundingBox()
  assert.ok(dialog.x>=0&&dialog.x+dialog.width<=390)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.getByRole('button',{name:'关联正式产品',exact:true}).click()
  await page.getByRole('button',{name:'解除关联',exact:true}).click()
  assert.equal(bindingWrites,1)
  await page.getByRole('button',{name:'确认解除关联',exact:true}).click()
  await panel.getByText('尚未关联正式产品',{exact:true}).waitFor()
  assert.equal(bindingWrites,2);assert.equal(platformWrites,0);assert.deepEqual(errors,[])
  console.log(JSON.stringify({productPreview:'ok',skuMatching:'ok',explicitConfirmation:'ok',differenceReport:'ok',unlinkConfirmation:'ok',desktopMobile:'ok',consoleErrors:0,platformWrites,screenshots:output}))
}finally{await browser.close();await app.close();await db.end()}
