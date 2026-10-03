namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

/**
 * One row per Goods Issue posting attempt, written BEFORE S/4HANA is called so that an attempt whose
 * outcome is unknown (timeout, crash mid-call) can be re-checked in SAP by its ReferenceDocument.
 * Never a business document: SAP stays the system of record (ADR-0001).
 */
@assert.unique: { referenceDocument: [ReferenceDocument] }
entity GoodsIssuePostingAttempt : cuid, managed {
    ReferenceDocument : String(16);   // sent to SAP as the material document header ReferenceDocument
    RequestHash       : String(64);
    MovementType      : String(3);
    ReservationNo     : String(10);
    ReservationItem   : String(4);
    Material          : String(40);
    Plant             : String(4);
    StorageLocation   : String(4);
    CostCenter        : String(10);
    IssueQty          : Decimal(13, 3);
    Unit              : String(10);
    PostingUser       : String(255);
    PostingDate       : Date;
    Status            : String(20);   // sending | posted | rejected | queued | unconfirmed | not_posted
    ResolvedAt        : Timestamp;
    MaterialDocument  : String(10);
    MaterialDocYear   : String(4);
    LastError         : String(500);
}
