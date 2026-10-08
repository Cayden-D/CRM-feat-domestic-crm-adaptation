import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {collectedCategoryDefaults} from '../server/integrations/1688-collected-attributes.js'
const script=readFileSync('scripts/1688-product-collector.user.js','utf8')
const marker='    // ─── Add global styles'
assert.ok(script.includes(marker))
const sandbox:any={URL,location:{href:'https://detail.1688.com/offer/990612560563.html'},document:{querySelectorAll:()=>[]}}
runInNewContext(script.replace(marker,'    globalThis.collectorTest={extract1688SourceCategoryAttributes,extractAttributesFromContext,mergeProducts$2};return;\n'+marker),sandbox)
const {extract1688SourceCategoryAttributes:extract,extractAttributesFromContext:attributes,mergeProducts$2:merge}=sandbox.collectorTest
const fixture=JSON.parse(readFileSync('scripts/fixtures/1688-feature-attributes.json','utf8'))
const rows=JSON.parse(JSON.stringify(extract(fixture))),attrs=attributes(fixture)
assert.equal(rows.length,20)
assert.equal(attrs['型号'],'无线');assert.equal(attrs['额定电压'],'12（V）');assert.equal(attrs['类型'],'车载')
assert.equal(rows.find((r:any)=>r.attrName==='额定电压').attrNameId,'821')
assert.deepEqual(rows.find((r:any)=>r.attrName==='额定电压').attrValueIds,['3234583'])
assert.deepEqual(rows.find((r:any)=>r.attrName==='颜色分类').attrValues,['黑色','白色'])
const schema={global:{systemParam:{catId:1032097}},data:{catProp:{fields:{dataSource:[{name:'p-3151',label:'型号',propertyId:3151,uiType:'input'},{name:'p-821',label:'额定电压',propertyId:821,unit:'V',uiType:'input'},{name:'p-1836',label:'类型',propertyId:1836,uiType:'select',dataSource:[{value:6663226,text:'车家两用'}]}]}}}}
assert.deepEqual(collectedCategoryDefaults(schema,{source:'1688',source_category_id:'1032097',attributes:attrs,source_category_attributes:rows}),{'p-3151':'无线','p-821':'12'})
const base={title:'测试',mainImages:[],detailImages:[],attributes:{},skuProps:[],skus:[]}
assert.equal(merge({...base,attributes:attrs,sourceCategoryAttributes:rows},base).sourceCategoryAttributes.length,20)
const root=fixture.Root.fields.dataJson;root.offerDomain=JSON.parse(root.offerDomain)
assert.equal(extract(fixture).length,20)
root.offerDomain.offerDetail.featureAttributes.push(null,{name:'空',values:[]},{name:'坏数据',values:[{}]},{name:'零值',values:[0],fid:123,vids:[0]})
assert.equal(extract(fixture).length,21);assert.equal(attributes(fixture)['零值'],'0')
root.offerDomain='{broken';assert.equal(extract(fixture).length,0);assert.equal(Object.keys(attributes(fixture)).length,0)
assert.equal(extract({}).length,0)
assert.match(script,/sourceCategoryAttributes: extract1688SourceCategoryAttributes\(data\)/)
assert.match(script,/sourceCategoryAttributes: product\.sourceCategoryAttributes/)
console.log(JSON.stringify({sourceFixture:'ok',stringAndObject:'ok',attributeIdsAndUnits:'ok',malformedFallback:'ok',mergeAndPayload:'ok',draftModelAndVoltage:'ok',unmatchedType:'preserved for review'}))
