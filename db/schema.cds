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
 * NOTE: All warehouse transactions post directly to SAP S/4HANA via standard OData/RFC APIs.
 * No local queue is persisted; S/4HANA remains the authoritative system of record.
 */

namespace saps4hana.fullstack;

// Lock notifications (dedupe and last seen lock state), until an SAP table replaces them
using from './admin/user-lock';

// Password expiry monitoring (snapshots, milestone tracking, health monitor)
using from './admin/password-expiry';
