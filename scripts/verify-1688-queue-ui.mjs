import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {buildApp} from '../dist-server/server/app.js'
import {db} from '../dist-server/server/db.js'

if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const app=await buildApp(),browser=await chromium.launch({headless:true,channel:'chrome'}),output='/tmp/crm-1688-queue-ui'
await mkdir(output,{recursive:true})
try{
  const user=(await db.query("SELECT id,tenant_id,email,display_name FROM users WHERE tenant_id=(SELECT id FROM tenants WHERE slug='default') AND status='active' AND deleted_at IS NULL LIMIT 1")).rows[0]
  const token=app.jwt.sign({sub:user.id,tenantId:user.tenant_id,email:user.email,displayName:user.display_name,roles:[],permissions:['*']},{expiresIn:'5m'})
  const makeItem=(title,queue_status,queue_message)=>({id:randomUUID(),source:'1688',source_product_id:String(Math.floor(Math.random()*1e8)),source_url:'https://detail.1688.com/offer/123.html',title,main_image_url:'https://cbu01.alicdn.com/img/demo.jpg',gallery_images:[],detail_images:['https://cbu01.alicdn.com/img/detail.jpg'],video_url:null,description_url:null,currency:'CNY',price_min:'12.00',price_max:'12.00',attributes:{材质:'棉'},sku_props:[],seller_name:'测试店铺',seller_id:null,category_path:'服饰',source_category_id:'101',source_category_attributes:[],tags:[],collector_note:null,source_collected_at:null,raw_data:{},collector_mode:'test',collector_version:'1',processing_status:'collected',queue_status,queue_message,product_id:null,collector_name:'测试',variant_count:1,min_price:'12.00',max_price:'12.00',collected_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()})
  const blocked=makeItem('有水印的商品','blocked','主图发现可见水印，请核对授权并更换原图')
  const available=makeItem('可加入队列的商品',null,null)
  let enqueueCalls=0,platformWrites=0
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(value=>localStorage.setItem('ai_crm_access_token',value),token)
  await page.route('**/api/product-collections**',route=>{
    const path=new URL(route.request().url()).pathname
    if(path.endsWith('/product-collections'))return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[blocked,available]})})
    if(path.endsWith(available.id))return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{product:available,variants:[{id:randomUUID(),label:'红色',attributes:{颜色:'红色'},image_url:null,price:'12.00',stock:'7'}]}})})
    return route.fulfill({status:404,contentType:'application/json',body:'{}'})
  })
  await page.route('**/api/integrations/1688/**',route=>{
    if(route.request().method()==='POST'&&route.request().url().endsWith(`/agent/queue/${available.id}`)){enqueueCalls++;return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{id:randomUUID(),status:'queued'}})})}
    if(route.request().method()!=='GET')platformWrites++
    return route.fulfill({status:418,contentType:'application/json',body:'{}'})
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('button',{name:'1688 商品采集',exact:true}).click()
  await page.getByText('主图发现可见水印，请核对授权并更换原图').waitFor()
  await page.screenshot({path:`${output}/list-desktop.png`})
  await page.getByRole('button',{name:`查看 ${available.title}`}).click()
  await page.getByRole('button',{name:'加入 Agent 队列'}).click()
  await page.getByText('已加入 Agent 队列').waitFor()
  assert.equal(enqueueCalls,1)
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350)
  await page.screenshot({path:`${output}/list-mobile.png`})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  assert.deepEqual(errors,[]);assert.equal(platformWrites,0)
  console.log(JSON.stringify({riskMessage:'ok',manualEnqueue:'ok',desktopMobile:'ok',consoleErrors:0,livePlatformWrites:0,screenshots:output}))
}finally{await browser.close();await app.close();await db.end()}
