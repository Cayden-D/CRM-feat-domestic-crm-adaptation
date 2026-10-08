import PublishTemplateSettings from './PublishTemplateSettings'
import { useEffect, useState } from 'react'
import { AlertCircle, Bot, ImagePlus, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { getAgentSettings, setAgentSetting, testAgentModel, type AgentSetting } from './1688Api'
import type { SessionUser } from './api'
import './1688.css'

export default function AgentSettingsPage({user}:{user:SessionUser}){
  const [shops,setShops]=useState<AgentSetting[]>([]),[configured,setConfigured]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<AgentSetting|null>(null),[confirmed,setConfirmed]=useState(false)
  const has=(name:string)=>(user.permissions||[]).some(p=>p==='*'||p===name||p==='integration:*')
  const editable=has('integration:publish')&&has('integration:manage')
  const [modelConnected,setModelConnected]=useState(false)
  async function testModel(){setBusy(true);setError('');setModelConnected(false);try{await testAgentModel();setModelConnected(true)}catch(error){setError(error instanceof Error?error.message:'模型测试失败。')}finally{setBusy(false)}}
  async function load(){setLoading(true);setError('');try{const result=await getAgentSettings();setShops(result.data);setConfigured(result.configured)}catch(error){setError(error instanceof Error?error.message:'配置读取失败。')}finally{setLoading(false)}}
  useEffect(()=>{void load()},[])
  async function save(shop:AgentSetting,enabled:boolean){setBusy(true);setError('');try{await setAgentSetting(shop.id,enabled,shop.revision);setPending(null);setConfirmed(false);await load()}catch(error){setError(error instanceof Error?error.message:'设置保存失败。')}finally{setBusy(false)}}
  return <div className="shop-page"><div className="shop-page-heading"><div><h2><Bot size={22}/>Agent 上品</h2><p>qwen3.8-flash · {modelConnected?'模型连接成功':configured?'已配置 · 待验证':'服务未配置'}</p></div><button className="shop-button" disabled={!editable||!configured||busy} onClick={()=>void testModel()}><Bot size={16}/>测试模型连接</button><button className="shop-icon" title="刷新设置" aria-label="刷新设置" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={17}/></button></div>
    {error&&<p className="shop-alert error" role="alert"><AlertCircle size={16}/>{error}</p>}
    {loading?<div className="shop-empty"><LoaderCircle className="spin"/></div>:<div className="shop-table-scroll"><table className="shop-table"><thead><tr><th>店铺</th><th>连接</th><th>Agent 上品模式</th></tr></thead><tbody>{shops.map(shop=><tr key={shop.id}><td>{shop.display_name}</td><td>{shop.status==='connected'?'已连接':'不可用'}</td><td><label className="agent-switch"><input type="checkbox" role="switch" aria-label={`${shop.display_name} Agent 上品模式`} checked={shop.enabled} disabled={!editable||busy||(!shop.enabled&&(!configured||shop.status!=='connected'))} onChange={e=>{if(e.target.checked){setPending(shop);setConfirmed(false)}else void save(shop,false)}}/><span>{shop.enabled?'已开启':'已关闭'}</span></label></td></tr>)}</tbody></table>{!shops.length&&<p className="shop-note">暂无已授权店铺。</p>}</div>}
    <section className="agent-repair"><h3><ImagePlus size={18}/>AI 图片</h3><span className="shop-status positive">已接入</span></section>
    <PublishTemplateSettings editable={editable}/>
    {pending&&<div className="dialog-layer shop-dialog"><button className="drawer-scrim" aria-label="取消开启" disabled={busy} onClick={()=>setPending(null)}/><section className="shop-modal" role="dialog" aria-modal="true" aria-label="开启 Agent 上品"><header><h2>开启 Agent 上品</h2><button title="关闭" disabled={busy} onClick={()=>setPending(null)}><X size={18}/></button></header><div className="shop-modal-body"><p>目标店铺：{pending.display_name}</p><p>开启后，新建发布草稿将自动检测、填写并提交平台。检测到水印、疑似权利风险或资料不足时中止。</p><p>AI 筛查不等于法律侵权认定或图片授权证明；请确认商品及图片使用权。图片与商品资料将发送至阿里云百炼。</p><label className="shop-review-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>确认使用权与资料传输，并授权该店铺自动发布</label></div><footer><button className="shop-button" disabled={busy} onClick={()=>setPending(null)}>取消</button><button className="shop-button primary" disabled={busy||!confirmed} onClick={()=>void save(pending,true)}><Bot size={16}/>开启模式</button></footer></section></div>}
  </div>
}
