import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, ChevronRight, Clock3, Inbox, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, UserRound, X } from 'lucide-react'
import { ApiError, checkLeadDuplicates, convertLead, createLead, createLeadActivity, deleteLead, getAssignableUsers, getLeadActivities, getLeads, updateLead, type AssignableUser, type DuplicateCandidate, type Lead, type LeadActivity, type LeadInput } from './api'

const statusNames: Record<string, string> = { new:'新线索', unassigned:'待分配', contacted:'已联系', nurturing:'培育中', qualified:'已确认', converted:'已转化', disqualified:'已放弃', public_pool:'线索池' }
const priorityNames: Record<string, string> = { low:'低', medium:'普通', high:'高', urgent:'紧急' }
const emptyForm: LeadInput = { companyName:'', contactName:'', email:'', phone:'', province:'', city:'', source:'', interestedProducts:'', priority:'medium' }

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Lead | null>(null)
  const [deleting, setDeleting] = useState<Lead | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const result = await getLeads({ search: appliedSearch, status }); setLeads(result.data); setTotal(result.pagination.total) }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '无法加载线索，请检查网络连接。') }
    finally { setLoading(false) }
  }, [appliedSearch, status])
  useEffect(() => { void load() }, [load])

  function openCreate() { setEditing(null); setFormOpen(true) }
  function openEdit(lead: Lead) { setEditing(lead); setFormOpen(true) }
  async function remove(lead: Lead) {
    try { await deleteLead(lead.id); setNotice('线索已删除'); await load() }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '删除失败。') }
    finally { setDeleting(null) }
  }

  return <div className="data-page leads-page">
    {notice && <div className="inline-notice">{notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}
    <section className="data-toolbar leads-toolbar">
      <div className="tabs">{[['','全部线索'],['unassigned','待分配'],['new','新线索'],['contacted','已联系'],['qualified','已确认']].map(([value,label]) => <button key={label} className={status === value ? 'selected' : ''} onClick={() => setStatus(value)}>{label}{value === '' && <span>{total}</span>}</button>)}</div>
      <div className="toolbar-actions"><form className="lead-search" onSubmit={e => { e.preventDefault(); setAppliedSearch(search.trim()) }}><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="公司、联系人或邮箱" /><button aria-label="搜索">搜索</button></form><button className="primary" onClick={openCreate}><Plus size={16} /> 新建线索</button></div>
    </section>
    {error && <section className="state-card error-state"><AlertCircle size={25} /><h2>线索暂时无法加载</h2><p>{error}</p><button onClick={() => void load()}><RefreshCw size={15} /> 重新加载</button></section>}
    {!error && loading && <section className="state-card"><LoaderCircle className="spin" size={27} /><p>正在同步线索数据…</p></section>}
    {!error && !loading && leads.length === 0 && <section className="state-card"><Inbox size={28} /><h2>{appliedSearch || status ? '没有符合条件的线索' : '从第一条询盘开始'}</h2><p>{appliedSearch || status ? '调整搜索条件或状态后再试。' : '新建线索后，它会出现在这里并自动归入你的名下。'}</p><button onClick={openCreate}><Plus size={15} /> 新建线索</button></section>}
    {!error && !loading && leads.length > 0 && <section className="table-card"><table><thead><tr><th>公司 / 联系人</th><th>省市</th><th>来源</th><th>意向产品</th><th>负责人</th><th>状态</th><th>优先级</th><th /></tr></thead><tbody>{leads.map(lead => <tr key={lead.id}><td><strong>{lead.company_name}</strong><small className="cell-sub">{lead.contact_name || lead.email || '暂无联系人'}</small></td><td>{[lead.province,lead.city].filter(Boolean).join(' · ') || '—'}</td><td>{lead.source || '—'}</td><td>{lead.interested_products || '—'}</td><td>{lead.owner_name || '待分配'}</td><td><span className={`status-pill status-${lead.status}`}>{statusNames[lead.status] || lead.status}</span></td><td><span className={`priority priority-${lead.priority}`}>{priorityNames[lead.priority]}</span></td><td><div className="row-actions"><button onClick={() => openEdit(lead)} aria-label={`编辑 ${lead.company_name}`}><Pencil size={15} /></button><button onClick={() => setDeleting(lead)} aria-label={`删除 ${lead.company_name}`}><Trash2 size={15} /></button><button onClick={() => openEdit(lead)} aria-label={`查看 ${lead.company_name}`}><ChevronRight size={16} /></button></div></td></tr>)}</tbody></table></section>}
    {formOpen && <LeadForm lead={editing} onClose={() => setFormOpen(false)} onSaved={async message => { setFormOpen(false); setNotice(message); await load() }} />}
    {deleting && <div className="dialog-layer"><button className="drawer-scrim" onClick={() => setDeleting(null)} aria-label="取消删除" /><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="confirm-icon"><Trash2 size={20} /></div><h2 id="delete-title">删除这条线索？</h2><p>“{deleting.company_name}”将从列表中移除，但操作记录仍会保留在审计日志中。</p><div><button onClick={() => setDeleting(null)}>取消</button><button className="danger" onClick={() => void remove(deleting)}>删除线索</button></div></section></div>}
  </div>
}

function LeadForm({ lead, onClose, onSaved }: { lead: Lead | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [view, setView] = useState<'details' | 'activities' | 'convert'>('details')
  const [form, setForm] = useState<LeadInput>(() => lead ? { companyName:lead.company_name, contactName:lead.contact_name, email:lead.email, phone:lead.phone, province:lead.province, city:lead.city, source:lead.source, interestedProducts:lead.interested_products, priority:lead.priority as LeadInput['priority'], status:lead.status, ownerId:lead.owner_id } : emptyForm)
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([])
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof LeadInput, value: string) => { setForm(current => ({ ...current, [key]: value || null })); if (['companyName','email','phone'].includes(key)) { setDuplicates([]); setDuplicateAcknowledged(false) } }
  const refreshActivities = useCallback(async () => { if (lead) setActivities((await getLeadActivities(lead.id)).data) }, [lead])
  useEffect(() => { void getAssignableUsers().then(result => setUsers(result.data)); if (lead) void refreshActivities() }, [lead, refreshActivities])

  async function findDuplicates() {
    if (form.companyName.trim().length < 2) return []
    const result = await checkLeadDuplicates({ companyName:form.companyName, email:form.email, phone:form.phone, excludeLeadId:lead?.id })
    setDuplicates(result.data); return result.data
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      if (!lead && !duplicateAcknowledged && (await findDuplicates()).length) { setSaving(false); return }
      if (lead) await updateLead(lead.id, form); else await createLead(form)
      await onSaved(lead ? '线索已更新' : '线索已创建')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。') }
    finally { setSaving(false) }
  }

  return <div className="drawer-layer"><button className="drawer-scrim" onClick={onClose} aria-label="关闭表单" /><aside className="record-drawer workflow-drawer"><header><div><p className="kicker">{lead ? statusNames[lead.status] : '录入询盘'}</p><h2>{lead ? lead.company_name : '新建线索'}</h2></div><button onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
    {lead && <nav className="drawer-tabs"><button className={view === 'details' ? 'active' : ''} onClick={() => setView('details')}>基本资料</button><button className={view === 'activities' ? 'active' : ''} onClick={() => setView('activities')}>跟进记录 <span>{activities.length}</span></button><button className={view === 'convert' ? 'active' : ''} onClick={() => setView('convert')}>转化</button></nav>}
    {view === 'details' && <form onSubmit={submit}><div className="form-grid"><label className="full"><span>公司名称 *</span><input value={form.companyName} onChange={e => set('companyName', e.target.value)} required maxLength={200} autoFocus /></label><label><span>联系人</span><input value={form.contactName ?? ''} onChange={e => set('contactName', e.target.value)} /></label><label><span>工作邮箱</span><input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)} /></label><label><span>电话</span><input value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} /></label><label><span>省份</span><input value={form.province ?? ''} onChange={e => set('province', e.target.value)} placeholder="如：江苏省" /></label><label><span>城市</span><input value={form.city ?? ''} onChange={e => set('city', e.target.value)} placeholder="如：苏州市" /></label><label><span>来源</span><select value={form.source ?? ''} onChange={e => set('source', e.target.value)}><option value="">请选择</option><option>官网咨询</option><option>百度推广</option><option>抖音企业号</option><option>行业展会</option><option>客户转介绍</option><option>电话咨询</option></select></label><label><span>优先级</span><select value={form.priority} onChange={e => set('priority', e.target.value)}><option value="low">低</option><option value="medium">普通</option><option value="high">高</option><option value="urgent">紧急</option></select></label>{lead && <label><span>状态</span><select value={form.status} onChange={e => set('status', e.target.value)}>{Object.entries(statusNames).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>}{lead && <label className="full"><span>负责人</span><select value={form.ownerId ?? ''} onChange={e => set('ownerId', e.target.value)}><option value="">待分配</option>{users.map(user => <option value={user.id} key={user.id}>{user.display_name} · {user.email}</option>)}</select></label>}<label className="full"><span>意向产品</span><input value={form.interestedProducts ?? ''} onChange={e => set('interestedProducts', e.target.value)} placeholder="产品名称、型号或需求摘要" /></label></div>
      {duplicates.length > 0 && <DuplicatePanel candidates={duplicates} acknowledged={duplicateAcknowledged} onAcknowledge={() => setDuplicateAcknowledged(true)} />}
      {error && <div className="form-error" role="alert">{error}</div>}<footer><button type="button" className="check-duplicate" onClick={() => void findDuplicates()}>检查重复</button><span className="footer-spacer" /><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? '正在保存…' : lead ? '保存修改' : duplicateAcknowledged ? '确认创建' : '创建线索'}</button></footer></form>}
    {lead && view === 'activities' && <ActivityPanel lead={lead} activities={activities} refresh={refreshActivities} />}
    {lead && view === 'convert' && <ConvertPanel lead={lead} onConverted={() => onSaved('线索已转为客户和商机')} />}
  </aside></div>
}

function DuplicatePanel({ candidates, acknowledged, onAcknowledge }: { candidates: DuplicateCandidate[]; acknowledged: boolean; onAcknowledge: () => void }) {
  return <section className="duplicate-panel"><div className="duplicate-title"><AlertCircle size={17} /><div><b>发现 {candidates.length} 条相似记录</b><p>请先确认不是同一家公司，避免撞单。</p></div></div>{candidates.map(item => <article key={`${item.entity_type}-${item.id}`}><div><b>{item.name}</b><span>{item.entity_type === 'lead' ? '线索' : '客户'} · {item.match_reason}</span></div><strong>{Math.round(Number(item.score) * 100)}%</strong></article>)}{!acknowledged ? <button type="button" onClick={onAcknowledge}>不是重复，继续创建</button> : <p className="duplicate-confirmed"><CheckCircle2 size={14} /> 已确认保留为新线索</p>}</section>
}

function ActivityPanel({ lead, activities, refresh }: { lead: Lead; activities: LeadActivity[]; refresh: () => Promise<void> }) {
  const [content, setContent] = useState('')
  const [activityType, setActivityType] = useState('note')
  const [nextAction, setNextAction] = useState('')
  const [nextActionAt, setNextActionAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { await createLeadActivity(lead.id, { activityType, content, nextAction:nextAction || null, nextActionAt:nextActionAt ? new Date(nextActionAt).toISOString() : null }); setContent(''); setNextAction(''); setNextActionAt(''); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : '跟进记录保存失败。') } finally { setSaving(false) } }
  return <div className="activity-workspace"><form className="activity-compose" onSubmit={submit}><div><select aria-label="跟进方式" value={activityType} onChange={e => setActivityType(e.target.value)}><option value="note">记录</option><option value="call">电话</option><option value="wechat">微信</option><option value="email">邮件</option><option value="meeting">拜访 / 会议</option></select><span>记录本次沟通</span></div><textarea value={content} onChange={e => setContent(e.target.value)} placeholder="客户反馈、需求变化或约定事项…" required /><div className="next-action-fields"><input value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="下一步行动（可选）" /><input type="datetime-local" value={nextActionAt} onChange={e => setNextActionAt(e.target.value)} aria-label="下次跟进时间" /></div>{error && <div className="form-error">{error}</div>}<button disabled={saving}>{saving ? '保存中…' : '保存跟进'}</button></form><section className="timeline"><p className="kicker">沟通时间线</p>{activities.length === 0 ? <div className="timeline-empty"><Clock3 size={22} /><p>还没有跟进记录。记录第一次沟通后，时间线会保存在这里。</p></div> : activities.map(item => <article key={item.id}><i /><div><header><b>{item.actor_name || '系统'}</b><span>{new Date(item.occurred_at).toLocaleString('zh-CN')}</span></header><p>{item.content}</p>{item.next_action && <small>下一步：{item.next_action}{item.next_action_at ? ` · ${new Date(item.next_action_at).toLocaleString('zh-CN')}` : ''}</small>}</div></article>)}</section></div>
}

function ConvertPanel({ lead, onConverted }: { lead: Lead; onConverted: () => Promise<void> }) {
  const [opportunityName, setOpportunityName] = useState(`${lead.company_name} 首次商机`)
  const [amount, setAmount] = useState('0')
  const [closeDate, setCloseDate] = useState('')
  const [duplicates, setDuplicates] = useState<Array<{ id:string; name:string; score:number }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function execute(force = false) { setSaving(true); setError(''); try { await convertLead(lead.id, { accountName:lead.company_name, createOpportunity:true, opportunityName, amount:Number(amount), expectedCloseDate:closeDate || null, force }); await onConverted() } catch (cause) { if (cause instanceof ApiError && cause.status === 409 && Array.isArray(cause.details)) setDuplicates(cause.details as Array<{id:string;name:string;score:number}>); else setError(cause instanceof Error ? cause.message : '转化失败。') } finally { setSaving(false) } }
  return <div className="convert-workspace"><div className="convert-route"><span className="done">线索</span><i /><span>客户</span><i /><span>商机</span></div><div className="convert-copy"><p className="kicker">销售链路下一步</p><h3>转为客户并创建首个商机</h3><p>联系人、所在省市和来源信息会一并带入，原线索及跟进历史保持可追溯。</p></div><div className="form-grid"><label className="full"><span>商机名称</span><input value={opportunityName} onChange={e => setOpportunityName(e.target.value)} /></label><label><span>预计金额（元）</span><input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} /></label><label><span>计价币种</span><input value="人民币 CNY" disabled /></label><label className="full"><span>预计成交日期</span><input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></label></div>{duplicates.length > 0 && <section className="duplicate-panel"><div className="duplicate-title"><AlertCircle size={17} /><div><b>发现相似客户</b><p>继续后仍会创建新的客户档案。</p></div></div>{duplicates.map(item => <article key={item.id}><div><b>{item.name}</b><span>现有客户</span></div><strong>{Math.round(Number(item.score)*100)}%</strong></article>)}<button onClick={() => void execute(true)}>确认仍然转化</button></section>}{error && <div className="form-error">{error}</div>}<button className="convert-button" onClick={() => void execute(false)} disabled={saving || lead.status === 'converted'}>{lead.status === 'converted' ? '该线索已转化' : saving ? '正在转化…' : <>转为客户与商机 <ArrowRight size={16} /></>}</button></div>
}
