namespace saps4hana.wm;

@(requires: 'authenticated-user')
service TrToService @(path: '/odata/v4/tr-to') {

    type TRItem {
        Lgnum             : String(3);
        Tbnum             : String(10);
        Tbpos             : String(4);
        Material          : String(40);
        MaterialDesc      : String(80);
        Plant             : String(4);
        StorageLocation   : String(4);
        Batch             : String(10);
        RequiredQty       : Decimal(13, 3);
        ProcessedQty      : Decimal(13, 3);
        OpenQty           : Decimal(13, 3);
        Unit              : String(3);
        DeliveryCompleted : Boolean;
        DestStorageType   : String(3);
        DestStorageBin    : String(10);
    };

    type TRHeader {
        Lgnum   : String(3);
        Tbnum   : String(10);
        Bwlvs   : String(3);
        Betyp   : String(1);
        Benum   : String(10);
        Rsnum   : String(10);
        Bdatu   : Date;
        Statu   : String(1);
        Vltyp   : String(3);
        Vlpla   : String(10);
        Nltyp   : String(3);
        Nlpla   : String(10);
        Items   : array of TRItem;
    };

    type SUQuant {
        Lgnum          : String(3);
        QuantNumber    : String(10);
        StorageUnit    : String(20);
        Tbpos          : String(4);
        Material       : String(40);
        MaterialDesc   : String(80);
        Plant          : String(4);
        StorageLocation: String(4);
        Batch          : String(10);
        AvailableStock : Decimal(13, 3);
        Unit           : String(3);
        StorageType    : String(3);
        StorageBin     : String(10);
        DisplayText    : String(120);
        Description    : String(120);
    };

    type StorageUnit {
        Lgnum        : String(3);
        StorageUnit  : String(20);
        Tbnum        : String(10);
        StorageType  : String(3);
        StorageBin   : String(10);
        SUType       : String(3);
        IsValid      : Boolean;
        ErrorCode    : String(20);
        ErrorMessage : String(220);
        Quants       : array of SUQuant;
    };

    type TOConfirmation {
        TransferOrder : String(10);
        Success       : Boolean;
        Message       : String(220);
        Confirmed     : Boolean;
    };

    type TOProcessResult {
        TransferOrder       : String(10);
        TransferRequirement : String(10);
        TRItem              : String(4);
        ReservationNo       : String(10);
        ReservationItem     : String(4);
        Status              : String(2);
        StatusText          : String(40);
        Confirmed           : Boolean;
        Material            : String(40);
        MaterialName        : String(80);
        Quantity            : Decimal(13, 3);
        Unit                : String(3);
        Batch               : String(10);
        Serials             : array of String(18);
        Success             : Boolean;
        Message             : String(255);
    };

    type TRDetail {
        TransferRequirement     : String(10);
        TRItem                  : String(4);
        WarehouseNumber         : String(3);
        MovementType            : String(3);
        RequirementType         : String(1);
        RequirementNumber       : String(10);
        ReservationNo           : String(10);
        ReservationItem         : String(4);
        Material                : String(40);
        MaterialName            : String(80);
        Plant                   : String(4);
        StorageLocation         : String(4);
        DestinationStorageType  : String(3);
        DestinationStorageBin   : String(10);
        SourceStorageType       : String(3);
        SourceStorageBin        : String(10);
        RequiredQuantity        : Decimal(13, 3);
        ProcessedQuantity       : Decimal(13, 3);
        OpenQuantity            : Decimal(13, 3);
        Unit                    : String(3);
        Batch                   : String(10);
        IsBatchManaged          : Boolean;
        IsSerialManaged         : Boolean;
        DeliveryCompleted       : Boolean;
        Status                  : String(2);
        StatusText              : String(40);
    };

    type TRListItem {
        Lgnum        : String(3);
        Tbnum        : String(10);
        Bwlvs        : String(3);
        Betyp        : String(1);
        Benum        : String(10);
        Rsnum        : String(10);
        Bdatu        : Date;
        Statu        : String(1);
        DisplayText  : String(120);
        Description  : String(120);
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getOpenTRs(lgnum: String(3), mvt: String(3)) returns array of TRListItem;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getTR(tbnum: String(10), lgnum: String(3)) returns TRHeader;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function lookupTR(tbnum: String(10), lgnum: String(3)) returns TRDetail;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getAvailableSUs(tbnum: String(10), lgnum: String(3), tbpos: String(4)) returns array of SUQuant;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function checkSU(lenum: String(20), tbnum: String(10), lgnum: String(3)) returns StorageUnit;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    // Create only (as RF transaction ZTO); item, unit and limits are derived from SAP server-side.
    action createTO(
        lgnum : String(3),
        tbnum : String(10),
        lenum : String(20),
        qty   : Decimal(13, 3)
    ) returns TOConfirmation;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createTOFromTR(
        lgnum       : String(3),
        tbnum       : String(10),
        tbpos       : String(4),
        qty         : Decimal(13, 3),
        unit        : String(3),
        batch       : String(10),
        serials     : array of String(18),
        storageUnit : String(20),
        autoConfirm : Boolean
    ) returns TOProcessResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action CreateTOFromTR(
        lgnum       : String(3),
        tbnum       : String(10),
        tbpos       : String(4),
        qty         : Decimal(13, 3),
        unit        : String(3),
        batch       : String(10),
        serials     : array of String(18),
        storageUnit : String(20),
        autoConfirm : Boolean
    ) returns TOProcessResult;
}
