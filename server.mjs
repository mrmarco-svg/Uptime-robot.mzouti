import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createConnection, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { performance } from 'node:perf_hooks'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer as createViteServer } from 'vite'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.argv.includes('--dev')
const port = Number(process.env.PORT || 3000)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET || ''
const CHECK_INTERVAL_MS = 30000
const CHECK_TIMEOUT_MS = 12000
const PAGE_SIZE = 1000
const MAX_MONITORS = 10000
const PLAN_LIMITS = Object.freeze({
  free: { label: 'Free', monitors: 5, historyDays: 7, minInterval: 300 },
  starter: { label: 'Starter', monitors: 20, historyDays: 30, minInterval: 60 },
  pro: { label: 'Pro', monitors: 50, historyDays: 90, minInterval: 60 },
  business: { label: 'Business', monitors: 150, historyDays: 365, minInterval: 60 },
})
const ADMIN_USER_IDS = new Set(String(process.env.ADMIN_USER_IDS || '').split(',').map((v) => v.trim()).filter(Boolean))
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'marcododji284@gmail.com'
const intervals = { '1 min': 60, '5 min': 300, '10 min': 600, '15 min': 900 }
const allowedTypes = new Set(['HTTP', 'PING', 'PORT'])
const inFlight = new Set()

if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY sont obligatoires.')
if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY est obligatoire pour le monitoring serveur.')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '32kb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
  next()
})

const publicClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

function makeUserClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right)
}

const rateBuckets = new Map()
function rateLimit({ windowMs = 60000, max = 90 } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    let bucket = rateBuckets.get(key)
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs }
      rateBuckets.set(key, bucket)
    }
    bucket.count += 1
    res.setHeader('RateLimit-Limit', String(max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)))
    if (bucket.count > max) return res.status(429).json({ error: 'Trop de requêtes. Réessaie dans un instant.' })
    next()
  }
}
app.use('/api/', rateLimit())

async function authenticate(req, res, next) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)
  if (!match) return res.status(401).json({ error: 'Authentification requise.' })
  try {
    const { data, error } = await publicClient.auth.getUser(match[1])
    if (error || !data?.user?.id) return res.status(401).json({ error: 'Session invalide ou expirée.' })
    req.user = data.user
    req.db = makeUserClient(match[1])
    next()
  } catch {
    res.status(401).json({ error: 'Impossible de vérifier la session.' })
  }
}

function fail(res, error, status = 503) {
  const message = String(error?.message || 'Erreur interne.')
  if (status >= 500) console.error('[Mzouti Uptime]', message)
  return res.status(status).json({ error: status >= 500 ? 'Le service est temporairement indisponible.' : message })
}

function normalizeTarget(value, type) {
  const raw = String(value || '').trim()
  if (!raw || raw.length > 2048) throw new Error('Adresse invalide.')
  if (!allowedTypes.has(type)) throw new Error('Type de contrôle invalide.')
  const normalized = type === 'PING' && !raw.includes('://') ? `http://${raw}` : type === 'PORT' && !raw.includes('://') ? `tcp://${raw}` : raw
  const parsed = new URL(normalized)
  if (type === 'HTTP' && !['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTP nécessite une adresse http:// ou https://.')
  if (type === 'PING' && !['http:', 'https:'].includes(parsed.protocol)) throw new Error('PING nécessite un nom de domaine ou une adresse IP.')
  if (type === 'PORT' && parsed.protocol !== 'tcp:') throw new Error('PORT nécessite tcp://hote:port.')
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error('Hôte invalide.')
  if (type === 'PORT' && (!parsed.port || Number(parsed.port) < 1 || Number(parsed.port) > 65535)) throw new Error('Port invalide.')
  return { raw: normalized, parsed }
}

function isPublicAddress(address) {
  const version = isIP(address)
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 0 || b === 168)) return false
    if (a === 192 && b === 88 && c === 99) return false
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
    if (a === 203 && b === 0 && c === 113) return false
    return true
  }
  if (version === 6) {
    const value = address.toLowerCase()
    if (value.startsWith('::ffff:')) return isPublicAddress(value.slice(7))
    // Only globally-routable unicast 2000::/3; reject documentation and special-use blocks.
    const first = parseInt(value.split(':')[0] || '0', 16)
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false
    if (value.startsWith('2001:db8:') || value.startsWith('2001:10:') || value.startsWith('2001:20:')) return false
    return true
  }
  return false
}

async function resolvePublicHost(hostname) {
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error('Les adresses réseau privées ou réservées ne sont pas autorisées.')
    return hostname
  }
  const records = await lookup(hostname, { all: true, verbatim: true })
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error('Ce domaine pointe vers une adresse privée ou réservée et ne peut pas être surveillé.')
  }
  return records[0].address
}

function checkHttp(target, address) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(target)
    const transport = parsed.protocol === 'https:' ? https : http
    const started = performance.now()
    let settled = false
    const request = transport.request(parsed, {
      method: 'GET', agent: false, servername: parsed.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)),
      headers: { 'User-Agent': 'Mzouti-Uptime/2.1', Accept: '*/*' },
    }, (response) => {
      const statusCode = response.statusCode || 0
      response.resume()
      settled = true
      resolve({ status: statusCode >= 200 && statusCode < 400 ? 'up' : 'down', statusCode,
        responseMs: Math.max(1, Math.round(performance.now() - started)), error: statusCode >= 400 ? `HTTP ${statusCode}` : null })
    })
    request.setTimeout(CHECK_TIMEOUT_MS, () => request.destroy(new Error('Délai de réponse dépassé.')))
    request.on('error', (error) => { if (!settled) reject(error) })
    request.end()
  })
}

async function checkPing(address) {
  const started = performance.now()
  const { stdout } = await execFileAsync('ping', ['-c', '1', '-W', '4', address], { timeout: 6000 })
  const match = stdout.match(/time[=<]([\d.]+)/)
  return { status: 'up', statusCode: null,
    responseMs: match ? Math.max(1, Math.round(Number(match[1]))) : Math.max(1, Math.round(performance.now() - started)), error: null }
}

function checkPort(address, portNumber) {
  const started = performance.now()
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address, port: portNumber, timeout: 8000 })
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve({ status: 'up', statusCode: null, responseMs: Math.max(1, Math.round(performance.now() - started)), error: null })
    }
    socket.once('connect', () => finish())
    socket.once('timeout', () => finish(new Error('Délai de connexion dépassé.')))
    socket.once('error', finish)
  })
}

async function executeCheck(monitor, db = adminClient) {
  if (!db) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante.')
  const key = String(monitor.id)
  if (inFlight.has(key)) return { skipped: true, reason: 'already-running' }
  inFlight.add(key)
  try {
    if (monitor.status === 'paused') return { skipped: true, reason: 'paused' }
    const { parsed } = normalizeTarget(monitor.url, monitor.monitor_type)
    const address = await resolvePublicHost(parsed.hostname)
    let result
    if (monitor.monitor_type === 'PING') result = await checkPing(address)
    else if (monitor.monitor_type === 'PORT') result = await checkPort(address, Number(parsed.port))
    else result = await checkHttp(parsed.href, address)
    const { error: insertError } = await db.from('monitor_checks').insert({ monitor_id: monitor.id,
      result_status: result.status, status_code: result.statusCode, response_ms: result.responseMs, error_message: result.error })
    if (insertError) throw insertError
    const { error: updateError } = await db.from('monitors').update({ status: result.status, response_ms: result.responseMs,
      last_check_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', monitor.id).neq('status', 'paused')
    if (updateError) throw updateError
    return result
  } catch (error) {
    const result = { status: 'down', statusCode: null, responseMs: null, error: String(error?.message || 'Échec du contrôle').slice(0, 500) }
    const { error: insertError } = await db.from('monitor_checks').insert({ monitor_id: monitor.id, result_status: 'down',
      status_code: null, response_ms: null, error_message: result.error })
    if (insertError) console.error('Unable to save failed check:', insertError.message)
    await db.from('monitors').update({ status: 'down', response_ms: null, last_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString() }).eq('id', monitor.id).neq('status', 'paused')
    return result
  } finally { inFlight.delete(key) }
}

async function readChecks(db, monitorId, since) {
  const all = []
  for (let offset = 0; offset < 50000; offset += PAGE_SIZE) {
    const { data, error } = await db.from('monitor_checks').select('result_status,status_code,response_ms,error_message,checked_at')
      .eq('monitor_id', monitorId).gte('checked_at', since).order('checked_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return all
}

function relativeTime(value) {
  if (!value) return 'jamais vérifié'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 5) return 'à l’instant'
  if (seconds < 60) return `il y a ${seconds} s`
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`
  return `il y a ${Math.round(seconds / 3600)} h`
}
function intervalLabel(seconds) {
  return Object.entries(intervals).find(([, value]) => value === Number(seconds))?.[0] || `${Math.round(Number(seconds) / 60)} min`
}

async function monitorPayload(row, db, historyDays = 30) {
  const since = new Date(Date.now() - historyDays * 86400000).toISOString()
  const checks = await readChecks(db, row.id, since)
  const responses = checks.filter((check) => check.response_ms != null).map((check) => Number(check.response_ms))
  const now = Date.now()
  let upMs = 0
  let measuredMs = 0
  for (let index = 0; index < checks.length; index += 1) {
    const check = checks[index]
    const from = Math.max(new Date(since).getTime(), new Date(check.checked_at).getTime())
    const next = checks[index + 1] ? new Date(checks[index + 1].checked_at).getTime() : Math.min(now, from + Number(row.interval_seconds || 300) * 1000)
    const duration = Math.max(0, next - from)
    measuredMs += duration
    if (check.result_status === 'up') upMs += duration
  }
  return { id: Number(row.id), name: row.name, url: row.url, type: row.monitor_type, status: row.status,
    uptime: measuredMs ? Number((upMs / measuredMs * 100).toFixed(2)) : 0,
    response: responses.length ? Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length) : 0,
    lastCheck: relativeTime(row.last_check_at), lastCheckAt: row.last_check_at,
    interval: intervalLabel(row.interval_seconds), intervalSeconds: Number(row.interval_seconds),
    location: 'Serveur Mzouti', tags: [row.monitor_type], chart: checks.slice(-120).map((check) => check.result_status === 'up' ? 100 : 12) }
}

async function getOwnedMonitor(db, id) {
  if (!/^\d+$/.test(String(id))) return null
  const { data, error } = await db.from('monitors').select('id,name,url,monitor_type,interval_seconds,status,response_ms,last_check_at,created_at')
    .eq('id', Number(id)).maybeSingle()
  if (error) throw error
  return data
}
async function listOwnedMonitors(db) {
  const { data, error } = await db.from('monitors').select('id,name,url,monitor_type,interval_seconds,status,response_ms,last_check_at,created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  const { data: subscription } = await db.from('subscriptions').select('plan_code').maybeSingle()
  const historyDays = PLAN_LIMITS[subscription?.plan_code || 'free']?.historyDays || 7
  return Promise.all((data || []).map((row) => monitorPayload(row, db, historyDays)))
}

async function checkDueMonitors(force = false) {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante : le robot automatique est désactivé.')
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await adminClient.from('monitors').select('id,name,url,monitor_type,interval_seconds,status,last_check_at')
      .neq('status', 'paused').order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  const now = Date.now()
  const due = (rows || []).filter((monitor) => force || !monitor.last_check_at ||
    now - new Date(monitor.last_check_at).getTime() >= Number(monitor.interval_seconds) * 1000)
  const results = []
  for (let i = 0; i < due.length; i += 8) {
    const batch = due.slice(i, i + 8)
    results.push(...await Promise.all(batch.map(async (monitor) => ({ id: Number(monitor.id), ...(await executeCheck(monitor, adminClient)) }))))
  }
  return { checked: results.filter((item) => !item.skipped).length, results, checkedAt: new Date().toISOString() }
}


async function getSubscription(userId) {
  if (!adminClient) throw new Error('Service de facturation non configuré.')
  const { data, error } = await adminClient.from('subscriptions').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (data) {
    const expired = data.plan_code !== 'free' && data.status === 'active' && data.current_period_end && new Date(data.current_period_end) <= new Date()
    if (expired) {
      const { data: downgraded, error: updateError } = await adminClient.from('subscriptions')
        .update({ plan_code: 'free', status: 'expired', current_period_start: null, current_period_end: null, updated_at: new Date().toISOString() })
        .eq('user_id', userId).select('*').single()
      if (updateError) throw updateError
      return downgraded
    }
    return data
  }
  const { error: createError } = await adminClient.from('subscriptions').upsert({
    user_id: userId, plan_code: 'free', status: 'active',
  }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (createError) throw createError
  const { data: created, error: readError } = await adminClient.from('subscriptions').select('*').eq('user_id', userId).single()
  if (readError) throw readError
  return created
}
async function accountPayload(userId) {
  const subscription = await getSubscription(userId)
  const plan = PLAN_LIMITS[subscription.plan_code] || PLAN_LIMITS.free
  const { count, error } = await adminClient.from('monitors').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  if (error) throw error
  const { data: payments, error: paymentError } = await adminClient.from('payment_requests')
    .select('id,provider,billing_period,amount,currency,reference,status,created_at,reviewed_at,admin_note')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(10)
  if (paymentError) throw paymentError
  return {
    email: SUPPORT_EMAIL,
    subscription: { planCode: subscription.plan_code, status: subscription.status, periodEnd: subscription.current_period_end, ...plan },
    usage: { monitors: count || 0, limit: plan.monitors, remaining: Math.max(0, plan.monitors - (count || 0)) },
    plans: Object.entries(PLAN_LIMITS).map(([code, value]) => ({ code, ...value })),
    paymentMethods: { natcash: { recipient: 'Mompremier Marc', phone: '+50941131299' }, meru: { tag: '$mzouti' } },
    payments: payments || [],
  }
}
app.get('/api/account', authenticate, async (req, res) => {
  try { res.json(await accountPayload(req.user.id)) } catch (error) { fail(res, error) }
})
app.post('/api/payment-requests', authenticate, async (req, res) => {
  try {
    if (!adminClient) return res.status(503).json({ error: 'La facturation serveur n’est pas configurée.' })
    const provider = String(req.body?.provider || '').toLowerCase()
    const period = String(req.body?.billingPeriod || '')
    const planCode = String(req.body?.planCode || '').toLowerCase()
    const reference = String(req.body?.reference || '').trim()
    const amount = Number(req.body?.amount)
    const currency = String(req.body?.currency || 'HTG').toUpperCase()
    const proofUrl = String(req.body?.proofUrl || '').trim()
    if (!['natcash', 'meru'].includes(provider)) return res.status(400).json({ error: 'Moyen de paiement invalide.' })
    if (!['monthly', 'annual'].includes(period)) return res.status(400).json({ error: 'Période invalide.' })
    if (!PLAN_LIMITS[planCode] || planCode === 'free') return res.status(400).json({ error: 'Forfait invalide.' })
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Montant invalide.' })
    if (!reference || reference.length > 160) return res.status(400).json({ error: 'La référence de transaction est obligatoire.' })
    if (proofUrl && (!/^https:\/\/\S+$/i.test(proofUrl) || proofUrl.length > 1000)) return res.status(400).json({ error: 'Le lien de preuve doit être une URL HTTPS valide.' })
    const { data, error } = await adminClient.from('payment_requests').insert({
      user_id: req.user.id, provider, plan_code: planCode, billing_period: period,
      amount, currency, reference, proof_url: proofUrl || null, status: 'pending',
    }).select('id,provider,plan_code,billing_period,amount,currency,reference,status,created_at').single()
    if (error) throw error
    res.status(201).json({ payment: data, message: 'Demande reçue. Le forfait sera activé après vérification manuelle du paiement.' })
  } catch (error) { fail(res, error, error?.code ? 503 : 400) }
})
app.get('/api/admin/payment-requests', authenticate, async (req, res) => {
  if (!ADMIN_USER_IDS.has(req.user.id)) return res.status(403).json({ error: 'Accès administrateur refusé.' })
  try {
    const { data, error } = await adminClient.from('payment_requests').select('*').order('created_at', { ascending: true }).limit(100)
    if (error) throw error
    res.json({ payments: data || [] })
  } catch (error) { fail(res, error) }
})
app.post('/api/admin/payment-requests/:id/review', authenticate, async (req, res) => {
  if (!ADMIN_USER_IDS.has(req.user.id)) return res.status(403).json({ error: 'Accès administrateur refusé.' })
  try {
    const status = String(req.body?.status || '')
    const note = String(req.body?.note || '').slice(0, 500)
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Décision invalide.' })
    const { data: payment, error: readError } = await adminClient.from('payment_requests').select('*').eq('id', req.params.id).maybeSingle()
    if (readError) throw readError
    if (!payment) return res.status(404).json({ error: 'Demande introuvable.' })
    if (payment.status !== 'pending') return res.status(409).json({ error: 'Cette demande a déjà été traitée.' })
    const { error: reviewError } = await adminClient.rpc('admin_review_payment_request', {
      p_payment_id: payment.id, p_status: status, p_note: note, p_reviewer: req.user.id,
    })
    if (reviewError) throw reviewError
    res.json({ success: true, status })
  } catch (error) { fail(res, error) }
})

app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await adminClient.from('monitors').select('id').limit(1)
    if (error) throw error
    res.json({ ok: true, service: 'Mzouti Uptime', database: 'connected', backgroundMonitoring: true, cronCallbackConfigured: Boolean(CRON_SECRET), time: new Date().toISOString() })
  } catch (error) {
    console.error('Health check failed:', error.message)
    res.status(503).json({ ok: false, service: 'Mzouti Uptime', database: 'unavailable', backgroundMonitoring: false })
  }
})

app.use('/api/monitors', authenticate)
app.get('/api/monitors', async (req, res) => {
  try { res.json({ monitors: await listOwnedMonitors(req.db) }) } catch (error) { fail(res, error) }
})
app.post('/api/monitors', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    const type = String(req.body?.type || 'HTTP').toUpperCase()
    const { raw: url } = normalizeTarget(req.body?.url, type)
    const interval = intervals[req.body?.interval] || 300
    if (!name || name.length > 120) return res.status(400).json({ error: 'Le nom doit contenir entre 1 et 120 caractères.' })
    if (!adminClient) return res.status(503).json({ error: 'Le service de contrôle serveur n’est pas configuré.' })
    const subscription = await getSubscription(req.user.id)
    const plan = PLAN_LIMITS[subscription.plan_code] || PLAN_LIMITS.free
    if (intervals[req.body?.interval] && intervals[req.body.interval] < plan.minInterval) {
      return res.status(403).json({ error: `Ton forfait ${plan.label} impose une fréquence minimale de ${Math.round(plan.minInterval / 60)} minute(s).` })
    }
    const { count: monitorCount, error: countError } = await adminClient.from('monitors').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id)
    if (countError) throw countError
    if ((monitorCount || 0) >= plan.monitors) return res.status(403).json({ error: `Limite atteinte : ${plan.monitors} moniteur(s) avec le forfait ${plan.label}. Les moniteurs existants sont conservés. Passe à un forfait supérieur pour en ajouter.` })
    const { data: created, error } = await req.db.from('monitors').insert({ name, url, monitor_type: type, interval_seconds: interval, status: 'up' })
      .select('id,name,url,monitor_type,interval_seconds,status,response_ms,last_check_at,created_at').single()
    if (error) throw error
    await executeCheck(created, adminClient)
    const fresh = await getOwnedMonitor(req.db, created.id)
    res.status(201).json({ monitor: await monitorPayload(fresh, req.db) })
  } catch (error) { fail(res, error, error?.code === '23505' ? 409 : error?.code ? 503 : 400) }
})
app.patch('/api/monitors/:id', async (req, res) => {
  try {
    const current = await getOwnedMonitor(req.db, req.params.id)
    if (!current) return res.status(404).json({ error: 'Moniteur introuvable.' })
    const changes = {}
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim()
      if (!name || name.length > 120) return res.status(400).json({ error: 'Le nom doit contenir entre 1 et 120 caractères.' })
      changes.name = name
    }
    if (req.body?.url !== undefined || req.body?.type !== undefined) {
      const type = String(req.body?.type || current.monitor_type).toUpperCase()
      const { raw } = normalizeTarget(req.body?.url ?? current.url, type)
      changes.url = raw
      changes.monitor_type = type
    }
    if (req.body?.interval !== undefined) {
      if (!intervals[req.body.interval]) return res.status(400).json({ error: 'Fréquence invalide.' })
      const subscription = await getSubscription(req.user.id)
      const plan = PLAN_LIMITS[subscription.plan_code] || PLAN_LIMITS.free
      if (intervals[req.body.interval] < plan.minInterval) return res.status(403).json({ error: `Ton forfait ${plan.label} impose une fréquence minimale de ${Math.round(plan.minInterval / 60)} minute(s).` })
      changes.interval_seconds = intervals[req.body.interval]
    }
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'Aucune modification reçue.' })
    changes.updated_at = new Date().toISOString()
    const { error } = await req.db.from('monitors').update(changes).eq('id', current.id)
    if (error) throw error
    const updated = await getOwnedMonitor(req.db, current.id)
    res.json({ monitor: await monitorPayload(updated, req.db) })
  } catch (error) { fail(res, error, error?.code ? 503 : 400) }
})
app.post('/api/monitors/:id/pause', async (req, res) => {
  try {
    const monitor = await getOwnedMonitor(req.db, req.params.id)
    if (!monitor) return res.status(404).json({ error: 'Moniteur introuvable.' })
    const { error } = await req.db.from('monitors').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', monitor.id)
    if (error) throw error
    res.json({ success: true, status: 'paused' })
  } catch (error) { fail(res, error) }
})
app.post('/api/monitors/:id/resume', async (req, res) => {
  try {
    const monitor = await getOwnedMonitor(req.db, req.params.id)
    if (!monitor) return res.status(404).json({ error: 'Moniteur introuvable.' })
    if (!adminClient) return res.status(503).json({ error: 'Service de contrôle non configuré.' })
    const resumed = { ...monitor, status: 'up', last_check_at: null }
    const { error } = await req.db.from('monitors').update({ status: 'up', last_check_at: null, updated_at: new Date().toISOString() }).eq('id', monitor.id)
    if (error) throw error
    const result = await executeCheck(resumed, adminClient)
    const fresh = await getOwnedMonitor(req.db, monitor.id)
    res.json({ success: true, result, monitor: await monitorPayload(fresh, req.db) })
  } catch (error) { fail(res, error) }
})
app.post('/api/monitors/check-all', async (req, res) => {
  try {
    const { data: rows, error } = await req.db.from('monitors').select('id,name,url,monitor_type,interval_seconds,status,last_check_at').neq('status', 'paused').limit(MAX_MONITORS)
    if (error) throw error
    const force = req.query.force === '1' || req.query.force === 'true'
    const due = (rows || []).filter((row) => force || !row.last_check_at || Date.now() - new Date(row.last_check_at).getTime() >= Number(row.interval_seconds) * 1000)
    const results = []
    for (const monitor of due) results.push({ id: Number(monitor.id), ...(await executeCheck(monitor, adminClient)) })
    res.json({ checked: results.filter((item) => !item.skipped).length, results })
  } catch (error) { fail(res, error) }
})
app.post('/api/monitors/:id/check', async (req, res) => {
  try {
    const monitor = await getOwnedMonitor(req.db, req.params.id)
    if (!monitor) return res.status(404).json({ error: 'Moniteur introuvable.' })
    if (monitor.status === 'paused') return res.status(409).json({ error: 'Ce moniteur est en pause.' })
    if (!adminClient) return res.status(503).json({ error: 'Service de contrôle non configuré.' })
    const result = await executeCheck(monitor, adminClient)
    const fresh = await getOwnedMonitor(req.db, monitor.id)
    res.json({ result, monitor: await monitorPayload(fresh, req.db) })
  } catch (error) { fail(res, error) }
})
app.get('/api/monitors/:id/checks', async (req, res) => {
  try {
    const monitor = await getOwnedMonitor(req.db, req.params.id)
    if (!monitor) return res.status(404).json({ error: 'Moniteur introuvable.' })
    const { data: subscription } = await req.db.from('subscriptions').select('plan_code').maybeSingle()
    const historyDays = PLAN_LIMITS[subscription?.plan_code || 'free']?.historyDays || 7
    const rows = await readChecks(req.db, monitor.id, new Date(Date.now() - historyDays * 86400000).toISOString())
    res.json({ checks: rows.reverse().map((row) => ({ status: row.result_status, statusCode: row.status_code, responseMs: row.response_ms, error: row.error_message, checkedAt: row.checked_at })) })
  } catch (error) { fail(res, error) }
})
app.get('/api/incidents', authenticate, async (req, res) => {
  try {
    const { data, error } = await req.db.from('monitor_incidents')
      .select('id,monitor_id,started_at,resolved_at,cause,monitors(name,url)')
      .order('started_at', { ascending: false }).limit(200)
    if (error) throw error
    res.json({ incidents: data || [] })
  } catch (error) { fail(res, error) }
})
app.delete('/api/monitors/:id', async (req, res) => {
  try {
    const monitor = await getOwnedMonitor(req.db, req.params.id)
    if (!monitor) return res.status(404).json({ error: 'Moniteur introuvable.' })
    const { error } = await req.db.from('monitors').delete().eq('id', monitor.id)
    if (error) throw error
    res.status(204).end()
  } catch (error) { fail(res, error) }
})
app.post('/api/scheduled/checks', async (req, res) => {
  if (!CRON_SECRET || !safeEqual(req.headers['x-cron-secret'], CRON_SECRET)) return res.status(401).json({ error: 'Accès refusé.' })
  try { res.json(await checkDueMonitors(false)) } catch (error) { fail(res, error) }
})

if (isDev) {
  const vite = await createViteServer({ server: { middlewareMode: true, host: '0.0.0.0' }, appType: 'spa' })
  app.use(vite.middlewares)
} else {
  app.use(express.static(path.join(__dirname, 'dist'), { etag: true, maxAge: '1h' }))
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
  app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }))
}
app.use((error, _req, res, _next) => {
  console.error('Unhandled request error:', error?.message || error)
  if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur.' })
})

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Mzouti Uptime listening on port ${port}`)
  console.log('Background monitoring enabled.')
})
const timer = setInterval(() => checkDueMonitors(false).catch((error) => console.error('Background monitoring cycle failed:', error.message)), CHECK_INTERVAL_MS)
timer.unref()
function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10000).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
