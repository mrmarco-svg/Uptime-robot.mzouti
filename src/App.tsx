import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  Activity, AlertTriangle, ArrowRight, Bell, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock3, ExternalLink, Gauge, Globe2, LayoutDashboard, Menu, MonitorDot,
  PauseCircle, PlayCircle, Plus, RefreshCw, Search, Settings2, ShieldCheck,
  Trash2, X, Zap,
} from 'lucide-react'

type Status = 'up' | 'down' | 'paused'
type Monitor = {
  id: number; name: string; url: string; type: 'HTTP' | 'PING' | 'PORT'; status: Status
  uptime: number; response: number; lastCheck: string; lastCheckAt: string | null
  interval: string; intervalSeconds: number; location: string; tags: string[]; chart: number[]
}
type Check = { status: 'up' | 'down'; statusCode: number | null; responseMs: number | null; error: string | null; checkedAt: string }
type Section = 'overview' | 'monitors' | 'incidents' | 'settings'
type MonitorForm = { name: string; url: string; type: Monitor['type']; interval: string }
type Incident = { id: number; monitor_id: number; started_at: string; resolved_at: string | null; cause: string | null; monitors?: { name: string; url: string } | null }
type AccountInfo = {
  email: string
  subscription: { planCode: string; status: string; periodEnd: string | null; label: string; monitors: number; historyDays: number; minInterval: number }
  usage: { monitors: number; limit: number; remaining: number }
  plans: { code: string; label: string; monitors: number; historyDays: number; minInterval: number }[]
  paymentMethods: { natcash: { recipient: string; phone: string }; meru: { tag: string } }
  payments: { id: number; provider: string; billing_period: string; amount: number; currency: string; reference: string; status: string; created_at: string }[]
}
const emptyForm: MonitorForm = { name: '', url: '', type: 'HTTP', interval: '5 min' }

function navigateTo(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function StatusBadge({ status }: { status: Status }) {
  const Icon = status === 'up' ? CheckCircle2 : status === 'down' ? AlertTriangle : PauseCircle
  const label = status === 'up' ? 'Opérationnel' : status === 'down' ? 'En panne' : 'En pause'
  return <span className={`status-badge status-${status}`}><Icon size={14} />{label}</span>
}

function Chart({ values }: { values: number[] }) {
  if (!values.length) return <div className="empty-state"><Activity size={22} /><strong>Aucun historique disponible</strong><span>Les points apparaîtront après les premiers contrôles.</span></div>
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 700},${190 - v * 1.68}`).join(' ')
  return <svg className="main-chart" viewBox="0 0 700 200" preserveAspectRatio="none" role="img" aria-label="Historique des contrôles">
    {[30, 80, 130, 180].map((y) => <line key={y} x1="0" x2="700" y1={y} y2={y} className="chart-grid" />)}
    {values.length > 1 && <polyline points={points} fill="none" stroke="#6575f2" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
}

function AuthScreen({ initialMode }: { initialMode: 'login' | 'signup' }) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setError(''); setMessage('')
    try {
      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
      if (result.error) setError(result.error.message)
      else if (mode === 'signup' && !result.data.session) setMessage('Compte créé. Vérifie ton email pour confirmer ton inscription.')
    } catch { setError('Connexion impossible. Réessaie.') }
    finally { setPending(false) }
  }
  const reset = async () => {
    if (!email) { setError('Indique ton adresse email.'); return }
    setPending(true); setError(''); setMessage('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (error) setError(error.message); else setMessage('Lien de réinitialisation envoyé.')
    setPending(false)
  }
  useEffect(() => { setMode(initialMode); setError(''); setMessage('') }, [initialMode])
  return <div className="auth-shell"><div className="auth-card"><button className="auth-back" onClick={() => navigateTo('/')}><ChevronDown size={15} /> Retour à l’accueil</button><div className="auth-brand"><div className="brand-mark"><span /></div><div><div className="brand-name">mzouti<span>uptime</span></div><div className="brand-caption">simple. fiable. visible.</div></div></div><div className="auth-kicker"><ShieldCheck size={14} /> ESPACE SÉCURISÉ</div><h1>{mode === 'login' ? 'Bon retour.' : 'Créer ton espace.'}</h1><p className="auth-lead">Surveille tes sites avec des contrôles réels et privés.</p><form className="auth-form" onSubmit={submit}><label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Mot de passe<input type="password" minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{mode === 'login' && <button type="button" className="forgot-password" onClick={() => void reset()} disabled={pending}>Mot de passe oublié ?</button>}{error && <div className="auth-message auth-error"><AlertTriangle size={15} />{error}</div>}{message && <div className="auth-message auth-success"><CheckCircle2 size={15} />{message}</div>}<button className="button button-primary auth-submit" disabled={pending}>{pending ? 'Patiente...' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}</button></form><button className="auth-switch" onClick={() => { const next = mode === 'login' ? 'signup' : 'login'; setMode(next); navigateTo(next === 'login' ? '/login' : '/signup'); setError(''); setMessage('') }}>{mode === 'login' ? 'Créer un compte' : 'J’ai déjà un compte'}</button><div className="auth-note">Tes moniteurs sont protégés par Supabase Auth et les règles RLS.</div></div></div>
}

function LandingPage() {
  return <div className="landing-shell">
    <header className="landing-nav">
      <button className="landing-brand" onClick={() => navigateTo('/')} aria-label="Mzouti Uptime, accueil"><span className="brand-mark"><span /></span><span><strong>mzouti<span>uptime</span></strong><small>simple. fiable. visible.</small></span></button>
      <nav className="landing-nav-links" aria-label="Navigation principale"><a href="#fonctionnalites">Fonctionnalités</a><a href="#fonctionnement">Comment ça marche</a><a href="#securite">Sécurité</a></nav>
      <div className="landing-nav-actions"><button className="landing-login" onClick={() => navigateTo('/login')}>Se connecter</button><button className="button button-primary button-small" onClick={() => navigateTo('/signup')}>Commencer gratuitement <ArrowRight size={14} /></button></div>
    </header>
    <main>
      <section className="landing-hero">
        <div className="hero-copy"><div className="landing-kicker"><span className="landing-kicker-dot" /> MONITORING RÉEL, SANS SURPRISE</div><h1>Ton site doit rester<br /><em>toujours en ligne.</em></h1><p>Mzouti Uptime surveille tes services avec de vrais contrôles HTTP, PING et PORT, puis te donne une vue claire de leur disponibilité.</p><div className="hero-actions"><button className="button button-primary hero-cta" onClick={() => navigateTo('/signup')}>Surveiller mon premier site <ArrowRight size={16} /></button><button className="hero-secondary" onClick={() => document.getElementById('fonctionnement')?.scrollIntoView({ behavior: 'smooth' })}>Découvrir la plateforme <ChevronDown size={15} /></button></div><div className="hero-proof"><div className="proof-avatars"><span>M</span><span>U</span><span>+</span></div><span>Une surveillance pensée pour les équipes qui veulent dormir tranquilles.</span></div></div>
        <div className="hero-visual" aria-label="Aperçu de la console Mzouti Uptime"><div className="hero-glow" /><div className="preview-window"><div className="preview-topbar"><div className="preview-dots"><i /><i /><i /></div><span>mzouti uptime / workspace</span><span className="preview-live"><b /> LIVE</span></div><div className="preview-body"><div className="preview-side"><div className="preview-logo"><span className="brand-mark"><span /></span><b>mzouti<span>uptime</span></b></div><div className="preview-side-item preview-side-active"><LayoutDashboard size={12} /> Vue d’ensemble</div><div className="preview-side-item"><MonitorDot size={12} /> Moniteurs <small>4</small></div><div className="preview-side-item"><AlertTriangle size={12} /> Incidents</div><div className="preview-side-bottom"><ShieldCheck size={13} /> Monitoring actif</div></div><div className="preview-content"><div className="preview-heading"><div><span>MONITORING CENTER</span><strong>Bonjour, Mzouti ✦</strong></div><span className="preview-time">Actualisé à l’instant</span></div><div className="preview-stats"><div><span>Moniteurs actifs</span><strong>4 <small>/ 4</small></strong><b>4 opérationnels</b></div><div><span>Uptime moyen</span><strong>99.98<small>%</small></strong><b>sur 30 jours</b></div><div><span>Temps de réponse</span><strong>184<small> ms</small></strong><b>réponse moyenne</b></div></div><div className="preview-panel"><div className="preview-panel-head"><div><b>Services surveillés</b><span>Dernier état connu de chaque moniteur.</span></div><span>Tout voir ›</span></div>{['Site vitrine', 'API production', 'Dashboard client'].map((name, index) => <div className="preview-monitor" key={name}><i /><div><b>{name}</b><span>{index === 1 ? 'api.mzouti.com' : index === 2 ? 'app.mzouti.com' : 'mzouti.com'}</span></div><strong>Opérationnel</strong><small>{index === 0 ? '142 ms' : index === 1 ? '96 ms' : '218 ms'}</small></div>)}</div></div></div></div></div>
      </section>
      <section className="landing-trust"><span>CONÇU POUR SURVEILLER CE QUI COMPTE</span><div><b><Globe2 size={15} /> Sites web</b><b><Zap size={15} /> APIs et services</b><b><Gauge size={15} /> Infrastructures</b><b><ShieldCheck size={15} /> Données privées</b></div></section>
      <section className="landing-section features-section" id="fonctionnalites"><div className="section-heading"><div><div className="landing-kicker">POURQUOI MZOUTI UPTIME</div><h2>La visibilité dont ton activité a besoin.</h2></div><p>Un tableau de bord simple, des contrôles authentiques et les informations utiles au bon moment.</p></div><div className="feature-grid"><article className="feature-card feature-card-highlight"><div className="feature-icon"><Activity size={19} /></div><h3>Des contrôles vraiment réels</h3><p>Chaque vérification est exécutée côté serveur. HTTP, PING ou PORT : tu vois l’état réel de ton service, pas une donnée simulée.</p><span className="feature-link">Surveillance continue <ArrowRight size={14} /></span></article><article className="feature-card"><div className="feature-icon feature-icon-green"><CheckCircle2 size={19} /></div><h3>Une lecture instantanée</h3><p>Uptime, temps de réponse, historique des contrôles et incidents sont réunis dans une interface claire et rapide.</p><span className="feature-link">Comprendre en un coup d’œil <ArrowRight size={14} /></span></article><article className="feature-card"><div className="feature-icon feature-icon-orange"><ShieldCheck size={19} /></div><h3>Privé par conception</h3><p>Ton espace est protégé par Supabase Auth et chaque moniteur reste isolé grâce aux règles de sécurité RLS.</p><span className="feature-link">Un espace à toi <ArrowRight size={14} /></span></article></div></section>
      <section className="landing-section how-section" id="fonctionnement"><div className="section-heading centered-heading"><div><div className="landing-kicker">EN TROIS ÉTAPES</div><h2>De l’inquiétude à la tranquillité.</h2></div><p>Quelques secondes suffisent pour mettre ton premier service sous surveillance.</p></div><div className="steps-grid"><div className="step"><span>01</span><div><h3>Crée ton espace</h3><p>Inscris-toi gratuitement avec ton adresse email.</p></div></div><div className="step"><span>02</span><div><h3>Ajoute ton service</h3><p>Indique une URL, un hôte ou un port à contrôler.</p></div></div><div className="step"><span>03</span><div><h3>Reste informé</h3><p>Consulte les contrôles réels et les incidents détectés.</p></div></div></div></section>
      <section className="landing-cta" id="securite"><div><div className="landing-kicker">PRÊT À COMMENCER ?</div><h2>Ne découvre pas une panne<br />par tes utilisateurs.</h2><p>Lance ton premier contrôle réel maintenant. Mzouti Uptime est là pour garder un œil ouvert.</p></div><button className="button button-primary hero-cta" onClick={() => navigateTo('/signup')}>Créer mon espace <ArrowRight size={16} /></button></section>
    </main>
    <footer className="landing-footer"><button className="landing-brand" onClick={() => navigateTo('/')}><span className="brand-mark"><span /></span><span><strong>mzouti<span>uptime</span></strong><small>simple. fiable. visible.</small></span></button><span>© 2026 Mzouti Uptime — All Right reserved</span><span>Monitoring réel · Authentification Supabase</span></footer>
  </div>
}

function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [section, setSection] = useState<Section>(() => window.location.pathname.startsWith('/monitors') ? 'monitors' : 'overview')
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [form, setForm] = useState<MonitorForm>(emptyForm)
  const [editForm, setEditForm] = useState<MonitorForm>(emptyForm)
  const [checks, setChecks] = useState<Check[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState('')
  const [toast, setToast] = useState('')
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [paymentForm, setPaymentForm] = useState({ planCode: 'starter', provider: 'natcash', billingPeriod: 'monthly', amount: '', currency: 'HTG', reference: '', proofUrl: '' })
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const selected = monitors.find((m) => m.id === selectedId) || null

  const apiFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${session.access_token}`)
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    return fetch(url, { ...init, headers })
  }, [session.access_token])

  const loadMonitors = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await apiFetch('/api/monitors')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Impossible de charger les moniteurs.')
      setMonitors(Array.isArray(payload.monitors) ? payload.monitors : [])
      setApiError(''); setLastUpdated(new Date())
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Serveur indisponible.') }
    finally { if (!silent) setLoading(false) }
  }, [apiFetch])

  const loadAccount = useCallback(async () => {
    try {
      const response = await apiFetch('/api/account')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Compte indisponible.')
      setAccount(data)
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Compte indisponible.') }
  }, [apiFetch])

  const loadIncidents = useCallback(async () => {
    try {
      const response = await apiFetch('/api/incidents')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Historique des incidents indisponible.')
      setIncidents(Array.isArray(data.incidents) ? data.incidents : [])
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Incidents indisponibles.') }
  }, [apiFetch])

  useEffect(() => { if (section === 'incidents') void loadIncidents() }, [section, loadIncidents])

  const submitPaymentRequest = async (event: FormEvent) => {
    event.preventDefault(); setPaymentBusy(true); setPaymentMessage(''); setApiError('')
    try {
      const response = await apiFetch('/api/payment-requests', { method: 'POST', body: JSON.stringify(paymentForm) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Demande impossible.')
      setPaymentMessage(data.message || 'Demande envoyée.')
      setPaymentForm({ ...paymentForm, reference: '', proofUrl: '' })
      await loadAccount()
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Demande impossible.') }
    finally { setPaymentBusy(false) }
  }

  useEffect(() => {
    void loadMonitors()
    void loadAccount()
    // Le serveur effectue les contrôles. Le navigateur ne déclenche que la lecture.
    const timer = window.setInterval(() => void loadMonitors(true), 30000)
    return () => window.clearInterval(timer)
  }, [loadMonitors, loadAccount])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const sync = () => setSection(window.location.pathname.startsWith('/monitors') ? 'monitors' : 'overview')
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  useEffect(() => {
    if (!selected) { setChecks([]); return }
    let active = true
    void apiFetch(`/api/monitors/${selected.id}/checks`).then(async (r) => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Historique indisponible')
      if (active) setChecks(data.checks || [])
    }).catch((e) => { if (active) setApiError(e.message) })
    return () => { active = false }
  }, [selected?.id, apiFetch])

  const stats = useMemo(() => {
    const active = monitors.filter((m) => m.status !== 'paused')
    const up = monitors.filter((m) => m.status === 'up').length
    const down = monitors.filter((m) => m.status === 'down').length
    const uptime = active.length ? active.reduce((sum, m) => sum + m.uptime, 0) / active.length : 0
    const latency = active.filter((m) => m.response > 0)
    const response = latency.length ? latency.reduce((sum, m) => sum + m.response, 0) / latency.length : 0
    return { up, down, paused: monitors.length - active.length, uptime, response }
  }, [monitors])
  const visible = monitors.filter((m) => `${m.name} ${m.url} ${m.type}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || m.status === filter))

  const navigate = (next: Section) => {
    const path = next === 'monitors' ? '/monitors' : next === 'overview' ? '/' : `/${next}`
    window.history.pushState({}, '', path); setSection(next); setMobileOpen(false); setSelectedId(null)
  }
  const submitAdd = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setApiError('')
    try {
      const response = await apiFetch('/api/monitors', { method: 'POST', body: JSON.stringify(form) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Création impossible.')
      setShowAdd(false); setForm(emptyForm); await loadMonitors(true); setToast('Moniteur ajouté et premier contrôle lancé.')
    } catch (e) { setApiError(e instanceof Error ? e.message : 'Création impossible.') }
    finally { setBusy(false) }
  }
  const openEdit = () => {
    if (!selected) return
    setEditForm({ name: selected.name, url: selected.url, type: selected.type, interval: selected.interval })
    setShowEdit(true)
  }
  const submitEdit = async (event: FormEvent) => {
    event.preventDefault(); if (!selected) return
    setBusy(true); setApiError('')
    try {
      const response = await apiFetch(`/api/monitors/${selected.id}`, { method: 'PATCH', body: JSON.stringify(editForm) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Modification impossible.')
      setShowEdit(false); await loadMonitors(true); setToast('Configuration mise à jour.')
    } catch (e) { setApiError(e instanceof Error ? e.message : 'Modification impossible.') }
    finally { setBusy(false) }
  }
  const togglePause = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const action = selected.status === 'paused' ? 'resume' : 'pause'
      const response = await apiFetch(`/api/monitors/${selected.id}/${action}`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Action impossible.')
      await loadMonitors(true); setToast(action === 'pause' ? 'Moniteur mis en pause.' : 'Moniteur repris et vérifié.')
    } catch (e) { setApiError(e instanceof Error ? e.message : 'Action impossible.') }
    finally { setBusy(false) }
  }
  const checkOne = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/monitors/${selected.id}/check`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Contrôle impossible.')
      await loadMonitors(true); setToast(data.result?.status === 'up' ? 'Le service répond correctement.' : 'Le service ne répond pas correctement.')
    } catch (e) { setApiError(e instanceof Error ? e.message : 'Contrôle impossible.') }
    finally { setBusy(false) }
  }
  const deleteMonitor = async () => {
    if (!selected || !window.confirm(`Supprimer « ${selected.name} » et son historique ?`)) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/monitors/${selected.id}`, { method: 'DELETE' })
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Suppression impossible.') }
      setSelectedId(null); await loadMonitors(true); setToast('Moniteur supprimé.')
    } catch (e) { setApiError(e instanceof Error ? e.message : 'Suppression impossible.') }
    finally { setBusy(false) }
  }

  const table = (items: Monitor[]) => items.length ? <div className="table-wrap"><table><thead><tr><th>MONITEUR</th><th>ÉTAT</th><th>UPTIME (30 J)</th><th>RÉPONSE</th><th>DERNIÈRE VÉRIFICATION</th><th /></tr></thead><tbody>{items.map((m) => <tr key={m.id} onClick={() => setSelectedId(m.id)}><td><div className="monitor-name-cell"><div className={`monitor-symbol monitor-symbol-${m.status}`}><Globe2 size={16} /></div><div><strong>{m.name}</strong><span>{m.url}</span></div></div></td><td><StatusBadge status={m.status} /></td><td><div className="uptime-cell"><strong>{m.uptime.toFixed(2)}%</strong><div className="uptime-track"><span className={m.status === 'down' ? 'track-red' : ''} style={{ width: `${m.uptime}%` }} /></div></div></td><td><strong>{m.response ? `${m.response} ms` : '—'}</strong></td><td><span className="last-check">{m.lastCheck}</span></td><td><button className="row-chevron" onClick={(e) => { e.stopPropagation(); setSelectedId(m.id) }} aria-label={`Ouvrir ${m.name}`}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div> : <div className="empty-state"><Search size={24} /><strong>{monitors.length ? 'Aucun résultat.' : 'Aucun moniteur configuré.'}</strong><span>{monitors.length ? 'Modifie tes filtres ou ta recherche.' : 'Ajoute ton premier site pour commencer.'}</span></div>

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu" />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><span /></div><div><div className="brand-name">mzouti<span>uptime</span></div><div className="brand-caption">simple. fiable. visible.</div></div></div>
      <div className="workspace-switcher"><span className="workspace-avatar">M</span><span className="workspace-copy"><strong>Mzouti Workspace</strong><small>Monitoring réel</small></span><ChevronDown size={15} /></div>
      <div className="nav-label">Monitoring</div>
      <nav className="main-nav">
        <button className={`nav-item ${section === 'overview' ? 'nav-active' : ''}`} onClick={() => navigate('overview')}><LayoutDashboard size={18} /> Vue d’ensemble</button>
        <button className={`nav-item ${section === 'monitors' ? 'nav-active' : ''}`} onClick={() => navigate('monitors')}><MonitorDot size={18} /> Moniteurs <span className="nav-pill">{monitors.length}</span></button>
        <button className={`nav-item ${section === 'incidents' ? 'nav-active' : ''}`} onClick={() => navigate('incidents')}><AlertTriangle size={18} /> Incidents <span className="nav-pill nav-pill-warning">{stats.down}</span></button>
      </nav>
      <div className="nav-label nav-label-spaced">Configuration</div>
      <nav className="main-nav"><button className={`nav-item ${section === 'settings' ? 'nav-active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18} /> Paramètres</button></nav>
      <div className="sidebar-bottom"><div className="upgrade-card"><div className="upgrade-icon"><ShieldCheck size={16} /></div><strong>Monitoring actif</strong><p>Les contrôles sont exécutés côté serveur, même sans dashboard ouvert.</p></div><div className="sidebar-user"><div className="user-avatar">{(session.user.email?.[0] || 'M').toUpperCase()}</div><div><strong>{session.user.email || 'Utilisateur'}</strong><small>Compte sécurisé</small></div><button className="sign-out-button" onClick={onSignOut}>Sortir</button></div></div>
    </aside>
    <div className="page-shell">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{section === 'overview' ? 'Vue d’ensemble' : section === 'monitors' ? 'Moniteurs' : section === 'incidents' ? 'Incidents' : 'Paramètres'}</strong></div></div><div className="topbar-actions"><div className="live-indicator"><span className="live-dot" /> Robot serveur actif</div><div className="topbar-avatar">M</div></div></header>
      <main className="content">
        {apiError && <div className="api-alert"><AlertTriangle size={16} /><span>{apiError}</span><button onClick={() => { setApiError(''); void loadMonitors() }}><RefreshCw size={14} /> Réessayer</button></div>}
        {section === 'overview' && <>
          <section className="page-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> MONITORING CENTER</div><h1>Bonjour, Mzouti <span className="wave">✦</span></h1><p>État réel de tes services surveillés.</p></div><div className="intro-actions"><div className="updated-copy"><span>Dernière lecture</span><strong>{lastUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div><button className="button button-secondary" onClick={() => void loadMonitors()}><RefreshCw size={16} /> Actualiser</button><button className="button button-primary" onClick={() => setShowAdd(true)}><Plus size={17} /> Ajouter</button></div></section>
          <section className="stats-grid"><div className="stat-card stat-card-featured"><div className="stat-topline"><span>Moniteurs actifs</span><MonitorDot size={16} /></div><div className="stat-value">{stats.up + stats.down}<span className="stat-total"> / {monitors.length}</span></div><div className="stat-foot"><span className="positive">{stats.up} opérationnel(s)</span><span>contrôles réels</span></div></div><div className="stat-card"><div className="stat-topline"><span>Uptime moyen</span><ShieldCheck size={16} /></div><div className="stat-value">{stats.uptime.toFixed(2)}<span className="stat-unit">%</span></div><div className="stat-foot"><span>calculé sur 30 jours</span></div></div><div className="stat-card"><div className="stat-topline"><span>Temps de réponse</span><Gauge size={16} /></div><div className="stat-value">{stats.response ? Math.round(stats.response) : '—'}<span className="stat-unit">{stats.response ? ' ms' : ''}</span></div><div className="stat-foot"><span>moyenne des réponses</span></div></div><div className="stat-card stat-card-alert"><div className="stat-topline"><span>Incidents ouverts</span><AlertTriangle size={16} /></div><div className="stat-value">{stats.down}</div><div className="stat-foot"><span>{stats.paused} en pause</span></div></div></section>
          <section className="panel monitor-panel"><div className="panel-heading panel-heading-list"><div><h2>Services surveillés</h2><p>Dernier état connu de chaque moniteur.</p></div><button className="text-button" onClick={() => navigate('monitors')}>Tout voir <ChevronRight size={15} /></button></div>{loading ? <div className="empty-state"><RefreshCw className="spin-icon" size={24} /><strong>Chargement...</strong></div> : table(monitors.slice(0, 6))}</section>
        </>}
        {section === 'monitors' && <section className="monitors-page"><section className="page-intro monitors-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> MONITORING CENTER</div><h1>Tous les moniteurs</h1><p>Gestion, configuration et contrôles manuels.</p>{account && <p className="quota-line">Forfait {account.subscription.label} · {account.usage.monitors}/{account.usage.limit} moniteurs utilisés</p>}</div><button className="button button-primary" disabled={!!account && account.usage.remaining <= 0} onClick={() => setShowAdd(true)}><Plus size={17} /> Ajouter un moniteur</button></section><div className="monitors-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un moniteur..." /></div><div className="filter-group"><span>État :</span>{(['all', 'up', 'down', 'paused'] as const).map((v) => <button key={v} className={`filter-chip ${filter === v ? 'filter-active' : ''}`} onClick={() => setFilter(v)}>{v === 'all' ? 'Tous' : v === 'up' ? 'Opérationnels' : v === 'down' ? 'En panne' : 'En pause'}</button>)}</div></div><div className="panel monitor-panel full-monitor-panel">{loading ? <div className="empty-state">Chargement...</div> : table(visible)}</div></section>}
        {section === 'incidents' && <section className="monitors-page"><section className="page-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> MONITORING CENTER</div><h1>Incidents</h1><p>Historique des pannes et rétablissements détectés.</p></div></section><div className="panel monitor-panel"><div className="panel-heading"><div><h2>Historique des incidents</h2><p>Jusqu’aux 200 derniers événements.</p></div><button className="text-button" onClick={() => void loadIncidents()}><RefreshCw size={14} /> Actualiser</button></div>{incidents.length ? <div className="incident-list">{incidents.map((incident) => <div className="incident-row" key={incident.id}><span className={`incident-state ${incident.resolved_at ? 'incident-resolved' : 'incident-open'}`} /> <div><strong>{incident.monitors?.name || `Moniteur #${incident.monitor_id}`}</strong><small>{incident.monitors?.url || ''}</small><p>{incident.cause || 'Échec du contrôle'}</p></div><div className="incident-times"><strong>{incident.resolved_at ? 'Résolu' : 'En cours'}</strong><span>{new Date(incident.started_at).toLocaleString('fr-FR')}</span>{incident.resolved_at && <span>Fin : {new Date(incident.resolved_at).toLocaleString('fr-FR')}</span>}</div></div>)}</div> : <div className="empty-state"><CheckCircle2 size={24} /><strong>Aucun incident enregistré.</strong><span>Les incidents apparaîtront après une panne détectée.</span></div>}</div></section>}
        {section === 'settings' && <section className="monitors-page"><section className="page-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> WORKSPACE</div><h1>Paramètres</h1><p>Configuration de ton espace de surveillance.</p></div></section><div className="panel monitor-panel">
          <div className="panel-heading"><div><h2>Compte et forfait</h2><p>{session.user.email}</p></div><ShieldCheck size={22} /></div>
          {account ? <><div className="plan-summary"><div><span>Forfait actuel</span><strong>{account.subscription.label}</strong><small>{account.subscription.status === 'active' ? 'Actif' : account.subscription.status}</small></div><div><span>Moniteurs utilisés</span><strong>{account.usage.monitors} / {account.usage.limit}</strong><small>{account.usage.remaining} restant(s)</small></div><div><span>Historique inclus</span><strong>{account.subscription.historyDays} jours</strong><small>Fréquence min. {Math.round(account.subscription.minInterval / 60)} min</small></div></div>
          <div className="plan-grid">{account.plans.map((plan) => <div className={`plan-card ${plan.code === account.subscription.planCode ? 'plan-current' : ''}`} key={plan.code}><strong>{plan.label}</strong><b>{plan.monitors} moniteurs</b><span>{plan.historyDays} jours d’historique</span><span>Intervalle min. {Math.round(plan.minInterval / 60)} min</span>{plan.code === account.subscription.planCode && <small>Forfait actuel</small>}</div>)}</div>
          <div className="detail-section"><div className="detail-section-title"><h3>Demander un forfait payant</h3><span>Activation après validation</span></div><p className="payment-help">Les paiements sont vérifiés manuellement pour le moment. N’indique jamais ton code PIN ni ton mot de passe de paiement.</p>
          <div className="payment-destinations"><div><strong>NatCash</strong><span>{account.paymentMethods.natcash.recipient}</span><b>{account.paymentMethods.natcash.phone}</b></div><div><strong>Meru Tag</strong><b>{account.paymentMethods.meru.tag}</b></div></div>
          <form className="payment-form" onSubmit={submitPaymentRequest}><div className="form-row"><label>Forfait<select value={paymentForm.planCode} onChange={(e) => setPaymentForm({ ...paymentForm, planCode: e.target.value })}><option value="starter">Starter</option><option value="pro">Pro</option><option value="business">Business</option></select></label><label>Période<select value={paymentForm.billingPeriod} onChange={(e) => setPaymentForm({ ...paymentForm, billingPeriod: e.target.value })}><option value="monthly">Mensuelle</option><option value="annual">Annuelle</option></select></label></div><div className="form-row"><label>Paiement<select value={paymentForm.provider} onChange={(e) => setPaymentForm({ ...paymentForm, provider: e.target.value })}><option value="natcash">NatCash</option><option value="meru">Meru</option></select></label><label>Devise<select value={paymentForm.currency} onChange={(e) => setPaymentForm({ ...paymentForm, currency: e.target.value })}><option value="HTG">HTG</option><option value="USD">USD</option></select></label></div><div className="form-row"><label>Montant payé<input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} required /></label><label>Référence transaction<input value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} maxLength={160} required /></label></div><label>Lien de preuve HTTPS (facultatif)<input type="url" placeholder="https://..." value={paymentForm.proofUrl} onChange={(e) => setPaymentForm({ ...paymentForm, proofUrl: e.target.value })} /></label><button className="button button-primary" disabled={paymentBusy}>{paymentBusy ? 'Envoi...' : 'Envoyer la demande de vérification'}</button>{paymentMessage && <p className="payment-success">{paymentMessage}</p>}</form></div>
          <div className="detail-section"><div className="detail-section-title"><h3>Historique des demandes</h3></div>{account.payments.length ? <div className="config-list">{account.payments.map((payment) => <div key={payment.id}><span>{payment.provider.toUpperCase()} · {payment.billing_period === 'annual' ? 'Annuel' : 'Mensuel'} · {payment.amount} {payment.currency}</span><strong>{payment.status === 'pending' ? 'En attente' : payment.status === 'approved' ? 'Approuvé' : 'Refusé'}</strong></div>)}</div> : <p className="payment-help">Aucune demande de paiement.</p>}</div></> : <div className="empty-state"><RefreshCw className="spin-icon" size={20} />Chargement du compte...</div>}
          <div className="config-list"><div><span>Authentification</span><strong>Supabase Auth</strong></div><div><span>Isolation des données</span><strong>RLS activé</strong></div><div><span>Contrôles automatiques</span><strong>Serveur — 30 secondes</strong></div><div><span>Support</span><strong><a href="mailto:marcododji284@gmail.com">marcododji284@gmail.com</a></strong></div></div>
          <p className="detail-footer-note">Les alertes email ne sont pas activées. Les demandes NatCash et Meru restent en attente jusqu’à vérification par un administrateur.</p>
        </div></section>}
      </main>
      <footer className="footer"><span>© 2026 Mzouti Uptime</span><span>by <strong>Mzouti</strong> — All Right reserved</span><span className="footer-links">Monitoring réel</span></footer>
    </div>
    {selected && <div className="detail-overlay" onClick={() => setSelectedId(null)}><aside className="detail-panel" onClick={(e) => e.stopPropagation()}><div className="detail-header"><button className="detail-back" onClick={() => setSelectedId(null)}>Fermer <X size={16} /></button><button className="icon-button detail-more" onClick={() => void checkOne()} disabled={busy} aria-label="Vérifier maintenant"><RefreshCw size={17} /></button></div><div className="detail-hero"><div className={`detail-symbol detail-symbol-${selected.status}`}><Globe2 size={23} /></div><div><div className="detail-eyebrow">{selected.type} MONITOR</div><h2>{selected.name}</h2><a href={selected.url} target="_blank" rel="noreferrer">{selected.url} <ExternalLink size={12} /></a></div></div><StatusBadge status={selected.status} /><div className="detail-metrics"><div><span>Uptime (30 jours)</span><strong>{selected.uptime.toFixed(2)}%</strong></div><div><span>Réponse moyenne</span><strong>{selected.response || '—'}<small>{selected.response ? ' ms' : ''}</small></strong></div><div><span>Dernière vérification</span><strong className="metric-small">{selected.lastCheck}</strong></div></div><div className="detail-section"><div className="detail-section-title"><h3>Historique de disponibilité</h3><span>{checks.length} contrôles</span></div><div className="detail-chart"><Chart values={selected.chart} /></div><div className="history-list">{checks.slice(0, 12).map((c, i) => <div className="history-row" key={`${c.checkedAt}-${i}`}><span className={`mini-status-dot ${c.status === 'up' ? 'mini-up' : 'mini-down'}`} /><span>{new Date(c.checkedAt).toLocaleString('fr-FR')}</span><strong>{c.status === 'up' ? 'OK' : c.error || `HTTP ${c.statusCode || 'erreur'}`}</strong><small>{c.responseMs ? `${c.responseMs} ms` : '—'}</small></div>)}{!checks.length && <p className="detail-footer-note">Aucun contrôle enregistré sur les 30 derniers jours.</p>}</div></div><div className="detail-section detail-config"><div className="detail-section-title"><h3>Configuration</h3><button onClick={openEdit}><Settings2 size={14} /> Modifier</button></div><div className="config-list"><div><span><Zap size={14} /> Fréquence</span><strong>Chaque {selected.interval}</strong></div><div><span><Activity size={14} /> Type</span><strong>{selected.type}</strong></div><div><span><Bell size={14} /> Notifications</span><strong>Non configurées</strong></div></div></div><div className="detail-actions"><button className="button button-secondary" disabled={busy} onClick={() => void togglePause()}>{selected.status === 'paused' ? <PlayCircle size={15} /> : <PauseCircle size={15} />}{selected.status === 'paused' ? 'Reprendre' : 'Mettre en pause'}</button><button className="button button-primary" disabled={busy || selected.status === 'paused'} onClick={() => void checkOne()}><RefreshCw size={15} /> Vérifier</button></div><button className="delete-monitor-button" disabled={busy} onClick={() => void deleteMonitor()}><Trash2 size={15} /> Supprimer ce moniteur</button></aside></div>}
    {showAdd && <div className="modal-backdrop" onClick={() => setShowAdd(false)}><div className="add-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="modal-kicker"><Plus size={14} /> NOUVEAU MONITEUR</div><h2>Ajouter un moniteur</h2><p>Un premier contrôle réel sera lancé.</p></div><button className="modal-close" onClick={() => setShowAdd(false)}><X size={19} /></button></div><form onSubmit={submitAdd}><label>Nom<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></label><label>URL ou hôte<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={form.type === 'PORT' ? 'tcp://example.com:443' : 'https://example.com'} required /></label><div className="form-row"><label>Type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Monitor['type'] })}><option>HTTP</option><option>PING</option><option>PORT</option></select></label><label>Fréquence<select value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })}><option>1 min</option><option>5 min</option><option>10 min</option><option>15 min</option></select></label></div><div className="modal-note"><ShieldCheck size={16} /><span>Les données sont enregistrées dans ton espace Supabase privé.</span></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowAdd(false)}>Annuler</button><button className="button button-primary" disabled={busy}>{busy ? 'Création...' : 'Créer et vérifier'}</button></div></form></div></div>}
    {showEdit && selected && <div className="modal-backdrop" onClick={() => setShowEdit(false)}><div className="add-modal" onClick={(e) => e.stopPropagation()}><div className="modal-header"><div><div className="modal-kicker"><Settings2 size={14} /> CONFIGURATION</div><h2>Modifier le moniteur</h2><p>Les modifications sont sauvegardées dans Supabase.</p></div><button className="modal-close" onClick={() => setShowEdit(false)}><X size={19} /></button></div><form onSubmit={submitEdit}><label>Nom<input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required maxLength={120} /></label><label>URL ou hôte<input value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} required /></label><div className="form-row"><label>Type<select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value as Monitor['type'] })}><option>HTTP</option><option>PING</option><option>PORT</option></select></label><label>Fréquence<select value={editForm.interval} onChange={(e) => setEditForm({ ...editForm, interval: e.target.value })}><option>1 min</option><option>5 min</option><option>10 min</option><option>15 min</option></select></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowEdit(false)}>Annuler</button><button className="button button-primary" disabled={busy}>{busy ? 'Enregistrement...' : 'Enregistrer'}</button></div></form></div></div>}
    {toast && <div className="toast"><Check size={16} /> {toast}</div>}
  </div>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setReady(true) } })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setReady(true) })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    const syncPath = () => setPath(window.location.pathname)
    window.addEventListener('popstate', syncPath)
    return () => window.removeEventListener('popstate', syncPath)
  }, [])
  if (!ready) return <div className="auth-loading"><RefreshCw className="spin-icon" size={22} /> Vérification de la session...</div>
  if (session) return <Dashboard session={session} onSignOut={() => { void supabase.auth.signOut() }} />
  if (path === '/login' || path === '/signup') return <AuthScreen initialMode={path === '/signup' ? 'signup' : 'login'} />
  return <LandingPage />
}
