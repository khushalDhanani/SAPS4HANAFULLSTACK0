namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

/**
 * Tracks Storage Units issued in an Inventory Management (IM) 261 Goods Issue
 * whose Warehouse Management (WM) Transfer Order has not yet been confirmed in LQUA.
 * Prevents double-allocation across concurrent or subsequent reservations.
 */
@cds.persistence.indexes: {
    ClaimLookupIdx: { element: [Material, Plant, StorageLocation, Status] }
}
entity GoodsIssueIssuedStorageUnit : cuid, managed {
    MaterialDocument : String(10);
    MaterialDocYear  : String(4);
    ReservationNo    : String(10);
    ReservationItem  : String(4);
    ReferenceDocument: String(16);
    StorageUnit      : String(20);
    Material         : String(40);
    Plant            : String(4);
    StorageLocation  : String(4);
    IssuedQty        : Decimal(13, 3);
    PreIssueStock    : Decimal(13, 3);
    Status           : String(20) default 'claiming'; // 'claiming' | 'issued' | 'released'
    ReleasedAt       : Timestamp;
    ReleaseReason    : String(50);
}
