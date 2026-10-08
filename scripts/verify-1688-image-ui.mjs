import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { buildApp } from '../dist-server/server/app.js'
import { db } from '../dist-server/server/db.js'

if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const app=await buildApp(),browser=await chromium.launch({headless:true,channel:'chrome'}),output='/tmp/crm-1688-image-ui'
await mkdir(output,{recursive:true})
try{
  const user=(await db.query("SELECT id,tenant_id,email,display_name FROM users WHERE tenant_id=(SELECT id FROM tenants WHERE slug='default') AND status='active' AND deleted_at IS NULL LIMIT 1")).rows[0]
  const connection=(await db.query('SELECT id,display_name FROM integration_1688_connections WHERE tenant_id=$1 LIMIT 1',[user.tenant_id])).rows[0]
  const token=app.jwt.sign({sub:user.id,tenantId:user.tenant_id,email:user.email,displayName:user.display_name,roles:['ui-test'],permissions:['*']},{expiresIn:'5m'})
  const product={id:randomUUID(),sku:'IMAGE-UI',name:'图片工作台测试商品',status:'active'}
  const source='https://cbu01.alicdn.com/img/source.png',previewUrl='https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/test.png'
  let draft={id:randomUUID(),connection_id:connection.id,product_id:product.id,name:product.name,sku:product.sku,cat_id:'101',scene:'cbu',revision:1,status:'draft',offer_id:null,platform_schema:{global:{},data:{title:{fields:{label:'标题',maxLength:60}},primaryPicture:{fields:{maxItems:5}}}},data_body:{global:{},formValues:{title:product.name,primaryPicture:{imageList:[{url:source}]}}}}
  let generateCalls=0,applyCalls=0,platformWrites=0,preview=null
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(value=>localStorage.setItem('ai_crm_access_token',value),token)
  await page.route('**/api/products**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:[product]})}))
  await page.route('**/api/integrations/1688/**',route=>{
    const req=route.request(),path=new URL(req.url()).pathname
    const fulfill=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
    if(path.endsWith('/agent/settings'))return fulfill({data:[{...connection,status:'connected',enabled:false,revision:0}],configured:true,model:'qwen3.8-flash',imageRepairAvailable:true})
    if(path.endsWith('/agent-job'))return fulfill({data:null})
    if(path.endsWith('/agent-images')&&req.method()==='GET')return fulfill({data:preview?[preview]:[]})
    if(path.endsWith('/agent-images')&&req.method()==='POST'){
      const input=req.postDataJSON();assert.equal(input.confirmed,true);assert.equal(input.mode,'edit');assert.equal(input.sourceIndex,0);generateCalls++
      preview={id:randomUUID(),mode:'edit',model:input.model,prompt:input.prompt,url:previewUrl,storage:'oss',findings:[{url:previewUrl,readable:true,watermark:true,rightsRisk:false,uncertain:false,reason:'发现可见水印'}],status:'preview',photo_url:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),risky:true}
      return fulfill({data:preview})
    }
    if(path.includes('/agent-images/')&&path.endsWith('/apply')){applyCalls++;return fulfill({error:'BLOCKED'},418)}
    if(path.endsWith('/drafts'))return fulfill({data:[draft]})
    if(path.includes('/drafts/')&&req.method()==='GET')return fulfill({data:draft,missing:[]})
    if(req.method()!=='GET'){platformWrites++;return fulfill({error:'BLOCKED'},418)}
    return route.continue()
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('button',{name:'1688 店铺',exact:true}).click()
  await page.getByRole('button',{name:'发布工作台',exact:true}).click()
  await page.getByRole('button',{name:`查看草稿 ${product.name}`,exact:true}).click()
  await page.getByRole('button',{name:'AI 图片工作台',exact:true}).click()
  const studio=page.getByRole('dialog',{name:'AI 图片工作台'})
  await studio.waitFor()
  await studio.getByLabel('画面要求').fill('保持商品形状和颜色，改善灯光，纯白背景')
  assert.equal(await studio.getByRole('button',{name:'生成预览'}).isEnabled(),false)
  await studio.getByRole('checkbox',{name:/确认拥有原图/}).check()
  await studio.getByRole('button',{name:'生成预览'}).click()
  await studio.getByText('发现可见水印').waitFor()
  await studio.getByText(/已保存至私有 OSS/).waitFor()
  assert.equal(await studio.getByRole('button',{name:'上传并应用'}).count(),0)
  await page.screenshot({path:`${output}/desktop.png`})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:`${output}/mobile.png`})
  const box=await studio.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=390)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  assert.deepEqual(errors,[])
  assert.equal(generateCalls,1);assert.equal(applyCalls,0);assert.equal(platformWrites,0)
  console.log(JSON.stringify({consentGate:'ok',riskGate:'ok',mobile:'ok',consoleErrors:0,platformWrites:0,screenshots:output}))
}finally{await browser.close();await app.close();await db.end()}
