import pg from 'pg'
import { config } from './config.js'

// Reports live in Postgres when DATABASE_URL is set (durable across Render
// restarts); otherwise in memory (lost on restart).
const memory = []
let pool = null

export async function initStore() {
  if (!config.databaseUrl) {
    console.warn('store: no DATABASE_URL, reports kept in memory only')
    return
  }
  pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false }, max: 3 })
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_reports (
      id SERIAL PRIMARY KEY,
      alert_name TEXT NOT NULL,
      fingerprint TEXT,
      status TEXT NOT NULL,
      alert JSONB,
      report TEXT,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    )`)
}

export async function createReport({ alertName, fingerprint, alert }) {
  if (!pool) {
    const row = {
      id: memory.length + 1, alert_name: alertName, fingerprint, status: 'running', alert,
      report: null, error: null, started_at: new Date().toISOString(), finished_at: null,
    }
    memory.push(row)
    return row.id
  }
  const { rows } = await pool.query(
    'INSERT INTO incident_reports (alert_name, fingerprint, status, alert) VALUES ($1,$2,$3,$4) RETURNING id',
    [alertName, fingerprint, 'running', JSON.stringify(alert)],
  )
  return rows[0].id
}

export async function finishReport(id, { report, error }) {
  const status = error ? 'failed' : 'done'
  if (!pool) {
    const row = memory.find((r) => r.id === id)
    Object.assign(row, { status, report: report ?? null, error: error ?? null, finished_at: new Date().toISOString() })
    return
  }
  await pool.query(
    'UPDATE incident_reports SET status=$2, report=$3, error=$4, finished_at=now() WHERE id=$1',
    [id, status, report ?? null, error ?? null],
  )
}

export async function listReports(limit = 20) {
  if (!pool) {
    return [...memory].reverse().slice(0, limit).map(({ alert, report, ...r }) => r)
  }
  const { rows } = await pool.query(
    'SELECT id, alert_name, fingerprint, status, started_at, finished_at FROM incident_reports ORDER BY id DESC LIMIT $1',
    [limit],
  )
  return rows
}

export async function getReport(id) {
  if (!pool) return memory.find((r) => r.id === id) || null
  const { rows } = await pool.query('SELECT * FROM incident_reports WHERE id=$1', [id])
  return rows[0] || null
}
