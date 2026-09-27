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
        Material       : String(40);
        MaterialDesc   : String(80);
        Plant          : String(4);
        StorageLocation: String(4);
        Batch          : String(10);
        AvailableStock : Decimal(13, 3);
        Unit           : String(3);
        StorageType    : String(3);
        StorageBin     : String(10);
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

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getTR(tbnum: String(10), lgnum: String(3)) returns TRHeader;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function checkSU(lenum: String(20), tbnum: String(10), lgnum: String(3)) returns StorageUnit;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createTO(
        lgnum            : String(3),
        tbnum            : String(10),
        tbpos            : String(4),
        lenum            : String(20),
        qty              : Decimal(13, 3),
        openQty          : Decimal(13, 3),
        unit             : String(3),
        confirmImmediate : Boolean
    ) returns TOConfirmation;
}
