namespace saps4hana.le;

@(requires: 'authenticated-user')
service OutboundDeliveryService @(path: '/odata/v4/outbound-delivery') {

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity OrdersDueForDelivery {
        key SalesOrder                  : String(10);
        key SalesOrderItem              : String(6);
        key ScheduleLine                : String(4);
            ShippingPoint               : String(4);
            DeliveryCreationDate        : Date;
            DeliveryPriority            : String(2);
            Route                       : String(6);
            ForwardingAgent             : String(10);
            GoodsIssueDate              : Date;
            ShipToParty                 : String(10);
            DelivBlockReasonForSchedLine: String(2);
            SalesDocApprovalStatus      : String(10);
            IsDeliverable               : Boolean;
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity ShippingPointVH {
        key ShippingPoint          : String(4);
            ShippingPointName      : String(30);
            ShippingPoint_Text     : String(30);
            ActiveDepartureCountry : String(3);
    };

    @(requires: ['SalesRepresentative', 'WarehouseClerk', 'WarehouseManager', 'SalesManager', 'Admin'])
    action createOutboundDelivery(
        SalesOrder   : String,
        ShippingPoint: String,
        DeliveryDate : Date
    ) returns String;

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getDefaultShippingPoint() returns {
        ShippingPoint : String;
        ShippingPoints: array of String;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getDeliveryStatus(DeliveryDocument : String) returns {
        DeliveryDocument             : String;
        DeliveryDocumentType         : String;
        ShippingPoint                : String;
        SoldToParty                  : String;
        SalesOrganization            : String;
        OverallPickingStatus         : String;
        OverallGoodsMovementStatus   : String;
        OverallDelivReltdBillgStatus : String;
        OverallSDProcessStatus       : String;
        ActualGoodsMovementDate      : String;
    };

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'SalesManager', 'Admin'])
    action postGoodsIssue(DeliveryDocument : String) returns {
        DeliveryDocument : String;
        Done             : Boolean;
        ErrorFlags       : array of String;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getBillingDocumentTypes(DeliveryDocument : String) returns array of {
        BillingDocumentType     : String;
        BillingDocumentTypeName : String;
    };

    @(requires: ['SalesRepresentative', 'SalesManager', 'Admin'])
    action createBillingDocument(DeliveryDocument : String, BillingDocumentType : String, BillingDocumentDate : Date) returns {
        BillingDocument : String;
        BillToParty     : String;
        BillToPartyName : String;
        Messages        : array of { MessageType : String; MessageId : String; Message : String; };
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getOrdersDueMetrics() returns {
        scheduleLineCount     : Integer;
        readyToDeliverCount   : Integer;
        inApprovalCount       : Integer;
        shippingPointCount    : Integer;
        distinctOrdersCount   : Integer;
        readyOrdersCount      : Integer;
        inApprovalOrdersCount : Integer;
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity DeliveryWithoutRefTypes {
        key DeliveryDocumentType         : String(4);
            DeliveryDocumentTypeName     : String(20);
            SDDocumentCategory           : String(4);
            PrecedingDocumentRequirement : String(1);
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity DeliveryWithoutRefShipToParties {
        key Customer     : String(10);
            CustomerName : String(80);
            CityName     : String(40);
            Country      : String(3);
    };

    type DeliveryItemInput {
        Material               : String;
        ActualDeliveryQuantity : Decimal(13,3);
        DeliveryQuantityUnit   : String;
    };

    @(requires: ['SalesRepresentative', 'WarehouseClerk', 'WarehouseManager', 'SalesManager', 'Admin'])
    action createDeliveryWithoutRef(
        ShippingPoint         : String,
        DeliveryDocumentType  : String,
        SalesOrganization     : String,
        DistributionChannel   : String,
        Division              : String,
        ShipToParty           : String,
        Plant                 : String,
        StorageLocation       : String,
        PlannedGoodsIssueDate : Date,
        Items                 : array of DeliveryItemInput
    ) returns {
        OutboundDelivery      : String;
        ShippingPoint         : String;
        DeliveryDocumentType  : String;
        PlannedGoodsIssueDate : String;
        Plant                 : String;
        StorageLocation       : String;
        ShipToParty           : String;
        ItemCount             : Integer;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getDeliveryWithoutRef(OutboundDelivery : String) returns {
        OutboundDelivery             : String;
        ShippingPoint                : String;
        ShippingPointName            : String;
        DeliveryDocumentType         : String;
        DeliveryDocumentTypeName     : String;
        SalesOrganization            : String;
        DistributionChannel          : String;
        Division                     : String;
        ShipToParty                  : String;
        CustomerName                 : String;
        PlannedGoodsIssueDate        : String;
        Plant                        : String;
        PlantName                    : String;
        StorageLocation              : String;
        StorageLocationName          : String;
        Items                        : array of {
            OutboundDelivery         : String;
            DeliveryDocumentItem     : String;
            Material                 : String;
            MaterialName             : String;
            ActualDeliveryQuantity   : Decimal(13,3);
            DeliveryQuantityUnit     : String;
            UnitOfMeasureLongName    : String;
        };
    };
}
