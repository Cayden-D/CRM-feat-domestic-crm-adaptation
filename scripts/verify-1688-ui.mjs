import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { buildApp } from '../dist-server/server/app.js'
import { db } from '../dist-server/server/db.js'

const modulePath=process.env.PLAYWRIGHT_MODULE
if(!modulePath)throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs path')
const {chromium}=await import(modulePath)
const app=await buildApp(),browser=await chromium.launch({headless:true,channel:'chrome'})
const output='/tmp/crm-1688-ui'
await mkdir(output,{recursive:true})
try{
  const user=(await db.query("SELECT id,tenant_id,email,display_name FROM users WHERE tenant_id=(SELECT id FROM tenants WHERE slug='default') AND status='active' AND deleted_at IS NULL LIMIT 1")).rows[0]
  assert.ok(user)
  const token=app.jwt.sign({sub:user.id,tenantId:user.tenant_id,email:user.email,displayName:user.display_name,roles:['ui-test'],permissions:['*']},{expiresIn:'5m'})
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  await page.emulateMedia({reducedMotion:'reduce'})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(value=>localStorage.setItem('ai_crm_access_token',value),token)
  await page.goto('http://127.0.0.1:5173/')
  await page.getByRole('button',{name:'1688 店铺',exact:true}).click()
  await page.getByRole('button',{name:'连接设置',exact:true}).waitFor()
  await page.locator('.shop-table tbody tr').first().waitFor()
  await page.locator('.shop-workspace img').first().evaluate(image=>image.complete?undefined:new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true})}))
  await page.screenshot({path:`${output}/desktop.png`,fullPage:true})
  const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)
  assert.equal(await overflow(),false,'desktop document overflow')
  await page.getByRole('button',{name:'连接设置',exact:true}).click()
  await page.getByRole('columnheader',{name:'访问令牌有效期'}).waitFor()
  await page.screenshot({path:`${output}/connections.png`,fullPage:true})
  await page.getByRole('button',{name:'发布工作台',exact:true}).click()
  await page.getByRole('button',{name:'新建草稿',exact:true}).click()
  await page.getByRole('dialog',{name:'新建发布草稿'}).waitFor()
  await page.screenshot({path:`${output}/create-draft.png`})
  await page.getByRole('button',{name:'取消',exact:true}).click()
  await page.getByRole('button',{name:'平台商品',exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:`${output}/mobile.png`,fullPage:true})
  assert.equal(await overflow(),false,'mobile document overflow')
  await page.locator('.shop-table tbody tr').first().getByRole('button').click()
  await page.getByRole('dialog',{name:'平台商品详情'}).waitFor()
  await page.screenshot({path:`${output}/mobile-detail.png`})
  assert.equal(await overflow(),false,'mobile modal document overflow')
  assert.deepEqual(errors,[])
  const images=await page.locator('.shop-workspace img').evaluateAll(nodes=>({total:nodes.length,loaded:nodes.filter(node=>node.complete&&node.naturalWidth>0).length}))
  assert.ok(images.loaded>0,'platform product images must render')
  console.log(JSON.stringify({desktop:'ok',mobile:'ok',connections:'ok',createDraft:'ok',productDetail:'ok',documentOverflow:false,consoleErrors:errors.length,images,screenshots:output,platformWrites:0}))
}finally{await browser.close();await app.close();await db.end()}
