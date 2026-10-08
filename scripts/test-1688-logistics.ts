import assert from 'node:assert/strict'
import {validatePublishBody} from '../server/routes/1688.js'
import {validateLogistics,updateItemLogistics} from '../shared/1688-logistics.js'
import {db} from '../server/db.js'
try{
 const defaults={measuredImageVerify:false,showLogisticsCategory:'item'}
 const schema=(extra={})=>({data:{officialLogistics:{fields:{label:'件重尺',required:false,logisticsRequired:true,value:defaults,...extra}}}})
 const body=(value:unknown)=>({formValues:{title:'测试商品',primaryPicture:{imageList:[{url:'https://cbu01.alicdn.com/img/a.jpg'}]},officialLogistics:value}})
 for(const value of [undefined,null,{},defaults,[],false,'item'])assert.ok(validatePublishBody(schema(),body(value)).some(x=>x.startsWith('件重尺')))
 assert.deepEqual(validatePublishBody(schema({logisticsRequired:false}),body(defaults)),[])
 assert.deepEqual(validatePublishBody(schema({visible:false}),body(defaults)),[])
 assert.deepEqual(validatePublishBody(schema({readonly:true}),body(defaults)),[])
 const valid={showLogisticsCategory:'item',offerInfo:{weight:900,length:0,width:0,height:0,volume:0}}
 assert.deepEqual(validatePublishBody(schema(),body(valid)),[])
 for(const weight of [null,0,-1,0.5,'900',Infinity])assert.ok(validatePublishBody(schema(),body({...valid,offerInfo:{...valid.offerInfo,weight}})).length)
 assert.ok(validatePublishBody(schema(),body({...valid,offerInfo:{weight:900,length:20}})).length)
 const withSize={weight:900,length:20,width:10,height:5,volume:1000}
 assert.deepEqual(validatePublishBody(schema(),body({...valid,offerInfo:withSize})),[])
 assert.ok(validatePublishBody(schema(),body({...valid,offerInfo:{...withSize,volume:1}})).length)
 assert.ok(validatePublishBody(schema(),body({...valid,offerInfo:{...withSize,width:21,volume:2100}})).length)
 assert.ok(validatePublishBody(schema(),body({...valid,skuInfo:[]})).length)
 let edited=updateItemLogistics({showLogisticsCategory:'item',measuredImageVerify:false},'weight','900')
 for(const [key,value] of [['length','20'],['width','10'],['height','5']])edited=updateItemLogistics(edited,key,value)
 assert.deepEqual(edited.offerInfo,withSize);assert.equal(edited.measuredImageVerify,false)
 assert.equal(updateItemLogistics(edited,'width','').offerInfo.volume,0)
 const props=(value:number)=>[{id:1,name:'p-1',value,text:String(value)}]
 const skus=[{sku_props:props(1)},{sku_props:props(2)}]
 const skuInfo=skus.map(row=>({...row,...withSize}))
 assert.deepEqual(validateLogistics({logisticsRequired:true},{showLogisticsCategory:'sku',skuInfo},skus),[])
 assert.ok(validateLogistics({logisticsRequired:true},{showLogisticsCategory:'sku',skuInfo:skuInfo.slice(0,1)},skus).length)
 assert.ok(validateLogistics({logisticsRequired:true},{showLogisticsCategory:'sku',skuInfo:[skuInfo[0],skuInfo[0]]},skus).length)
 console.log(JSON.stringify({requiredFlag:'ok',defaultsNotData:'ok',optionalHiddenReadonly:'ok',itemStructure:'ok',weight:'ok',dimensionsAndVolume:'ok',skuCoverage:'ok'}))
}finally{await db.end()}
