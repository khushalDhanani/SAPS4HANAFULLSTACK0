const SERVICE_PATH = '/sap/opu/odata/sap/SD_F2651_CRT_CREATE_SRV';
const TRANSACTIONAL_SERVICE_PATH = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
const HEADER_ENTITY_SET = 'C_CustomerReturnOPg';
const ITEM_ENTITY_SET = 'C_CustomerReturnItemOPg';
const REASON_VH_SET = 'C_ReturnsOrderReasonVH';
const REF_DOC_VH_SET = 'C_ReturnsReferenceDocVH';
const SOLD_TO_VH_SET = 'C_SoldToValueHelp';
const MATERIAL_VH_SET = 'I_MaterialStdVH';
const PLANT_VH_SET = 'I_AllwdPlantsPerSlsOrgVH';
const DOC_TYPE_VH_SET = 'C_CustomerReturnTypeManageVH';

const DEFAULT_RETURN_TYPE = 'ZRET'; // Standard Return Order Type in Client 220
const MAX_READBACK_ATTEMPTS = 3;
const READBACK_DELAYS_MS = [0, 800, 1500];

/**
 * Strips client authorization headers from options so they never override S4HttpClient
 * configured destination credentials (e.g. S4_USERNAME / S4_PASSWORD).
 *
 * @param {Object} options
 * @returns {Object}
 */
function _cleanOptions(options = {}) {
  const clean = { ...options };
  if (clean.headers) {
    const safeHeaders = { ...clean.headers };
    delete safeHeaders.authorization;
    delete safeHeaders.Authorization;
    clean.headers = safeHeaders;
  }
  return clean;
}

/**
 * Helper to pause execution.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parses an OData v2 /Date(ms)/ timestamp to ISO Date format (YYYY-MM-DD).
 *
 * @param {string|Date} dateVal
 * @returns {string|null}
 */
function _parseODataV2Date(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
    if (match) {
      const d = new Date(parseInt(match[1], 10));
      return d.toISOString().slice(0, 10);
    }
  }
  if (dateVal instanceof Date) {
    return dateVal.toISOString().slice(0, 10);
  }
  return String(dateVal);
}

/**
 * Normalizes a raw SAP C_CustomerReturnOPg row to a clean domain object.
 *
 * @param {Object} row
 * @returns {Object|null}
 */
function _formatReturnHeaderRow(row) {
  if (!row) return null;
  return {
    CustomerReturn: String(row.CustomerReturn || '').trim(),
    CustomerReturnType: row.CustomerReturnType || '',
    CustomerReturnType_Text: row.CustomerReturnType_Text || '',
    SoldToParty: row.SoldToParty || '',
    SoldToPartyName: row.SoldToPartyName || '',
    ShipToParty: row.ShipToParty || '',
    ShipToPartyName: row.ShipToPartyName || '',
    ShippingCondition: row.ShippingCondition || '',
    ShippingCondition_Text: row.ShippingCondition_Text || '',
    CustomerReturnDate: _parseODataV2Date(row.CustomerReturnDate),
    PricingDate: _parseODataV2Date(row.PricingDate),
    ReturnsOrderReason: row.ReturnsOrderReason || '',
    SDDocumentReasonText: row.SDDocumentReasonText || '',
    PurchaseOrderByCustomer: row.PurchaseOrderByCustomer || '',
    ReferenceSDDocument: row.ReferenceSDDocument || '',
    ReferenceSDDocumentCategory: row.ReferenceSDDocumentCategory || '',
    SDDocumentCategoryName: row.SDDocumentCategoryName || '',
    SalesOrganization: row.SalesOrganization || '',
    DistributionChannel: row.DistributionChannel || '',
    OrganizationDivision: row.OrganizationDivision || '',
    TotalNetAmount: row.TotalNetAmount !== null && row.TotalNetAmount !== undefined ? Number(row.TotalNetAmount) : null,
    TransactionCurrency: row.TransactionCurrency || '',
    CreatedByUser: row.CreatedByUser || '',
    OverallSDDocumentRejectionSts: row.OverallSDDocumentRejectionSts || '',
    OverallSDDocumentRejectionSts_Text: row.OverallSDDocumentRejectionSts_Text || ''
  };
}

/**
 * Normalizes a raw SAP C_CustomerReturnItemOPg row to a clean domain object.
 *
 * @param {Object} row
 * @returns {Object|null}
 */
function _formatReturnItemRow(row) {
  if (!row) return null;
  return {
    CustomerReturn: String(row.CustomerReturn || '').trim(),
    CustomerReturnItem: String(row.CustomerReturnItem || '').trim(),
    Material: row.Material || '',
    Material_Text: row.Material_Text || '',
    MaterialGroup: row.MaterialGroup || '',
    MaterialGroup_Text: row.MaterialGroup_Text || '',
    Batch: row.Batch || '',
    OrderQuantity: row.OrderQuantity !== null && row.OrderQuantity !== undefined ? Number(row.OrderQuantity) : null,
    OrderQuantityUnit: row.OrderQuantityUnit || '',
    NetAmount: row.NetAmount !== null && row.NetAmount !== undefined ? Number(row.NetAmount) : null,
    Currency: row.Currency || '',
    DeliveryDate: _parseODataV2Date(row.DeliveryDate),
    ProductionPlant: row.ProductionPlant || '',
    PlantName: row.PlantName || '',
    StorageLocation: row.StorageLocation || '',
    StorageLocationName: row.StorageLocationName || '',
    ShippingPoint: row.ShippingPoint || '',
    ShippingPoint_Text: row.ShippingPoint_Text || '',
    ReturnReason: row.ReturnReason || '',
    ReturnReason_Text: row.ReturnReason_Text || '',
    ReferenceSDDocument: row.ReferenceSDDocument || '',
    ReferenceSDDocumentItem: row.ReferenceSDDocumentItem || '',
    GoodsMovementType: row.GoodsMovementType || ''
  };
}

/**
 * SAP holds the return but the result is unproven. CAP hides 5xx text in production unless $sanitize is false,
 * and this text carries the number and the warning that stop the user creating a duplicate.
 */
function _unconfirmedReturn(message, customerReturn) {
  return Object.assign(new Error(message), {
    status: 502,
    code: 502,
    CustomerReturn: customerReturn,
    name: 'PartialCustomerReturnError',
    $sanitize: false
  });
}

const _sameNumber = (a, b) =>
  String(a || '').trim().replace(/^0+/, '') === String(b || '').trim().replace(/^0+/, '');

module.exports = {
  SERVICE_PATH,
  TRANSACTIONAL_SERVICE_PATH,
  HEADER_ENTITY_SET,
  ITEM_ENTITY_SET,
  REASON_VH_SET,
  REF_DOC_VH_SET,
  SOLD_TO_VH_SET,
  MATERIAL_VH_SET,
  PLANT_VH_SET,
  DOC_TYPE_VH_SET,
  DEFAULT_RETURN_TYPE,
  MAX_READBACK_ATTEMPTS,
  READBACK_DELAYS_MS,
  _cleanOptions,
  _sleep,
  _parseODataV2Date,
  _formatReturnHeaderRow,
  _formatReturnItemRow,
  _unconfirmedReturn,
  _sameNumber
};
