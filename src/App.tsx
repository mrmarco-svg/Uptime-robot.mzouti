import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  Gauge,
  Globe2,
  LayoutDashboard,
  Menu,
  MonitorDot,
  MoreHorizontal,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'

type Status = 'up' | 'down' | 'paused'
type Section = 'overview' | 'monitors'

type Monitor = {
  id: number
  name: string
  url: string
  type: 'HTTP' | 'PING' | 'PORT'
  status: Status
  uptime: number
  response: number
  lastCheck: string
  lastCheckAt: string | null
  interval: string
  intervalSeconds: number
  location: string
  tags: string[]
  chart: number[]
}

function Sparkline({ values, tone = 'blue' }: { values: number[]; tone?: 'blue' | 'green' | 'orange' }) {
  if (!values.length) return <div className="sparkline-empty" />
  const points = values.map((value, index) => `${(index / (values.length - 1 || 1)) * 100},${100 - value}`).join(' ')
  return <svg className={`sparkline sparkline-${tone}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function Chart({ values, color = '#6575f2', fill = '#6575f2' }: { values: number[]; color?: string; fill?: string }) {
  const coords = values.length ? values.map((value, index) => `${(index / (values.length - 1 || 1)) * 700},${190 - value * 1.68}`).join(' ') : ''
  const area = values.length ? `0,190 ${coords} 700,190` : ''
  return <svg className="main-chart" viewBox="0 0 700 200" preserveAspectRatio="none" role="img" aria-label={values.length ? 'Historique des contrôles réels' : 'Aucune donnée de contrôle disponible'}>
    <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={fill} stopOpacity=".24" /><stop offset="100%" stopColor={fill} stopOpacity="0" /></linearGradient></defs>
    {[30, 80, 130, 180].map((y) => <line key={y} x1="0" x2="700" y1={y} y2={y} className="chart-grid" />)}
    {values.length > 1 && <><polygon points={area} fill="url(#chart-fill)" /><polyline points={coords} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="700" cy={190 - values[values.length - 1] * 1.68} r="5" fill={color} className="chart-dot" /></>}
    {!values.length && <text x="350" y="105" textAnchor="middle" fill="#a7afbd" fontSize="11">Les contrôles apparaîtront ici après le premier check</text>}
  </svg>
}

function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  const labels: Record<Status, string> = { up: 'Opérationnel', down: 'En panne', paused: 'En pause' }
  const icons = { up: CheckCircle2, down: AlertTriangle, paused: PauseCircle }
  const Icon = icons[status]
  return <span className={`status-badge status-${status} ${compact ? 'status-compact' : ''}`}><Icon size={compact ? 13 : 14} strokeWidth={2.2} />{!compact && labels[status]}</span>
}

function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [section, setSection] = useState<Section>(() => window.location.pathname.startsWith('/monitors') ? 'monitors' : 'overview')
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')
  const [toast, setToast] = useState('')
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [form, setForm] = useState({ name: '', url: '', type: 'HTTP' as Monitor['type'], interval: '5 min' })

  const selected = monitors.find((monitor) => monitor.id === selectedId) ?? null
  const stats = useMemo(() => {
    const active = monitors.filter((monitor) => monitor.status !== 'paused')
    const up = monitors.filter((monitor) => monitor.status === 'up').length
    const down = monitors.filter((monitor) => monitor.status === 'down').length
    const uptime = active.reduce((sum, monitor) => sum + monitor.uptime, 0) / (active.length || 1)
    const response = active.filter((monitor) => monitor.response > 0).reduce((sum, monitor) => sum + monitor.response, 0) / (active.filter((monitor) => monitor.response > 0).length || 1)
    return { up, down, uptime: active.length ? uptime : 0, response: active.some((monitor) => monitor.response > 0) ? response : 0 }
  }, [monitors])

  const visibleMonitors = monitors.filter((monitor) => {
    const matchesQuery = `${monitor.name} ${monitor.url} ${monitor.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'all' || monitor.status === filter
    return matchesQuery && matchesFilter
  })
  const globalChart = monitors.flatMap((monitor) => monitor.chart).slice(-24)
  const ringStyle = monitors.length ? { background: `conic-gradient(var(--green) 0deg ${(stats.up / monitors.length) * 360}deg, var(--red) ${(stats.up / monitors.length) * 360}deg ${((stats.up + stats.down) / monitors.length) * 360}deg, #e6a04f ${((stats.up + stats.down) / monitors.length) * 360}deg 360deg)` } : { background: '#e9edf4' }

  const loadMonitors = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await apiFetch('/api/monitors')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Impossible de charger les moniteurs')
      setMonitors(payload.monitors)
      setApiError('')
      setLastUpdated(new Date())
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Le serveur de monitoring est indisponible')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const runChecks = async (force = false) => {
    setIsRefreshing(true)
    try {
      const response = await apiFetch(`/api/monitors/check-all${force ? '?force=1' : ''}`, { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Le contrôle n’a pas pu être exécuté')
      await loadMonitors(true)
      setToast(payload.checked ? `${payload.checked} contrôle${payload.checked > 1 ? 's' : ''} réel${payload.checked > 1 ? 's' : ''} effectué${payload.checked > 1 ? 's' : ''}` : 'Aucun contrôle n’était dû')
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Le serveur de monitoring est indisponible')
    } finally {
      setIsRefreshing(false)
    }
  }

  const apiFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${session.access_token}`)
    return fetch(input, { ...init, headers })
  }

  useEffect(() => {
    void loadMonitors()
    const interval = window.setInterval(() => { void runChecks() }, 30000)
    return () => window.clearInterval(interval)
  }, [session.access_token])

  useEffect(() => {
    const syncSection = () => setSection(window.location.pathname.startsWith('/monitors') ? 'monitors' : 'overview')
    window.addEventListener('popstate', syncSection)
    return () => window.removeEventListener('popstate', syncSection)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const response = await apiFetch('/api/monitors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Impossible de créer le moniteur')
      setMonitors((current) => [payload.monitor, ...current])
      setForm({ name: '', url: '', type: 'HTTP', interval: '5 min' })
      setShowModal(false)
      setToast(`${payload.monitor.name} a été vérifié et ajouté`)
      setLastUpdated(new Date())
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Impossible de créer le moniteur')
    }
  }

  const removeMonitor = async (id: number) => {
    if (!window.confirm('Supprimer ce moniteur et son historique de contrôles ?')) return
    try {
      const response = await apiFetch(`/api/monitors/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Impossible de supprimer ce moniteur')
      setMonitors((current) => current.filter((monitor) => monitor.id !== id))
      setSelectedId(null)
      setToast('Moniteur supprimé')
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Impossible de supprimer le moniteur') }
  }

  const navigate = (next: Section) => {
    const nextPath = next === 'monitors' ? '/monitors' : '/'
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
    setSection(next)
    setMobileOpen(false)
  }

  return <div className="app-shell">
    {mobileOpen && <button className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu" />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><span /></div><div><div className="brand-name">mzouti<span>uptime</span></div><div className="brand-caption">simple. fiable. visible.</div></div></div>
      <div className="workspace-switcher"><span className="workspace-avatar">M</span><span className="workspace-copy"><strong>Mzouti Workspace</strong><small>Monitoring réel</small></span><ChevronDown size={15} /></div>
      <div className="nav-label">Monitoring</div>
      <nav className="main-nav">
        <button className={section === 'overview' ? 'nav-item nav-active' : 'nav-item'} onClick={() => navigate('overview')}><LayoutDashboard size={18} /> Vue d’ensemble <span className="nav-pill">{monitors.length}</span></button>
        <button className={section === 'monitors' ? 'nav-item nav-active' : 'nav-item'} onClick={() => navigate('monitors')}><MonitorDot size={18} /> Moniteurs <span className="nav-pill nav-pill-muted">{monitors.length}</span></button>
        <button className="nav-item" onClick={() => setToast('Les incidents sont calculés à partir des contrôles réels')}><AlertTriangle size={18} /> Incidents <span className="nav-pill nav-pill-warning">{stats.down}</span></button>
      </nav>
      <div className="nav-label nav-label-spaced">Configuration</div>
      <nav className="main-nav"><button className="nav-item" onClick={() => setToast('Les notifications seront disponibles prochainement')}><Bell size={18} /> Notifications</button><button className="nav-item" onClick={() => setToast('Paramètres de workspace')}><Settings2 size={18} /> Paramètres</button></nav>
      <div className="sidebar-bottom"><div className="upgrade-card"><div className="upgrade-icon"><Sparkles size={16} /></div><strong>Plus de visibilité</strong><p>Ajoutez des contrôles depuis plusieurs régions avec le plan Pro.</p><button onClick={() => setToast('Votre espace est prêt pour plusieurs régions')}>Voir le plan <ArrowUpRight size={14} /></button></div><div className="sidebar-user"><div className="user-avatar">{(session.user.email?.[0] || 'M').toUpperCase()}</div><div><strong>{session.user.email || 'Utilisateur'}</strong><small>Compte sécurisé</small></div><button className="sign-out-button" onClick={onSignOut}>Sortir</button></div></div>
    </aside>

    <div className="page-shell">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{section === 'overview' ? 'Vue d’ensemble' : 'Moniteurs'}</strong></div></div><div className="topbar-actions"><div className="live-indicator"><span className="live-dot" /> Contrôles réels actifs</div><button className="icon-button" onClick={() => setToast('Aucune notification non lue')} aria-label="Notifications"><Bell size={18} /><i /></button><div className="topbar-avatar">M</div></div></header>
      <main className="content">
        {apiError && <div className="api-alert"><AlertTriangle size={16} /><span>{apiError}</span><button onClick={() => { setApiError(''); void loadMonitors() }}><RefreshCw size={14} /> Réessayer</button></div>}
        {section === 'overview' ? <>
          <section className="page-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> MONITORING CENTER</div><h1>Bonjour, Mzouti <span className="wave">✦</span></h1><p>Vos données proviennent maintenant de contrôles réseau réels.</p></div><div className="intro-actions"><div className="updated-copy"><span>Dernière mise à jour</span><strong>{lastUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div><button className={`button button-secondary refresh-button ${isRefreshing ? 'is-refreshing' : ''}`} onClick={() => void runChecks(true)}><RefreshCw size={16} /> Vérifier maintenant</button><button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} /> Ajouter un moniteur</button></div></section>
          <section className="stats-grid"><div className="stat-card stat-card-featured"><div className="stat-topline"><span>Moniteurs actifs</span><span className="stat-icon"><MonitorDot size={16} /></span></div><div className="stat-value">{stats.up + stats.down}<span className="stat-total"> / {monitors.length}</span></div><div className="stat-foot"><span className="positive"><CheckCircle2 size={14} /> {monitors.length ? `${stats.up} opérationnel${stats.up > 1 ? 's' : ''}` : 'Aucun moniteur'}</span><span>contrôles réels</span></div><div className="stat-visual stat-visual-blue"><Sparkline values={globalChart} /></div></div><div className="stat-card"><div className="stat-topline"><span>Uptime global</span><span className="stat-icon stat-icon-green"><ShieldCheck size={16} /></span></div><div className="stat-value">{stats.uptime.toFixed(2)}<span className="stat-unit">%</span></div><div className="stat-foot"><span className={stats.uptime >= 99 ? 'positive' : 'negative'}>{monitors.length ? `${stats.uptime.toFixed(2)}% calculé` : '— aucune donnée'}</span><span>sur 30 jours</span></div><div className="stat-visual stat-visual-green"><Sparkline values={globalChart} tone="green" /></div></div><div className="stat-card"><div className="stat-topline"><span>Temps de réponse</span><span className="stat-icon stat-icon-orange"><Gauge size={16} /></span></div><div className="stat-value">{stats.response || '—'}<span className="stat-unit">{stats.response ? 'ms' : ''}</span></div><div className="stat-foot"><span className="positive"><Clock3 size={14} /> {stats.response ? 'moyenne réelle' : 'en attente'}</span><span>sur les checks</span></div><div className="stat-visual stat-visual-orange"><Sparkline values={globalChart} tone="orange" /></div></div><div className="stat-card stat-card-alert"><div className="stat-topline"><span>Incidents ouverts</span><span className="stat-icon stat-icon-red"><AlertTriangle size={16} /></span></div><div className="stat-value">{stats.down}<span className="stat-unit"> actif{stats.down > 1 ? 's' : ''}</span></div><div className="stat-foot"><span className={stats.down ? 'negative' : 'positive'}>{stats.down ? 'À résoudre' : 'Aucun incident'}</span><span>détecté en réel</span></div><div className="incident-progress"><span style={{ width: monitors.length ? `${(stats.down / monitors.length) * 100}%` : '0%' }} /></div></div></section>
          <section className="dashboard-grid"><div className="panel performance-panel"><div className="panel-heading"><div><h2>Performance globale</h2><p>Historique issu des contrôles enregistrés</p></div><div className="range-select"><CalendarDays size={15} /> 30 jours <ChevronDown size={14} /></div></div><div className="chart-legend"><span><i className="legend-dot legend-blue" /> Disponibilité <strong>{monitors.length ? `${stats.uptime.toFixed(2)}%` : '—'}</strong></span><span><i className="legend-dot legend-purple" /> Réponse moyenne <strong>{stats.response ? `${Math.round(stats.response)} ms` : '—'}</strong></span><button className="chart-more"><MoreHorizontal size={18} /></button></div><div className="chart-wrap"><div className="chart-y-labels"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><Chart values={globalChart} /></div><div className="chart-x-labels"><span>Début</span><span>Historique</span><span>Aujourd’hui</span></div></div><div className="panel status-panel"><div className="panel-heading"><div><h2>État des services</h2><p>Statut issu du dernier contrôle</p></div><button className="panel-link" onClick={() => navigate('monitors')}>Tout voir <ArrowUpRight size={14} /></button></div><div className="status-ring-row"><div className="status-ring" style={ringStyle}><div><strong>{stats.up}</strong><span>sur {monitors.length}</span></div></div><div className="status-summary"><div><i className="summary-dot summary-up" /><span>Opérationnels</span><strong>{stats.up}</strong></div><div><i className="summary-dot summary-down" /><span>En panne</span><strong>{stats.down}</strong></div><div><i className="summary-dot summary-paused" /><span>En pause</span><strong>{monitors.filter((m) => m.status === 'paused').length}</strong></div></div></div><div className="mini-status-list">{monitors.slice(0, 3).map((monitor) => <button key={monitor.id} className="mini-status" onClick={() => setSelectedId(monitor.id)}><span className={`mini-status-dot mini-${monitor.status}`} /><span>{monitor.name}</span><strong>{monitor.status === 'paused' ? '—' : monitor.response ? `${monitor.response} ms` : '—'}</strong><ChevronRight size={15} /></button>)}{!monitors.length && <div className="mini-empty">Ajoutez votre premier moniteur pour commencer les contrôles.</div>}</div></div></section>
          <section className="panel monitor-panel"><div className="panel-heading panel-heading-list"><div><h2>Vos moniteurs</h2><p>Chaque ligne est alimentée par un contrôle réseau réel</p></div><div className="list-heading-actions"><button className="text-button" onClick={() => navigate('monitors')}>Voir tous les moniteurs <ArrowUpRight size={15} /></button><button className="button button-primary button-small" onClick={() => setShowModal(true)}><Plus size={15} /> Ajouter</button></div></div>{loading ? <div className="empty-state"><RefreshCw className="spin-icon" size={24} /><strong>Connexion au serveur de monitoring...</strong><span>Lecture de votre base de données.</span></div> : <MonitorTable monitors={monitors.slice(0, 4)} onSelect={setSelectedId} empty="Aucun moniteur configuré." />}</section>
        </> : <section className="monitors-page"><section className="page-intro monitors-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> MONITORING CENTER</div><h1>Tous les moniteurs</h1><p>Les résultats affichés viennent directement de votre serveur de monitoring.</p></div><button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} /> Ajouter un moniteur</button></section><div className="monitors-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un moniteur..." /></div><div className="filter-group"><SlidersHorizontal size={16} /><span>État :</span>{(['all', 'up', 'down', 'paused'] as const).map((value) => <button key={value} className={filter === value ? 'filter-chip filter-active' : 'filter-chip'} onClick={() => setFilter(value)}>{value === 'all' ? 'Tous' : value === 'up' ? 'Opérationnels' : value === 'down' ? 'En panne' : 'En pause'}</button>)}</div></div><div className="panel monitor-panel full-monitor-panel"><div className="list-summary"><span><strong>{visibleMonitors.length}</strong> moniteur{visibleMonitors.length > 1 ? 's' : ''} affiché{visibleMonitors.length > 1 ? 's' : ''}</span><span className="list-live"><span className="live-dot" /> Contrôles actifs</span></div><MonitorTable monitors={visibleMonitors} onSelect={setSelectedId} empty={query || filter !== 'all' ? 'Aucun moniteur ne correspond à vos critères.' : 'Aucun moniteur configuré.'} /></div></section>}
      </main>
      <footer className="footer"><span>© 2026 Mzouti Uptime</span><span>by <strong>Mzouti</strong> — All Right reserved</span><span className="footer-links"><button onClick={() => setToast('Documentation bientôt disponible')}>Documentation</button><button onClick={() => setToast('Centre d’aide bientôt disponible')}>Centre d’aide</button></span></footer>
    </div>
    {selected && <DetailPanel monitor={selected} onClose={() => setSelectedId(null)} onToast={setToast} onDelete={() => void removeMonitor(selected.id)} />}
    {showModal && <div className="modal-backdrop" onClick={() => setShowModal(false)}><div className="add-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="modal-kicker"><Plus size={14} /> NOUVEAU MONITEUR</div><h2>Ajouter un moniteur</h2><p>Le premier contrôle réel est lancé immédiatement.</p></div><button className="modal-close" onClick={() => setShowModal(false)} aria-label="Fermer"><X size={19} /></button></div><form onSubmit={handleAdd}><label>Nom du moniteur<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="ex. Site principal" required /></label><label>URL ou hôte à surveiller<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder={form.type === 'PORT' ? 'tcp://example.com:443' : form.type === 'PING' ? 'example.com' : 'https://votre-site.com'} required /></label><div className="form-row"><label>Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as Monitor['type'] })}><option>HTTP</option><option>PING</option><option>PORT</option></select></label><label>Fréquence<select value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value })}><option>1 min</option><option>5 min</option><option>10 min</option><option>15 min</option></select></label></div><div className="modal-note"><ShieldCheck size={16} /><span>Les résultats et l’historique seront stockés dans votre base gérée.</span></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowModal(false)}>Annuler</button><button type="submit" className="button button-primary"><Plus size={16} /> Créer et vérifier</button></div></form></div></div>}
    {toast && <div className="toast"><Check size={16} /> {toast}</div>}
  </div>
}

function MonitorTable({ monitors, onSelect, empty }: { monitors: Monitor[]; onSelect: (id: number) => void; empty?: string }) {
  if (!monitors.length) return <div className="empty-state"><Search size={24} /><strong>{empty ?? 'Aucun moniteur pour le moment.'}</strong><span>Ajoutez une URL, un hôte ou un port pour commencer.</span></div>
  return <div className="table-wrap"><table><thead><tr><th>MONITEUR</th><th>ÉTAT</th><th>UPTIME (30 J)</th><th>RÉPONSE</th><th>DERNIÈRE VÉRIFICATION</th><th /></tr></thead><tbody>{monitors.map((monitor) => <tr key={monitor.id} onClick={() => onSelect(monitor.id)}><td><div className="monitor-name-cell"><div className={`monitor-symbol monitor-symbol-${monitor.status}`}><Globe2 size={16} /></div><div><strong>{monitor.name}</strong><span>{monitor.url}</span></div></div></td><td><StatusBadge status={monitor.status} /></td><td><div className="uptime-cell"><strong>{monitor.uptime ? `${monitor.uptime.toFixed(2)}%` : '—'}</strong><div className="uptime-track"><span className={monitor.status === 'down' ? 'track-red' : ''} style={{ width: `${monitor.uptime}%` }} /></div></div></td><td><strong className={monitor.status === 'down' ? 'response-bad' : ''}>{monitor.response ? `${monitor.response} ms` : '—'}</strong></td><td><span className="last-check">{monitor.lastCheck}</span></td><td><button className="row-chevron" onClick={(event) => { event.stopPropagation(); onSelect(monitor.id) }} aria-label={`Voir ${monitor.name}`}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div>
}

function DetailPanel({ monitor, onClose, onToast, onDelete }: { monitor: Monitor; onClose: () => void; onToast: (message: string) => void; onDelete: () => void }) {
  return <div className="detail-overlay" onClick={onClose}><aside className="detail-panel" onClick={(event) => event.stopPropagation()}><div className="detail-header"><button className="detail-back" onClick={onClose}><ChevronRight size={17} /> Fermer</button><button className="icon-button detail-more" onClick={() => onToast('Options du moniteur')}><MoreHorizontal size={18} /></button></div><div className="detail-hero"><div className={`detail-symbol detail-symbol-${monitor.status}`}><Globe2 size={23} /></div><div><div className="detail-eyebrow">{monitor.type} MONITOR</div><h2>{monitor.name}</h2><a href={monitor.url} onClick={(event) => event.preventDefault()}>{monitor.url} <ExternalLink size={12} /></a></div></div><StatusBadge status={monitor.status} /><div className="detail-metrics"><div><span>Uptime (30 jours)</span><strong className={monitor.status === 'down' ? 'metric-red' : ''}>{monitor.uptime ? `${monitor.uptime.toFixed(2)}%` : '—'}</strong></div><div><span>Réponse moyenne</span><strong>{monitor.response || '—'}<small>{monitor.response ? ' ms' : ''}</small></strong></div><div><span>Dernière vérification</span><strong className="metric-small">{monitor.lastCheck}</strong></div></div><div className="detail-section"><div className="detail-section-title"><h3>Historique de disponibilité</h3><span>Derniers contrôles</span></div><div className="detail-chart"><Chart values={monitor.chart} color={monitor.status === 'down' ? '#ee6f70' : '#6575f2'} fill={monitor.status === 'down' ? '#ee6f70' : '#6575f2'} /></div><div className="detail-chart-labels"><span>Plus ancien</span><span>Plus récent</span></div></div><div className="detail-section detail-config"><div className="detail-section-title"><h3>Configuration</h3><button onClick={() => onToast('Édition de configuration bientôt disponible')}><Settings2 size={14} /> Modifier</button></div><div className="config-list"><div><span><Zap size={14} /> Fréquence</span><strong>Chaque {monitor.interval}</strong></div><div><span><Server size={14} /> Région de contrôle</span><strong>{monitor.location}</strong></div><div><span><Bell size={14} /> Notifications</span><strong className="config-enabled"><Check size={13} /> Activées</strong></div></div></div><div className="detail-footer-note"><CircleHelp size={15} /> Contrôles effectués depuis le serveur Mzouti.</div><button className="delete-monitor-button" onClick={onDelete}>Supprimer ce moniteur</button></aside></div>
}

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true); setError(''); setMessage('')
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    if (result.error) setError(result.error.message)
    else if (mode === 'signup' && !result.data.session) setMessage('Compte créé. Vérifie ton adresse email pour activer la connexion.')
    setPending(false)
  }

  const resetPassword = async () => {
    if (!email) return setError('Indique ton email pour recevoir le lien de réinitialisation.')
    setResetPending(true); setError(''); setMessage('')
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (resetError) setError(resetError.message)
    else setMessage('Un lien de réinitialisation vient d’être envoyé à ton adresse email.')
    setResetPending(false)
  }

  return <div className="auth-shell"><div className="auth-card"><div className="auth-brand"><div className="brand-mark"><span /></div><div><div className="brand-name">mzouti<span>uptime</span></div><div className="brand-caption">simple. fiable. visible.</div></div></div><div className="auth-kicker"><ShieldCheck size={14} /> ESPACE SÉCURISÉ</div><h1>{mode === 'login' ? 'Bon retour.' : 'Créer ton espace.'}</h1><p className="auth-lead">Surveille tes sites avec des contrôles réels, associés à ton compte.</p><form onSubmit={submit} className="auth-form"><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" required /></label><label>Mot de passe<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6 caractères minimum" required /></label>{mode === 'login' && <button type="button" className="forgot-password" onClick={() => void resetPassword()} disabled={resetPending}>{resetPending ? 'Envoi...' : 'Mot de passe oublié ?'}</button>}{error && <div className="auth-message auth-error"><AlertTriangle size={15} />{error}</div>}{message && <div className="auth-message auth-success"><CheckCircle2 size={15} />{message}</div>}<button className="button button-primary auth-submit" disabled={pending || resetPending}>{pending ? <RefreshCw className="spin-icon" size={16} /> : <ShieldCheck size={16} />}{pending ? 'Connexion...' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'Créer un compte' : 'J’ai déjà un compte'}</button><div className="auth-note">Tes moniteurs sont privés et protégés par les règles RLS de Supabase.</div></div></div>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setAuthReady(true) } })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setAuthReady(true) })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  if (!authReady) return <div className="auth-loading"><RefreshCw className="spin-icon" size={22} /> Vérification de la session...</div>
  if (!session) return <AuthScreen />
  return <Dashboard session={session} onSignOut={() => { void supabase.auth.signOut() }} />
}

export default App
