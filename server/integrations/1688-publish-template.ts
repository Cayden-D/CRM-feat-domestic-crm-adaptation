import { z } from 'zod'
import { db } from '../db.js'
import { IntegrationError } from './1688.js'
import { publishTemplateFields, type PublishTemplateValues } from '../../shared/1688-publish-template.js'
import { validateLogistics } from '../../shared/1688-logistics.js'

export const publishTemplateInput=z.object({
  cbuUnit:z.string().trim().min(1).max(20).optional(),
  invReduce:z.enum(['1','2']).optional(),
  supplyType:z.enum(['1','2']).optional(),
  onlineTrade:z.enum(['17410','-1']).optional(),
  quotationType:z.enum(['1','2']).optional(),
  officialLogistics:z.object({
    showLogisticsCategory:z.literal('item'),
    offerInfo:z.object({weight:z.number().int().positive(),length:z.number().nonnegative(),width:z.number().nonnegative(),height:z.number().nonnegative(),volume:z.number().nonnegative()}).strict(),
  }).strict().refine(value=>validateLogistics({},value).length===0,'件重尺的重量、尺寸或体积无效').optional(),
}).strict()
export async function getPublishTemplate(tenantId:string){
  return (await db.query('SELECT template_values AS values,revision FROM integration_1688_publish_templates WHERE tenant_id=$1',[tenantId])).rows[0]||{values:{},revision:0}
}
export function applyPublishTemplate(schema:Record<string,any>,values:Record<string,any>,template:PublishTemplateValues){
  const next={...values}
  for(const {key,label} of publishTemplateFields){
    const configured=template[key],fields=schema.data?.[key]?.fields,current=values[key]
    if(!configured||!fields||fields.visible===false||fields.readonly===true)continue
    const selected=key==='cbuUnit'?current?.unit:current?.value
    if(current!=null&&current!==''&&(typeof current!=='object'||(selected!=null&&selected!=='')))continue
    if(key==='cbuUnit'){next[key]={unit:configured};continue}
    const option=fields.dataSource?.find((item:any)=>String(item.value)===configured&&item.disabled!==true&&item.readonly!==true)
    if(!option)throw new IntegrationError('TEMPLATE_INCOMPATIBLE',`公共发布模板的「${label}」不适用于当前类目，请调整模板或在草稿中填写。`,400)
    // Only the selected value and label belong in the submission, not help HTML.
    next[key]={value:option.value,text:option.text}
  }
  const logisticsFields=schema.data?.officialLogistics?.fields
  const current=values.officialLogistics
  // Preserve the entire manually filled measurement group, including SKU data.
  // Platform default selectors with no measurements are still empty.
  const hasMeasurements=current!=null&&(typeof current!=='object'||Array.isArray(current)||
    (current.skuInfo!=null&&(!Array.isArray(current.skuInfo)||current.skuInfo.length>0))||
    Object.values(current.offerInfo||{}).some(value=>value!=null&&value!==''&&value!==0))
  if(template.officialLogistics&&logisticsFields&&logisticsFields.visible!==false&&logisticsFields.readonly!==true&&!hasMeasurements){
    next.officialLogistics={...current,showLogisticsCategory:'item',offerInfo:{...template.officialLogistics.offerInfo}}
    delete next.officialLogistics.skuInfo
  }
  return next
}
export async function fillPublishTemplate(tenantId:string,schema:Record<string,any>,values:Record<string,any>){
  return applyPublishTemplate(schema,values,(await getPublishTemplate(tenantId)).values)
}
