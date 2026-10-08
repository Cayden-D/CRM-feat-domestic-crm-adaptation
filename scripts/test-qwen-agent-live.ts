import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { config } from '../server/config.js'
import { db } from '../server/db.js'
import { prepareAgentFields, inspectPublishingImages } from '../server/integrations/1688-agent.js'
import { validatePublishBody } from '../server/routes/1688.js'

if(process.env.RUN_LIVE_QWEN!=='1')throw new Error('Set RUN_LIVE_QWEN=1 to opt into billable model calls')
if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE is required')
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,channel:'chrome'}),originalFetch=globalThis.fetch
const endpoint=`${config.DASHSCOPE_BASE_URL.replace(/\/$/,'')}/chat/completions`
const output='/tmp/crm-qwen-agent-live'
let modelCalls=0,platformAttempts=0
globalThis.fetch=async(input,init)=>{
  if(String(input)!==endpoint){platformAttempts++;throw new Error('Live test permits only the configured Qwen endpoint')}
  modelCalls++;return originalFetch(input,init)
}
try{
  await mkdir(output,{recursive:true})
  const page=await browser.newPage({viewport:{width:640,height:640},deviceScaleFactor:1})
  await page.setContent('<html><body style="margin:0;background:white;display:grid;place-items:center;height:640px"><div style="width:180px;height:300px;background:#b4cecb;border:5px solid #3e6460;border-radius:18px;position:relative"><div style="position:absolute;left:52px;top:-55px;width:70px;height:50px;background:#3e6460;border-radius:6px"></div></div></body></html>')
  const clean=await page.screenshot({type:'png',path:`${output}/clean.png`})
  await page.evaluate(()=>{
    const mark=document.createElement('div')
    mark.textContent='测试店铺有限公司'
    Object.assign(mark.style,{position:'absolute',top:'300px',left:'10px',width:'620px',color:'#bd2020',fontSize:'26px',fontWeight:'bold',textAlign:'center',background:'white'})
    document.body.appendChild(mark)
  })
  const marked=await page.screenshot({type:'png',path:`${output}/watermark.png`})
  const fixtureImages=[clean,marked].map(buffer=>`data:image/png;base64,${buffer.toString('base64')}`)
  const fixtureFindings=await inspectPublishingImages(fixtureImages)
  assert.equal(fixtureFindings[0].readable,true,'clean fixture must be readable')
  assert.equal(fixtureFindings[0].watermark,false,'clean fixture must not have a watermark')
  assert.equal(fixtureFindings[1].readable,true,'marked fixture must be readable')
  assert.equal(fixtureFindings[1].watermark,true,'explicit watermark must be detected')

  const image=(await db.query("SELECT image_url FROM integration_1688_listings WHERE tenant_id=(SELECT id FROM tenants WHERE slug='default') AND image_url IS NOT NULL ORDER BY synced_at DESC LIMIT 1")).rows[0]?.image_url
  assert.ok(image,'a synced product image is required for CDN verification')
  const actualUrl=image.startsWith('img/')?`https://cbu01.alicdn.com/${image}`:image
  const actualFindings=await inspectPublishingImages([actualUrl])
  assert.equal(actualFindings[0].readable,true,'real CDN product image must be readable')

  const schema={global:{systemParam:{catId:101}},data:{title:{fields:{required:true,maxLength:60}},primaryPicture:{fields:{required:true}},catProp:{fields:{dataSource:[{name:'p-1',label:'材质',required:true,dataSource:[{value:1,text:'棉'},{value:2,text:'涤纶'}]}]}},saleProp:{fields:{dataSource:[{name:'p-2',propertyId:2,label:'颜色',required:true,dataSource:[{value:10,text:'红色'}]}]}},skuTable:{fields:{column:[]}},priceRange:{fields:{required:true}}}}
  const values={title:'测试商品',primaryPicture:{imageList:[{url:actualUrl}]},quotationType:{value:1,text:'按产品规格报价'},priceRange:[{pricerange_beginAmount:1,pricerange_price:12}]}
  const variants=[{id:randomUUID(),label:'红色',attributes:{颜色:'红色'},unit_price:'15.0000',stock:'7.0000',image_url:null}]
  const prepared=await prepareAgentFields(schema,values,{name:'红色棉质收纳袋',description:'材质为棉，颜色为红色。不包含品牌或认证信息。'},variants)
  assert.ok(prepared.title.length>0&&prepared.title.length<=60)
  assert.deepEqual(prepared.catProp['p-1'],{value:1,text:'棉'})
  assert.equal(prepared.skuTable[0].sku_price,15)
  assert.equal(prepared.skuTable[0].sku_amountOnSale,7)
  assert.deepEqual(prepared.priceRange,values.priceRange)
  assert.deepEqual(validatePublishBody(schema,{formValues:prepared}),[])

  const unknownSchema={data:{title:{fields:{required:true,maxLength:60}},catProp:{fields:{dataSource:[{name:'certification',label:'认证证书编号',required:true,dataSource:[{value:1,text:'证书 ABC-123'}]}]}}}}
  let unknownBlocked=false
  try{const candidate=await prepareAgentFields(unknownSchema,{title:'收纳袋'},{name:'收纳袋',description:'未提供认证及任何证书信息。'},[]);unknownBlocked=validatePublishBody(unknownSchema,{formValues:candidate}).includes('认证证书编号')}catch(error){if((error as {code?:string}).code!=='AGENT_MISSING_FACTS')throw error;unknownBlocked=true}
  assert.equal(unknownBlocked,true,'unknown certificate must never pass the publishing gate')
  let missingBlocked=false
  try{const findings=await inspectPublishingImages([`https://cbu01.alicdn.com/img/qwen-missing-${randomUUID()}.png`]);missingBlocked=findings.some(i=>!i.readable||i.watermark||i.rightsRisk||i.uncertain)}catch{missingBlocked=true}
  assert.equal(missingBlocked,true,'unreadable images must not qualify for automatic publishing')

  const result={model:'qwen3.8-flash',structuredFields:'ok',reviewedSkuPriceStock:'ok',schemaValidation:'ok',cleanImage:'ok',watermarkDetection:'ok',realCdnImage:'ok',missingFactsBlocked:'ok',unreadableImageBlocked:'ok',title:prepared.title,fixtureFindings:fixtureFindings.map(({url,...finding})=>finding),realImageFinding:actualFindings.map(({url,...finding})=>finding),modelCalls,platformAttempts,livePlatformWrites:0}
  assert.equal(platformAttempts,0)
  await writeFile(`${output}/result.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify({...result,output}))
}finally{globalThis.fetch=originalFetch;await browser.close();await db.end()}
