const COLORS = ['#2563eb', '#dc2626', '#d97706']
const $ = (id) => document.getElementById(id)

async function api(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json()
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Minimal Markdown: escapes first, so report text can never inject HTML.
function markdown(src) {
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const out = []
  let list = false
  let code = null
  for (const line of src.split('\n')) {
    if (line.startsWith('```')) {
      if (code === null) { code = [] } else { out.push(`<pre>${esc(code.join('\n'))}</pre>`); code = null }
      continue
    }
    if (code !== null) { code.push(line); continue }
    const item = line.match(/^\s*[-*]\s+(.*)/)
    if (item) { if (!list) { out.push('<ul>'); list = true } out.push(`<li>${inline(item[1])}</li>`); continue }
    if (list) { out.push('</ul>'); list = false }
    const h = line.match(/^#{1,3}\s+(.*)/)
    if (h) out.push(`<h2>${inline(h[1])}</h2>`)
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`)
  }
  if (list) out.push('</ul>')
  return out.join('')
}

let selectedId = null

async function loadReports() {
  const list = await api('/api/reports')
  const select = $('report-select')
  select.innerHTML = list.map((r) => `<option value="${r.id}">#${r.id} ${esc(r.alert_name)} (${r.status})</option>`).join('')
  if (!list.length) return
  if (selectedId === null || !list.some((r) => String(r.id) === String(selectedId))) selectedId = list[0].id
  select.value = selectedId
  const r = await api(`/api/reports/${selectedId}`)
  const started = new Date(r.started_at).toLocaleString()
  $('report-meta').innerHTML = `<span class="badge ${r.status}">${r.status}</span> started ${esc(started)}`
  $('report-body').innerHTML = r.status === 'running'
    ? '<p class="muted">The agent is investigating…</p>'
    : r.status === 'failed'
      ? `<p>The investigation failed: <code>${esc(r.error || 'unknown error')}</code></p>`
      : markdown(r.report || '')
}

function lineChart(panel) {
  const W = 400, H = 150, P = 4
  const all = panel.series.flatMap((s) => s.points)
  if (!all.length) return '<p class="muted">No data yet.</p>'
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y1 = Math.max(...ys, 0.0001)
  const sx = (x) => P + ((x - x0) / Math.max(x1 - x0, 1)) * (W - 2 * P)
  const sy = (y) => H - P - (y / y1) * (H - 2 * P)
  const paths = panel.series.map((s, i) => {
    const d = s.points.map(([x, y], j) => `${j ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('')
    return `<path d="${d}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2"/>`
  }).join('')
  const legend = panel.series.map((s, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(s.name)}</span>`).join('')
  const label = `${panel.title}: max ${y1.toFixed(2)} ${panel.unit}`
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${paths}</svg>
    <div class="legend">${legend}<span>max ${y1.toFixed(2)} ${esc(panel.unit)}</span></div>`
}

async function loadCharts() {
  const ids = await api('/api/panels')
  const host = $('charts')
  if (!host.children.length) {
    host.innerHTML = ids.map((id) => `<div class="card chart" id="chart-${id}"><h2>${esc(id)}</h2><p class="muted">Loading…</p></div>`).join('')
  }
  await Promise.all(ids.map(async (id) => {
    const el = $(`chart-${id}`)
    try {
      const data = await api(`/api/panels/${id}`)
      el.innerHTML = `<h2>${esc(data.title)}</h2>${lineChart(data)}`
    } catch (e) {
      el.innerHTML = `<h2>${esc(id)}</h2><p class="muted">${esc(e.message)}</p>`
    }
  }))
}

async function loadLogs() {
  try {
    const lines = await api('/api/logs')
    $('logs').innerHTML = lines.length
      ? lines.map((l) => {
        const bad = /status=5\d\d|failed|error/i.test(l.line)
        return `<span class="${bad ? 'err' : ''}">${esc(new Date(l.ts).toLocaleTimeString())} ${esc(l.line)}</span>`
      }).join('\n')
      : 'No logs in the last 15 minutes.'
  } catch (e) {
    $('logs').textContent = e.message
  }
}

async function refresh() {
  await Promise.allSettled([loadReports(), loadCharts(), loadLogs()])
  $('updated').textContent = `updated ${new Date().toLocaleTimeString()}`
}

$('report-select').addEventListener('change', (e) => { selectedId = e.target.value; loadReports() })
refresh()
setInterval(refresh, 10000)
