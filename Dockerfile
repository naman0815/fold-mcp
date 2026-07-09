# Multi-stage build: compiles the Go CLI (unfold_cli) and the Node MCP server
# (fold-mcp) into one small runtime image for Render.

FROM golang:1.21-bookworm AS go-builder
# CGO is required (mattn/go-sqlite3 needs cgo) — bookworm (glibc) avoids the
# musl/cgo linking friction an Alpine base would introduce.
ENV CGO_ENABLED=1
WORKDIR /src/unfold_cli
COPY unfold_cli/go.mod unfold_cli/go.sum ./
RUN go mod download
COPY unfold_cli/ ./
RUN go build -o /out/unfold_patched .

FROM node:20-bookworm AS node-builder
WORKDIR /src/fold-mcp
COPY fold-mcp/package.json fold-mcp/package-lock.json ./
RUN npm ci
COPY fold-mcp/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
# node:*-slim strips CA certificates, so the Go binary's HTTPS calls to
# api.fold.money fail TLS verification ("x509: certificate signed by unknown
# authority") without this — bit us in production, verified by the fix.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=go-builder /out/unfold_patched ./unfold_patched
COPY --from=node-builder /src/fold-mcp/build ./fold-mcp/build
COPY --from=node-builder /src/fold-mcp/node_modules ./fold-mcp/node_modules
COPY --from=node-builder /src/fold-mcp/package.json ./fold-mcp/package.json
COPY fold-mcp/schema ./fold-mcp/schema

ENV MCP_TRANSPORT=http
ENV NODE_ENV=production
# Render sets PORT automatically; index.ts reads it via config.ts.
EXPOSE 3000

ENTRYPOINT ["node", "fold-mcp/build/index.js"]
