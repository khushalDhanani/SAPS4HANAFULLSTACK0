namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

/**
 * Shared Posting-Attempt Persistence Entity (ADR-0001, Finding DEBT-01).
 *
 * Persisted in SAP HANA Cloud HDI container to enforce At-Most-Once / Idempotent posting guarantees.
 * Every row is committed BEFORE S/4HANA transactional mutations (BAPIs/OData) are dispatched.
 *
 * Serves as the shared attempt log for:
 * 1. Goods Issues (Movement 261/201/...): ReferenceDocument sent in header (BKTXT/XBLNR) for MATDOC correlation.
 * 2. Goods Receipts (Movement 101): ReservationNo/ReservationItem hold Inbound Delivery and POSNR.
 *
 * Complete lifecycle specification: docs/architecture/posting-attempt-lifecycle.md
 */
@assert.unique: { referenceDocument: [ReferenceDocument] }
entity GoodsIssuePostingAttempt : cuid, managed {
    // -------------------------------------------------------------------------
    // Tier 1: Generic Lifecycle & Idempotency Attributes
    // -------------------------------------------------------------------------
    ReferenceDocument : String(16) not null;   // Idempotency reference key / SAP header reference
    RequestHash       : String(64);            // Hash of normalized input payload
    MovementType      : String(3);             // SAP movement type (101, 261, 201, ...)
    Status            : String(20);            // sending | posted | rejected | queued | unconfirmed | not_posted | delivery_created
    ResolvedAt        : Timestamp;             // Timestamp when finalized into terminal status
    PostingUser       : String(255);           // Authenticated user ID executing the attempt
    PostingDate       : Date;                  // Posting date passed to S/4HANA
    LastError         : String(500);           // Rejection reason, diagnostic message, or distributed lease tag

    // -------------------------------------------------------------------------
    // Tier 2: S/4HANA Confirmed Document Attributes (Populated upon SAP persistence)
    // -------------------------------------------------------------------------
    MaterialDocument  : String(10);            // SAP Material Document number (MBLNR)
    MaterialDocYear   : String(4);             // SAP Material Document fiscal year (MJAHR)
    DeliveryNumber    : String(10);            // Outbound delivery SAP created instead of a document (L9/514)

    // -------------------------------------------------------------------------
    // Tier 3: Contextual Business Attributes (Correlated for reconciliation & audit)
    // -------------------------------------------------------------------------
    ReservationNo     : String(10);            // Reservation number or Inbound Delivery number
    ReservationItem   : String(6);             // Reservation item or Inbound Delivery item (POSNR)
    Material          : String(40);            // Material number
    Plant             : String(4);             // Plant
    StorageLocation   : String(4);             // Storage location
    CostCenter        : String(10);            // Cost center
    IssueQty          : Decimal(13, 3);        // Quantity attempted
    Unit              : String(10);            // Unit of measure
}
