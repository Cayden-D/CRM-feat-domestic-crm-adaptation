type Json=Record<string,any>

const normalized=(value:unknown)=>String(value??'').trim().toLocaleLowerCase().replace(/[\s/／_-]+/g,'')
const placeholder=/^(详情可咨询客服|详情咨询客服|请咨询客服|咨询客服|详询|暂无|未知|不详|[-—]+)$/

export function collectedCategoryDefaults(schema:Json,source:Json|null){
  const result:Json={}
  if(!source||source.source!=='1688'||String(source.source_category_id||'')!==String(schema.global?.systemParam?.catId||''))return result
  const rows=Array.isArray(source.source_category_attributes)?source.source_category_attributes:[]
  const attributes=source.attributes&&typeof source.attributes==='object'?source.attributes:{}
  for(const field of schema.data?.catProp?.fields?.dataSource||[]){
    if(!field?.name||!field.label||field.readonly||field.visible===false)continue
    const candidates=rows.filter((row:Json)=>row&&typeof row==='object'&&(field.propertyId&&String(row.attrNameId||'')===String(field.propertyId)||normalized(row.attrName)===normalized(field.label)))
    if(candidates.length>1)continue
    const fallback=Object.entries(attributes).filter(([label])=>normalized(label)===normalized(field.label))
    if(!candidates.length&&fallback.length!==1)continue
    const sourceValue=candidates.length===1?String(candidates[0].attrValue??'').trim():String(fallback[0][1]??'').trim()
    if(!sourceValue||placeholder.test(sourceValue)||field.maxLength&&sourceValue.length>field.maxLength)continue
    if(!Array.isArray(field.dataSource)||!field.dataSource.length){
      if(['input','cbuinput'].includes(field.uiType))result[field.name]=sourceValue
      continue
    }
    const sourceIds=candidates.length===1&&Array.isArray(candidates[0].attrValueIds)?candidates[0].attrValueIds.map(String):[]
    const matches=field.dataSource.filter((option:Json)=>String(option.text||'').trim()===sourceValue&&(sourceIds.length===0||sourceIds.includes(String(option.value))))
    if(matches.length===1)result[field.name]={value:matches[0].value,text:matches[0].text}
  }
  return result
}
