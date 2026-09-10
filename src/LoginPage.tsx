import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Globe2, LockKeyhole, Mail, Radio, ShieldCheck } from 'lucide-react'
import { ApiError, login, type SessionUser } from './api'

export default function LoginPage({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('admin@local.crm')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setLoading(true)
    try { onLogin(await login(email, password)) }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : '无法连接服务器，请确认后端服务已启动。') }
    finally { setLoading(false) }
  }

  return <main className="login-page">
    <section className="login-signal">
      <div className="login-brand"><div className="brand-mark"><span /></div><div><b>销途</b><small>AI CRM</small></div></div>
      <div className="signal-copy"><p className="signal-code"><Radio size={14} /> 实时 · 国内销售工作台</p><h1>每一次跟进，<br />都更接近成交。</h1><p>连接国内客户、商机、报价与回款，让 AI 在正确的时间提示下一步。</p></div>
      <div className="login-route" aria-label="从线索到回款的销售全链路">
        {['线索', '客户', '商机', '报价', '订单', '回款'].map((item, i) => <div key={item}><span>{i + 1}</span><b>{item}</b></div>)}
      </div>
      <div className="signal-foot"><span><Globe2 size={15} /> 上海 · 北京时间</span><span><ShieldCheck size={15} /> 租户数据隔离已启用</span></div>
    </section>
    <section className="login-form-side">
      <form className="login-card" onSubmit={submit}>
        <p className="kicker">欢迎回来</p><h2>进入销售作战台</h2><p className="login-intro">使用你的工作邮箱登录默认组织。</p>
        <label><span>邮箱</span><div className="field-with-icon"><Mail size={17} /><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></div></label>
        <label><span>密码</span><div className="field-with-icon"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="输入密码" required minLength={8} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="login-submit" disabled={loading}>{loading ? '正在验证…' : <>登录 <ArrowRight size={17} /></>}</button>
        <div className="login-security"><ShieldCheck size={15} /><span>登录凭据通过本地 API 验证，密码不会存储在浏览器中。</span></div>
      </form>
    </section>
  </main>
}
