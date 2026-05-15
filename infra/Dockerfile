# ─── API Server Dockerfile ────────────────────────────────────────────────────
# Multi-stage: dev target for local development, prod for production.

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

# nodemon is already in devDependencies
CMD ["npx", "nodemon", "--exec", "npx ts-node packages/server/index.ts", \
     "--watch", "packages", "--ext", "ts", \
     "--ignore", "node_modules"]

EXPOSE 3000

# ── Production ────────────────────────────────────────────────────────────────
FROM base AS prod
ENV NODE_ENV=production

# Re-install without devDependencies
RUN npm ci --omit=dev

CMD ["node", "-r", "ts-node/register", "packages/server/index.ts"]

EXPOSE 3000
