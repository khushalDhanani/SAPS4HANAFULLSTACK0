ARG PLATFORM=linux/amd64
ARG INSTALL_DEV_DEPENDENCIES=false
FROM --platform=${PLATFORM} node:22.23.4-bookworm-slim

ARG PLATFORM=linux/amd64
ENV NODE_ENV=production \
    HOME=/tmp \
    PORT=4004 \
    PLATFORM=${PLATFORM} \
    APP_ROLE=cap \
    BINDING_SERVICES=xsuaa,destination,hana \
    RFC_SDK_PATH=/usr/sap/nwrfcsdk \
    LD_LIBRARY_PATH=/usr/sap/nwrfcsdk/lib

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
ARG INSTALL_DEV_DEPENDENCIES=false
ARG INSTALL_RFC_PREBUILD=false
# node-gyp-build supports NODE_RFC to defer this package's load test until
# runtime, when the proprietary SDK is mounted. Other install scripts still run.
RUN if [ "$INSTALL_RFC_PREBUILD" = "true" ]; then \
      test "$PLATFORM" = "linux/amd64" && export NODE_RFC=1; \
    fi && \
    if [ "$INSTALL_DEV_DEPENDENCIES" = "true" ]; then \
      npm ci --include=dev --no-audit --no-fund; \
    else \
      npm ci --omit=dev --no-audit --no-fund; \
    fi && \
    if [ "$INSTALL_RFC_PREBUILD" = "true" ]; then \
      test -f node_modules/node-rfc/prebuilds/linux-x64/node.napi.node; \
    fi

COPY --chown=node:node server.js xs-security.json ./
COPY --chown=node:node config/schema ./config/schema
COPY --chown=node:node db ./db
COPY --chown=node:node srv ./srv
COPY --chown=node:node tools/docker ./tools/docker

USER node
EXPOSE 4004
ENTRYPOINT ["node", "tools/docker/runtime.js"]
