// 1688 title units: ASCII counts as one, non-ASCII as two (not UTF-8 bytes).
export function titleLength(title:string){
  return Array.from(title).reduce((length,char)=>length+(char.codePointAt(0)!>127?2:1),0)
}
export function titleLimit(schema:Record<string,any>):number{
  const limit=schema.data?.title?.fields?.maxLength
  return typeof limit==='number'&&Number.isInteger(limit)&&limit>0?limit:60
}
