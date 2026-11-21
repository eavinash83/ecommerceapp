import { timingSafeEqual, createHash } from 'node:crypto'
import { config } from './config.js'

// Hash both sides so timingSafeEqual gets equal-length buffers and the
// comparison time doesn't depend on where the strings differ.
export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest()
  const hb = createHash('sha256').update(String(b)).digest()
  return timingSafeEqual(ha, hb)
}

// Grafana webhook: Authorization: Bearer <WEBHOOK_SECRET>
export function requireWebhookSecret(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || !safeEqual(token, config.webhookSecret)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// Triage page and its API: HTTP Basic, any username, password = CONSOLE_PASSWORD.
export function requirePageLogin(req, res, next) {
  const header = req.get('authorization') || ''
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString()
    const password = decoded.slice(decoded.indexOf(':') + 1)
    if (safeEqual(password, config.consolePassword)) return next()
  }
  res.set('WWW-Authenticate', 'Basic realm="SmartBuy incident console"')
  res.status(401).send('Authentication required')
}
