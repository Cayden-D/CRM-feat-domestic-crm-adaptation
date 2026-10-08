import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,channel:'chrome'})
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
 const shop=randomUUID(),listing={id:randomUUID(),connection_id:shop,offer_id:'1234567890123456789',title:'删除界面测试',status:'published',deletion_state:'active',display_name:'测试店铺',synced_at:new Date().toISOString(),snapshot:{}}
 let calls=0
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>localStorage.setItem('ai_crm_access_token','fixture'))
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  let data={data:[]}
  if(path.endsWith('/delete')){calls++;assert.deepEqual(route.request().postDataJSON(),{confirmed:true,offerId:listing.offer_id,syncedAt:listing.synced_at});listing.deletion_state='deleted';data={data:{deleted:true}}}
  else if(path==='/api/auth/me')data={user:{email:'fixture',displayName:'测试',permissions:['*'],roles:[]}}
  else if(path==='/api/ai/models')data={data:{configured:false,models:['qwen3.8-flash'],defaultModel:'qwen3.8-flash'}}
  else if(path.endsWith('/connections'))data={data:[{id:shop,display_name:'测试店铺',status:'connected'}],configured:true}
  else if(path.endsWith('/comparison'))return route.fulfill({status:404,contentType:'application/json',body:'{"message":"测试商品未关联"}'})
  else if(path.endsWith(`/listings/${listing.id}`))data={data:listing}
  else if(path.endsWith('/listings'))data={data:[listing]}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
 })
 await page.goto('http://127.0.0.1:5173/')
 await page.getByRole('button',{name:'1688 店铺',exact:true}).click()
 await page.getByRole('button',{name:'查看 删除界面测试',exact:true}).click()
 await page.getByRole('button',{name:'移入回收站',exact:true}).click()
 const dialog=page.getByRole('alertdialog',{name:'确认移入回收站'})
 assert.ok(await dialog.getByRole('button',{name:'确认移入回收站',exact:true}).isDisabled())
 await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(calls,0)
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350)
 await page.getByRole('button',{name:'移入回收站',exact:true}).click()
 await dialog.getByRole('checkbox').check()
 await dialog.getByRole('button',{name:'确认移入回收站',exact:true}).click()
 await page.getByText('已移入平台回收站',{exact:true}).waitFor()
 assert.equal(calls,1);assert.deepEqual(errors,[])
 console.log(JSON.stringify({confirmation:'ok',cancelNoRequest:'ok',mobileSubmit:'ok',deletedState:'ok',consoleErrors:0,liveDeletes:0}))
}finally{await browser.close()}
