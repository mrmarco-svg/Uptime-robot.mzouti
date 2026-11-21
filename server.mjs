import express from 'express'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createConnection } from 'node:net'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer as createViteServer } from 'vite'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.argv.includes('--dev')
const port = Number(process.env.PORT || 3000)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rvjzubrksvaivcvmrqmi.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_-I_VNv-8UqjoAoYtyV3Tfw_C4vaCd0Z'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const app = express()
app.use(express.json({ limit: '64kb' }))

function serviceAuthHeader() {
  return SUPABASE_SERVICE_ROLE_KEY ? `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` : `Bearer ${SUPABASE_KEY}`
}
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentification requise' })
  req.authHeader = authHeader
  next()
}

async function supabaseRequest(table, { method = 'GET', query = {}, body, headers = {}, authHeader } = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) params.set(key, String(value))
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params.toString() ? `?${params}` : ''}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: authHeader || `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  if (!response.ok) throw new Error(payload?.message || payload?.hint || payload?.error_description || `Supabase request failed (${response.status})`)
  return payload
}

const intervalSeconds = { '1 min': 60, '5 min': 300, '10 min': 600, '15 min': 900 }
function intervalLabel(seconds) {
  const entry = Object.entries(intervalSeconds).find(([, value]) => value === Number(seconds))
  return entry?.[0] ?? `${Math.max(1, Math.round(Number(seconds) / 60))} min`
}
function normalizeUrl(value, type) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('URL is required')
  if (type === 'PING' && !raw.includes('://')) return `http://${raw}`
  if (type === 'PORT' && !raw.includes('://')) return `tcp://${raw}`
  const parsed = new URL(raw)
  if (type === 'HTTP' && !['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTP monitors require an http:// or https:// URL')
  if (type === 'PING' && !['http:', 'https:'].includes(parsed.protocol)) throw new Error('PING monitors require a hostname or URL')
  if (type === 'PORT' && !['tcp:', 'http:', 'https:'].includes(parsed.protocol)) throw new Error('PORT monitors require a host:port value')
  return raw
}
function relativeTime(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 5) return "l’instant"
  if (seconds < 60) return `il y a ${seconds} s`
  return `il y a ${Math.round(seconds / 60)} min`
}
function serializeDate(value) { return value ? new Date(value).toISOString() : null }

async function monitorPayload(row, authHeader = serviceAuthHeader()) {
  const checks = await supabaseRequest('monitor_checks', { authHeader, query: { select: 'result_status,response_ms,checked_at', monitor_id: `eq.${row.id}`, checked_at: `gte.${new Date(Date.now() - 30 * 86400000).toISOString()}`, order: 'checked_at.desc', limit: 100 } })
  const totalChecks = checks.length
  const successfulChecks = checks.filter((check) => check.result_status === 'up').length
  const responses = checks.filter((check) => check.response_ms != null).map((check) => Number(check.response_ms))
  return {
    id: Number(row.id), name: row.name, url: row.url, type: row.monitor_type, status: row.status,
    uptime: totalChecks ? Number(((successfulChecks / totalChecks) * 100).toFixed(2)) : 0,
    response: responses.length ? Math.round(responses.reduce((sum, value) => sum + value, 0) / responses.length) : 0,
    lastCheck: row.last_check_at ? `à ${relativeTime(row.last_check_at)}` : 'jamais vérifié',
    lastCheckAt: serializeDate(row.last_check_at), interval: intervalLabel(row.interval_seconds), intervalSeconds: Number(row.interval_seconds),
    location: 'Serveur Mzouti', tags: [row.monitor_type], chart: checks.reverse().map((check) => check.result_status === 'up' ? 100 : 12),
  }
}
async function listMonitors(authHeader = serviceAuthHeader()) {
  const rows = await supabaseRequest('monitors', { authHeader, query: { select: 'id,name,url,monitor_type,interval_seconds,status,response_ms,last_check_at,created_at', order: 'created_at.desc', limit: 200 } })
  return Promise.all(rows.map((row) => monitorPayload(row, authHeader)))
}
async function findMonitor(id, authHeader = serviceAuthHeader()) {
  const rows = await supabaseRequest('monitors', { authHeader, query: { select: 'id,name,url,monitor_type,interval_seconds,status,response_ms,last_check_at', id: `eq.${id}`, limit: 1 } })
  return rows[0] || null
}
async function checkHttp(target) {
  const started = performance.now()
  const response = await fetch(target, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) })
  return { status: response.status >= 200 && response.status < 400 ? 'up' : 'down', statusCode: response.status, responseMs: Math.max(1, Math.round(performance.now() - started)), error: null }
}
async function checkPing(target) {
  const parsed = new URL(target)
  const { stdout } = await execFileAsync('ping', ['-c', '1', '-W', '3', parsed.hostname], { timeout: 5000 })
  const match = stdout.match(/time[=<]([\d.]+)/)
  return { status: 'up', statusCode: null, responseMs: match ? Math.max(1, Math.round(Number(match[1]))) : 1, error: null }
}
async function checkPort(target) {
  const parsed = new URL(target)
  const portNumber = Number(parsed.port)
  if (!portNumber || portNumber > 65535) throw new Error('PORT monitors require a valid port, for example tcp://example.com:443')
  const started = performance.now()
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: parsed.hostname, port: portNumber, timeout: 8000 })
    const finish = (error) => { socket.destroy(); error ? reject(error) : resolve() }
    socket.once('connect', () => finish()); socket.once('timeout', () => finish(new Error('Connection timeout'))); socket.once('error', finish)
  })
  return { status: 'up', statusCode: null, responseMs: Math.max(1, Math.round(performance.now() - started)), error: null }
}
async function executeCheck(monitor, authHeader = serviceAuthHeader()) {
  let result
  try {
    const target = normalizeUrl(monitor.url, monitor.monitor_type)
    result = monitor.monitor_type === 'PING' ? await checkPing(target) : monitor.monitor_type === 'PORT' ? await checkPort(target) : await checkHttp(target)
  } catch (error) {
    result = { status: 'down', statusCode: null, responseMs: null, error: String(error?.message || 'Check failed').slice(0, 500) }
  }
  await supabaseRequest('monitor_checks', { method: 'POST', authHeader, body: { monitor_id: monitor.id, result_status: result.status, status_code: result.statusCode, response_ms: result.responseMs, error_message: result.error } })
  await supabaseRequest('monitors', { method: 'PATCH', authHeader, query: { id: `eq.${monitor.id}` }, body: { status: result.status, response_ms: result.responseMs, last_check_at: new Date().toISOString() } })
  return result
}
async function checkDueMonitors(force = false, authHeader = serviceAuthHeader()) {
  const rows = await supabaseRequest('monitors', { authHeader, query: { select: 'id,name,url,monitor_type,interval_seconds,status,last_check_at', status: 'neq.paused', limit: 200 } })
  const now = Date.now()
  const due = force ? rows : rows.filter((monitor) => !monitor.last_check_at || now - new Date(monitor.last_check_at).getTime() >= Number(monitor.interval_seconds) * 1000)
  const results = []
  for (const monitor of due) results.push({ id: Number(monitor.id), ...(await executeCheck(monitor, authHeader)) })
  return { checked: results.length, results }
}

app.get('/api/health', async (_req, res) => {
  try { await supabaseRequest('monitors', { authHeader: serviceAuthHeader(), query: { select: 'id', limit: 1 } }); res.json({ ok: true, database: 'supabase', auth: 'enabled' }) }
  catch (error) { res.status(503).json({ ok: false, database: 'unavailable', error: error.message }) }
})
app.use('/api/monitors', requireAuth)
app.get('/api/monitors', async (req, res) => { try { res.json({ monitors: await listMonitors(req.authHeader) }) } catch (error) { res.status(503).json({ error: 'Supabase unavailable', detail: error.message }) } })
app.post('/api/monitors', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim(); const type = String(req.body?.type || 'HTTP').toUpperCase(); const url = normalizeUrl(req.body?.url, type); const interval = intervalSeconds[req.body?.interval] || 300
    if (!name || name.length > 120) return res.status(400).json({ error: 'Name is required and must be under 120 characters' })
    const created = await supabaseRequest('monitors', { method: 'POST', authHeader: req.authHeader, headers: { Prefer: 'return=representation' }, body: { name, url, monitor_type: type, interval_seconds: interval } })
    const monitor = created[0]; await executeCheck(monitor, req.authHeader); res.status(201).json({ monitor: await monitorPayload(await findMonitor(monitor.id, req.authHeader), req.authHeader) })
  } catch (error) { res.status(400).json({ error: error.message }) }
})
app.post('/api/monitors/check-all', async (req, res) => { try { res.json(await checkDueMonitors(Boolean(req.query.force), req.authHeader)) } catch (error) { res.status(503).json({ error: error.message }) } })
app.post('/api/monitors/:id/check', async (req, res) => { try { const monitor = await findMonitor(req.params.id, req.authHeader); if (!monitor) return res.status(404).json({ error: 'Monitor not found' }); const result = await executeCheck(monitor, req.authHeader); res.json({ result, monitor: await monitorPayload(await findMonitor(monitor.id, req.authHeader), req.authHeader) }) } catch (error) { res.status(503).json({ error: error.message }) } })
app.get('/api/monitors/:id/checks', async (req, res) => { try { const rows = await supabaseRequest('monitor_checks', { authHeader: req.authHeader, query: { select: 'result_status,status_code,response_ms,error_message,checked_at', monitor_id: `eq.${req.params.id}`, order: 'checked_at.desc', limit: 100 } }); res.json({ checks: rows.map((row) => ({ status: row.result_status, statusCode: row.status_code, responseMs: row.response_ms, error: row.error_message, checkedAt: serializeDate(row.checked_at) })) }) } catch (error) { res.status(503).json({ error: error.message }) } })
app.delete('/api/monitors/:id', async (req, res) => { try { await supabaseRequest('monitors', { method: 'DELETE', authHeader: req.authHeader, query: { id: `eq.${req.params.id}` } }); res.status(204).end() } catch (error) { res.status(503).json({ error: error.message }) } })
app.post('/api/scheduled/checks', async (_req, res) => { try { res.json(await checkDueMonitors(false)) } catch (error) { res.status(503).json({ error: error.message }) } })

if (isDev) {
  const vite = await createViteServer({ server: { middlewareMode: true, host: '0.0.0.0' }, appType: 'spa' }); app.use(vite.middlewares)
} else {
  app.use(express.static(path.join(__dirname, 'dist'))); app.use((req, res, next) => { if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(__dirname, 'dist', 'index.html')); next() })
}
app.listen(port, '0.0.0.0', () => console.log(`Mzouti Uptime listening on ${port} with Supabase Auth (${isDev ? 'development' : 'production'})`))
setInterval(() => { checkDueMonitors(false, serviceAuthHeader()).catch((error) => console.error('Background monitoring cycle failed:', error.message)) }, 30000).unref()
