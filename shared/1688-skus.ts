export type SaleChoice = { value:string|number; text:string; custom?:boolean }
export type SaleDimension = { name:string; label:string; propertyId?:number|string; required?:boolean; maxItems?:number; customizable?:boolean; fieldType?:string; dataSource?:SaleChoice[] }
export type SkuProperty = SaleChoice & { id:number; name:string; label:string }
export type SkuRow = { sku_props:SkuProperty[]; sku_amountOnSale:number|null; sku_price?:number|null; sku_cargoNumber?:string; sku_status?:number; [key:string]:unknown }
export type ReviewedVariant = { id:string; label:string; attributes:Record<string,string>; unit_price:string|number; stock:string|number|null; image_url:string|null }

export function skuKey(properties:SkuProperty[]):string {
  return JSON.stringify(properties.map(p=>[String(p?.id??''),String(p?.value??''),String(p?.text??'').trim()]).sort((a,b)=>a[0].localeCompare(b[0])))
}
export function saleDimensions(schema:Record<string,any>):SaleDimension[] {
  const source=schema.data?.saleProp?.fields?.dataSource
  return Array.isArray(source)?source.filter(p=>p&&typeof p.name==='string'&&typeof p.label==='string'):[]
}
export function dimensionId(dimension:SaleDimension):number {
  const id=Number(dimension.propertyId??/^p-(\d+)$/.exec(dimension.name)?.[1])
  if(!Number.isSafeInteger(id)||id<=0)throw new Error(`销售属性 ${dimension.label} 缺少有效平台 ID。`)
  return id
}
export function validChoice(dimension:SaleDimension,choice:SaleChoice):boolean {
  if(!choice||typeof choice.text!=='string'||!choice.text.trim())return false
  if(choice.custom)return choice.value===-1&&allowsCustom(dimension)
  return (dimension.dataSource||[]).some(option=>String(option.value)===String(choice.value)&&option.text===choice.text)
}
export function allowsCustom(dimension:SaleDimension):boolean {
  return dimension.customizable===true||(dimension.fieldType==='string'&&dimension.customizable!==false&&!dimension.dataSource?.length)
}
export function buildSkuRows(dimensions:SaleDimension[],selected:Record<string,SaleChoice[]>,previous:SkuRow[]=[]):SkuRow[] {
  const active=dimensions.filter(d=>Array.isArray(selected[d.name])&&selected[d.name].length)
  if(dimensions.some(d=>d.required&&!active.includes(d)))throw new Error('请补全必填销售规格。')
  if(!active.length)return []
  let count=1
  for(const dimension of active){
    const choices=selected[dimension.name]
    if(choices.some(c=>!validChoice(dimension,c)))throw new Error(`${dimension.label} 包含不合法的规格值。`)
    if(new Set(choices.map(c=>JSON.stringify([String(c.value),c.text]))).size!==choices.length)throw new Error(`${dimension.label} 存在重复规格。`)
    if(dimension.maxItems&&choices.length>dimension.maxItems)throw new Error(`${dimension.label} 超过规格数量上限。`)
    count*=choices.length;if(count>2000)throw new Error('SKU 组合不能超过 2000 个。')
  }
  let combinations:SkuProperty[][]=[[]]
  for(const dimension of active)combinations=combinations.flatMap(props=>selected[dimension.name].map(choice=>[...props,{...choice,id:dimensionId(dimension),name:dimension.name,label:dimension.label}]))
  const existing=new Map(previous.filter(row=>Array.isArray(row.sku_props)).map(row=>[skuKey(row.sku_props),row]))
  return combinations.map(sku_props=>({...existing.get(skuKey(sku_props)),sku_props,sku_amountOnSale:existing.get(skuKey(sku_props))?.sku_amountOnSale??null,sku_status:existing.get(skuKey(sku_props))?.sku_status??1}))
}
export function mapReviewedVariants(dimensions:SaleDimension[],variants:ReviewedVariant[],mapping:Record<string,string>) {
  if(Object.keys(mapping).some(key=>!dimensions.some(d=>d.name===key)))throw new Error('映射包含未知平台属性。')
  const active=dimensions.filter(d=>mapping[d.name])
  if(!variants.length||!active.length)throw new Error('请选择正式规格和平台属性映射。')
  if(dimensions.some(d=>d.required&&!mapping[d.name]))throw new Error('必填销售属性尚未映射。')
  const saleProp:Record<string,SaleChoice[]>={},skuTable:SkuRow[]=[],seen=new Set<string>()
  if(variants.length>2000)throw new Error('正式 SKU 数量超过上限。')
  for(const variant of variants){
    const props=active.map(d=>{
      const text=variant.attributes[mapping[d.name]]?.trim()
      if(!text)throw new Error(`${variant.label} 缺少 ${mapping[d.name]}。`)
      const matches=(d.dataSource||[]).filter(c=>c.text.trim()===text)
      if(matches.length>1)throw new Error(`${d.label} 的枚举值不唯一，请人工选择。`)
      const choice:SaleChoice=matches[0]||{value:-1,text,custom:true}
      if(!validChoice(d,choice))throw new Error(`${d.label} 不允许自定义规格“${text}”。`)
      saleProp[d.name]??=[]
      if(!saleProp[d.name].some(c=>String(c.value)===String(choice.value)&&c.text===choice.text))saleProp[d.name].push(choice)
      if(d.maxItems&&saleProp[d.name].length>d.maxItems)throw new Error(`${d.label} 超过规格数量上限。`)
      return {...choice,id:dimensionId(d),name:d.name,label:d.label}
    })
    const key=skuKey(props);if(seen.has(key))throw new Error('多个正式 SKU 映射到同一平台组合，请补充区分属性。');seen.add(key)
    const price=Number(variant.unit_price),stock=variant.stock==null?null:Number(variant.stock)
    if(!Number.isFinite(price)||price<0||(stock!=null&&(!Number.isSafeInteger(stock)||stock<0)))throw new Error(`${variant.label} 的价格或库存不合法。`)
    skuTable.push({sku_props:props,sku_price:price,sku_amountOnSale:stock,sku_picture_url:variant.image_url,sku_cargoNumber:'',sku_status:1})
  }
  return {saleProp,skuTable}
}
