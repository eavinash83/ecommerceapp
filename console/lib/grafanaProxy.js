import { config } from './config.js'

// Read-only access to Grafana for the triage page. The browser never sees the
// token, and it can't send queries: it can only ask for the fixed panels below.

const headers = { Authorization: `Bearer ${config.grafanaToken}`, Accept: 'application/json' }
const uids = {
  prometheus: process.env.PROM_DATASOURCE_UID || null,
  loki: process.env.LOKI_DATASOURCE_UID || null,
}

async function gfetch(path) {
  const res = await fetch(`${config.grafanaUrl}${path}`, { headers, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Grafana ${res.status} for ${path.split('?')[0]}`)
  return res.json()
}

async function datasourceUid(type) {
  if (uids[type]) return uids[type]
  const list = await gfetch('/api/datasources')
  // Grafana Cloud names its sources "grafanacloud-<stack>-prom" and "-logs", but also
  // ships "-alert-state-history" and "-usage-insights" Loki sources we must not pick.
  const suffix = type === 'loki' ? /-logs$/ : /-prom$/
  const ofType = list.filter((d) => d.type === type)
  const match = ofType.find((d) => suffix.test(d.name)) || ofType.find((d) => d.isDefault) || ofType[0]
  if (!match) throw new Error(`No ${type} data source found; set ${type === 'loki' ? 'LOKI' : 'PROM'}_DATASOURCE_UID`)
  uids[type] = match.uid
  return match.uid
}

const sel = (extra = '') => `{${[config.metricSelector, extra].filter(Boolean).join(',')}}`
const REQ = 'http_server_requests_total'

export const PANELS = {
  traffic: {
    title: 'Requests per second',
    unit: 'req/s',
    queries: [
      { name: 'all', expr: `sum(rate(${REQ}${sel()}[1m]))` },
      { name: '5xx', expr: `sum(rate(${REQ}${sel('http_status_code=~"5.."')}[1m]))` },
    ],
  },
  errorRatio: {
    title: '5xx share of requests',
    unit: '%',
    queries: [
      { name: '5xx %', expr: `100 * sum(rate(${REQ}${sel('http_status_code=~"5.."')}[1m])) / sum(rate(${REQ}${sel()}[1m]))` },
    ],
  },
  pool: {
    title: 'Database pool',
    unit: 'connections',
    queries: [
      { name: 'active', expr: `max(db_pool_connections_active${sel()})` },
      { name: 'waiting', expr: `max(db_pool_connections_waiting${sel()})` },
      { name: 'max', expr: `max(db_pool_connections_max${sel()})` },
    ],
  },
}

export async function panelData(id, minutes = 30) {
  const panel = PANELS[id]
  if (!panel) return null
  const uid = await datasourceUid('prometheus')
  const end = Math.floor(Date.now() / 1000)
  const start = end - minutes * 60
  const step = Math.max(15, Math.floor((minutes * 60) / 120))
  const series = []
  for (const q of panel.queries) {
    const qs = new URLSearchParams({ query: q.expr, start: String(start), end: String(end), step: String(step) })
    const data = await gfetch(`/api/datasources/proxy/uid/${uid}/api/v1/query_range?${qs}`)
    const points = (data.data?.result?.[0]?.values || []).map(([t, v]) => [t * 1000, Number(v)]).filter(([, v]) => Number.isFinite(v))
    series.push({ name: q.name, points })
  }
  return { id, title: panel.title, unit: panel.unit, series }
}

export async function recentLogs(minutes = 15, limit = 100) {
  const uid = await datasourceUid('loki')
  const end = Date.now() * 1e6
  const start = end - minutes * 60 * 1e9
  const qs = new URLSearchParams({ query: config.logSelector, start: String(start), end: String(end), limit: String(limit), direction: 'backward' })
  const data = await gfetch(`/api/datasources/proxy/uid/${uid}/loki/api/v1/query_range?${qs}`)
  const lines = []
  for (const stream of data.data?.result || []) {
    for (const [ts, line] of stream.values) lines.push({ ts: Number(ts) / 1e6, line })
  }
  return lines.sort((a, b) => b.ts - a.ts).slice(0, limit)
}
