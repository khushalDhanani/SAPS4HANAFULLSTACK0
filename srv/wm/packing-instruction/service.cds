namespace saps4hana.wm;

@(requires: 'authenticated-user')
service PackingInstructionService @(path: '/odata/v4/packing-instruction') {

    type PackingInstructionComponent {
        Item           : String(6);
        Material       : String(40);
        TargetQuantity : Decimal(15, 3);
        Unit           : String(3);
    };

    type PackingInstructionText { Language : String(2); Text : String(255); };

    type PackingInstruction {
        PackingInstructionSystemUUID   : String(36);
        PackingInstructionNumber       : String(20);
        PackingInstructionExternalName : String(20);
        HandlingUnitType               : String(4);
        Length                         : Decimal(13, 3);
        Width                          : Decimal(13, 3);
        Height                         : Decimal(13, 3);
        DimensionUnit                  : String(3);
        GrossWeight                    : Decimal(15, 3);
        WeightUnit                     : String(3);
        GrossVolume                    : Decimal(15, 3);
        VolumeUnit                     : String(3);
        IsDeleted                      : Boolean;
        CreatedByUser                  : String(12);
        CreationDate                   : Date;
        LastChangedByUser              : String(12);
        LastChangeDate                 : Date;
        Components                     : array of PackingInstructionComponent;
        Texts                          : array of PackingInstructionText;
    };

    type PackingInstructionListResult {
        TotalCount : Integer;
        SapCount   : Integer;
        Truncated  : Boolean;
        Items      : array of PackingInstruction;
    };

    // Read-only: list packing instruction headers (optional external-name contains filter).
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function list(externalName : String(20)) returns PackingInstructionListResult;

    // Read-only: one packing instruction with its components and texts.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function get(systemUUID : String(36)) returns PackingInstruction;

    // NOTE: a create action was NOT exposed. A live POST proof (2026-10-06, client 220) failed with
    // PI_RAP/003 "Incomplete data" for every informed payload (name, HandlingUnitType, units, external
    // number, LoadCarrierSystUUID); the required RAP field set is not discoverable from the service, so
    // per AGENTS.md no create path is shipped. See WORKSTATUS. Read-only until the required fields are known.
}
