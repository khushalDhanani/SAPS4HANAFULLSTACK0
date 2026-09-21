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
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity ShippingPointVH {
        key ShippingPoint          : String(4);
            ShippingPointName      : String(30);
            ShippingPoint_Text     : String(30);
            ActiveDepartureCountry : String(3);
    };

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'SalesManager', 'Admin'])
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
}
