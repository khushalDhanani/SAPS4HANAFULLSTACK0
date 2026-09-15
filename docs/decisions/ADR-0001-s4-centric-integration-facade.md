# ADR-0001: Pure S/4HANA Integration Façade Architecture

## Status
**Accepted** (2026-09-05)

## Context
The SAP S/4HANA Full-Stack Purchase Order application provides a modern Fiori interface backed by SAP Cloud Application Programming Model (CAP) for viewing and creating Purchase Orders in SAP S/4HANA.

During architectural review of the persistence layer (`db/schema.cds`), it was noted that the schema file was empty. Two distinct architectural choices were evaluated:

1. **Option A — Pure S/4HANA Integration Façade**:
   The CAP application functions as an intelligent integration and orchestration layer. All business persistence, transactional state, master data, pricing routines, and validation rules remain solely within the SAP S/4HANA system of record.
2. **Option B — Full CAP Domain Application**:
   The CAP application provisions a local SAP HANA Cloud database (HDI container) to persist local shadow entities, draft models, audit logs, or approval workflows before publishing them to S/4HANA.

## Decision
We adopt **Option A — Pure S/4HANA Integration Façade**.

The application will maintain zero local database persistence. S/4HANA Gateway services (`C_PURCHASEORDER_FS_SRV` and `MM_PUR_PO_MAINT_V2_SRV`) act as the single source of truth for:
- Purchase Order headers, items, and schedule lines.
- Master data Value Helps (Suppliers, Company Codes, Purchasing Orgs/Groups, Plants, Storage Locations, Tax Codes, Currencies, Units of Measure).
- Draft creation, server-side validation, and document activation.

## Consequences
### Positive:
- **Single Source of Truth**: Eliminates data duplication, dual-write anomalies, and synchronization overhead between BTP and S/4HANA.
- **Resource & Cost Optimization**: Eliminates the need to provision, license, and maintain an SAP HANA Cloud HDI container on SAP BTP, directly reducing operational expenditure and cloud quota consumption.
- **Simplified Deployment Topology**: The MTA deployment descriptor (`mta.yaml`) is streamlined: no `saps4hana-db-deployer` module or `com.sap.xs.hdi-container` resource is required.
- **Real-Time Accuracy**: Eliminates stale data issues by executing live read and write operations against the S/4HANA Gateway.

### Negative / Trade-offs:
- **Backend Availability Dependency**: Read and write capabilities depend directly on S/4HANA Gateway availability and network connectivity.
- **No Local Offline Caching**: Requests are executed directly; caching or local queuing must be handled via specific middleware services if needed in future phases.

## Compliance
- `db/schema.cds` is annotated to clearly reflect this architectural decision.
- `mta.yaml` defines modules for `approuter`, `srv` (CAP), and `fiori-app`, with backing services for `XSUAA`, `Destination`, `Connectivity`, and `HTML5 Application Repository`.

## Addendum (2026-09-14): HDI container for the Goods Issue dispatch queue

### Context
The warehouse Goods Issue module queues movement-261 postings that S/4HANA cannot accept at posting time (posting service not activated or not authorised) so that they can be retried later. This queue is application-owned state: it holds transactions that do **not** yet exist in S/4HANA. It was first implemented as a JSON file on local disk, which is not durable on Cloud Foundry and is not shared between application instances.

### Decision
Option A stays in force for all business documents: S/4HANA remains the single source of truth for purchase orders, sales documents, journal entries, stock, batches and warehouse objects, and nothing is cached or shadowed locally.

For the dispatch queue only, the application provisions an SAP HANA Cloud HDI container (`saps4hana-db`, plan `hdi-shared`) deployed by `saps4hana-db-deployer` from `gen/db`, holding the single entity `saps4hana.wm.GoodsIssueQueue` (`db/wm/goods-issue-queue.cds`). Local development and automated tests use the in-memory SQLite database of `@cap-js/sqlite` and need no HANA.

### Consequences
- The "no HDI container" cost argument of Option A no longer applies; the marginal cost is nil where the subaccount already runs a HANA Cloud instance and is the price of one instance otherwise.
- Queue records are durable across restarts and visible to every application instance.
- Without a bound database (for example a deployment that omits the container), the queue is unavailable: `getQueueSummary` reports `StoreAvailable: false`, reads are empty, and a failed SAP posting is returned to the user as an error instead of a queued success. Nothing is ever recorded locally in that case.
- Queued items are always marked `QUEUED` / `FAILED` until S/4HANA confirms a material document; the queue never claims SAP persistence (AGENTS.md).
