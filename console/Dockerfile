# Incident console image. Build context must be the REPOSITORY ROOT (it copies
# the shop's server/ folder so the triage agent can read the code):
#   docker build -f console/Dockerfile .
FROM node:22-slim

ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (runs headless as `claude -p`).
RUN npm install -g @anthropic-ai/claude-code

# Grafana MCP server (stdio). The console starts it with --disable-write.
RUN case "${TARGETARCH:-amd64}" in arm64) A=arm64 ;; *) A=x86_64 ;; esac \
 && curl -fsSL "https://github.com/grafana/mcp-grafana/releases/latest/download/mcp-grafana_Linux_${A}.tar.gz" \
    | tar -xz -C /usr/local/bin mcp-grafana \
 && chmod +x /usr/local/bin/mcp-grafana

WORKDIR /app
COPY console/package.json console/package-lock.json* ./
RUN npm install --omit=dev

COPY console/ ./
# Read-only reference copy of the shop code for the agent (its working directory).
COPY server/ ./shop/server/

# Claude Code refuses to run as root in some modes; use the built-in node user.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "server.js"]
