# SAP S/4HANA Full-Stack Application Architecture

## 1. System Overview

This application delivers a modern SAP Fiori user experience for querying and creating Purchase Orders against SAP S/4HANA, orchestrated via an SAP Cloud Application Programming Model (CAP) service on SAP BTP Cloud Foundry.

Per [ADR-0001: Pure S/4HANA Integration Façade](../decisions/ADR-0001-s4-centric-integration-facade.md), the application follows **Option A** as a pure integration façade. All business domain logic, master data, validation, and persistence are owned by the SAP S/4HANA backend.

---

## 2. End-to-End Architecture Topology

```text
┌─────────────────────────────────────────────────────────────┐
│                    End User Web Browser                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   SAP BTP Cloud Foundry                     │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Application Router (saps4hana-approuter)    │  │
│  │     - Session Management & Security                   │  │
│  │     - Route Dispatching                               │  │
│  └──────────────┬───────────────────────────┬────────────┘  │
│                 │ /odata/v4/*               │ /*            │
│                 │ /auth/*                   │ Static Assets │
│                 ▼                           ▼               │
│  ┌──────────────────────────────┐  ┌─────────────────────┐  │
│  │     CAP Service (Node.js)    │  │  HTML5 App Repo     │  │
│  │       (saps4hana-srv)        │  │  (saps4hana-fiori)  │  │
│  │  - OData V4 Service          │  │  - UI5 XML Views    │  │
│  │  - Value Help Deduplication  │  │  - Controllers      │  │
│  │  - Draft Lifecycle Mgmt      │  │  - Component Bundle │  │
│  │  - Error Parsing             │  └─────────────────────┘  │
│  └──────────────┬───────────────┘                           │
│                 │                                           │
│                 │ Destination / Connectivity Service        │
└─────────────────┼───────────────────────────────────────────┘
                  │
                  ▼ Cloud Connector / Direct HTTPS
┌─────────────────────────────────────────────────────────────┐
│                   SAP S/4HANA Gateway                       │
│                                                             │
│  - C_PURCHASEORDER_FS_SRV (OData V2 - Read / Value Helps)   │
│  - MM_PUR_PO_MAINT_V2_SRV (OData V2 - Draft / Activation)   │
│  - Business Rules, Database Persistence & Commit Work       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Component Responsibilities

| Layer | Path | Responsibility | Boundary Restrictions |
|---|---|---|---|
| **Presentation** | `app/fiori-app/` | UI5/Fiori presentation, ViewModels, client validation, Value Help dialogs | No direct S/4 calls; no direct credentials; communicates only with CAP via `/odata/v4/purchase-order/`. |
| **Routing** | `app/router/` | Standalone Approuter, central entry point, authentication gateway, route dispatching | Stateless proxy; routes only to registered destinations and HTML5 repo. |
| **CAP Service** | `srv/` | OData V4 projection, CSRF token handling, S/4 session cookie management, payload normalization, error translation | Communicates with S/4 strictly via `srv/integration/s4hana/`. |
| **S/4 Integration** | `srv/integration/s4hana/` | S/4HANA technical adapter, HTTP client, CSRF fetch, draft creation, line scheduling, and document activation | Exclusive location for S/4 technical HTTP and OData communication. |
| **Persistence** | `db/` | Application-owned state only: the Goods Issue dispatch queue (`saps4hana.wm.GoodsIssueQueue`) in an HDI container | S/4 remains the system of record for every business document; the queue holds transactions SAP has not yet accepted and never claims SAP persistence (ADR-0001 addendum 2026-09-14). |

---

## 4. Multi-Target Application (MTA) Deployment Topology

The deployment architecture is defined in `mta.yaml`:

### Modules
1. `saps4hana-approuter` (`app/router`): Application entry point routing requests to CAP or HTML5 Repository.
2. `saps4hana-srv` (`gen/srv`): CAP Node.js backend executing business orchestration.
3. `saps4hana-fiori-app` (`app/fiori-app`): UI5 build module producing the optimized distribution bundle.
4. `saps4hana-app-deployer` (`gen`): Deploys the built UI5 zip archive to the BTP HTML5 Application Repository.
5. `saps4hana-db-deployer` (`gen/db`): Deploys the HDI design-time artifacts of the dispatch queue into the `saps4hana-db` container.

### Backing Service Resources
1. `saps4hana-auth` (`xsuaa`): BTP OAuth2 authorization service enforcing role templates.
2. `saps4hana-destination` (`destination`): Manages outbound HTTP destinations to the S/4HANA Gateway.
3. `saps4hana-connectivity` (`connectivity`): Manages secure proxy tunnels via SAP Cloud Connector.
4. `saps4hana-html5-repo-host` / `saps4hana-html5-runtime`: Hosts and serves the UI5 frontend.
5. `saps4hana-db` (`hana`, plan `hdi-shared`): HDI container for the Goods Issue dispatch queue; bound to `saps4hana-srv`. Requires a SAP HANA Cloud instance mapped to the space.

---

## 5. Security & Credential Isolation

- **Zero Hardcoded Secrets**: All credentials and backend hosts are externalized via BTP Destination service and environment configuration (`.env.local` for local development, BTP service bindings for production).
- **Session & CSRF Protection**: The CAP S/4 adapter dynamically manages CSRF tokens and SAP session cookies across multiple sequential Gateway requests (Draft Create → Draft Activate).
- **Tenant Isolation**: Dedicated tenant mode configured in `xs-security.json` with one scope, role template and role collection per application role (Viewer, Admin, PurchasingManager, FinanceViewer, SalesRepresentative, SalesManager, WarehouseClerk, WarehouseManager).
