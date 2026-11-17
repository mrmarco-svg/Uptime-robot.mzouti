import express from 'express'
import mysql from 'mysql2/promise'
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
const app = express()
app.use(express.json({ limit: '64kb' }))

let pool
let schemaReady

function databasePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  if (!pool) {
    pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      decimalNumbers: true,
    })
  }
  return pool
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = databasePool()
      await db.query(`
        CREATE TABLE IF NOT EXISTS mzouti_monitors (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(120) NOT NULL,
          url VARCHAR(2048) NOT NULL,
          monitor_type ENUM('HTTP', 'PING', 'PORT') NOT NULL DEFAULT 'HTTP',
          interval_seconds INT UNSIGNED NOT NULL DEFAULT 300,
          status ENUM('up', 'down', 'paused') NOT NULL DEFAULT 'up',
          response_ms INT UNSIGNED NULL,
          last_check_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          INDEX idx_mzouti_monitors_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
      await db.query(`
        CREATE TABLE IF NOT EXISTS mzouti_monitor_checks (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          monitor_id BIGINT UNSIGNED NOT NULL,
          result_status ENUM('up', 'down') NOT NULL,
          status_code SMALLINT UNSIGNED NULL,
          response_ms INT UNSIGNED NULL,
          error_message VARCHAR(500) NULL,
          checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          INDEX idx_mzouti_checks_monitor_time (monitor_id, checked_at),
          CONSTRAINT fk_mzouti_checks_monitor FOREIGN KEY (monitor_id) REFERENCES mzouti_monitors(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
    })().catch((error) => {
      schemaReady = undefined
      throw error
    })
  }
  return schemaReady
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
  if (!['HTTP', 'PING', 'PORT'].includes(type)) throw new Error('Unsupported monitor type')
  if (type === 'HTTP' && !['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTP monitors require an http:// or https:// URL')
  if (type === 'PING' && !['http:', 'https:'].includes(parsed.protocol)) throw new Error('PING monitors require a hostname or URL')
  if (type === 'PORT' && !['tcp:', 'http:', 'https:'].includes(parsed.protocol)) throw new Error('PORT monitors require a host:port value')
  return raw
}

function serializeDate(value) {
  return value ? new Date(value).toISOString() : null
}

async function monitorPayload(row) {
  const db = databasePool()
  const [summaryRows] = await db.execute(`
    SELECT
      COUNT(*) AS total_checks,
      COALESCE(SUM(result_status = 'up'), 0) AS successful_checks,
      AVG(response_ms) AS average_response
    FROM mzouti_monitor_checks
    WHERE monitor_id = ? AND checked_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
  `, [row.id])
  const summary = summaryRows[0] || {}
  const [checkRows] = await db.execute(`
    SELECT result_status, response_ms
    FROM mzouti_monitor_checks
    WHERE monitor_id = ?
    ORDER BY checked_at DESC
    LIMIT 30
  `, [row.id])
  const chart = checkRows.reverse().map((check) => check.result_status === 'up' ? 100 : 12)
  const totalChecks = Number(summary.total_checks || 0)
  const successfulChecks = Number(summary.successful_checks || 0)
  return {
    id: Number(row.id),
    name: row.name,
    url: row.url,
    type: row.monitor_type,
    status: row.status,
    uptime: totalChecks ? Number(((successfulChecks / totalChecks) * 100).toFixed(2)) : 0,
    response: summary.average_response == null ? 0 : Math.round(Number(summary.average_response)),
    lastCheck: row.last_check_at ? `à ${relativeTime(row.last_check_at)}` : 'jamais vérifié',
    lastCheckAt: serializeDate(row.last_check_at),
    interval: intervalLabel(row.interval_seconds),
    intervalSeconds: Number(row.interval_seconds),
    location: 'Serveur Mzouti',
    tags: [row.monitor_type],
    chart,
  }
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 5) return "l’instant"
  if (seconds < 60) return `il y a ${seconds} s`
  const minutes = Math.round(seconds / 60)
  return `il y a ${minutes} min`
}

async function listMonitors() {
  await ensureSchema()
  const db = databasePool()
  const [rows] = await db.query('SELECT * FROM mzouti_monitors ORDER BY created_at DESC')
  return Promise.all(rows.map(monitorPayload))
}

async function findMonitor(id) {
  await ensureSchema()
  const db = databasePool()
  const [rows] = await db.execute('SELECT * FROM mzouti_monitors WHERE id = ?', [id])
  return rows[0] || null
}

async function checkHttp(target) {
  const started = performance.now()
  const response = await fetch(target, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) })
  const elapsed = Math.max(1, Math.round(performance.now() - started))
  return { status: response.status >= 200 && response.status < 400 ? 'up' : 'down', statusCode: response.status, responseMs: elapsed, error: null }
}

async function checkPing(target) {
  const parsed = new URL(target)
  const host = parsed.hostname
  const started = performance.now()
  const { stdout } = await execFileAsync('ping', ['-c', '1', '-W', '3', host], { timeout: 5000 })
  const match = stdout.match(/time[=<]([\d.]+)/)
  return { status: 'up', statusCode: null, responseMs: match ? Math.max(1, Math.round(Number(match[1]))) : Math.max(1, Math.round(performance.now() - started)), error: null }
}

async function checkPort(target) {
  const parsed = new URL(target)
  const host = parsed.hostname
  const portNumber = Number(parsed.port)
  if (!portNumber || portNumber < 1 || portNumber > 65535) throw new Error('PORT monitors require a valid port, for example tcp://example.com:443')
  const started = performance.now()
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: portNumber, timeout: 8000 })
    const finish = (error) => { socket.destroy(); error ? reject(error) : resolve() }
    socket.once('connect', () => finish())
    socket.once('timeout', () => finish(new Error('Connection timeout')))
    socket.once('error', finish)
  })
  return { status: 'up', statusCode: null, responseMs: Math.max(1, Math.round(performance.now() - started)), error: null }
}

async function executeCheck(monitor) {
  const db = databasePool()
  let result
  try {
    const target = normalizeUrl(monitor.url, monitor.monitor_type)
    if (monitor.monitor_type === 'PING') result = await checkPing(target)
    else if (monitor.monitor_type === 'PORT') result = await checkPort(target)
    else result = await checkHttp(target)
  } catch (error) {
    result = { status: 'down', statusCode: error?.cause?.code ? null : (error?.statusCode || null), responseMs: null, error: String(error?.message || 'Check failed').slice(0, 500) }
  }
  await db.execute(`
    INSERT INTO mzouti_monitor_checks (monitor_id, result_status, status_code, response_ms, error_message)
    VALUES (?, ?, ?, ?, ?)
  `, [monitor.id, result.status, result.statusCode, result.responseMs, result.error])
  await db.execute(`
    UPDATE mzouti_monitors
    SET status = ?, response_ms = ?, last_check_at = UTC_TIMESTAMP(3)
    WHERE id = ?
  `, [result.status, result.responseMs, monitor.id])
  return result
}

async function checkDueMonitors(force = false) {
  await ensureSchema()
  const db = databasePool()
  const [rows] = await db.query("SELECT * FROM mzouti_monitors WHERE status <> 'paused'")
  const now = Date.now()
  const due = force ? rows : rows.filter((monitor) => !monitor.last_check_at || now - new Date(monitor.last_check_at).getTime() >= Number(monitor.interval_seconds) * 1000)
  const results = []
  for (const monitor of due) results.push({ id: Number(monitor.id), ...(await executeCheck(monitor)) })
  return { checked: results.length, results }
}

function scheduledCookie(req) {
  const cookie = req.headers.cookie || ''
  return cookie.match(/(?:^|;\s*)app_session_id=([^;]+)/)?.[1]
}

async function verifyScheduledRequest(req) {
  if (isDev && req.headers['x-mzouti-local-schedule'] === '1') return true
  const jwt = scheduledCookie(req)
  const authUrl = process.env.MANUS_OAUTH_API_URL
  const projectId = process.env.MANUS_PROJECT_ID
  if (!jwt || !authUrl || !projectId) return false
  const response = await fetch(`${authUrl}/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jwt_token: jwt, project_id: projectId }),
    signal: AbortSignal.timeout(8000),
  })
  return response.ok
}

app.get('/api/health', async (_req, res) => {
  try {
    await ensureSchema()
    await databasePool().query('SELECT 1')
    res.json({ ok: true, database: 'connected' })
  } catch (error) {
    res.status(503).json({ ok: false, database: 'unavailable', error: error.message })
  }
})

app.get('/api/monitors', async (_req, res) => {
  try { res.json({ monitors: await listMonitors() }) }
  catch (error) { res.status(503).json({ error: 'Database unavailable', detail: error.message }) }
})

app.post('/api/monitors', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    const type = String(req.body?.type || 'HTTP').toUpperCase()
    const url = normalizeUrl(req.body?.url, type)
    const interval = intervalSeconds[req.body?.interval] || 300
    if (!name || name.length > 120) return res.status(400).json({ error: 'Name is required and must be under 120 characters' })
    await ensureSchema()
    const db = databasePool()
    const [insert] = await db.execute('INSERT INTO mzouti_monitors (name, url, monitor_type, interval_seconds) VALUES (?, ?, ?, ?)', [name, url, type, interval])
    const monitor = await findMonitor(insert.insertId)
    await executeCheck(monitor)
    res.status(201).json({ monitor: await monitorPayload(await findMonitor(insert.insertId)) })
  } catch (error) { res.status(400).json({ error: error.message }) }
})

app.post('/api/monitors/check-all', async (req, res) => {
  try { res.json(await checkDueMonitors(Boolean(req.query.force))) }
  catch (error) { res.status(503).json({ error: error.message }) }
})

app.post('/api/monitors/:id/check', async (req, res) => {
  try {
    const monitor = await findMonitor(req.params.id)
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' })
    const result = await executeCheck(monitor)
    res.json({ result, monitor: await monitorPayload(await findMonitor(monitor.id)) })
  } catch (error) { res.status(503).json({ error: error.message }) }
})

app.get('/api/monitors/:id/checks', async (req, res) => {
  try {
    await ensureSchema()
    const [rows] = await databasePool().execute(`SELECT result_status AS status, status_code AS statusCode, response_ms AS responseMs, error_message AS error, checked_at AS checkedAt FROM mzouti_monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 100`, [req.params.id])
    res.json({ checks: rows.map((row) => ({ ...row, checkedAt: serializeDate(row.checkedAt) })) })
  } catch (error) { res.status(503).json({ error: error.message }) }
})

app.delete('/api/monitors/:id', async (req, res) => {
  try {
    await ensureSchema()
    const [result] = await databasePool().execute('DELETE FROM mzouti_monitors WHERE id = ?', [req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'Monitor not found' })
    res.status(204).end()
  } catch (error) { res.status(503).json({ error: error.message }) }
})

app.post('/api/scheduled/checks', async (req, res) => {
  try {
    if (!await verifyScheduledRequest(req)) return res.status(401).json({ error: 'Invalid scheduled request' })
    res.json(await checkDueMonitors(false))
  } catch (error) { res.status(503).json({ error: error.message }) }
})

if (isDev) {
  const vite = await createViteServer({ server: { middlewareMode: true, host: '0.0.0.0' }, appType: 'spa' })
  app.use(vite.middlewares)
} else {
  app.use(express.static(path.join(__dirname, 'dist')))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(__dirname, 'dist', 'index.html'))
    next()
  })
}

app.listen(port, '0.0.0.0', () => console.log(`Mzouti Uptime listening on ${port} (${isDev ? 'development' : 'production'})`))

setInterval(() => {
  checkDueMonitors(false).catch((error) => console.error('Background monitoring cycle failed:', error.message))
}, 30000).unref()
