import AgentQueueSettings from './AgentQueueSettings'
import { useEffect, useMemo, useState } from 'react'
import {
  Bell, Bot, Building2, ChevronDown, ChevronRight, CircleDollarSign, Command,
  Database, FileText, Gauge, HandCoins, LayoutDashboard, Mail, Menu, Mic, PackageCheck,
  Plus, Search, Send, Settings, Sparkles, Store, Target, LogOut, X, Zap, LoaderCircle,
} from 'lucide-react'
import { activities, customers, leads, opportunities, pipeline, priorities } from './data'
import LoginPage from './LoginPage'
import LeadsPage from './LeadsPage'
import CustomersPage from './CustomersPage'
import OpportunitiesPage from './OpportunitiesPage'
import QuotesPage from './QuotesPage'
import ProductCollectionsPage from './ProductCollectionsPage'
import Integration1688Page from './1688Page'
import AgentSettingsPage from './AgentSettingsPage'
import { ApiError,clearToken,getAiModels,getCurrentUser,getToken,sendAiMessage,type AiMessage,type AiModel,type SessionUser } from './api'

type Page = 'dashboard' | 'leads' | 'customers' | 'opportunities' | 'quotes' | 'collections' | 'shop' | 'orders' | 'settings' | 'queue'

const pageMeta: Record<Page, { title: string; eyebrow: string }> = {
  dashboard: { title: '销售作战台', eyebrow: '2026年8月5日 · 上海 13:40' },
  leads: { title: '线索管理', eyebrow: '统一查看、分配并转化多渠道询盘' },
  customers: { title: '客户资产', eyebrow: '沉淀客户关系与全生命周期价值' },
  opportunities: { title: '商机管道', eyebrow: '从初步接触到合同签订' },
  quotes: { title: '报价管理', eyebrow: '人民币报价、含税金额与账期管理' },
  collections: { title: '1688 商品采集', eyebrow: '独立采集、查看并清洗源商品资料' },
  shop: { title: '1688 店铺', eyebrow: '平台商品、发布工作台与连接设置' },
  queue: {title:'上架队列',eyebrow:'跟踪采集商品的检测、资料准备与发布进度'},
  settings: { title: '系统设置', eyebrow: '店铺 Agent 与自动发布授权' },
  orders: { title: '订单履约', eyebrow: '跟踪订单、国内交付与回款进度' },
}

const nav: Array<{ id: Page; label: string; icon: typeof LayoutDashboard; count?: number }> = [
  { id: 'dashboard', label: '销售作战台', icon: LayoutDashboard },
  { id: 'leads', label: '线索', icon: Zap, count: 12 },
  { id: 'customers', label: '客户', icon: Building2 },
  { id: 'opportunities', label: '商机', icon: Target, count: 5 },
  { id: 'quotes', label: '报价管理', icon: FileText },
  { id: 'collections', label: '1688 商品采集', icon: Database },
  { id: 'shop', label: '1688 店铺', icon: Store },
  { id: 'queue', label: '上架队列', icon: PackageCheck },
  { id: 'orders', label: '订单履约', icon: PackageCheck },
]

function Sidebar({ page, setPage, open, close, user, onLogout }: { page: Page; setPage: (page: Page) => void; open: boolean; close: () => void; user: SessionUser; onLogout: () => void }) {
  return <>
    {open && <button className="scrim" onClick={close} aria-label="关闭导航" />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><span /></div><div><b>销途</b><small>AI CRM</small></div></div>
      <nav aria-label="主导航">
        <p className="nav-label">工作空间</p>
        {nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); close() }}>
          <item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.count && <em>{item.count}</em>}
        </button>)}
        <p className="nav-label nav-label-gap">协作与洞察</p>
        <button><Mail size={18} /><span>消息中心</span><i className="dot" /></button>
        <button><Gauge size={18} /><span>数据分析</span></button>
      </nav>
      <div className="sidebar-foot">
        <button className={page==='settings'?'active':''} onClick={()=>{setPage('settings');close()}}><Settings size={18} /><span>系统设置</span></button>
        <div className="profile"><div className="avatar">{user.displayName.slice(0, 1)}</div><div><b>{user.displayName}</b><small>{user.roles.includes('super_admin') ? '超级管理员' : '业务成员'}</small></div><button className="logout-button" onClick={onLogout} aria-label="退出登录"><LogOut size={16} /></button></div>
      </div>
    </aside>
  </>
}

function Topbar({ page, openMenu, openAI }: { page: Page; openMenu: () => void; openAI: () => void }) {
  return <header className="topbar">
    <button className="mobile-menu" onClick={openMenu}><Menu size={20} /></button>
    <div className="page-title"><p>{pageMeta[page].eyebrow}</p><h1>{pageMeta[page].title}</h1></div>
    <div className="top-actions">
      <button className="global-search"><Search size={17} /><span>搜索客户、商机或订单</span><kbd>⌘ K</kbd></button>
      <button className="ai-shortcut" onClick={openAI}><Sparkles size={17} /><span>问 AI</span></button>
      <button className="icon-button" aria-label="通知"><Bell size={19} /><i /></button>
    </div>
  </header>
}

function Dashboard({ openAI }: { openAI: (prompt?: string) => void }) {
  return <div className="dashboard">
    <section className="briefing">
      <div className="briefing-copy">
        <div className="ai-orbit"><Sparkles size={18} /></div>
        <div><p className="kicker">AI 晨间简报</p><h2>今天先推进 4 个关键客户</h2><p>预计可推动 <b>¥214.5 万</b> 商机进入下一阶段，其中 1 笔回款需要关注。</p></div>
      </div>
      <div className="briefing-actions"><button onClick={() => openAI('展开今天的销售简报')}>展开简报 <ChevronRight size={16} /></button><span>刚刚更新</span></div>
    </section>

    <section className="metrics" aria-label="关键指标">
      <article><div><span>本月销售额</span><CircleDollarSign size={18} /></div><strong>¥286.4 万</strong><p><b>↑ 18.6%</b> 较上月</p></article>
      <article><div><span>新增询盘</span><Zap size={18} /></div><strong>126</strong><p><b>↑ 24</b> 条待首次响应</p></article>
      <article><div><span>商机转化率</span><Target size={18} /></div><strong>31.4%</strong><p><b>↑ 3.2%</b> 较上月</p></article>
      <article className="warning"><div><span>待收款</span><HandCoins size={18} /></div><strong>¥126.8 万</strong><p><b>2 笔</b> 已超过约定日期</p></article>
    </section>

    <section className="route-card">
      <div className="section-head"><div><p className="kicker">销售全链路</p><h2>业务推进轨迹</h2></div><button>查看完整管道 <ChevronRight size={16} /></button></div>
      <div className="route-track">
        {pipeline.map((item, index) => <div className={`route-stop ${item.tone}`} key={item.name}>
          <div className="route-node"><span>{index + 1}</span></div>
          <div className="route-data"><b>{item.name}</b><strong>{item.count}</strong><small>{item.amount}</small></div>
        </div>)}
      </div>
    </section>

    <div className="content-grid">
      <section className="card priority-card">
        <div className="section-head"><div><p className="kicker">AI 推荐 · 按成交影响排序</p><h2>今日优先跟进</h2></div><button>查看全部</button></div>
        <div className="priority-list">
          {priorities.map((item, index) => <article key={item.company}>
            <span className="rank">0{index + 1}</span><div className="flag">{item.region}</div>
            <div className="priority-main"><b>{item.company}</b><p>{item.contact} · {item.action}</p></div>
            <div className={`tag ${item.risk.includes('风险') ? 'tag-risk' : ''}`}>{item.risk}</div>
            <time>{item.time}<small>建议联系</small></time>
            <div className="score">{item.score}<small>AI分</small></div>
          </article>)}
        </div>
      </section>
      <section className="card activity-card">
        <div className="section-head"><div><p className="kicker">实时同步</p><h2>最新动态</h2></div><button>全部动态</button></div>
        <div className="activity-list">
          {activities.map((item, index) => <article key={item.title}>
            <div className={`activity-icon activity-${item.icon}`}>{item.icon === 'spark' ? <Sparkles size={16} /> : item.icon === 'mail' ? <Mail size={16} /> : item.icon === 'deal' ? <Target size={16} /> : <PackageCheck size={16} />}</div>
            <div><b>{item.title}</b><p>{item.detail}</p><time>{item.time}</time></div>{index < activities.length - 1 && <span className="activity-line" />}
          </article>)}
        </div>
      </section>
    </div>
  </div>
}

type Row = Record<string, string | number>
function DataPage({ page, openAI }: { page: Page; openAI: (prompt?: string) => void }) {
  const config = useMemo(() => {
    if (page === 'leads') return { rows: leads as Row[], tabs: ['全部线索', '待分配', '我的线索', '线索池'], columns: [['company','公司 / 询盘'], ['region','区域'], ['source','来源'], ['product','意向产品'], ['owner','负责人'], ['status','状态'], ['score','AI 评分']] }
    if (page === 'customers') return { rows: customers as Row[], tabs: ['全部客户', '我的客户', '高潜客户', '公海池'], columns: [['company','客户名称'], ['region','区域'], ['level','分级'], ['owner','负责人'], ['value','历史成交'], ['last','最近互动'], ['health','健康度']] }
    if (page === 'opportunities') return { rows: opportunities as Row[], tabs: ['全部商机', '我的商机', '本月预计成交', '高风险'], columns: [['name','商机名称'], ['company','客户'], ['stage','阶段'], ['value','预计金额'], ['probability','AI 成交率'], ['close','预计成交']] }
    return { rows: [] as Row[], tabs: ['全部', '待处理', '审批中', '已完成'], columns: [] as string[][] }
  }, [page])
  const empty = page === 'quotes' || page === 'orders'
  return <div className="data-page">
    <section className="data-toolbar">
      <div className="tabs">{config.tabs.map((tab, i) => <button className={i === 0 ? 'selected' : ''} key={tab}>{tab}{i === 0 && !empty ? <span>{config.rows.length}</span> : null}</button>)}</div>
      <div className="toolbar-actions"><button className="filter"><Search size={16} /> 搜索</button><button className="primary"><Plus size={16} /> 新建{page === 'leads' ? '线索' : page === 'customers' ? '客户' : page === 'opportunities' ? '商机' : page === 'quotes' ? '报价' : '订单'}</button></div>
    </section>
    {empty ? <section className="coming-soon"><div className="coming-icon">{page === 'quotes' ? <FileText size={30} /> : <PackageCheck size={30} />}</div><p className="kicker">第 2 阶段</p><h2>{pageMeta[page].title}模块已排入下一迭代</h2><p>基础导航与数据结构已预留。下一步将实现创建、审批和状态流转。</p><button onClick={() => openAI(`帮我规划${pageMeta[page].title}模块`)}><Sparkles size={16} /> 与 AI 规划这个模块</button></section> :
    <section className="table-card"><table><thead><tr>{config.columns.map(col => <th key={col[0]}>{col[1]}</th>)}<th /></tr></thead><tbody>{config.rows.map((row, i) => <tr key={i}>{config.columns.map(([key]) => <td key={key}>{key === 'company' || key === 'name' ? <strong>{row[key]}</strong> : key === 'score' || key === 'health' || key === 'probability' ? <span className="mini-score"><i style={{ width: `${row[key]}%` }} />{row[key]}{key !== 'score' ? '%' : ''}</span> : key === 'status' || key === 'stage' || key === 'level' ? <span className="status-pill">{row[key]}</span> : row[key]}</td>)}<td><button className="row-action"><ChevronRight size={17} /></button></td></tr>)}</tbody></table></section>}
  </div>
}

function AIAssistant({ open, close, initialPrompt, userName, page }: { open: boolean; close: () => void; initialPrompt: string; userName: string; page: Page }) {
const [value,setValue]=useState(''),[messages,setMessages]=useState<AiMessage[]>([]),[conversationId,setConversationId]=useState<string|null>(null),[model,setModel]=useState<AiModel>('qwen3.8-flash'),[models,setModels]=useState<AiModel[]>(['qwen3.8-flash','qwen3.7-flash','qwen3.7-plus','qwen3.6-plus']),[configured,setConfigured]=useState(true),[sending,setSending]=useState(false),[error,setError]=useState('')
  useEffect(()=>{if(initialPrompt)setValue(initialPrompt)},[initialPrompt])
  useEffect(()=>{getAiModels().then(result=>{setModel(result.data.defaultModel);setModels(result.data.models);setConfigured(result.data.configured)}).catch(()=>{})},[])
  async function send(){const message=value.trim();if(!message||sending)return;setValue('');setError('');setMessages(current=>[...current,{id:`pending-${Date.now()}`,role:'user',content:message,input_tokens:null,output_tokens:null,latency_ms:null,created_at:new Date().toISOString()}]);setSending(true);try{const result=await sendAiMessage({message,conversationId,model,context:{page,pageTitle:pageMeta[page].title}});setConversationId(result.data.conversationId);setMessages(current=>[...current,result.data.message])}catch(cause){setError(cause instanceof ApiError?cause.message:'AI 暂时无法响应。')}finally{setSending(false)}}
  return <aside className={`ai-panel ${open ? 'ai-panel-open' : ''}`} aria-hidden={!open}>
    <div className="ai-head"><div className="ai-identity"><div><Bot size={19} /></div><span><b>销途 AI</b><small><i className={configured?'':'offline'} /> {configured?'千问已连接':'等待配置千问'}</small></span></div><button onClick={close} aria-label="关闭 AI 助手"><X size={20} /></button></div>
    <div className="ai-context"><Command size={15} /><span>当前上下文</span><b>销售作战台 · {userName}</b></div>
    <div className="chat">
      {!messages.length&&<><div className="ai-message"><div className="bot-dot"><Sparkles size={14} /></div><div><p>你好，{userName}。我已经接入千问，可以协助分析销售和商品信息。</p><span>当前只提供分析与建议；涉及写入业务数据时会先请你确认。</span></div></div><div className="suggestions"><button onClick={() => setValue('准备一份客户跟进简报')}>准备客户简报</button><button onClick={() => setValue('给我一套有效的客户跟进策略')}>规划客户跟进</button><button onClick={() => setValue('如何优化采集商品的标题和SKU')}>优化商品信息</button></div></>}
      {messages.map(message=><div className={`chat-message ${message.role}`} key={message.id}>{message.role==='assistant'&&<div className="bot-dot"><Sparkles size={14}/></div>}<div><p>{message.content}</p>{message.role==='assistant'&&message.latency_ms!=null&&<small>{(message.latency_ms/1000).toFixed(1)} 秒 · {model}</small>}</div></div>)}
      {sending&&<div className="chat-message assistant"><div className="bot-dot"><LoaderCircle className="spin" size={14}/></div><div><p>正在思考…</p></div></div>}
      {error&&<div className="ai-error">{error}</div>}
    </div>
    <div className="composer"><div className="model-row"><span>模型</span><select value={model} onChange={e=>setModel(e.target.value as AiModel)}>{models.map(item=><option key={item}>{item}</option>)}</select></div><div className="composer-box"><textarea value={value} onChange={e => setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} placeholder="直接说出你想做的事…" /><div><button aria-label="语音输入"><Mic size={18} /></button><span>AI 写操作将在执行前请你确认</span><button className="send" aria-label="发送" disabled={sending||!value.trim()} onClick={()=>void send()}><Send size={17} /></button></div></div><small>AI 生成内容可能有误，请核对关键业务数据。</small></div>
  </aside>
}

export default function App() {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined)
  const [page, setPage] = useState<Page>('dashboard')
  const [aiOpen, setAiOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const openAI = (text = '') => { setPrompt(text); setAiOpen(true) }
  useEffect(() => {
    const expired = () => setSession(null)
    window.addEventListener('crm:unauthorized', expired)
    if (!getToken()) setSession(null)
    else getCurrentUser().then(setSession).catch(() => { clearToken(); setSession(null) })
    return () => window.removeEventListener('crm:unauthorized', expired)
  }, [])
  if (session === undefined) return <div className="app-loading"><div className="brand-mark"><span /></div><p>正在恢复工作空间…</p></div>
  if (session === null) return <LoginPage onLogin={setSession} />
  const logout = () => { clearToken(); setSession(null); setAiOpen(false) }
  return <div className="app-shell">
    <Sidebar page={page} setPage={setPage} open={menuOpen} close={() => setMenuOpen(false)} user={session} onLogout={logout} />
    <main className={aiOpen ? 'main ai-visible' : 'main'}>
      <Topbar page={page} openMenu={() => setMenuOpen(true)} openAI={() => openAI()} />
      <div className="page-content">{page === 'dashboard' ? <Dashboard openAI={openAI} /> : page === 'leads' ? <LeadsPage /> : page === 'customers' ? <CustomersPage /> : page === 'opportunities' ? <OpportunitiesPage /> : page === 'quotes' ? <QuotesPage /> : page === 'collections' ? <ProductCollectionsPage user={session} /> : page === 'shop' ? <Integration1688Page user={session} onCollections={()=>setPage('collections')}/> : page === 'queue' ? <AgentQueueSettings user={session}/> : page === 'settings' ? <AgentSettingsPage user={session}/> : <DataPage page={page} openAI={openAI} />}</div>
    </main>
    <button className={`ai-fab ${aiOpen ? 'hidden' : ''}`} onClick={() => openAI()}><Sparkles size={20} /><span>问销途 AI</span></button>
    <AIAssistant open={aiOpen} close={() => setAiOpen(false)} initialPrompt={prompt} userName={session.displayName} page={page} />
  </div>
}
