namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

/**
 * Goods Receipt Posting-Attempt Persistence Entity.
 *
 * Persisted in SAP HANA Cloud HDI container to enforce At-Most-Once / Idempotent posting guarantees.
 * Every row is committed BEFORE S/4HANA transactional mutations (BAPIs/OData) are dispatched.
 *
 * Serves as the attempt log for Goods Receipts (Movement 101):
 * ReservationNo/ReservationItem hold Inbound Delivery and POSNR.
 */
@assert.unique: { referenceDocument: [ReferenceDocument] }
entity GoodsReceiptPostingAttempt : cuid, managed {
    // -------------------------------------------------------------------------
    // Tier 1: Generic Lifecycle & Idempotency Attributes
    // -------------------------------------------------------------------------
    ReferenceDocument : String(16) not null;   // Idempotency reference key / SAP header reference
    RequestHash       : String(64);            // Hash of normalized input payload
    MovementType      : String(3);             // SAP movement type (101)
    Status            : String(20);            // sending | posted | rejected | unconfirmed | not_posted
    ResolvedAt        : Timestamp;             // Timestamp when finalized into terminal status
    PostingUser       : String(255);           // Authenticated user ID executing the attempt
    PostingDate       : Date;                  // Posting date passed to S/4HANA
    LastError         : String(500);           // Rejection reason, diagnostic message, or distributed lease tag

    // -------------------------------------------------------------------------
    // Tier 2: S/4HANA Confirmed Document Attributes (Populated upon SAP persistence)
    // -------------------------------------------------------------------------
    MaterialDocument  : String(10);            // SAP Material Document number (MBLNR)
    MaterialDocYear   : String(4);             // SAP Material Document fiscal year (MJAHR)
    DeliveryNumber    : String(10);            // Delivery number

    // -------------------------------------------------------------------------
    // Tier 3: Contextual Business Attributes (Correlated for reconciliation & audit)
    // -------------------------------------------------------------------------
    ReservationNo     : String(10);            // Inbound Delivery number
    ReservationItem   : String(6);             // Inbound Delivery item (POSNR)
    Material          : String(40);            // Material number
    Plant             : String(4);             // Plant
    StorageLocation   : String(4);             // Storage location
    CostCenter        : String(10);            // Cost center
    IssueQty          : Decimal(13, 3);        // Quantity attempted
    Unit              : String(10);            // Unit of measure
}
