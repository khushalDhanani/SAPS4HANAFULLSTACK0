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
    Batch                 : String(10);
    ExpiryDate            : Date;
    IssueQty              : Decimal(13, 3);
    Unit                  : String(10);
    DifferenceQty         : Decimal(13, 3);
    DifferenceReason      : String(4);
    DifferenceStorageType : String(3);
    FinalIssue            : Boolean;
    MovementType          : String(3) default '261';
    ReceivingPlant        : String(4);
    ReceivingStorageLocation : String(4);
    CostCenter            : String(10);
    GLAccount             : String(10);
    SerialNumber          : String(18);
    StorageUnits          : LargeString;
    PostingDate           : Date;
    DocumentDate          : Date;
    ReferenceDocument     : String(16);   // idempotency reference sent to SAP; checked before replay
    SyncStatus            : String(30);   // 'QUEUED', 'SYNCING', 'POSTED_IN_SAP', 'FAILED'
    SyncAttempts          : Integer default 0;
    LastSyncError         : String(500);
    SapMaterialDocument   : String(10);
    SapMaterialDocYear    : String(4);
    QueuedAt              : Timestamp;
    SyncedAt              : Timestamp;
}
