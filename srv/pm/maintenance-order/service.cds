namespace saps4hana.pm;

@(requires: 'authenticated-user')
service MaintenanceOrderService @(path: '/odata/v4/maintenance-order') {

    type MaintenanceOrderItem {
        maintenanceOrder           : String(12);
        maintenanceOrderType       : String(4);
        maintenanceOrderTypeName   : String(60);
        maintenanceOrderDesc       : String(40);
        maintenancePlan            : String(12);
        maintenanceNotification    : String(12);
        maintenancePlanningPlant   : String(4);
        maintenancePlant           : String(4);
        plantName                  : String(40);
        planningPlantDiff          : String(4);
        mainWorkCenter             : String(8);
        equipment                  : String(18);
        equipmentName              : String(40);
        functionalLocation         : String(30);
        functionalLocationLabel    : String(40);
        functionalLocationName     : String(60);
        maintPriority              : String(1);
        systemStatusText           : String(40);
        userStatusText             : String(40);
        maintOrdBasicStartDate     : String(10); // formatted YYYY-MM-DD
        maintOrdBasicEndDate       : String(10);
        maintOrderCreationDate     : String(10); // formatted YYYY-MM-DD (UTC fallback)
        maintOrderCreationDateTime : String(30); // ISO UTC timestamp for browser-timezone display
        createdByUser              : String(12);
    };

    type MaintenanceOrderListResult {
        totalCount : Integer;
        items      : array of MaintenanceOrderItem;
    };

    type MaintenanceOrderMetrics {
        totalCount : Integer;
    };

    // Read-only: list maintenance orders with optional filters and paging.
    @(requires: ['Viewer', 'PurchasingManager', 'SalesRepresentative', 'SalesManager',
                 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function list(
        plant          : String(4),
        planningPlant  : String(4),
        mainWorkCenter : String(8),
        orderType      : String(4),
        priority       : String(1),
        searchQuery    : String(100),
        top            : Integer,
        skip           : Integer
    ) returns MaintenanceOrderListResult;

    // Read-only: total count of maintenance orders (for KPI tile).
    @(requires: ['Viewer', 'PurchasingManager', 'SalesRepresentative', 'SalesManager',
                 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getMetrics() returns MaintenanceOrderMetrics;
}
