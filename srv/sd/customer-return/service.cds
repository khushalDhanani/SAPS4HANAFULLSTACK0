@(requires: 'authenticated-user')
service CustomerReturnService @(path: '/odata/v4/customer-return') {

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'FinanceViewer', 'Admin'])
    entity CustomerReturns {
        key CustomerReturn                     : String(10);
            CustomerReturnType                 : String(4);
            CustomerReturnType_Text            : String(20);
            SoldToParty                        : String(10);
            SoldToPartyName                    : String(80);
            ShipToParty                        : String(10);
            ShipToPartyName                    : String(80);
            ShippingCondition                  : String(2);
            ShippingCondition_Text             : String(20);
            CustomerReturnDate                 : Date;
            PricingDate                        : Date;
            ReturnsOrderReason                 : String(3);
            SDDocumentReasonText               : String(40);
            PurchaseOrderByCustomer            : String(35);
            ReferenceSDDocument                : String(10);
            ReferenceSDDocumentCategory        : String(4);
            SDDocumentCategoryName             : String(60);
            SalesOrganization                  : String(4);
            DistributionChannel                : String(2);
            OrganizationDivision               : String(2);
            TotalNetAmount                     : Decimal(15, 2);
            TransactionCurrency                : String(5);
            CreatedByUser                      : String(12);
            OverallSDDocumentRejectionSts      : String(1);
            OverallSDDocumentRejectionSts_Text : String(20);
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'FinanceViewer', 'Admin'])
    entity CustomerReturnItems {
        key CustomerReturn         : String(10);
        key CustomerReturnItem     : String(6);
            Material               : String(40);
            Material_Text          : String(40);
            MaterialGroup          : String(9);
            MaterialGroup_Text     : String(20);
            Batch                  : String(10);
            OrderQuantity          : Decimal(15, 3);
            OrderQuantityUnit      : String(3);
            NetAmount              : Decimal(15, 2);
            Currency               : String(5);
            DeliveryDate           : Date;
            ProductionPlant        : String(4);
            PlantName              : String(30);
            StorageLocation        : String(4);
            StorageLocationName    : String(16);
            ShippingPoint          : String(4);
            ShippingPoint_Text     : String(30);
            ReturnReason           : String(3);
            ReturnReason_Text      : String(40);
            ReferenceSDDocument    : String(10);
            ReferenceSDDocumentItem: String(6);
            GoodsMovementType      : String(3);
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'FinanceViewer', 'Admin'])
    function getReturnMetrics() returns {
        totalReturns        : Integer;
        totalNetValue       : Decimal(15, 2);
        poorQualityCount    : Integer;
        damagedTransitCount : Integer;
        otherReasonsCount   : Integer;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getReturnReasons() returns array of {
        ReasonCode : String(3);
        ReasonText : String(40);
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getCustomers(
        search : String,
        top    : Integer
    ) returns array of {
        Customer     : String(10);
        CustomerName : String(80);
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getMaterials(
        search : String,
        top    : Integer
    ) returns array of {
        Material      : String(40);
        Material_Text : String(40);
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getPlants() returns array of {
        Plant     : String(4);
        PlantName : String(30);
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getDocumentTypes() returns array of {
        CustomerReturnType      : String(4);
        CustomerReturnType_Text : String(40);
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getReferenceDocuments(
        search : String,
        top    : Integer
    ) returns array of {
        ReferenceSDDocument    : String(10);
        SDDocumentCategory     : String(4);
        SDDocumentCategoryName : String(60);
        SoldToParty            : String(10);
        SalesOrganization      : String(4);
        DistributionChannel    : String(2);
        Division               : String(2);
        DocumentDate           : Date;
    };

    @(requires: ['SalesRepresentative', 'SalesManager', 'Admin'])
    action createCustomerReturn(
        CustomerReturnType          : String(4),
        SoldToParty                 : String(10),
        ReturnsOrderReason          : String(3),
        ReferenceSDDocument         : String(10),
        ReferenceSDDocumentCategory : String(4),
        SalesOrganization           : String(4),
        DistributionChannel         : String(2),
        OrganizationDivision        : String(2),
        CustomerReturnDate          : Date,
        PurchaseOrderByCustomer     : String(35),
        Items                       : array of {
            Material                : String(40);
            OrderQuantity           : Decimal(15, 3);
            OrderQuantityUnit       : String(3);
            ProductionPlant         : String(4);
            StorageLocation         : String(4);
            ReturnReason            : String(3);
            ReferenceSDDocument     : String(10);
            ReferenceSDDocumentItem : String(6);
        }
    ) returns {
        CustomerReturn      : String(10);
        CustomerReturnType  : String(4);
        SoldToParty         : String(10);
        TotalNetAmount      : Decimal(15, 2);
        TransactionCurrency : String(5);
        Success             : Boolean;
        Message             : String;
    };
}
