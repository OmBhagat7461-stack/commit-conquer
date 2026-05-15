# ─── API Server Dockerfile ────────────────────────────────────────────────────
# Multi-stage: dev target for local development, prod for production.
# Supports both monolith and individual service modes via SERVICE_ENTRY env var.
#
# Usage:
#   Monolith (default):  SERVICE_ENTRY=packages/server/index.ts
#   Gateway only:        SERVICE_ENTRY=packages/server/gateway.ts
#   Product service:     SERVICE_ENTRY=packages/server/services/product-service.ts
#   Auth service:        SERVICE_ENTRY=packages/server/services/auth-service.ts
#   Cart service:        SERVICE_ENTRY=packages/server/services/cart-service.ts
#   Order service:       SERVICE_ENTRY=packages/server/services/order-service.ts

# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json tsconfig.json ./

# Copy package sources (needed for workspace resolution)
COPY packages/ packages/

# Install all dependencies (including devDependencies for ts-node)
RUN npm ci

# ── Dev (hot-reload via nodemon, volumes mount source) ────────────────────────
FROM base AS dev
ENV NODE_ENV=development
ENV SERVICE_ENTRY=packages/server/index.ts

CMD npx nodemon --exec "npx ts-node ${SERVICE_ENTRY}" \
    --watch packages --ext ts \
    --ignore node_modules

EXPOSE 3000 4000 4001 4002 4003 4004 4005

# ── Production ────────────────────────────────────────────────────────────────
FROM base AS prod
ENV NODE_ENV=production
ENV SERVICE_ENTRY=packages/server/index.ts

# Re-install without devDependencies
RUN npm ci --omit=dev

CMD ["sh", "-c", "node -r ts-node/register ${SERVICE_ENTRY}"]

EXPOSE 3000
