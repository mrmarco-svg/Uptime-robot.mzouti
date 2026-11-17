import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Activity,
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
  Cloud,
  ExternalLink,
  Gauge,
  Globe2,
  LayoutDashboard,
  ListFilter,
  Menu,
  MoreHorizontal,
  MonitorDot,
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
  interval: string
  location: string
  tags: string[]
  chart: number[]
}

const initialMonitors: Monitor[] = [
  {
    id: 1,
    name: 'Site principal',
    url: 'https://mzouti.com',
    type: 'HTTP',
    status: 'up',
    uptime: 99.99,
    response: 184,
    lastCheck: 'il y a 18 s',
    interval: '5 min',
    location: 'Paris, FR',
    tags: ['Production', 'Public'],
    chart: [72, 76, 73, 78, 75, 81, 84, 82, 86, 90, 88, 94, 91, 96, 94, 98, 96],
  },
  {
    id: 2,
    name: 'API clients',
    url: 'https://api.mzouti.com/health',
    type: 'HTTP',
    status: 'up',
    uptime: 99.97,
    response: 246,
    lastCheck: 'il y a 32 s',
    interval: '5 min',
    location: 'Amsterdam, NL',
    tags: ['Production', 'API'],
    chart: [84, 83, 87, 82, 86, 89, 84, 90, 88, 92, 89, 94, 91, 93, 96, 92, 95],
  },
  {
    id: 3,
    name: 'Portail admin',
    url: 'https://admin.mzouti.com',
    type: 'HTTP',
    status: 'down',
    uptime: 98.42,
    response: 1240,
    lastCheck: 'il y a 1 min',
    interval: '1 min',
    location: 'Londres, UK',
    tags: ['Incident', 'Admin'],
    chart: [92, 94, 93, 90, 91, 89, 88, 83, 81, 78, 79, 72, 70, 64, 67, 58, 54],
  },
  {
    id: 4,
    name: 'Docs publiques',
    url: 'https://docs.mzouti.com',
    type: 'PING',
    status: 'up',
    uptime: 99.91,
    response: 92,
    lastCheck: 'il y a 44 s',
    interval: '10 min',
    location: 'Francfort, DE',
    tags: ['Public', 'Docs'],
    chart: [68, 72, 71, 76, 73, 79, 77, 80, 84, 82, 87, 85, 89, 90, 93, 92, 95],
  },
  {
    id: 5,
    name: 'Webhook paiement',
    url: 'https://hooks.mzouti.com',
    type: 'PORT',
    status: 'paused',
    uptime: 100,
    response: 0,
    lastCheck: 'en pause',
    interval: '15 min',
    location: 'New York, US',
    tags: ['Test'],
    chart: [76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76, 76],
  },
]

const availabilityHistory = [96, 97, 96, 98, 97, 99, 98, 99, 98, 99, 99, 99, 100, 99, 100, 100, 100, 100, 100, 100, 100, 99, 100, 100]
const responseHistory = [238, 224, 252, 218, 242, 202, 194, 210, 188, 178, 205, 192, 172, 184, 176, 168, 190, 181, 165, 174, 168, 161, 172, 164]

function Sparkline({ values, tone = 'blue' }: { values: number[]; tone?: 'blue' | 'green' | 'orange' | 'red' }) {
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - value}`).join(' ')
  return (
    <svg className={`sparkline sparkline-${tone}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Chart({ values, color = '#6575f2', fill = '#6575f2' }: { values: number[]; color?: string; fill?: string }) {
  const coords = values.map((value, index) => `${(index / (values.length - 1)) * 700},${190 - value * 1.68}`).join(' ')
  const area = `0,190 ${coords} 700,190`
  return (
    <svg className="main-chart" viewBox="0 0 700 200" preserveAspectRatio="none" role="img" aria-label="Graphique des performances">
      <defs>
        <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity=".24" />
          <stop offset="100%" stopColor={fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 80, 130, 180].map((y) => <line key={y} x1="0" x2="700" y1={y} y2={y} className="chart-grid" />)}
      <polygon points={area} fill="url(#chart-fill)" />
      <polyline points={coords} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="700" cy={190 - values[values.length - 1] * 1.68} r="5" fill={color} className="chart-dot" />
    </svg>
  )
}

function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  const labels: Record<Status, string> = { up: 'Opérationnel', down: 'En panne', paused: 'En pause' }
  const icons = { up: CheckCircle2, down: AlertTriangle, paused: PauseCircle }
  const Icon = icons[status]
  return (
    <span className={`status-badge status-${status} ${compact ? 'status-compact' : ''}`}>
      <Icon size={compact ? 13 : 14} strokeWidth={2.2} />
      {!compact && labels[status]}
    </span>
  )
}

function App() {
  const [section, setSection] = useState<Section>(() => window.location.pathname.startsWith('/monitors') ? 'monitors' : 'overview')
  const [monitors, setMonitors] = useState<Monitor[]>(initialMonitors)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [toast, setToast] = useState('')
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [form, setForm] = useState({ name: '', url: '', type: 'HTTP' as Monitor['type'], interval: '5 min' })

  const selected = monitors.find((monitor) => monitor.id === selectedId) ?? null
  const stats = useMemo(() => {
    const active = monitors.filter((monitor) => monitor.status !== 'paused')
    const up = monitors.filter((monitor) => monitor.status === 'up').length
    const down = monitors.filter((monitor) => monitor.status === 'down').length
    const uptime = active.reduce((sum, monitor) => sum + monitor.uptime, 0) / (active.length || 1)
    const response = active.reduce((sum, monitor) => sum + monitor.response, 0) / (active.length || 1)
    return { up, down, uptime, response }
  }, [monitors])

  const visibleMonitors = monitors.filter((monitor) => {
    const matchesQuery = `${monitor.name} ${monitor.url} ${monitor.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'all' || monitor.status === filter
    return matchesQuery && matchesFilter
  })

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMonitors((current) => current.map((monitor) => monitor.status === 'paused' ? monitor : {
        ...monitor,
        response: Math.max(62, monitor.response + Math.round((Math.random() - .5) * 28)),
        lastCheck: 'à l’instant',
      }))
      setLastUpdated(new Date())
    }, 8000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    const syncSection = () => setSection(window.location.pathname.startsWith('/monitors') ? 'monitors' : 'overview')
    window.addEventListener('popstate', syncSection)
    return () => window.removeEventListener('popstate', syncSection)
  }, [])

  const refresh = () => {
    setIsRefreshing(true)
    window.setTimeout(() => {
      setMonitors((current) => current.map((monitor) => monitor.status === 'paused' ? monitor : {
        ...monitor,
        response: Math.max(62, monitor.response + Math.round((Math.random() - .5) * 36)),
        lastCheck: 'à l’instant',
      }))
      setLastUpdated(new Date())
      setIsRefreshing(false)
      setToast('Les données ont été actualisées')
    }, 650)
  }

  const handleAdd = (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim() || !form.url.trim()) return
    const newMonitor: Monitor = {
      id: Date.now(),
      name: form.name.trim(),
      url: form.url.trim(),
      type: form.type,
      status: 'up',
      uptime: 100,
      response: 128,
      lastCheck: 'à l’instant',
      interval: form.interval,
      location: 'Paris, FR',
      tags: ['Nouveau'],
      chart: [72, 76, 75, 79, 78, 83, 84, 88, 86, 90, 92, 91, 94, 95, 94, 98, 97],
    }
    setMonitors((current) => [newMonitor, ...current])
    setForm({ name: '', url: '', type: 'HTTP', interval: '5 min' })
    setShowModal(false)
    setToast(`${newMonitor.name} a été ajouté`)
  }

  const navigate = (next: Section) => {
    const nextPath = next === 'monitors' ? '/monitors' : '/'
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath)
    setSection(next)
    setMobileOpen(false)
  }

  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu" />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span /></div>
          <div>
            <div className="brand-name">mzouti<span>uptime</span></div>
            <div className="brand-caption">simple. fiable. visible.</div>
          </div>
        </div>

        <button className="workspace-switcher">
          <span className="workspace-avatar">M</span>
          <span className="workspace-copy"><strong>Mzouti Workspace</strong><small>Plan Pro</small></span>
          <ChevronDown size={15} />
        </button>

        <div className="nav-label">Monitoring</div>
        <nav className="main-nav">
          <button className={section === 'overview' ? 'nav-item nav-active' : 'nav-item'} onClick={() => navigate('overview')}>
            <LayoutDashboard size={18} /> Vue d’ensemble <span className="nav-pill">5</span>
          </button>
          <button className={section === 'monitors' ? 'nav-item nav-active' : 'nav-item'} onClick={() => navigate('monitors')}>
            <MonitorDot size={18} /> Moniteurs <span className="nav-pill nav-pill-muted">{monitors.length}</span>
          </button>
          <button className="nav-item" onClick={() => setToast('Les incidents seront disponibles dans la prochaine version')}>
            <AlertTriangle size={18} /> Incidents <span className="nav-pill nav-pill-warning">1</span>
          </button>
        </nav>

        <div className="nav-label nav-label-spaced">Configuration</div>
        <nav className="main-nav">
          <button className="nav-item" onClick={() => setToast('Les intégrations arrivent bientôt')}><Bell size={18} /> Notifications</button>
          <button className="nav-item" onClick={() => setToast('Paramètres de workspace')}><Settings2 size={18} /> Paramètres</button>
        </nav>

        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-icon"><Sparkles size={16} /></div>
            <strong>Plus de visibilité</strong>
            <p>Ajoutez des régions de contrôle avec le plan Pro.</p>
            <button onClick={() => setToast('Votre espace est déjà sur le plan Pro')}>Voir le plan <ArrowUpRight size={14} /></button>
          </div>
          <div className="sidebar-user">
            <div className="user-avatar">M</div>
            <div><strong>Mzouti</strong><small>Administrateur</small></div>
            <MoreHorizontal size={17} className="user-more" />
          </div>
        </div>
      </aside>

      <div className="page-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><Menu size={20} /></button>
            <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{section === 'overview' ? 'Vue d’ensemble' : 'Moniteurs'}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="live-indicator"><span className="live-dot" /> Tous les systèmes opérationnels</div>
            <button className="icon-button" onClick={() => setToast('Aucune notification non lue')} aria-label="Notifications"><Bell size={18} /><i /></button>
            <div className="topbar-avatar">M</div>
          </div>
        </header>

        <main className="content">
          {section === 'overview' ? (
            <>
              <section className="page-intro">
                <div>
                  <div className="eyebrow"><span className="eyebrow-line" /> MONITORING CENTER</div>
                  <h1>Bonjour, Mzouti <span className="wave">✦</span></h1>
                  <p>Voici ce qui se passe sur vos services aujourd’hui.</p>
                </div>
                <div className="intro-actions">
                  <div className="updated-copy"><span>Dernière mise à jour</span><strong>{lastUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
                  <button className={`button button-secondary refresh-button ${isRefreshing ? 'is-refreshing' : ''}`} onClick={refresh}><RefreshCw size={16} /> Actualiser</button>
                  <button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} /> Ajouter un moniteur</button>
                </div>
              </section>

              <section className="stats-grid">
                <div className="stat-card stat-card-featured">
                  <div className="stat-topline"><span>Moniteurs actifs</span><span className="stat-icon"><MonitorDot size={16} /></span></div>
                  <div className="stat-value">{stats.up + stats.down}<span className="stat-total"> / {monitors.length}</span></div>
                  <div className="stat-foot"><span className="positive"><ArrowUpRight size={14} /> 20% ce mois</span><span>services suivis</span></div>
                  <div className="stat-visual stat-visual-blue"><Sparkline values={[42, 48, 45, 55, 53, 63, 61, 70, 67, 74, 78, 82]} /></div>
                </div>
                <div className="stat-card">
                  <div className="stat-topline"><span>Uptime global</span><span className="stat-icon stat-icon-green"><ShieldCheck size={16} /></span></div>
                  <div className="stat-value">{stats.uptime.toFixed(2)}<span className="stat-unit">%</span></div>
                  <div className="stat-foot"><span className="positive"><ArrowUpRight size={14} /> 0.04%</span><span>vs. mois dernier</span></div>
                  <div className="stat-visual stat-visual-green"><Sparkline values={[60, 63, 62, 66, 65, 70, 73, 71, 78, 80, 84, 86]} tone="green" /></div>
                </div>
                <div className="stat-card">
                  <div className="stat-topline"><span>Temps de réponse</span><span className="stat-icon stat-icon-orange"><Gauge size={16} /></span></div>
                  <div className="stat-value">{Math.round(stats.response)}<span className="stat-unit">ms</span></div>
                  <div className="stat-foot"><span className="positive"><ArrowDownRight size={14} /> 8.6%</span><span>plus rapide</span></div>
                  <div className="stat-visual stat-visual-orange"><Sparkline values={[76, 70, 74, 68, 63, 66, 58, 62, 54, 57, 50, 46]} tone="orange" /></div>
                </div>
                <div className="stat-card stat-card-alert">
                  <div className="stat-topline"><span>Incidents ouverts</span><span className="stat-icon stat-icon-red"><AlertTriangle size={16} /></span></div>
                  <div className="stat-value">{stats.down}<span className="stat-unit"> actif</span></div>
                  <div className="stat-foot"><span className="negative"><Clock3 size={14} /> Depuis 14 min</span><span>à résoudre</span></div>
                  <div className="incident-progress"><span style={{ width: stats.down ? '34%' : '0%' }} /></div>
                </div>
              </section>

              <section className="dashboard-grid">
                <div className="panel performance-panel">
                  <div className="panel-heading">
                    <div><h2>Performance globale</h2><p>Disponibilité et temps de réponse sur les dernières 24 heures</p></div>
                    <div className="range-select"><CalendarDays size={15} /> 24 heures <ChevronDown size={14} /></div>
                  </div>
                  <div className="chart-legend"><span><i className="legend-dot legend-blue" /> Disponibilité <strong>99,84%</strong></span><span><i className="legend-dot legend-purple" /> Réponse moyenne <strong>186 ms</strong></span><button className="chart-more"><MoreHorizontal size={18} /></button></div>
                  <div className="chart-wrap"><div className="chart-y-labels"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><Chart values={availabilityHistory} /></div>
                  <div className="chart-x-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>Maintenant</span></div>
                </div>

                <div className="panel status-panel">
                  <div className="panel-heading"><div><h2>État des services</h2><p>Vue instantanée de vos moniteurs</p></div><button className="panel-link" onClick={() => navigate('monitors')}>Tout voir <ArrowUpRight size={14} /></button></div>
                  <div className="status-ring-row"><div className="status-ring"><div><strong>{stats.up}</strong><span>sur {monitors.length}</span></div></div><div className="status-summary"><div><i className="summary-dot summary-up" /><span>Opérationnels</span><strong>{stats.up}</strong></div><div><i className="summary-dot summary-down" /><span>En panne</span><strong>{stats.down}</strong></div><div><i className="summary-dot summary-paused" /><span>En pause</span><strong>{monitors.filter((m) => m.status === 'paused').length}</strong></div></div></div>
                  <div className="mini-status-list">{monitors.slice(0, 3).map((monitor) => <button key={monitor.id} className="mini-status" onClick={() => setSelectedId(monitor.id)}><span className={`mini-status-dot mini-${monitor.status}`} /><span>{monitor.name}</span><strong>{monitor.status === 'paused' ? '—' : `${monitor.response} ms`}</strong><ChevronRight size={15} /></button>)}</div>
                </div>
              </section>

              <section className="panel monitor-panel">
                <div className="panel-heading panel-heading-list"><div><h2>Vos moniteurs</h2><p>Les services que vous surveillez actuellement</p></div><div className="list-heading-actions"><button className="text-button" onClick={() => navigate('monitors')}>Voir tous les moniteurs <ArrowUpRight size={15} /></button><button className="button button-primary button-small" onClick={() => setShowModal(true)}><Plus size={15} /> Ajouter</button></div></div>
                <MonitorTable monitors={monitors.slice(0, 4)} onSelect={setSelectedId} />
              </section>
            </>
          ) : (
            <section className="monitors-page">
              <section className="page-intro monitors-intro"><div><div className="eyebrow"><span className="eyebrow-line" /> MONITORING CENTER</div><h1>Tous les moniteurs</h1><p>Gardez un œil sur chaque point de contact de votre infrastructure.</p></div><button className="button button-primary" onClick={() => setShowModal(true)}><Plus size={17} /> Ajouter un moniteur</button></section>
              <div className="monitors-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un moniteur..." /></div><div className="filter-group"><SlidersHorizontal size={16} /><span>État :</span>{(['all', 'up', 'down', 'paused'] as const).map((value) => <button key={value} className={filter === value ? 'filter-chip filter-active' : 'filter-chip'} onClick={() => setFilter(value)}>{value === 'all' ? 'Tous' : value === 'up' ? 'Opérationnels' : value === 'down' ? 'En panne' : 'En pause'}</button>)}</div></div>
              <div className="panel monitor-panel full-monitor-panel"><div className="list-summary"><span><strong>{visibleMonitors.length}</strong> moniteur{visibleMonitors.length > 1 ? 's' : ''} affiché{visibleMonitors.length > 1 ? 's' : ''}</span><span className="list-live"><span className="live-dot" /> Données en direct</span></div><MonitorTable monitors={visibleMonitors} onSelect={setSelectedId} empty={query || filter !== 'all' ? 'Aucun moniteur ne correspond à vos critères.' : undefined} /></div>
            </section>
          )}
        </main>

        <footer className="footer"><span>© 2026 Mzouti Uptime</span><span>by <strong>Mzouti</strong> — All Right reserved</span><span className="footer-links"><button onClick={() => setToast('Documentation bientôt disponible')}>Documentation</button><button onClick={() => setToast('Centre d’aide bientôt disponible')}>Centre d’aide</button></span></footer>
      </div>

      {selected && <DetailPanel monitor={selected} onClose={() => setSelectedId(null)} onToast={setToast} />}
      {showModal && <div className="modal-backdrop" onClick={() => setShowModal(false)}><div className="add-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="modal-kicker"><Plus size={14} /> NOUVEAU MONITEUR</div><h2>Ajouter un moniteur</h2><p>Commencez à suivre un endpoint en quelques secondes.</p></div><button className="modal-close" onClick={() => setShowModal(false)} aria-label="Fermer"><X size={19} /></button></div><form onSubmit={handleAdd}><label>Nom du moniteur<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="ex. Site principal" required /></label><label>URL à surveiller<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://votre-site.com" required /></label><div className="form-row"><label>Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as Monitor['type'] })}><option>HTTP</option><option>PING</option><option>PORT</option></select></label><label>Fréquence<select value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value })}><option>1 min</option><option>5 min</option><option>10 min</option><option>15 min</option></select></label></div><div className="modal-note"><ShieldCheck size={16} /><span>Votre premier contrôle sera lancé immédiatement après l’ajout.</span></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowModal(false)}>Annuler</button><button type="submit" className="button button-primary"><Plus size={16} /> Créer le moniteur</button></div></form></div></div>}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function MonitorTable({ monitors, onSelect, empty }: { monitors: Monitor[]; onSelect: (id: number) => void; empty?: string }) {
  if (!monitors.length) return <div className="empty-state"><Search size={24} /><strong>{empty ?? 'Aucun moniteur pour le moment.'}</strong><span>Essayez une autre recherche ou ajoutez un nouveau moniteur.</span></div>
  return <div className="table-wrap"><table><thead><tr><th>MONITEUR</th><th>ÉTAT</th><th>UPTIME (30 J)</th><th>RÉPONSE</th><th>DERNIÈRE VÉRIFICATION</th><th /></tr></thead><tbody>{monitors.map((monitor) => <tr key={monitor.id} onClick={() => onSelect(monitor.id)}><td><div className="monitor-name-cell"><div className={`monitor-symbol monitor-symbol-${monitor.status}`}><Globe2 size={16} /></div><div><strong>{monitor.name}</strong><span>{monitor.url}</span></div></div></td><td><StatusBadge status={monitor.status} /></td><td><div className="uptime-cell"><strong>{monitor.uptime.toFixed(2)}%</strong><div className="uptime-track"><span className={monitor.status === 'down' ? 'track-red' : ''} style={{ width: `${monitor.uptime}%` }} /></div></div></td><td><strong className={monitor.status === 'down' ? 'response-bad' : ''}>{monitor.response ? `${monitor.response} ms` : '—'}</strong></td><td><span className="last-check">{monitor.lastCheck}</span></td><td><button className="row-chevron" onClick={(event) => { event.stopPropagation(); onSelect(monitor.id) }} aria-label={`Voir ${monitor.name}`}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div>
}

function DetailPanel({ monitor, onClose, onToast }: { monitor: Monitor; onClose: () => void; onToast: (message: string) => void }) {
  return <div className="detail-overlay" onClick={onClose}><aside className="detail-panel" onClick={(event) => event.stopPropagation()}><div className="detail-header"><button className="detail-back" onClick={onClose}><ChevronRight size={17} /> Fermer</button><button className="icon-button detail-more" onClick={() => onToast('Options du moniteur')}><MoreHorizontal size={18} /></button></div><div className="detail-hero"><div className={`detail-symbol detail-symbol-${monitor.status}`}><Globe2 size={23} /></div><div><div className="detail-eyebrow">{monitor.type} MONITOR</div><h2>{monitor.name}</h2><a href={monitor.url} onClick={(event) => event.preventDefault()}>{monitor.url} <ExternalLink size={12} /></a></div></div><StatusBadge status={monitor.status} /><div className="detail-metrics"><div><span>Uptime (30 jours)</span><strong className={monitor.status === 'down' ? 'metric-red' : ''}>{monitor.uptime.toFixed(2)}%</strong></div><div><span>Réponse moyenne</span><strong>{monitor.response || '—'}<small>{monitor.response ? ' ms' : ''}</small></strong></div><div><span>Dernière vérification</span><strong className="metric-small">{monitor.lastCheck}</strong></div></div><div className="detail-section"><div className="detail-section-title"><h3>Historique de disponibilité</h3><span>30 derniers jours</span></div><div className="detail-chart"><Chart values={monitor.chart} color={monitor.status === 'down' ? '#ee6f70' : '#6575f2'} fill={monitor.status === 'down' ? '#ee6f70' : '#6575f2'} /></div><div className="detail-chart-labels"><span>01 mai</span><span>15 mai</span><span>Aujourd’hui</span></div></div><div className="detail-section detail-config"><div className="detail-section-title"><h3>Configuration</h3><button onClick={() => onToast('Édition de configuration bientôt disponible')}><Settings2 size={14} /> Modifier</button></div><div className="config-list"><div><span><Zap size={14} /> Fréquence</span><strong>Chaque {monitor.interval}</strong></div><div><span><Server size={14} /> Région de contrôle</span><strong>{monitor.location}</strong></div><div><span><Bell size={14} /> Notifications</span><strong className="config-enabled"><Check size={13} /> Activées</strong></div></div></div><div className="detail-footer-note"><CircleHelp size={15} /> Les données sont simulées pour cette démonstration.</div></aside></div>
}

export default App
