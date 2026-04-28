# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copy dependency manifests first for layer-cache efficiency
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy installed dependencies from the build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (node_modules is excluded via .dockerignore)
COPY . .

# Default data directory — override via DATA_DIR env var in docker-compose.yml
ENV DATA_DIR=/user_data
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]
