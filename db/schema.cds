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
 * NOTE: All Goods Issue transactions post directly to SAP S/4HANA via API_MATERIAL_DOCUMENT_SRV.
 * No dispatch queue is persisted; S/4HANA remains the authoritative system of record.
 */

namespace saps4hana.fullstack;

// Warehouse Management Persistence (Tracking & Logging)
using from './wm/goods-issue-attempt';
using from './wm/reservation-track';
