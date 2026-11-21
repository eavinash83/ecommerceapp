import { config } from './config.js'

const seen = new Map() // fingerprint -> time last accepted
let busy = false

// Decide whether a Grafana webhook payload should start an investigation.
// Returns { run: true, alert } or { run: false, reason }.
export function decide(payload) {
  const alerts = Array.isArray(payload?.alerts) ? payload.alerts : []
  const firing = alerts.filter((a) => a.status === 'firing')
  if (firing.length === 0) {
    return { run: false, reason: payload?.status === 'resolved' ? 'resolved' : 'no firing alerts' }
  }
  if (busy) return { run: false, reason: 'investigation already running' }

  const now = Date.now()
  for (const [key, at] of seen) if (now - at > config.cooldownMs) seen.delete(key)

  const keyOf = (a) => a.fingerprint || a.labels?.alertname || 'unknown'
  const fresh = firing.find((a) => !seen.has(keyOf(a)))
  if (!fresh) return { run: false, reason: 'cooldown' }

  seen.set(keyOf(fresh), now)
  return { run: true, alert: fresh }
}

export const gate = {
  begin() { busy = true },
  end() { busy = false },
}
