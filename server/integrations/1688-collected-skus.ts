type Json=Record<string,any>

export function collectedSkuAttributes(source:Json,variant:Json):Record<string,string>{
  const dimensions=source.sku_props
  if(!Array.isArray(dimensions)||!dimensions.length||typeof variant.label!=='string')return {}
  const parts=variant.label.split('>').map((part:string)=>part.trim())
  if(parts.length!==dimensions.length||parts.some((part:string)=>!part))return {}
  const result:Record<string,string>={}
  for(let index=0;index<dimensions.length;index++){
    const dimension:Json=dimensions[index]
    const name=String(dimension?.name||'').trim(),value=parts[index]
    if(!name||name in result||!Array.isArray(dimension.values))return {}
    if(dimension.values.filter((choice:Json)=>String(choice?.name||'').trim()===value).length!==1)return {}
    if(variant.attributes?.[name]&&variant.attributes[name]!==value)return {}
    result[name]=value
  }
  return result
}
