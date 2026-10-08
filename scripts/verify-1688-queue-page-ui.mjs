import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,channel:'chrome'})
const long='图片风险筛查未通过，请核对图片、商品信息和资料。'.repeat(200),shop='11111111-1111-4111-8111-111111111111'
const rows=Array.from({length:45},(_,i)=>({id:`job-${i}`,title:`商品${i} `+'很长的商品名称'.repeat(20),display_name:'很长的目标店铺名称有限公司'.repeat(5),connection_id:shop,status:i%2?'queued':'blocked',message:long,attempts:1,product_id:null,draft_id:null,updated_at:new Date().toISOString()}))
const output='/tmp/crm-queue-page';await mkdir(output,{recursive:true})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>localStorage.setItem('ai_crm_access_token','fixture'))
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname
  let data={data:[]}
  if(path==='/api/auth/me')data={user:{email:'fixture',displayName:'测试',permissions:['*'],roles:[]}}
  else if(path==='/api/ai/models')data={data:{models:['qwen3.8-flash'],defaultModel:'qwen3.8-flash',configured:false}}
  else if(path.endsWith('/agent/settings'))data={data:[],configured:false}
  else if(path.endsWith('/publish-template'))data={data:{values:{},revision:0}}
  else if(path.endsWith('/agent/queue')){
   const pageNo=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('pageSize')||20),status=url.searchParams.get('status'),search=url.searchParams.get('search')||''
   const filtered=rows.filter(r=>(!status||r.status===status)&&r.title.includes(search))
   data={data:{settings:[{id:shop,display_name:'测试店铺',agent_enabled:false,enabled:false}],jobs:filtered.slice((pageNo-1)*size,pageNo*size),page:pageNo,pageSize:size,total:filtered.length}}
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
 })
 await page.goto('http://127.0.0.1:5173/')
 await page.getByRole('button',{name:'上架队列',exact:true}).click()
 await page.getByText('共 45 条',{exact:true}).waitFor()
 assert.equal(await page.locator('.queue-table tbody tr').count(),20)
 const heights=await page.locator('.queue-table tbody tr').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height));assert.ok(heights.every(h=>h<110))
 await page.locator('.queue-detail-button').first().click()
 const dialog=page.getByRole('dialog',{name:'上架任务详情'});assert.equal(await dialog.locator('.queue-full-message').textContent(),long)
 await page.keyboard.press('Escape')
 await page.screenshot({path:`${output}/desktop.png`,fullPage:true})
 await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 / 3 页',{exact:true}).waitFor()
 assert.ok((await page.locator('.queue-title').first().textContent()).startsWith('商品20 '))
 await page.getByLabel('任务状态',{exact:true}).selectOption('queued');await page.getByText('共 22 条',{exact:true}).waitFor();assert.ok((await page.locator('.queue-title').first().textContent()).startsWith('商品1 '))
 await page.getByLabel('搜索队列商品',{exact:true}).fill('不存在');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByText('没有符合筛选条件的任务。',{exact:true}).waitFor()
 await page.getByLabel('搜索队列商品',{exact:true}).fill('');await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByText('共 22 条',{exact:true}).waitFor()
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
 await page.screenshot({path:`${output}/mobile.png`,fullPage:true})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({navigation:'ok',pagination:'ok',filters:'ok',empty:'ok',longRowsBounded:'ok',fullDetail:'ok',mobileOverflow:'ok',screenshots:output}))
}finally{await browser.close()}
