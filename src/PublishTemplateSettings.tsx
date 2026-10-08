import { useEffect, useState } from 'react'
import { getPublishTemplate, savePublishTemplate, type PublishTemplate } from './1688Api'
import { publishTemplateFields, type ItemLogisticsTemplate } from '../shared/1688-publish-template'
import LogisticsEditor from './1688LogisticsEditor'
import { validateLogistics } from '../shared/1688-logistics'

export default function PublishTemplateSettings({editable}:{editable:boolean}){
  const [template,setTemplate]=useState<PublishTemplate>({values:{},revision:0})
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[loaded,setLoaded]=useState(false)
  const logisticsErrors=validateLogistics({},template.values.officialLogistics)
  async function load(){setLoading(true);setError('');setSaved(false);try{setTemplate((await getPublishTemplate()).data);setLoaded(true)}catch(e){setError(e instanceof Error?e.message:'模板加载失败')}finally{setLoading(false)}}
  useEffect(()=>{void load()},[])
  async function save(){setBusy(true);setError('');setSaved(false);try{setTemplate((await savePublishTemplate(template)).data);setSaved(true)}catch(e){setError(e instanceof Error?e.message:'模板保存失败')}finally{setBusy(false)}}
  return <section className="shop-comparison publish-template-settings" aria-label="公共发布模板">
    <div className="shop-sku-heading"><h3>公共发布模板</h3><button className="shop-button" disabled={busy||loading} onClick={()=>void load()}>重新加载</button></div>
    <p className="shop-note">当前企业的店铺共用。新草稿自动应用，已有草稿再次运行 Agent 或点击“应用公共模板”时补齐空值，保留已填内容。</p>
    <div className="shop-form-columns">{publishTemplateFields.map(field=><label key={field.key}>{field.label}{field.key==='cbuUnit'?<input aria-label={`模板${field.label}`} placeholder="例如：件、个、套" maxLength={20} value={template.values[field.key]||''} disabled={!editable||busy||loading||!loaded} onChange={e=>{setSaved(false);const values={...template.values};if(e.target.value)values[field.key]=e.target.value;else delete values[field.key];setTemplate({...template,values})}}/>:<select aria-label={`模板${field.label}`} value={template.values[field.key]||''} disabled={!editable||busy||loading||!loaded} onChange={e=>{setSaved(false);const values={...template.values};if(e.target.value)values[field.key]=e.target.value;else delete values[field.key];setTemplate({...template,values})}}><option value="">不配置</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.text}</option>)}</select>}</label>)}</div>
    <p className="shop-note">按规格报价需要完整 SKU 单价和库存；选项是否可用以每个类目的平台规则为准。清空配置只影响后续补齐，不清除草稿已填值。</p>
    <LogisticsEditor title="公共件重尺模板（可选）" labelPrefix="模板" fields={{}} value={template.values.officialLogistics} disabled={!editable||busy||loading||!loaded} onChange={value=>{
      setSaved(false)
      const next=value as ItemLogisticsTemplate,values={...template.values}
      if(Object.values(next.offerInfo).every(v=>v==null||v===0))delete values.officialLogistics
      else values.officialLogistics=next
      setTemplate({...template,values})
    }}/>
    <p className="shop-note">模板按商品设置，适用于所有 SKU 包装相同的商品。新草稿自动带入；可在商品草稿中手动修改覆盖。已有任一件重尺数值或按 SKU 数据时，应用公共模板保留整组数据。</p>
    {editable&&<button className="shop-button" disabled={loading||busy||!loaded||!template.values.officialLogistics} onClick={()=>{const values={...template.values};delete values.officialLogistics;setTemplate({...template,values});setSaved(false)}}>清空件重尺模板</button>}
    {error&&<p className="shop-local-error" role="alert">{error}</p>}{saved&&<p role="status">公共模板已保存。</p>}
    {editable&&<button className="shop-button primary" disabled={loading||busy||!loaded||logisticsErrors.length>0} onClick={()=>void save()}>{busy?'保存中…':'保存公共模板'}</button>}
  </section>
}
