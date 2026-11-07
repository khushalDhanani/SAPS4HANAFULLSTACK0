FROM node:22.23.4-bookworm-slim AS fiori-build

WORKDIR /workspace/app/fiori-app
COPY app/fiori-app/package.json app/fiori-app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/fiori-app/ ./
RUN npm run build

FROM node:22.23.4-bookworm-slim

ARG PLATFORM=""
ENV NODE_ENV=production \
    PORT=5000 \
    PLATFORM=${PLATFORM} \
    APP_ROLE=approuter \
    BINDING_SERVICES=xsuaa \
    HOME=/tmp

WORKDIR /app/router
COPY docker/approuter/package.json docker/approuter/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node docker/approuter/xs-app.json ./xs-app.json
COPY --from=fiori-build --chown=node:node /workspace/app/fiori-app/dist ./saps4hanafiori
COPY --chown=node:node tools/docker/runtime.js ./tools/docker/runtime.js

USER node
EXPOSE 5000
ENTRYPOINT ["node", "tools/docker/runtime.js"]
