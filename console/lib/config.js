import 'dotenv/config'
import { fileURLToPath } from 'node:url'

function required(name) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} environment variable is not set`)
  return v
}

export const config = {
  port: Number(process.env.PORT || 3100),
  webhookSecret: required('WEBHOOK_SECRET'),
  consolePassword: required('CONSOLE_PASSWORD'),
  grafanaUrl: required('GRAFANA_URL').replace(/\/+$/, ''),
  grafanaToken: required('GRAFANA_SERVICE_ACCOUNT_TOKEN'),
  databaseUrl: process.env.DATABASE_URL || null,
  // Label selectors so charts/logs match how your telemetry lands in Grafana.
  logSelector: process.env.LOKI_SELECTOR || '{service_name="checkout-service"}',
  metricSelector: process.env.PROM_SELECTOR || '',
  cooldownMs: Number(process.env.COOLDOWN_MS || 3 * 60 * 1000),
  claudeTimeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS || 5 * 60 * 1000),
  claudeMaxTurns: String(process.env.CLAUDE_MAX_TURNS || 25),
  // Folder the agent runs in; it contains a read-only copy of the shop's server/ code.
  shopDir: process.env.SHOP_DIR || fileURLToPath(new URL('../shop', import.meta.url)),
}
