# Incident console

Receives Grafana's alert webhook, runs a headless Claude agent with read-only Grafana tools, and serves a triage page.

```
Grafana alert (>5% 5xx for 1 min) -> POST /webhook -> checks -> claude -p + mcp-grafana -> report -> triage page
```

## What it does
| Piece | File |
|---|---|
| Webhook secret check, page login | `lib/auth.js` |
| Ignore resolved/repeat alerts, 3-minute cooldown, one run at a time | `lib/gate.js` |
| Spawns `claude -p` with read-only tools, timeout, turn cap | `lib/runner.js` |
| Agent instructions and Grafana MCP config | `agent/` |
| Reports (Postgres if `DATABASE_URL`, else memory) | `lib/store.js` |
| Read-only chart and log queries for the page | `lib/grafanaProxy.js` |
| Alert rule, contact point, provisioning script | `grafana/` |
| Triage page | `public/` |

The agent may only use Grafana query tools (`mcp-grafana --disable-write`, Viewer token) plus Read/Grep/Glob on a copy of the shop's `server/` folder. Bash, Edit, Write and web tools are denied.

## Deploy on Render
1. Push the repo, then create the `smartbuy-incident-console` service from `render.yaml` (Docker runtime, Starter plan so it doesn't sleep).
2. Set the environment variables listed in `.env.example`:
   - `WEBHOOK_SECRET`, `CONSOLE_PASSWORD`: generate random values.
   - `GRAFANA_URL` and `GRAFANA_SERVICE_ACCOUNT_TOKEN`: in Grafana, Administration > Users and access > Service accounts, create one with the **Viewer** role and add a token.
   - `ANTHROPIC_API_KEY`: from the Anthropic console.
   - `DATABASE_URL` (optional): a Neon connection string for durable reports.
3. Provision the alert (needs a token with alerting write access, separate from the Viewer one):
   ```bash
   GRAFANA_URL=https://<stack>.grafana.net GRAFANA_ADMIN_TOKEN=... \
   CONSOLE_URL=https://<console>.onrender.com WEBHOOK_SECRET=... \
   node console/grafana/provision.mjs
   ```
4. Open `https://<console>.onrender.com` and sign in with any username and `CONSOLE_PASSWORD`.

## Test without waiting for a real incident
```bash
curl -X POST https://<console>.onrender.com/webhook \
  -H "Authorization: Bearer $WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"status":"firing","alerts":[{"status":"firing","fingerprint":"test1","labels":{"alertname":"SmartBuy 5xx rate above 5%"}}]}'
```
A repeat within 3 minutes returns `{"accepted":false,"reason":"cooldown"}`.

For a real one, run `incident-demo/shoppers.mjs express 6` against the shop. Express Pay leaks connections, so the pool saturates and requests start returning 500.

## Local run
```bash
cd console && npm install && cp .env.example .env   # fill it in
npm start                                            # http://localhost:3100
```
Locally you also need the `claude` CLI and `mcp-grafana` on your PATH, and `SHOP_DIR` pointing at a folder that contains the shop's `server/`.
