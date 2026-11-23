# Docker Deployment & Containerization Guide

This guide documents the enterprise containerization setup for the SAP S/4HANA Full-Stack platform (CAP Node.js backend + SAPUI5/Fiori frontend + App Router).

---

## Architecture Overview

The container configuration provides enterprise-grade, secure, multi-stage Docker builds:

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: ui5-builder (node:22-bookworm-slim)                │
│ - Copies app/fiori-app                                      │
│ - Runs ui5 build --all (Component-preload.js, minification) │
└──────────────────────────────┬──────────────────────────────┘
                               │ (transfers dist/)
┌──────────────────────────────▼──────────────────────────────┐
│ Stage 2: cap-builder (node:22-bookworm-slim)                │
│ - Copies srv, db, server.js                                 │
│ - Compiles CDS models: npx cds compile --to csn (csn.json)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ (transfers csn.json)
┌──────────────────────────────▼──────────────────────────────┐
│ Stage 3: runtime (node:22-bookworm-slim)                    │
│ - Non-root execution: USER node (UID 1000)                  │
│ - POSIX signal handling: dumb-init as PID 1 (graceful exit) │
│ - Production dependencies only: npm ci --omit=dev           │
│ - Exposes port 4004 with native HTTP /health probe          │
│ - Serves CAP OData V4 APIs & Fiori Webapp concurrently      │
└─────────────────────────────────────────────────────────────┘
```

### Key Security & Operational Highlights

1. **Non-Root Execution**: Runs as the unprivileged `node` user (UID/GID 1000). Root access is dropped after package installation.
2. **PID 1 Signal Handling**: Uses `dumb-init` to forward `SIGTERM` and `SIGINT` signals properly, enabling clean connection draining and container termination.
3. **Multi-Stage Optimization**: The final runtime image contains zero build tooling (no UI5 CLI, no devDependencies, no build artifacts), yielding a compact footprint.
4. **Active Health Monitoring**: Native `/health` HTTP endpoint monitored every 30 seconds by the container runtime.
5. **Zero Secret Leakage**: Rigorous `.dockerignore` blocks `.env`, `.git`, credentials, and local logs from ever entering the image layers.

---

## Container Topologies

| Topology | Use Case | Services | Ports | Command |
| :--- | :--- | :--- | :--- | :--- |
| **All-in-One Standalone** (Default) | Production / Local evaluation | `backend` (CAP + UI5 Fiori) | `4004` | `docker compose up -d` |
| **Dual-Container BTP Emulation** | CF/BTP architecture validation | `backend` + `approuter` | `4004`, `5000` | `docker compose --profile full up -d` |
| **Live Development** | Rapid full-stack development with watch | `backend` (with bind mounts) | `4004` | `npm run docker:dev` |

---

## Quick Start

### 1. Configure Environment

Copy the Docker environment template:

```bash
cp .env.docker.example .env
```

Edit `.env` to configure your SAP S/4HANA target system:

```properties
NODE_ENV=development
PORT=4004

# SAP S/4HANA Connection Configuration
S4_SYSTEM_NAME=S4HANA_DEV
S4_DESTINATION_URL=https://s4hana.your-company.com:44300
S4_CLIENT=220
S4_CONNECTION_TYPE=abap_catalog
S4_USERNAME=YOUR_SAP_USERNAME
S4_PASSWORD=YOUR_SAP_PASSWORD
S4_DESTINATION_NAME=S4HANA_PO_API
```

> [!NOTE]
> For standalone containerized execution without BTP service bindings, `NODE_ENV=development` is used. This enables CAP's built-in authentication with mock users (`khushal` / `S4_USERNAME`) and direct S/4HANA Gateway connectivity without requiring bound Cloud Foundry XSUAA or Destination services. For BTP/Cloud Foundry deployments with bound XSUAA and Destination services (`VCAP_SERVICES`), use `NODE_ENV=production`.

> [!WARNING]
> Never commit `.env` or files containing plain-text SAP credentials to source control. `.env` is ignored by `.gitignore` and `.dockerignore`.

---

### 2. Run with Docker Compose

#### Start the Standalone Stack (Backend + Fiori)

```bash
docker compose up -d
```

- **Fiori Application & Launchpad**: [http://localhost:4004](http://localhost:4004)
- **Health Check**: [http://localhost:4004/health](http://localhost:4004/health)
- **OData V4 Purchase Order**: [http://localhost:4004/odata/v4/purchase-order/$metadata](http://localhost:4004/odata/v4/purchase-order/$metadata)

#### Check Logs & Health

```bash
docker compose logs -f backend
docker compose ps
```

#### Stop the Stack

```bash
docker compose down
```

---

### 3. Run with Standalone App Router (Dual-Container Stack)

To run the complete BTP dual-container architecture with SAP Application Router acting as the reverse proxy on port 5000:

```bash
docker compose --profile full up -d
```

- **App Router Entry Point**: [http://localhost:5000](http://localhost:5000)
- **Direct CAP Service**: [http://localhost:4004](http://localhost:4004)

---

### 4. Development with Live Reload (Docker Dev Mode)

For continuous development where host file changes immediately reload inside the container:

```bash
npm run docker:dev
# or
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Host folders (`./srv`, `./app`, `./db`) are bind-mounted into the running container with hot-reloading enabled via `cds watch --exclude data`.

---

## Manual Docker CLI Commands

### Build Image Manually

```bash
# Production multi-stage build
docker build -t saps4hana-fullstack:latest .

# Development build
docker build -f Dockerfile.dev -t saps4hana-fullstack:dev .
```

### Run Container Directly

```bash
docker run -d \
  --name saps4hana-app \
  -p 4004:4004 \
  --env-file .env \
  saps4hana-fullstack:latest
```

### Verify Container Health

```bash
docker inspect --format='{{json .State.Health}}' saps4hana-app
curl -s http://localhost:4004/health
```

Output:
```json
{"status":"UP","uptime":120,"timestamp":"2026-11-23T06:45:00.000Z"}
```

---

## NPM Docker Scripts Reference

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run docker:build` | `docker build -t saps4hana-fullstack:latest .` | Build production multi-stage image |
| `npm run docker:build:dev` | `docker build -f Dockerfile.dev -t saps4hana-fullstack:dev .` | Build development image |
| `npm run docker:run` | `docker run -d --name saps4hana-app -p 4004:4004 --env-file .env ...` | Run production container |
| `npm run docker:up` | `docker compose up -d` | Start compose stack in background |
| `npm run docker:down` | `docker compose down` | Stop and remove compose stack |
| `npm run docker:dev` | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` | Run dev stack with hot-reload |

---

## Production Deployment Checklist

1. [ ] Target S/4HANA Gateway is accessible from the container network.
2. [ ] In production Kubernetes / Cloud environments, inject `S4_USERNAME` and `S4_PASSWORD` via Kubernetes Secrets or HashiCorp Vault, not directly in Dockerfiles.
3. [ ] Set container resource constraints (recommended: `memory: 512M` to `1G`, `cpu: 1.0`).
4. [ ] Configure health check probes in Kubernetes:
   - **Liveness Probe**: `httpGet: { path: /health, port: 4004 }`, `periodSeconds: 30`
   - **Readiness Probe**: `httpGet: { path: /health, port: 4004 }`, `periodSeconds: 10`
