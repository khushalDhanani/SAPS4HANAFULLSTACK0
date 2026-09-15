/**
 * SAP S/4HANA Full-Stack Purchase Order Persistence Model
 *
 * ARCHITECTURAL DECISION: Option A — Pure S/4HANA Integration Façade
 * (Reference: docs/decisions/ADR-0001-s4-centric-integration-facade.md)
 *
 * This application operates strictly as an intelligent integration and orchestration
 * façade over SAP S/4HANA. All business persistence, master data, transactional state,
 * and approval lifecycles are owned directly by the SAP S/4HANA system of record via:
 *   - C_PURCHASEORDER_FS_SRV (OData V2 read & value helps)
 *   - MM_PUR_PO_MAINT_V2_SRV (OData V2 draft & activation)
 *
 * Consequently, no business documents are stored locally.
 *
 * ADDENDUM (2026-09-14, see ADR-0001): the only application-owned state is the Goods Issue
 * dispatch queue (db/wm/goods-issue-queue.cds), persisted in the HDI container 'saps4hana-db'
 * on Cloud Foundry and in the in-memory SQLite database of @cap-js/sqlite for local development
 * and tests. It holds transactions S/4HANA has not yet accepted and never claims SAP persistence.
 */

namespace saps4hana.fullstack;

// Intentionally empty — business persistence delegated completely to SAP S/4HANA.
