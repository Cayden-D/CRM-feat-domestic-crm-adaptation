import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { buildApp } from '../dist-server/server/app.js'
import { db } from '../dist-server/server/db.js'

if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const app=await buildApp(),browser=await chromium.launch({headless:true,channel:'chrome'}),output='/tmp/crm-1688-agent-ui'
await mkdir(output,{recursive:true})
try{
  const user=(await db.query("SELECT id,tenant_id,email,display_name FROM users WHERE tenant_id=(SELECT id FROM tenants WHERE slug='default') AND status='active' AND deleted_at IS NULL LIMIT 1")).rows[0]
  const connection=(await db.query('SELECT id,display_name FROM integration_1688_connections WHERE tenant_id=$1 LIMIT 1',[user.tenant_id])).rows[0]
  const token=app.jwt.sign({sub:user.id,tenantId:user.tenant_id,email:user.email,displayName:user.display_name,roles:['ui-test'],permissions:['*']},{expiresIn:'5m'})
  const product={id:randomUUID(),sku:'AGENT-UI',name:'Agent 界面测试商品',status:'active'}
  let enabled=false,revision=0,queueEnabled=false,queueRevision=0,queueWrites=0,job=null,agentRuns=0,settingWrites=0,platformWrites=0
  const freshDraft=()=>({id:randomUUID(),connection_id:connection.id,product_id:product.id,name:product.name,sku:product.sku,cat_id:'101',scene:'cbu',revision:1,status:'draft',offer_id:null,platform_schema:{global:{},data:{title:{fields:{label:'标题',maxLength:60}}}},data_body:{global:{},formValues:{title:product.name,primaryPicture:{imageList:[]}}}})
  let draft=freshDraft()
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(value=>localStorage.setItem('ai_crm_access_token',value),token)
  await page.route('**/api/products**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:[product]})}))
  await page.route('**/api/integrations/1688/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname
    const fulfill=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
    if(path.endsWith('/agent/settings'))return fulfill({data:[{...connection,status:'connected',enabled,revision}],configured:true,model:'qwen3.8-flash',imageRepairAvailable:false})
    if(path.endsWith('/agent/queue'))return fulfill({data:{settings:[{id:connection.id,display_name:connection.display_name,connection_status:'connected',agent_enabled:enabled,enabled:queueEnabled,revision:queueRevision}],jobs:[{id:randomUUID(),collected_product_id:randomUUID(),connection_id:connection.id,title:'待核对测试商品',display_name:connection.display_name,status:'blocked',phase:'screening',attempts:1,message:'主图发现可见水印，请更换原图',product_id:null,draft_id:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]}})
    if(path.endsWith('/agent-settings')){const payload=req.postDataJSON();assert.equal(payload.confirmed,true);assert.equal(payload.revision,revision);enabled=payload.enabled;revision++;settingWrites++;return fulfill({data:{enabled,revision}})}
    if(path.endsWith('/agent-queue-settings')){const payload=req.postDataJSON();assert.equal(payload.confirmed,true);assert.equal(payload.revision,queueRevision);queueEnabled=payload.enabled;queueRevision++;queueWrites++;return fulfill({data:{enabled:queueEnabled,revision:queueRevision}})}
    if(path.includes('/agent/queue-jobs/')&&path.endsWith('/retry'))return fulfill({data:{status:'queued'}})
    if(path.endsWith('/agent-job'))return fulfill({data:job})
    if(path.endsWith('/agent')){assert.equal(enabled,true);agentRuns++;job={id:randomUUID(),status:'blocked',message:'图片 1 检测到水印与疑似品牌标识，请核对授权或替换图片；AI 修图尚未接入。',report:{model:'qwen3.8-flash',title:'自动生成的测试标题',images:[{url:'fixture',watermark:true,rightsRisk:true,uncertain:false,readable:true,reason:'店铺水印与品牌标识'}]}};return fulfill({data:job})}
    if(path.endsWith('/drafts')&&req.method()==='POST'){draft=freshDraft();job=null;return fulfill({data:draft,missing:[]},201)}
    if(path.endsWith('/drafts'))return fulfill({data:[draft]})
    if(path.includes('/drafts/')&&req.method()==='GET')return fulfill({data:draft,missing:[]})
    if(req.method()!=='GET'){platformWrites++;return fulfill({error:'BLOCKED'},418)}
    return route.continue()
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('button',{name:'系统设置',exact:true}).click()
  const toggle=page.getByRole('switch',{name:`${connection.display_name} Agent 上品模式`,exact:true})
  await toggle.click()
  const confirmation=page.getByRole('dialog',{name:'开启 Agent 上品'})
  assert.equal(await confirmation.getByRole('button',{name:'开启模式'}).isEnabled(),false)
  assert.equal(settingWrites,0)
  await confirmation.getByRole('checkbox').check();await confirmation.getByRole('button',{name:'开启模式'}).click()
  await confirmation.waitFor({state:'hidden'});assert.equal(settingWrites,1)
  await page.getByRole('button',{name:'刷新队列'}).click()
  const queueToggle=page.getByRole('switch',{name:`${connection.display_name} 采集后自动上品`,exact:true})
  await queueToggle.click()
  const queueConfirmation=page.getByRole('dialog',{name:'开启采集自动上品'})
  assert.equal(await queueConfirmation.getByRole('button',{name:'开启队列'}).isEnabled(),false)
  await queueConfirmation.getByRole('checkbox').check();await queueConfirmation.getByRole('button',{name:'开启队列'}).click()
  await queueConfirmation.waitFor({state:'hidden'});assert.equal(queueWrites,1)
  await page.getByText('主图发现可见水印，请更换原图').waitFor()
  await page.screenshot({path:`${output}/settings-desktop.png`})
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);await page.screenshot({path:`${output}/settings-mobile.png`})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'1688 店铺',exact:true}).click()
  await page.getByRole('button',{name:'发布工作台',exact:true}).click()
  await page.getByRole('button',{name:`查看草稿 ${product.name}`,exact:true}).click()
  await page.getByRole('button',{name:'自动检测并发布',exact:true}).click()
  const warning=page.getByRole('alertdialog',{name:'Agent 上品提示'})
  await warning.getByText(/图片 1 检测到水印/).waitFor()
  await page.screenshot({path:`${output}/risk-desktop.png`})
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/risk-mobile.png`})
  const box=await warning.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
  await warning.getByRole('button',{name:'知道了'}).click()
  await page.getByRole('dialog',{name:'商品发布草稿'}).getByRole('button',{name:'关闭',exact:true}).last().click()
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'新建草稿',exact:true}).click()
  const create=page.getByRole('dialog',{name:'新建发布草稿'})
  await create.getByLabel('正式产品',{exact:true}).selectOption(product.id)
  await create.getByLabel('类目 ID',{exact:true}).fill('101')
  await create.getByRole('button',{name:'获取发布规则',exact:true}).click()
  await warning.waitFor();assert.equal(agentRuns,2,'new draft must start the enabled Agent automatically')
  assert.equal(platformWrites,0);assert.deepEqual(errors,[])
  console.log(JSON.stringify({settingsConfirmation:'ok',queueConfirmation:'ok',queueErrors:'ok',manualAgent:'ok',automaticNewDraft:'ok',riskPopup:'ok',desktopMobile:'ok',consoleErrors:0,livePlatformWrites:0,screenshots:output}))
}finally{await browser.close();await app.close();await db.end()}
