# ─────────────────────────────────────────────
#  Stage 1 – Install dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDeps for potential future tests/builds)
COPY package.json package-lock.json ./
RUN npm ci

# ─────────────────────────────────────────────
#  Stage 2 – production image
# ─────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security best-practice: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copy application files
COPY package.json package-lock.json ./
COPY knexfile.js ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# Install production dependencies only
RUN npm ci --only=production

# Use non-root user from this point forward
USER appuser

EXPOSE 4000

# Health-check using the existing /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]

