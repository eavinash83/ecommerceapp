// Creates (or updates) the alert folder, the webhook contact point and the 5xx
// alert rule in Grafana. Safe to rerun: everything uses fixed UIDs.
//
//   GRAFANA_URL=https://<stack>.grafana.net \
//   GRAFANA_ADMIN_TOKEN=<service account token with alerting write access> \
//   CONSOLE_URL=https://<console>.onrender.com \
//   WEBHOOK_SECRET=<same value the console uses> \
//   node console/grafana/provision.mjs
import { readFileSync } from 'node:fs'

const env = (name, fallback) => {
  const v = process.env[name] ?? fallback
  if (v === undefined) { console.error(`Missing ${name}`); process.exit(1) }
  return v
}

const grafana = env('GRAFANA_URL').replace(/\/+$/, '')
const token = env('GRAFANA_ADMIN_TOKEN')
const consoleUrl = env('CONSOLE_URL').replace(/\/+$/, '')
const secret = env('WEBHOOK_SECRET')
const promSelector = env('PROM_SELECTOR', '')

async function call(method, path, body) {
  const res = await fetch(`${grafana}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Disable-Provenance': 'true' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, ok: res.ok, body: text ? safeJson(text) : null }
}
const safeJson = (t) => { try { return JSON.parse(t) } catch { return t } }
const fail = (what, r) => { console.error(`${what} failed (${r.status}):`, JSON.stringify(r.body)); process.exit(1) }

function template(file, vars) {
  let text = readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`\${${k}}`, v)
  return text
}

async function promUid() {
  if (process.env.PROM_DATASOURCE_UID) return process.env.PROM_DATASOURCE_UID
  const r = await call('GET', '/api/datasources')
  if (!r.ok) fail('List data sources', r)
  const ds = r.body.find((d) => d.type === 'prometheus' && /grafanacloud.*prom/.test(d.name)) || r.body.find((d) => d.type === 'prometheus')
  if (!ds) { console.error('No Prometheus data source found; set PROM_DATASOURCE_UID'); process.exit(1) }
  console.log(`Using Prometheus data source "${ds.name}" (${ds.uid})`)
  return ds.uid
}

// 1. Folder
let r = await call('POST', '/api/folders', { uid: 'smartbuy-incident', title: 'SmartBuy incident' })
if (!r.ok && ![409, 412].includes(r.status)) fail('Create folder', r)
console.log('Folder ready')

// 2. Contact point (update if it exists, otherwise create)
const contact = JSON.parse(template('contact-point.json', { CONSOLE_URL: consoleUrl, WEBHOOK_SECRET: secret }))
r = await call('PUT', `/api/v1/provisioning/contact-points/${contact.uid}`, contact)
if (r.status === 404) r = await call('POST', '/api/v1/provisioning/contact-points', contact)
if (!r.ok) fail('Contact point', r)
console.log('Contact point ready')

// 3. Alert rule
const sel = promSelector ? `${promSelector},` : ''
const rule = JSON.parse(template('alert-rule.json', {
  PROM_DATASOURCE_UID: await promUid(),
  SEL: sel.replaceAll('"', '\\"'),
  SEL_ONLY: promSelector.replaceAll('"', '\\"'),
}))
r = await call('PUT', `/api/v1/provisioning/alert-rules/${rule.uid}`, rule)
if (r.status === 404) r = await call('POST', '/api/v1/provisioning/alert-rules', rule)
if (!r.ok) fail('Alert rule', r)
console.log('Alert rule ready: more than 5% 5xx for 1 minute -> webhook')
