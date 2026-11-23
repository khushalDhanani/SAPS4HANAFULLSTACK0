# ==============================================================================
# Standalone SAP Application Router Dockerfile
# ==============================================================================
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init curl \
    && rm -rf /var/lib/apt/lists/*

COPY app/router/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY app/router/xs-app.json ./

ENV PORT=5000 \
    NODE_ENV=production

EXPOSE 5000

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["node", "node_modules/@sap/approuter/approuter.js"]
