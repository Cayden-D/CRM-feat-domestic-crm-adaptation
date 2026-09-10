import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, Building2, ChevronRight, CircleDollarSign, Clock3, Globe2, Inbox, LoaderCircle, Mail, Pencil, Phone, Plus, RefreshCw, Target, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { ApiError, createAccount, createContact, deleteAccount, deleteContact, getAccount, getAccounts, updateAccount, updateContact, type Account, type AccountDetail, type AccountInput, type Contact, type ContactInput } from './api'

const lifecycleNames: Record<string,string> = { active:'活跃', silent:'沉默', public_pool:'公海', lost:'流失' }
const emptyAccount: AccountInput = { name:'',website:'',domain:'',province:'',city:'',district:'',address:'',industry:'',taxId:'',creditLevel:null,lifecycleStatus:'active',source:'' }
const emptyContact: ContactInput = { fullName:'',jobTitle:'',department:'',email:'',phone:'',wechat:'',preferredChannel:'phone',employmentStatus:'active',isPrimary:false }

const money = (value: string | number | undefined) => new Intl.NumberFormat('zh-CN', { style:'currency',currency:'CNY',maximumFractionDigits:0 }).format(Number(value ?? 0))
const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { month:'short',day:'numeric',year:'numeric' }).format(new Date(value)) : '—'

export default function CustomersPage() {
  const [accounts,setAccounts] = useState<Account[]>([])
  const [total,setTotal] = useState(0)
  const [search,setSearch] = useState('')
  const [appliedSearch,setAppliedSearch] = useState('')
  const [status,setStatus] = useState('')
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [selected,setSelected] = useState<Account | null>(null)
  const [creating,setCreating] = useState(false)
  const [deleting,setDeleting] = useState<Account | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const result = await getAccounts({ search:appliedSearch,lifecycleStatus:status }); setAccounts(result.data); setTotal(result.pagination.total) }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '无法加载客户数据。') }
    finally { setLoading(false) }
  },[appliedSearch,status])
  useEffect(() => { void load() },[load])

  async function remove(account: Account) {
    try { await deleteAccount(account.id); setNotice('客户已移入已删除记录'); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除客户失败。') }
    finally { setDeleting(null) }
  }

  return <div className="data-page customers-page">
    {notice && <div className="inline-notice">{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}
    <section className="data-toolbar leads-toolbar">
      <div className="tabs">{[['','全部客户'],['active','活跃客户'],['silent','沉默客户'],['public_pool','公海池']].map(([value,label]) => <button key={label} className={status === value ? 'selected' : ''} onClick={() => setStatus(value)}>{label}{!value && <span>{total}</span>}</button>)}</div>
      <div className="toolbar-actions"><form className="lead-search" onSubmit={event => { event.preventDefault(); setAppliedSearch(search.trim()) }}><Globe2 size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="客户、域名或城市"/><button>搜索</button></form><button className="primary" onClick={() => setCreating(true)}><Plus size={16}/> 新建客户</button></div>
    </section>
    {error && <section className="state-card error-state"><AlertCircle size={25}/><h2>客户资产暂时无法加载</h2><p>{error}</p><button onClick={() => void load()}><RefreshCw size={15}/> 重新加载</button></section>}
    {!error && loading && <section className="state-card"><LoaderCircle className="spin" size={27}/><p>正在汇总客户关系…</p></section>}
    {!error && !loading && !accounts.length && <section className="state-card"><Inbox size={28}/><h2>{appliedSearch || status ? '没有符合条件的客户' : '建立第一份客户档案'}</h2><p>{appliedSearch || status ? '调整搜索条件或生命周期状态后再试。' : '客户、联系人、商机和历史互动会在一处沉淀。'}</p><button onClick={() => setCreating(true)}><Plus size={15}/> 新建客户</button></section>}
    {!error && !loading && accounts.length > 0 && <section className="table-card"><table><thead><tr><th>客户 / 区域</th><th>分级</th><th>负责人</th><th>联系人</th><th>开放商机</th><th>管道金额</th><th>生命周期</th><th/></tr></thead><tbody>{accounts.map(account => <tr key={account.id} onDoubleClick={() => setSelected(account)}><td><strong>{account.name}</strong><small className="cell-sub">{[account.province,account.city,account.district].filter(Boolean).join(' · ') || account.domain || '区域待补充'}</small></td><td><span className={`account-level level-${account.credit_level ?? 'unset'}`}>{account.credit_level ?? '—'}</span></td><td>{account.owner_name || '待分配'}</td><td>{account.contact_count ?? 0}</td><td>{account.open_opportunity_count ?? 0}</td><td><strong>{money(account.pipeline_amount)}</strong></td><td><span className={`status-pill customer-${account.lifecycle_status}`}>{lifecycleNames[account.lifecycle_status]}</span></td><td><div className="row-actions"><button onClick={() => setSelected(account)} aria-label={`编辑 ${account.name}`}><Pencil size={15}/></button><button onClick={() => setDeleting(account)} aria-label={`删除 ${account.name}`}><Trash2 size={15}/></button><button onClick={() => setSelected(account)} aria-label={`查看 ${account.name}`}><ChevronRight size={16}/></button></div></td></tr>)}</tbody></table></section>}
    {(creating || selected) && <CustomerDrawer account={selected} onClose={() => { setCreating(false); setSelected(null) }} onSaved={async message => { setCreating(false); setSelected(null); setNotice(message); await load() }}/>} 
    {deleting && <div className="dialog-layer"><button className="drawer-scrim" onClick={() => setDeleting(null)} aria-label="取消删除"/><section className="confirm-dialog"><div className="confirm-icon"><Trash2 size={20}/></div><h2>删除这位客户？</h2><p>“{deleting.name}”将从客户列表中移除，审计记录仍会保留。</p><div><button onClick={() => setDeleting(null)}>取消</button><button className="danger" onClick={() => void remove(deleting)}>删除客户</button></div></section></div>}
  </div>
}

function CustomerDrawer({ account,onClose,onSaved }: { account: Account | null; onClose:()=>void; onSaved:(message:string)=>Promise<void> }) {
  const [view,setView] = useState<'overview'|'contacts'|'trajectory'>('overview')
  const [detail,setDetail] = useState<AccountDetail | null>(null)
  const [detailError,setDetailError] = useState('')
  const [loading,setLoading] = useState(Boolean(account))
  const [form,setForm] = useState<AccountInput>(() => account ? { name:account.name,website:account.website,domain:account.domain,province:account.province,city:account.city,district:account.district,address:account.address,industry:account.industry,taxId:account.tax_id,creditLevel:account.credit_level,lifecycleStatus:account.lifecycle_status as AccountInput['lifecycleStatus'],source:account.source } : emptyAccount)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const refresh = useCallback(async () => {
    if (!account) return
    setLoading(true); setDetailError('')
    try { setDetail((await getAccount(account.id)).data) }
    catch (cause) { setDetailError(cause instanceof Error ? cause.message : '客户 360 数据加载失败。') }
    finally { setLoading(false) }
  },[account])
  useEffect(() => { void refresh() },[refresh])
  const set = (key:keyof AccountInput,value:string) => setForm(current => ({ ...current,[key]:value || null }))
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try { if (account) await updateAccount(account.id,form); else await createAccount(form); await onSaved(account ? '客户档案已更新' : '客户档案已创建') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存客户失败。') }
    finally { setSaving(false) }
  }

  return <div className="drawer-layer"><button className="drawer-scrim" onClick={onClose} aria-label="关闭客户详情"/><aside className="record-drawer customer-drawer"><header><div><p className="kicker">{account ? `${account.province || '区域待补充'} · 客户 360` : '建立客户资产'}</p><h2>{account?.name || '新建客户'}</h2></div><button onClick={onClose}><X size={20}/></button></header>
    {account && <nav className="drawer-tabs"><button className={view==='overview'?'active':''} onClick={() => setView('overview')}>360 总览</button><button className={view==='contacts'?'active':''} onClick={() => setView('contacts')}>联系人 <span>{detail?.contacts.length ?? 0}</span></button><button className={view==='trajectory'?'active':''} onClick={() => setView('trajectory')}>业务轨迹</button></nav>}
    {loading && <div className="drawer-loading"><LoaderCircle className="spin" size={25}/><span>正在拼合客户关系…</span></div>}
    {detailError && <div className="drawer-loading error-state"><AlertCircle size={24}/><span>{detailError}</span><button onClick={() => void refresh()}>重试</button></div>}
    {!loading && !detailError && view === 'overview' && <form onSubmit={submit}>
      {detail && <RelationshipRing detail={detail}/>} 
      <div className="form-grid customer-form"><label className="full"><span>客户名称 *</span><input value={form.name} onChange={event => set('name',event.target.value)} required autoFocus={!account}/></label><label><span>官网</span><input type="url" value={form.website ?? ''} onChange={event => set('website',event.target.value)} placeholder="https://"/></label><label><span>统一社会信用代码</span><input value={form.taxId ?? ''} onChange={event => set('taxId',event.target.value.toUpperCase())} maxLength={18}/></label><label><span>省份</span><input value={form.province ?? ''} onChange={event => set('province',event.target.value)} placeholder="如：江苏省"/></label><label><span>城市</span><input value={form.city ?? ''} onChange={event => set('city',event.target.value)} placeholder="如：苏州市"/></label><label><span>区县</span><input value={form.district ?? ''} onChange={event => set('district',event.target.value)}/></label><label className="full"><span>详细地址</span><input value={form.address ?? ''} onChange={event => set('address',event.target.value)}/></label><label><span>行业</span><input value={form.industry ?? ''} onChange={event => set('industry',event.target.value)}/></label><label><span>客户来源</span><input value={form.source ?? ''} onChange={event => set('source',event.target.value)}/></label><label><span>信用分级</span><select value={form.creditLevel ?? ''} onChange={event => set('creditLevel',event.target.value)}><option value="">未分级</option>{['A','B','C','D'].map(level => <option key={level}>{level}</option>)}</select></label><label><span>生命周期</span><select value={form.lifecycleStatus} onChange={event => set('lifecycleStatus',event.target.value)}>{Object.entries(lifecycleNames).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      {error && <div className="form-error">{error}</div>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving?'正在保存…':account?'保存客户档案':'创建客户'}</button></footer>
    </form>}
    {!loading && detail && view === 'contacts' && <ContactsWorkspace accountId={account!.id} contacts={detail.contacts} refresh={refresh}/>} 
    {!loading && detail && view === 'trajectory' && <TrajectoryWorkspace detail={detail}/>} 
  </aside></div>
}

function RelationshipRing({ detail }: { detail:AccountDetail }) {
  const received = Number(detail.summary.received_amount)
  const planned = Number(detail.summary.planned_amount)
  const paymentRate = planned ? Math.round(received / planned * 100) : 0
  return <section className="relationship-map" aria-label="客户 360 关系概览"><div className="relationship-ring"><div><small>关系中枢</small><strong>{detail.account.name.slice(0,2)}</strong><span>{detail.account.credit_level ? `${detail.account.credit_level} 级客户` : '待分级'}</span></div><i className="orbit-dot dot-contact"/><i className="orbit-dot dot-deal"/><i className="orbit-dot dot-order"/></div><div className="relationship-metrics"><article><UsersRound size={16}/><span>关键联系人</span><strong>{detail.summary.contactCount}</strong></article><article><Target size={16}/><span>开放商机</span><strong>{detail.summary.openOpportunityCount}</strong><small>{money(detail.summary.openPipeline)}</small></article><article><CircleDollarSign size={16}/><span>历史订单</span><strong>{money(detail.summary.orderTotal)}</strong><small>回款 {paymentRate}%</small></article><article><Clock3 size={16}/><span>最近互动</span><strong>{date(detail.activities[0]?.occurred_at ?? detail.account.last_contact_at)}</strong></article></div></section>
}

function ContactsWorkspace({ accountId,contacts,refresh }: { accountId:string; contacts:Contact[]; refresh:()=>Promise<void> }) {
  const [editing,setEditing] = useState<Contact | null>(null)
  const [adding,setAdding] = useState(false)
  const [form,setForm] = useState<ContactInput>(emptyContact)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  function begin(contact?:Contact) { setEditing(contact ?? null); setAdding(true); setForm(contact ? { fullName:contact.full_name,jobTitle:contact.job_title,department:contact.department,email:contact.email,phone:contact.phone,wechat:contact.wechat,preferredChannel:contact.preferred_channel as ContactInput['preferredChannel'],employmentStatus:contact.employment_status as ContactInput['employmentStatus'],isPrimary:contact.is_primary } : emptyContact) }
  const set = (key:keyof ContactInput,value:string|boolean) => setForm(current => ({ ...current,[key]:value || null }))
  async function submit(event:FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { if (editing) await updateContact(accountId,editing.id,form); else await createContact(accountId,form); setAdding(false); setEditing(null); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : '保存联系人失败。') } finally { setSaving(false) } }
  async function remove(contact:Contact) { if (!window.confirm(`删除联系人“${contact.full_name}”？`)) return; try { await deleteContact(accountId,contact.id); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : '删除联系人失败。') } }
  return <div className="contact-workspace"><div className="workspace-heading"><div><p className="kicker">关系网络</p><h3>联系人</h3></div><button onClick={() => begin()}><Plus size={15}/> 添加联系人</button></div>
    {adding && <form className="contact-editor" onSubmit={submit}><div className="form-grid"><label className="full"><span>姓名 *</span><input value={form.fullName} onChange={event => set('fullName',event.target.value)} required autoFocus/></label><label><span>职位</span><input value={form.jobTitle ?? ''} onChange={event => set('jobTitle',event.target.value)}/></label><label><span>部门</span><input value={form.department ?? ''} onChange={event => set('department',event.target.value)}/></label><label><span>电话</span><input value={form.phone ?? ''} onChange={event => set('phone',event.target.value)}/></label><label><span>微信</span><input value={form.wechat ?? ''} onChange={event => set('wechat',event.target.value)}/></label><label><span>邮箱</span><input type="email" value={form.email ?? ''} onChange={event => set('email',event.target.value)}/></label><label><span>偏好渠道</span><select value={form.preferredChannel ?? ''} onChange={event => set('preferredChannel',event.target.value)}><option value="">未指定</option><option value="phone">电话</option><option value="wechat">微信</option><option value="email">邮件</option><option value="meeting">拜访 / 会议</option></select></label><label className="primary-check"><input type="checkbox" checked={Boolean(form.isPrimary)} onChange={event => set('isPrimary',event.target.checked)}/><span>设为主联系人</span></label></div>{error && <div className="form-error">{error}</div>}<footer><button type="button" onClick={() => setAdding(false)}>取消</button><button className="primary" disabled={saving}>{saving?'保存中…':'保存联系人'}</button></footer></form>}
    {!adding && !contacts.length && <div className="contacts-empty"><UserRound size={28}/><p>还没有联系人。添加一位决策人或日常对接人。</p></div>}
    {!adding && <div className="contact-list">{contacts.map(contact => <article key={contact.id}><div className="contact-avatar">{contact.full_name.slice(0,1)}</div><div className="contact-main"><div><b>{contact.full_name}</b>{contact.is_primary && <span>主联系人</span>}</div><p>{[contact.job_title,contact.department].filter(Boolean).join(' · ') || '职位待补充'}</p><small>{contact.email && <><Mail size={12}/>{contact.email}</>}{contact.phone && <><Phone size={12}/>{contact.phone}</>}</small></div><div className="contact-actions"><button onClick={() => begin(contact)}><Pencil size={14}/></button><button onClick={() => void remove(contact)}><Trash2 size={14}/></button></div></article>)}</div>}
  </div>
}

function TrajectoryWorkspace({ detail }: { detail:AccountDetail }) {
  return <div className="trajectory-workspace"><section><div className="workspace-heading"><div><p className="kicker">销售管道</p><h3>商机与订单</h3></div></div>{!detail.opportunities.length && !detail.orders.length ? <p className="trajectory-empty">还没有商机或订单记录。</p> : <div className="deal-stack">{detail.opportunities.map(item => <article key={item.id}><i/><div><b>{item.name}</b><span>{item.stage_name} · {item.status}</span></div><strong>{money(item.amount)}</strong></article>)}{detail.orders.map(item => <article className="order-row" key={item.id}><i/><div><b>{item.order_number}</b><span>订单 · {item.status}</span></div><strong>{money(item.total_amount)}</strong></article>)}</div>}</section><section><div className="workspace-heading"><div><p className="kicker">关系记录</p><h3>互动时间线</h3></div></div>{!detail.activities.length ? <p className="trajectory-empty">暂无互动记录。由线索转化而来的跟进会自动汇入这里。</p> : <div className="timeline customer-timeline">{detail.activities.map(item => <article key={item.id}><i/><div><header><b>{item.subject || item.activity_type}</b><span>{date(item.occurred_at)}</span></header><p>{item.content}</p>{item.next_action && <small>下一步：{item.next_action}</small>}</div></article>)}</div>}</section>{detail.tasks.length > 0 && <section><div className="workspace-heading"><div><p className="kicker">下一步行动</p><h3>待办</h3></div></div><div className="task-strip">{detail.tasks.filter(item => !['done','cancelled'].includes(item.status)).map(item => <article key={item.id}><Clock3 size={14}/><div><b>{item.title}</b><span>{date(item.due_at)} · {item.assignee_name || '待分配'}</span></div></article>)}</div></section>}</div>
}
