namespace saps4hana.wm;

using { managed } from '@sap/cds/common';

/**
 * BusinessConfig — admin-maintained table that maps a plant/warehouse combination
 * to the SAP org/document-type customizing values required for SD and WM operations.
 *
 * This is the runtime source for all business-data values that were previously
 * hardcoded in package.json or environment variables.
 *
 * Key:   Plant + WarehouseNumber  (WarehouseNumber may be blank for plant-level rows
 *        that apply to all warehouses in the plant).
 *
 * Populated by admins via the BusinessConfigService OData API.
 * Resolved at request time by BusinessConfigResolver.
 */
@assert.unique: { plantWarehouse: [Plant, WarehouseNumber] }
@restrict: [
    { grant: 'READ', to: 'authenticated-user' },
    { grant: ['CREATE', 'UPDATE', 'DELETE', 'WRITE'], to: ['WarehouseManager', 'Admin'] }
]
entity BusinessConfig : managed {
    key Plant              : String(4)  not null;    // WERKS — SAP Plant (e.g. '1120')
    key WarehouseNumber    : String(3)  not null;    // LGNUM — WM Warehouse (e.g. 'W01'); '' = plant-level

    // ─── Sales / SD organisation ──────────────────────────────────────────────
    SalesOrganization      : String(4);              // VKORG (e.g. '1000')
    DistributionChannel    : String(2);              // VTWEG (e.g. '10')
    Division               : String(2);              // SPART (e.g. '52')
    Currency               : String(5);              // WAERS (e.g. 'INR')
    InquiryType            : String(4);              // SAP SD Inquiry document type (e.g. 'ZIN')
    OrderType              : String(4);              // SAP SD Order document type (e.g. 'ZDOM')
    ConditionType          : String(4);              // SAP SD pricing condition (e.g. 'ZPR1')

    // ─── Shipping / LE ────────────────────────────────────────────────────────
    // Comma-separated shipping point codes (e.g. '1120,1112,1108,1109')
    ShippingPoints         : String(200);            // Stored as CSV; parsed to array on read

    // ─── Material master filter ────────────────────────────────────────────────
    // Comma-separated material type codes for the sales material value help (e.g. 'ZFRT,FERT')
    SalesMaterialTypes     : String(100);            // Stored as CSV; parsed to array on read

    // ─── WM customizing ────────────────────────────────────────────────────────
    DifferenceStorageType  : String(3);              // T332 GI difference interim storage type (e.g. '999')
    // JSON array of { storageType, bin, reason } — stock-not-ready bin rules for mvt 261 (R4).
    // Empty string or null means the R4 rule is switched off for this warehouse.
    Mvt261NotReadyBinsJson : String(2000);           // JSON, parsed to array on read
    // Comma-separated, warehouse-specific HU storage-type policy; intentionally unseeded.
    PickableStorageTypes   : String(200);
    HoldStorageTypes       : String(200);
    InterimStorageTypes    : String(200);
    // Oversize-HU setting: “default BLOCK, pending the user's confirmation”.
    OversizeHuSelectionBehavior : String(5) default 'BLOCK';

    // ─── Descriptive ──────────────────────────────────────────────────────────
    Description            : String(100);            // Free-text note for admins
    Active                 : Boolean default true;   // false = row is draft/inactive, resolver skips it
}
