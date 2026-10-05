namespace saps4hana.wm;

@(requires: 'authenticated-user')
service Mvt261Service @(path: '/odata/v4/mvt261') {

    type Mvt261Row {
        Rank                   : Integer;
        MaterialDocument       : String(10);
        MaterialDocumentYear   : String(4);
        MaterialDocumentItem   : String(4);
        PostingDate            : Date;
        EntryTimestamp         : Timestamp;
        Material               : String(40);
        MaterialName           : String(40);
        Plant                  : String(4);
        StorageLocation        : String(4);
        ProductionOrder        : String(12);
        Quantity               : Decimal(13, 3);
        Unit                   : String(3);
        IsAutomaticallyCreated : Boolean;
        IsReversed             : Boolean;
        ReversedBy             : String(20);
        CreatedByUser          : String(12);
    };

    // Top[0] is the first document; Top holds its neighbours in sort order as proof.
    type Mvt261Result {
        Definition : String(1);
        SortKey    : String(60);
        TotalCount : Integer;
        Top        : array of Mvt261Row;
    };

    type Open261Item {
        Reservation       : String(10);
        ReservationItem   : String(4);
        RecordType        : String(1);
        ProductionOrder   : String(12);
        OrderDescription  : String(40);
        Material          : String(40);
        MaterialName      : String(40);
        Plant             : String(4);
        StorageLocation   : String(4);
        RequirementDate   : Date;
        RequiredQuantity  : Decimal(13, 3);
        WithdrawnQuantity : Decimal(13, 3);
        OpenQuantity      : Decimal(13, 3);
        Unit              : String(3);
        MovementAllowed   : Boolean;
    };

    // SapOpenCount = items SAP holds as open (not deleted, not final-issued); TotalCount = items returned.
    type Open261Result {
        TotalCount   : Integer;
        SapOpenCount : Integer;
        Truncated    : Boolean;
        Items        : array of Open261Item;
    };

    // Read-only: open movement type 261 reservation items. Dates YYYY-MM-DD (requirement date).
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function openItems(
        plant                 : String(4),
        material              : String(40),
        productionOrder       : String(12),
        reservation           : String(10),
        dateFrom              : String(10),
        dateTo                : String(10),
        includeFullyWithdrawn : Boolean
    ) returns Open261Result;

    // Read-only: first goods movement of movement type 261. definition A | B | C, dates YYYY-MM-DD.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function findFirst(
        plant           : String(4),
        material        : String(40),
        productionOrder : String(12),
        dateFrom        : String(10),
        dateTo          : String(10),
        definition      : String(1),
        excludeReversed : Boolean,
        manualOnly      : Boolean
    ) returns Mvt261Result;
}
