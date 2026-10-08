import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,channel:'chrome'})
const id=randomUUID(),shop=randomUUID()
const draft={id,connection_id:shop,product_id:randomUUID(),name:'预览测试商品',cat_id:'101',scene:'cbu',revision:1,status:'draft',platform_schema:{data:Object.fromEntries(Array.from({length:25},(_,i)=>[`test${i}`,{fields:{label:`属性 ${i}`,uiType:'input'}}]))},data_body:{global:{},formValues:{title:'预览测试商品',primaryPicture:{imageList:[]}}}}
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[]
 let writes=0
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>localStorage.setItem('ai_crm_access_token','preview-fixture'))
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET'){writes++;return route.fulfill({status:418,body:'{}'})}
  const path=new URL(route.request().url()).pathname
  let data={data:[]}
  if(path==='/api/auth/me')data={user:{displayName:'测试',email:'test@fixture.local',permissions:['*'],roles:[]}}
  else if(path==='/api/ai/models')data={data:{defaultModel:'qwen3.8-flash',models:['qwen3.8-flash'],configured:true}}
  else if(path.endsWith('/connections'))data={data:[{id:shop,display_name:'测试店铺',status:'connected'}],configured:true}
  else if(path.endsWith('/drafts'))data={data:[draft]}
  else if(path.endsWith('/agent-job'))data={data:null}
  else if(path.endsWith('/agent/settings'))data={data:[],configured:true}
  else if(path.endsWith(`/drafts/${id}`))data={data:draft,missing:[]}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
 })
 await page.goto('http://127.0.0.1:5173/')
 await page.getByRole('button',{name:'1688 店铺',exact:true}).click()
 await page.getByRole('button',{name:'发布工作台',exact:true}).click()
 await page.getByRole('button',{name:'查看草稿 预览测试商品',exact:true}).click()
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(350)
  const body=page.locator('.shop-editor-fields');await body.evaluate(el=>{el.scrollTop=0})
  await page.getByRole('button',{name:'发布预览',exact:true}).click()
  const review=page.getByRole('region',{name:'确认发布到 1688'})
  assert.ok(await review.evaluate(el=>el===document.activeElement))
  assert.ok(await page.getByRole('heading',{name:'确认发布到 1688'}).evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.shop-editor-fields').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom}))
 }
 assert.equal(writes,0);assert.deepEqual(errors,[])
 console.log(JSON.stringify({desktopMobile:'ok',previewScroll:'ok',repeatPreview:'ok',focus:'ok',liveWrites:0}))
}finally{await browser.close()}
