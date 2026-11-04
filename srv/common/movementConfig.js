'use strict';

const GM_CODE = Object.freeze({
  '201': '03',
  '241': '03',
  '311': '04',
  '301': '04',
  '261': '03'
});

const MOVEMENT_CONFIG = Object.freeze({
  '261': Object.freeze({
    movementType: '261',
    inventoryMovement: '261',
    configuredWmMovement: '261',
    wmMovement: '261',
    requirementType: 'F',
    interimStorageType: '914',
    description: 'Goods Issue to Order',
    gmCode: '03',
    requiresCostCenter: false,
    requiresAsset: false,
    requiresOrder: true,
    requiresReceivingPlant: false,
    requiresReceivingSloc: false,
    receivingPlantMustMatch: false,
    receivingSlocMustDiffer: false,
    receivingPlantMustDiffer: false,
    preserveReservationOnTr: true,
    requiredFields: Object.freeze(['Plant', 'StorageLocation', 'Material', 'Quantity', 'Unit', 'OrderType', 'OrderID']),
    requiredPostingFields: Object.freeze(['ReservationNo', 'ReservationItem', 'IssueQty']),
    forbiddenFields: Object.freeze(['CostCenter', 'AssetNo', 'SubNumber', 'ReceivingPlant', 'ReceivingStorageLocation', 'GLAccount']),
    destinationRules: Object.freeze({
      type: 'none',
      requiresReceivingPlant: false,
      requiresReceivingSloc: false,
      allowsReceivingPlant: false,
      allowsReceivingSloc: false,
      receivingPlantMustMatch: false,
      receivingSlocMustDiffer: false,
      receivingPlantMustDiffer: false
    }),
    batchRules: Object.freeze({
      supported: true,
      maxLength: 10,
      regex: /^[A-Za-z0-9]{1,10}$/,
      reconcileWithReservation: true,
      interimStockForbidden: true,
      pinnedBatchEnforced: true
    }),
    serialRules: Object.freeze({
      supported: true,
      maxLength: 18,
      unique: true,
      onePerUnitForSerialManaged: true,
      sapPreCheckRequired: true
    }),
    reservationRules: Object.freeze({
      requiredForPosting: true,
      allowsReservation: true,
      reconcileMasterData: true,
      checkDeletion: true,
      checkFinalIssue: true,
      enforceOpenQuantityCeiling: true,
      preserveReservationOnTr: true
    }),
    accountAssignment: Object.freeze({
      type: 'Order',
      field: 'OrderID',
      orderNoField: 'OrderNo',
      secondaryField: 'OrderType',
      mandatory: true,
      padDigits: true,
      allowsStatisticalCostCenter: true
    })
  })
});


/**
 * Returns the configured Goods Movement Code (GM_CODE) for a movement type.
 * @param {string} movementType
 * @returns {string|null}
 */
function getGmCode(movementType) {
  if (!movementType) return null;
  const key = String(movementType).trim();
  const cfg = MOVEMENT_CONFIG[key];
  return cfg ? cfg.gmCode : (GM_CODE[key] || null);
}

/**
 * Validates a reservation creation payload before calling SAP backend.
 * Checks all required fields according to movement type:
 * - Movement 201: Plant, SLoc, Material, Quantity, UoM, Cost Center
 * - Movement 241: Plant, SLoc, Material, Quantity, UoM, Asset Number
 * - Movement 311: Plant, Source SLoc, Destination SLoc, Material, Quantity, UoM
 * - Movement 301: Source Plant, Source SLoc, Destination Plant, Destination SLoc, Material, Quantity, UoM
 *
 * @param {object} data Payload with camelCase or PascalCase properties
 * @param {object} [options]
 * @param {boolean} [options.throwError=false] If true, throws Error with status 400 on first error
 * @param {object} [options.req=null] CAP request object; calls req.error(400, msg) for errors
 * @returns {{ isValid: boolean, errors: string[], config: object|null }}
 */
// Checked once for every type by the base rules or the destination validator, never by the generic loops.

/**
 * Authoritative single canonical Movement 261 stock-eligibility calculation.
 * Unifies:
 * - Open Quantity
 * - Issuable Quantity
 * - Supply Area Stock
 * - Staged Quantity
 * - Storage Unit Quantity
 * - No-Unit Quantity
 *
 * Into one authoritative posting-eligibility result.
 *
 * @param {object} params
 * @param {number} [params.openQuantity]
 * @param {number} [params.issuableQuantity]
 * @param {number} [params.supplyAreaStock]
 * @param {number} [params.stagedQuantity]
 * @param {boolean} [params.stagingRequired]
 * @param {number} [params.stagingShortfall]
 * @param {string} [params.stagingStorageType]
 * @param {string} [params.stagingBin]
 * @param {number} [params.storageUnitQuantity]
 * @param {number} [params.noUnitQuantity]
 * @param {string} [params.unit]
 * @param {string} [params.storageLocation]
 * @param {string} [params.supplyAreaStorageLocation]
 * @param {string} [params.batch]
 * @param {number} [params.requestQuantity]
 * @param {Array<string>|string} [params.blockers]
 * @param {string} [params.source] Default 'SAP'
 * @returns {{
 *   eligible: boolean,
 *   issuableQuantity: number,
 *   reason: string | null,
 *   source: string,
 *   openQuantity: number,
 *   supplyAreaStock: number,
 *   stagedQuantity: number,
 *   storageUnitQuantity: number,
 *   noUnitQuantity: number,
 *   stagingRequired: boolean,
 *   stagingShortfall: number,
 *   partialCoverage: boolean,
 *   unit: string
 * }}
 */
function calculateMovement261StockEligibility(params = {}) {
  const round = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

  const rawOpen = params.openQuantity !== undefined ? params.openQuantity : params.OpenQuantity;
  const rawIss = params.issuableQuantity !== undefined ? params.issuableQuantity : params.IssuableQuantity;
  const rawSA = params.supplyAreaStock !== undefined ? params.supplyAreaStock : params.SupplyAreaStock;
  const rawStaged = params.stagedQuantity !== undefined ? params.stagedQuantity : params.StagedQuantity;
  const rawStagingReq = params.stagingRequired !== undefined ? params.stagingRequired : params.StagingRequired;
  const rawStagingShort = params.stagingShortfall !== undefined ? params.stagingShortfall : params.StagingShortfall;
  const rawType = params.stagingStorageType !== undefined ? params.stagingStorageType : params.StagingStorageType;
  const rawBin = params.stagingBin !== undefined ? params.stagingBin : params.StagingBin;
  const rawSU = params.storageUnitQuantity !== undefined ? params.storageUnitQuantity : params.StorageUnitQuantity;
  const rawNoUnit = params.noUnitQuantity !== undefined ? params.noUnitQuantity : params.NoUnitQuantity;
  const rawUnit = params.unit !== undefined ? params.unit : params.Unit;
  const rawSLoc = params.storageLocation !== undefined ? params.storageLocation : params.StorageLocation;
  const rawSASLoc = params.supplyAreaStorageLocation !== undefined ? params.supplyAreaStorageLocation : params.SupplyAreaStorageLocation;
  const rawBatch = params.batch !== undefined ? params.batch : params.Batch;
  const rawSource = params.source !== undefined ? params.source : params.Source;
  const rawReqQty = params.requestQuantity !== undefined ? params.requestQuantity : params.RequestQuantity;
  const rawBlk = params.blockers !== undefined ? params.blockers : params.Blockers;

  const openQty = Math.max(0, round(rawOpen));
  const rawIssuable = Math.max(0, round(rawIss));
  const supplyAreaStock = Math.max(0, round(rawSA));
  const stagedQuantity = Math.max(0, round(rawStaged));
  const stagingRequired = Boolean(rawStagingReq);
  const stagingStorageType = String(rawType || '').trim();
  const stagingBin = String(rawBin || '').trim();
  const storageUnitQuantity = Math.max(0, round(rawSU));
  const noUnitQuantity = Math.max(0, round(rawNoUnit));
  const unit = String(rawUnit || '').trim();
  const storageLocation = String(rawSLoc || '').trim();
  const supplyAreaStorageLocation = String(rawSASLoc || '').trim();
  const batch = String(rawBatch || '').trim();
  const source = String(rawSource || 'SAP');
  const requestQuantity = rawReqQty !== undefined && rawReqQty !== null
    ? round(rawReqQty)
    : null;

  // External / upstream blockers take precedence (e.g. order locked, item deleted, warehouse mismatch)
  const rawBlockers = Array.isArray(rawBlk)
    ? rawBlk
    : rawBlk
      ? [rawBlk]
      : [];
  const blockers = rawBlockers
    .map((b) => (b ? String(b).trim() : ''))
    .filter(Boolean);

  // Determine effective postable quantity upper bound from the stock dimensions:
  // 1. Cannot exceed open quantity
  // 2. Cannot exceed ready/unrestricted stock in issue location/warehouse (rawIssuable)
  // 3. When staging is required, cannot exceed staged stock in the interim bin
  let effectiveIssuable = Math.min(openQty, rawIssuable);
  if (stagingRequired) {
    effectiveIssuable = Math.min(stagedQuantity, effectiveIssuable);
  }
  effectiveIssuable = round(effectiveIssuable);

  // Staging shortfall calculation
  const targetQty = requestQuantity !== null ? requestQuantity : openQty;
  const hasStagingShortfall = stagingRequired && (
    (rawStagingShort !== undefined && Number(rawStagingShort) > 0) ||
    (targetQty > 0 && stagedQuantity < targetQty)
  );
  const stagingShortfall = hasStagingShortfall
    ? round(Math.max(0, targetQty - stagedQuantity))
    : 0;

  let eligible = true;
  let reason = null;

  if (blockers.length > 0) {
    eligible = false;
    reason = blockers.join('; ');
  } else if (openQty <= 0) {
    eligible = false;
    reason = 'No open quantity remaining';
  } else if (requestQuantity !== null && requestQuantity <= 0) {
    eligible = false;
    reason = 'Quantity must be greater than zero';
  } else if (requestQuantity !== null && requestQuantity > openQty) {
    eligible = false;
    reason = `Quantity ${requestQuantity} exceeds the open quantity ${openQty}${unit ? ' ' + unit : ''}`;
  } else if (hasStagingShortfall) {
    eligible = false;
    reason = `available stock shortfall of ${stagingShortfall} ${unit} in interim storage bin ${stagingStorageType || 'interim'}/${stagingBin || 'bin'}`;
  } else if (rawIssuable <= 0) {
    eligible = false;
    if (supplyAreaStock > 0) {
      reason = `${supplyAreaStock} ${unit} in supply area ${supplyAreaStorageLocation}; issue location ${storageLocation || 'issue location'} is empty - transfer required`;
    } else {
      reason = `no unrestricted stock in ${storageLocation || 'the issue location'}${batch ? ` for batch ${batch}` : ''}`;
    }
  } else if (requestQuantity !== null && rawIssuable < requestQuantity) {
    eligible = false;
    reason = `issuable stock ${rawIssuable} ${unit} is less than ${requestQuantity} ${unit}`;
  }

  const partialCoverage = eligible && effectiveIssuable > 0 && effectiveIssuable < openQty;

  return {
    eligible,
    Eligible: eligible,
    issuableQuantity: effectiveIssuable,
    IssuableQuantity: effectiveIssuable,
    reason: eligible ? null : reason,
    Reason: eligible ? null : reason,
    source,
    Source: source,
    openQuantity: openQty,
    OpenQuantity: openQty,
    supplyAreaStock,
    SupplyAreaStock: supplyAreaStock,
    stagedQuantity,
    StagedQuantity: stagedQuantity,
    storageUnitQuantity,
    StorageUnitQuantity: storageUnitQuantity,
    noUnitQuantity,
    NoUnitQuantity: noUnitQuantity,
    stagingRequired,
    StagingRequired: stagingRequired,
    stagingShortfall,
    StagingShortfall: stagingShortfall,
    partialCoverage,
    PartialCoverage: partialCoverage,
    unit,
    Unit: unit
  };
}

/**
 * Canonical validator for Movement Type 261 (Goods Issue to Order).
 * Consumed by Mvt261Service and GoodsIssue handlers.
 * Supports both { reservation, item, quantity } and { ReservationNo, ReservationItem, IssueQty }.
 *
 * @param {object} data
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }>, message: string }}
 */
function validateMovement261Payload(data) {
  if (!data || typeof data !== 'object') {
    return {
      isValid: false,
      errors: [{ field: 'body', message: 'Request body must be a valid JSON object' }],
      message: 'Request body must be a valid JSON object'
    };
  }

  const reservation = String(data.reservation || data.ReservationNo || '').trim();
  const item = String(data.item || data.ReservationItem || '').trim();
  const movementTypeAliases = ['movementType', 'MovementType']
    .filter((key) => data[key] !== undefined && data[key] !== null)
    .map((key) => String(data[key]).trim());
  const movementType = String(data.movementType ?? data.MovementType ?? '').trim();
  const orderAliases = ['orderId', 'OrderID', 'orderNo', 'OrderNo']
    .filter((key) => data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '')
    .map((key) => String(data[key]).trim());
  const orderId = String(data.orderId ?? data.OrderID ?? data.orderNo ?? data.OrderNo ?? '').trim();
  const canonicalOrderAliases = new Set(orderAliases.map((value) => value.replace(/^0+/, '') || '0'));
  const orderTypeAliases = ['orderType', 'OrderType']
    .filter((key) => data[key] !== undefined && data[key] !== null)
    .map((key) => String(data[key]).trim());
  const orderType = String(data.orderType ?? data.OrderType ?? '').trim();
  const rawQty = data.quantity !== undefined ? data.quantity : data.IssueQty;
  const quantity = Number(rawQty);

  const errors = [];
  if (!reservation || !item) {
    errors.push({ field: 'reservation', message: 'Reservation and item are required' });
  }
  if (movementType !== '261') {
    errors.push({ field: 'movementType', message: "MovementType must be exactly '261' for this action" });
  }
  if (movementTypeAliases.some((value) => value !== '261')) {
    errors.push({ field: 'movementType', message: "Every supplied MovementType alias must be exactly '261'" });
  }
  if (!/^\d{1,12}$/.test(orderId)) {
    errors.push({ field: 'orderId', message: 'A valid production Order number (1 to 12 digits) is required for Movement Type 261' });
  }
  if (canonicalOrderAliases.size > 1) {
    errors.push({ field: 'orderId', message: 'Supplied Order ID fields must all refer to the same production order' });
  }
  if (!orderType || orderType.length > 4 || orderTypeAliases.some((value) => value !== orderType)) {
    errors.push({ field: 'orderType', message: 'A single explicit OrderType of at most 4 characters is required for Movement Type 261' });
  }
  if (rawQty === undefined || rawQty === null || rawQty === '' || isNaN(quantity) || quantity <= 0) {
    errors.push({ field: 'quantity', message: 'Quantity must be greater than zero' });
  }

  // Forbidden fields for 261
  const cfg = MOVEMENT_CONFIG['261'];
  const costCenter = data.CostCenter || data.costCenter;
  const assetNo = data.AssetNo || data.assetNo;
  const subNumber = data.SubNumber || data.subNumber;
  const recPlant = data.ReceivingPlant || data.receivingPlant;
  const recSLoc = data.ReceivingStorageLocation || data.receivingStorageLocation;
  const glAccount = data.GLAccount || data.glAccount;

  if (costCenter && cfg.forbiddenFields.includes('CostCenter')) {
    errors.push({ field: 'CostCenter', message: 'Cost Center is not allowed for Movement Type 261 (GI to Order)' });
  }
  if (assetNo && cfg.forbiddenFields.includes('AssetNo')) {
    errors.push({ field: 'AssetNo', message: 'Asset number is not allowed for Movement Type 261 (GI to Order)' });
  }
  if (subNumber && cfg.forbiddenFields.includes('SubNumber')) {
    errors.push({ field: 'SubNumber', message: 'Asset sub-number is not allowed for Movement Type 261 (GI to Order)' });
  }
  if (recPlant && cfg.forbiddenFields.includes('ReceivingPlant')) {
    errors.push({ field: 'ReceivingPlant', message: 'Receiving Plant is not allowed for Movement Type 261 (GI to Order)' });
  }
  if (recSLoc && cfg.forbiddenFields.includes('ReceivingStorageLocation')) {
    errors.push({ field: 'ReceivingStorageLocation', message: 'Receiving Storage Location is not allowed for Movement Type 261 (GI to Order)' });
  }
  if (glAccount && cfg.forbiddenFields.includes('GLAccount')) {
    errors.push({ field: 'GLAccount', message: 'GLAccount is not allowed for Movement Type 261 (GI to Order)' });
  }

  const isValid = errors.length === 0;
  return {
    isValid,
    errors,
    message: isValid ? 'Validation succeeded' : errors.map((e) => e.message).join('; ')
  };
}

module.exports = {
  MOVEMENT_CONFIG,
  GM_CODE,
  getGmCode,
  validateMovement261Payload,
  calculateMovement261StockEligibility
};
