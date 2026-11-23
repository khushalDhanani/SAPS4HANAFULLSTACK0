# ==============================================================================
# Production Multi-Stage Dockerfile for SAP S/4HANA Full-Stack Platform
# Multi-stage build producing a lean, secure, non-root Node.js image
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build SAPUI5 / Fiori Application
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS ui5-builder
WORKDIR /build/app/fiori-app

# Copy UI5 package descriptors and install build dependencies
COPY app/fiori-app/package*.json ./
RUN npm ci --legacy-peer-deps

# Copy UI5 configuration and source assets
COPY app/fiori-app/ui5.yaml ./
COPY app/fiori-app/webapp ./webapp

# Build optimized UI5 bundle (Component-preload.js, minification)
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Lean Runtime Image
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Install dumb-init for proper PID 1 signal forwarding (SIGTERM / SIGINT) and curl for healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init curl \
    && rm -rf /var/lib/apt/lists/*

# Runtime environment settings (defaults to development for standalone execution without BTP XSUAA binding)
ENV NODE_ENV=development \
    PORT=4004

# Create app directory with non-root ownership
WORKDIR /home/node/app
RUN chown -R node:node /home/node/app

# Drop root privileges for container security
USER node

# Copy package descriptors and install runtime dependencies
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy backend CAP services, server bootstrap, schemas, and configurations
COPY --chown=node:node server.js ./
COPY --chown=node:node xs-security.json ./
COPY --chown=node:node srv ./srv
COPY --chown=node:node db ./db
COPY --chown=node:node config ./config

# Copy UI5 source webapp and optimized dist bundle from Stage 1
COPY --chown=node:node app/fiori-app/package*.json ./app/fiori-app/
COPY --chown=node:node app/fiori-app/ui5.yaml ./app/fiori-app/
COPY --chown=node:node app/fiori-app/webapp ./app/fiori-app/webapp
COPY --chown=node:node --from=ui5-builder /build/app/fiori-app/dist ./app/fiori-app/dist

# Expose standard CAP application port
EXPOSE 4004

# Health check probe against the dedicated /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-4004}/health || node -e "require('http').get('http://localhost:' + (process.env.PORT || 4004) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Use dumb-init as init system for robust graceful shutdown
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Launch CAP application server
CMD ["node", "server.js"]
