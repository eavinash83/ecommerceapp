import express from 'express'
import helmet from 'helmet'
import { fileURLToPath } from 'node:url'
import { config } from './lib/config.js'
import { requireWebhookSecret, requirePageLogin } from './lib/auth.js'
import { decide, gate } from './lib/gate.js'
import { runTriage } from './lib/runner.js'
import { initStore, createReport, finishReport, listReports, getReport } from './lib/store.js'
import { PANELS, panelData, recentLogs } from './lib/grafanaProxy.js'

const app = express()
app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"] } },
}))

app.get('/healthz', (req, res) => res.json({ status: 'ok' }))

// Step 5-7: Grafana webhook -> checks -> background investigation.
app.post('/webhook', requireWebhookSecret, express.json({ limit: '256kb' }), (req, res) => {
  const verdict = decide(req.body)
  if (!verdict.run) {
    console.log(`webhook ignored: ${verdict.reason}`)
    return res.status(200).json({ accepted: false, reason: verdict.reason })
  }
  res.status(202).json({ accepted: true })
  investigate(verdict.alert).catch((e) => console.error('investigation crashed', e))
})

async function investigate(alert) {
  const alertName = alert.labels?.alertname || 'alert'
  const id = await createReport({ alertName, fingerprint: alert.fingerprint, alert })
  gate.begin()
  console.log(`investigation ${id} started for ${alertName}`)
  try {
    const report = await runTriage(alert)
    await finishReport(id, { report })
    console.log(`investigation ${id} done`)
  } catch (e) {
    console.error(`investigation ${id} failed: ${e.message}`)
    await finishReport(id, { error: e.message })
  } finally {
    gate.end()
  }
}

// Triage page and its read-only API.
app.use(requirePageLogin)

app.get('/api/reports', async (req, res, next) => {
  try { res.json(await listReports()) } catch (e) { next(e) }
})
app.get('/api/reports/:id', async (req, res, next) => {
  try {
    const row = await getReport(Number(req.params.id))
    if (!row) return res.status(404).json({ error: 'not found' })
    const { alert, ...rest } = row
    res.json(rest)
  } catch (e) { next(e) }
})
app.get('/api/panels', (req, res) => res.json(Object.keys(PANELS)))
app.get('/api/panels/:id', async (req, res, next) => {
  try {
    const data = await panelData(req.params.id)
    if (!data) return res.status(404).json({ error: 'unknown panel' })
    res.json(data)
  } catch (e) { next(e) }
})
app.get('/api/logs', async (req, res, next) => {
  try { res.json(await recentLogs()) } catch (e) { next(e) }
})

app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))))

app.use((err, req, res, next) => {
  console.error(err.message)
  res.status(502).json({ error: err.message })
})

await initStore()
app.listen(config.port, () => console.log(`incident console listening on ${config.port}`))
