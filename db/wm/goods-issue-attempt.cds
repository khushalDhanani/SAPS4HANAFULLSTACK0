namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

/**
 * One row per Goods Issue posting attempt, written BEFORE S/4HANA is called so that an attempt whose
 * outcome is unknown (timeout, crash mid-call) can be re-checked in SAP by its ReferenceDocument.
 * Goods receipts (MovementType 101) share this log: ReservationNo/ReservationItem hold the inbound delivery
 * and its item, ReferenceDocument never reaches SAP, and the re-check finds them through MATDOC instead.
 * Never a business document: SAP stays the system of record (ADR-0001).
 */
@assert.unique: { referenceDocument: [ReferenceDocument] }
entity GoodsIssuePostingAttempt : cuid, managed {
    ReferenceDocument : String(16);   // sent to SAP as the material document header ReferenceDocument
    RequestHash       : String(64);
    MovementType      : String(3);
    ReservationNo     : String(10);
    ReservationItem   : String(6);    // 6 for delivery items (POSNR), e.g. batch-split item 900001
    Material          : String(40);
    Plant             : String(4);
    StorageLocation   : String(4);
    CostCenter        : String(10);
    IssueQty          : Decimal(13, 3);
    Unit              : String(10);
    PostingUser       : String(255);
    PostingDate       : Date;
    Status            : String(20);   // sending | posted | rejected | queued | unconfirmed | not_posted | delivery_created
    ResolvedAt        : Timestamp;
    MaterialDocument  : String(10);
    MaterialDocYear   : String(4);
    DeliveryNumber    : String(10);   // outbound delivery SAP created instead of a document (L9/514)
    LastError         : String(500);
}
