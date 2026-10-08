import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { buildApp } from '../dist-server/server/app.js'
import { db } from '../dist-server/server/db.js'

if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const app=await buildApp(),browser=await chromium.launch({headless:true,channel:'chrome'})
const output='/tmp/crm-1688-sku-ui'
await mkdir(output,{recursive:true})
try{
  const user=(await db.query("SELECT id,tenant_id,email,display_name FROM users WHERE tenant_id=(SELECT id FROM tenants WHERE slug='default') AND status='active' AND deleted_at IS NULL LIMIT 1")).rows[0]
  const connection=(await db.query('SELECT id FROM integration_1688_connections WHERE tenant_id=$1 LIMIT 1',[user.tenant_id])).rows[0]
  const image=(await db.query('SELECT image_url FROM integration_1688_listings WHERE connection_id=$1 LIMIT 1',[connection.id])).rows[0].image_url
  const token=app.jwt.sign({sub:user.id,tenantId:user.tenant_id,email:user.email,displayName:user.display_name,roles:['ui-test'],permissions:['*']},{expiresIn:'5m'})
  const dimensions=[{name:'p-1',propertyId:1,label:'颜色',required:true,dataSource:[{value:10,text:'红色'},{value:20,text:'蓝色'}]},{name:'p-2',propertyId:2,label:'尺码',customizable:true}]
  const properties=[{id:1,name:'p-1',label:'颜色',value:10,text:'红色'},{id:2,name:'p-2',label:'尺码',value:-1,text:'L',custom:true}]
  let draft={id:randomUUID(),connection_id:connection.id,product_id:randomUUID(),name:'SKU 界面测试产品',sku:'UI-TEST',cat_id:'101',scene:'cbu',revision:1,status:'draft',offer_id:null,platform_schema:{global:{systemParam:{catId:101}},data:{title:{fields:{label:'标题',maxLength:60}},saleProp:{fields:{label:'销售规格',dataSource:dimensions}},skuTable:{supportLevelProp:true,fields:{label:'规格报价',column:[]}},quotationType:{fields:{label:'报价方式',dataSource:[{value:1,text:'按产品规格报价'},{value:2,text:'按数量报价'}]}}}},data_body:{global:{systemParam:{catId:101}},formValues:{title:'SKU 界面测试产品',primaryPicture:{imageList:[{url:image}]},quotationType:{value:1,text:'按产品规格报价'},saleProp:{'p-1':[{value:10,text:'红色'}],'p-2':[{value:-1,text:'L',custom:true}]},skuTable:[{sku_props:properties,sku_price:12,sku_amountOnSale:10,sku_status:1}]}}}
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'})
  await page.addInitScript(value=>localStorage.setItem('ai_crm_access_token',value),token)
  let platformWrites=0,ruleCalls=0,mappingCalls=0
  await page.route('**/api/integrations/1688/drafts**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,payload=req.method()==='GET'?{}:req.postDataJSON()
    const fulfill=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
    if(path.endsWith('/publish')){platformWrites++;return fulfill({error:'BLOCKED'},418)}
    if(path.endsWith('/variants'))return fulfill({data:[{id:'v-1',label:'红 L',attributes:{来源颜色:'红色',来源尺码:'L'},unit_price:23,stock:9,image_url:null}]})
    if(path.endsWith('/map-variants')){assert.equal(payload.confirmed,true);assert.deepEqual(payload.mapping,{'p-1':'来源颜色','p-2':'来源尺码'});mappingCalls++;draft={...draft,revision:draft.revision+1,data_body:{...draft.data_body,formValues:{...draft.data_body.formValues,skuTable:[{sku_props:properties,sku_price:23,sku_amountOnSale:9,sku_status:1}],saleProp:{'p-1':[{value:10,text:'红色'}],'p-2':[{value:-1,text:'L',custom:true}]}}}};return fulfill({data:draft,missing:[]})}
    if(path.endsWith('/sku-rules')){ruleCalls++;draft={...draft,revision:draft.revision+1,platform_schema:{...draft.platform_schema,data:{...draft.platform_schema.data,skuTable:{supportLevelProp:true,fields:{column:[{name:'sku_firstPrice',label:'会员单价',uiType:'cbunumber',precision:2,visible:true}]}}}}};return fulfill({data:draft,missing:[]})}
    if(req.method()==='PATCH'){assert.equal(payload.revision,draft.revision);draft={...draft,revision:draft.revision+1,data_body:{...draft.data_body,formValues:payload.formValues}};return fulfill({data:draft,missing:[]})}
    if(path.endsWith('/drafts'))return fulfill({data:[draft]})
    return fulfill({data:draft,missing:[]})
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('button',{name:'1688 店铺',exact:true}).click()
  await page.getByRole('button',{name:'发布工作台',exact:true}).click()
  await page.getByRole('button',{name:'查看草稿 SKU 界面测试产品',exact:true}).click()
  await page.getByLabel('SKU 单价 1',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('SKU 单价 1',{exact:true}).inputValue(),'12')
  await page.getByLabel('颜色枚举规格').selectOption('20')
  await page.getByRole('button',{name:'生成组合预览'}).click()
  await page.getByRole('button',{name:'应用组合'}).click()
  assert.equal(await page.getByLabel('SKU 单价 1',{exact:true}).inputValue(),'12')
  assert.equal(await page.getByLabel('SKU 库存 1',{exact:true}).inputValue(),'10')
  assert.equal(await page.getByLabel('SKU 库存 2',{exact:true}).inputValue(),'')
  await page.getByLabel('SKU 单价 2',{exact:true}).fill('16')
  await page.getByLabel('SKU 库存 2',{exact:true}).fill('8')
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await page.getByRole('button',{name:'读取官方 SKU 子规则',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="SKU 单价 2"]')?.value==='16')
  await page.getByLabel('会员单价 1',{exact:true}).fill('21')
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await page.getByRole('button',{name:'映射正式产品规格',exact:true}).click()
  const mapping=page.locator('.shop-sku-mapping')
  await mapping.getByLabel('平台颜色映射',{exact:true}).selectOption('来源颜色')
  await mapping.getByLabel('平台尺码映射',{exact:true}).selectOption('来源尺码')
  assert.equal(await mapping.getByRole('button',{name:'确认映射',exact:true}).isEnabled(),false)
  await mapping.getByRole('checkbox').check()
  await mapping.getByRole('button',{name:'确认映射',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="SKU 单价 1"]')?.value==='23')
  await page.locator('.shop-sku-section').scrollIntoViewIfNeeded()
  await page.screenshot({path:`${output}/desktop.png`})
  await page.setViewportSize({width:390,height:844});await page.locator('.shop-sku-section').scrollIntoViewIfNeeded()
  await page.screenshot({path:`${output}/mobile.png`})
  const dialog=await page.getByRole('dialog',{name:'商品发布草稿'}).boundingBox()
  assert.ok(dialog.x>=0&&dialog.x+dialog.width<=390,'mobile modal must fit the viewport')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  assert.deepEqual(errors,[]);assert.equal(ruleCalls,1);assert.equal(mappingCalls,1);assert.equal(platformWrites,0)
  console.log(JSON.stringify({skuControls:'ok',combinationPreview:'ok',retainedPriceStock:'ok',unknownStock:'ok',savedDraft:'ok',ruleRefresh:'ok',dynamicQuoteColumns:'ok',mappingConfirmation:'ok',desktopMobile:'ok',consoleErrors:0,platformWrites,screenshots:output}))
}finally{await browser.close();await app.close();await db.end()}
