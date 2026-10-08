import {skuKey} from './1688-skus.js'
type Json=Record<string,any>
const empty=(value:unknown)=>value==null||value===''||value===0
export function validateLogistics(fields:Json,value:Json|undefined,skus:Json[]=[]):string[]{
  if(fields.visible===false||fields.readonly===true)return []
  const required=fields.required||fields.logisticsRequired
  if(!required&&!value?.offerInfo&&!value?.skuInfo)return []
  const errors:string[]=[]
  const check=(info:Json|undefined,label:string)=>{
    if(!info||typeof info!=='object'||Array.isArray(info)){errors.push(`${label}重量未填写`);return}
    if(typeof info.weight!=='number'||!Number.isSafeInteger(info.weight)||info.weight<=0)errors.push(`${label}重量须为正整数克`)
    const keys=['length','width','height','volume']
    if(keys.every(k=>empty(info[k])))return
    if(keys.some(k=>typeof info[k]!=='number'||!Number.isFinite(info[k])||info[k]<=0)){errors.push(`${label}长、宽、高、体积须全部填写或全部留空`);return}
    if(info.length<info.width||info.width<info.height)errors.push(`${label}须满足长 ≥ 宽 ≥ 高`)
    if(['length','width','height'].some(k=>Math.abs(info[k]*10-Math.round(info[k]*10))>1e-8))errors.push(`${label}尺寸最多保留一位小数` )
    const volume=info.length*info.width*info.height
    if(Math.abs(info.volume-volume)>Math.max(0.001,volume*1e-8))errors.push(`${label}体积须等于长 × 宽 × 高`)
  }
  if(value?.showLogisticsCategory==='item'){
    check(value.offerInfo,'件重尺（按商品）')
    if(value.skuInfo!=null)errors.push('件重尺按商品设置时请移除按规格数据')
  }else if(value?.showLogisticsCategory==='sku'){
    if(value.offerInfo!=null)errors.push('件重尺按规格设置时请移除按商品数据')
    const rows=Array.isArray(value.skuInfo)?value.skuInfo:[]
    const key=(row:Json)=>Array.isArray(row?.sku_props)&&row.sku_props.length?skuKey(row.sku_props):null
    const expected=skus.map(key),actual=rows.map(key)
    if(!expected.length||expected.includes(null)||actual.includes(null)||new Set(actual).size!==actual.length||actual.length!==expected.length||expected.some(k=>!actual.includes(k)))errors.push('件重尺须与全部 SKU 一一对应，不能遗漏或重复')
    rows.forEach((row:Json,index:number)=>check(row,`件重尺第 ${index+1} 个 SKU`))
  }else errors.push('件重尺请选择按商品或按规格设置')
  return errors
}
export function updateItemLogistics(value:Json|undefined,key:string,input:string):Json{
  const {skuInfo:_,...base}=value||{}
  const offerInfo={length:0,width:0,height:0,volume:0,...base.offerInfo,[key]:input===''?null:Number(input)}
  const dimensions=[offerInfo.length,offerInfo.width,offerInfo.height]
  offerInfo.volume=dimensions.every(v=>typeof v==='number'&&v>0)?Number((offerInfo.length*offerInfo.width*offerInfo.height).toFixed(6)):0
  return {...base,showLogisticsCategory:'item',offerInfo}
}
