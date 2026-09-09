namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

entity GoodsIssueQueue : cuid, managed {
    QueueReference        : String(40);
    ReservationNo         : String(10);
    ReservationItem       : String(4);
    OrderNo               : String(12);
    Material              : String(40);
    MaterialDesc          : String(80);
    Plant                 : String(4);
    StorageLocation       : String(4);
    StorageBin            : String(18);
    Batch                 : String(10);
    ExpiryDate            : Date;
    IssueQty              : Decimal(13, 3);
    Unit                  : String(10);
    DifferenceQty         : Decimal(13, 3);
    DifferenceReason      : String(4);
    DifferenceStorageType : String(3);
    FinalIssue            : Boolean;
    SyncStatus            : String(30);   // 'QUEUED', 'SYNCING', 'POSTED_IN_SAP', 'FAILED'
    SyncAttempts          : Integer default 0;
    LastSyncError         : String(500);
    SapMaterialDocument   : String(10);
    SapMaterialDocYear    : String(4);
    QueuedAt              : Timestamp;
    SyncedAt              : Timestamp;
}
