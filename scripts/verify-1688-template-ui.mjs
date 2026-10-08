import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,channel:'chrome'})
const output='/tmp/crm-1688-template-ui';await mkdir(output,{recursive:true})
let template={values:{},revision:0},writes=0,conflict=false
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>localStorage.setItem('ai_crm_access_token','ui-fixture'))
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  let data={data:[]}
  if(path==='/api/auth/me')data={user:{email:'fixture@example.test',displayName:'测试管理员',permissions:['*'],roles:[]}}
  else if(path==='/api/ai/models')data={data:{defaultModel:'qwen3.8-flash',models:['qwen3.8-flash'],configured:true}}
  else if(path.endsWith('/agent/settings'))data={data:[],configured:true,model:'qwen3.8-flash'}
  else if(path.endsWith('/agent/queue'))data={data:{settings:[],jobs:[]}}
  else if(path.endsWith('/publish-template')){
   if(route.request().method()==='PUT'){
    if(conflict)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'公共模板已被修改，请重新加载后再保存。'})})
    const input=route.request().postDataJSON();assert.equal(input.revision,template.revision);template={values:input.values,revision:input.revision+1};writes++
   }
   data={data:template}
  }else assert.equal(route.request().method(),'GET','unexpected mutation')
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)})
 })
 await page.goto('http://127.0.0.1:5173/')
 await page.getByRole('button',{name:'系统设置',exact:true}).click()
 await page.getByLabel('模板计量单位',{exact:true}).fill('件')
 for(const [label,value]of [['库存扣减设置','2'],['供货方式','1'],['网上订购','17410'],['报价方式','2']])await page.getByLabel(`模板${label}`,{exact:true}).selectOption(value)
 await page.getByLabel('模板含包装重量（g）',{exact:true}).fill('900')
 for(const [label,value]of [['包装长（cm）','20'],['包装宽（cm）','10'],['包装高（cm）','5']])await page.getByLabel(`模板${label}`,{exact:true}).fill(value)
 await page.getByRole('button',{name:'保存公共模板',exact:true}).click()
 await page.getByText('公共模板已保存。',{exact:true}).waitFor()
 assert.equal(writes,1);assert.deepEqual(template.values,{cbuUnit:'件',invReduce:'2',supplyType:'1',onlineTrade:'17410',quotationType:'2',officialLogistics:{showLogisticsCategory:'item',offerInfo:{weight:900,length:20,width:10,height:5,volume:1000}}})
 await page.getByRole('button',{name:'重新加载',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('[aria-label="模板计量单位"]')?.value==='件')
 await page.screenshot({path:`${output}/desktop.png`,fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400)
 await page.getByRole('heading',{name:'公共发布模板',exact:true}).scrollIntoViewIfNeeded()
 await page.screenshot({path:`${output}/mobile.png`,fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
 await page.getByLabel('模板包装宽（cm）',{exact:true}).fill('30');assert.equal(await page.getByRole('button',{name:'保存公共模板',exact:true}).isDisabled(),true)
 await page.getByLabel('模板包装宽（cm）',{exact:true}).fill('10')
 await page.getByRole('button',{name:'清空件重尺模板',exact:true}).click();assert.equal(await page.getByLabel('模板含包装重量（g）',{exact:true}).inputValue(),'')
 conflict=true;await page.getByLabel('模板计量单位',{exact:true}).fill('套');await page.getByRole('button',{name:'保存公共模板',exact:true}).click()
 await page.getByText('公共模板已被修改，请重新加载后再保存。',{exact:true}).waitFor();assert.equal(writes,1)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({formSave:'ok',reload:'ok',conflict:'ok',desktopMobile:'ok',consoleErrors:0,liveWrites:0,screenshots:output}))
}finally{await browser.close()}
