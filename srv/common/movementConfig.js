'use strict';

/**
 * Single Normalized SAP Movement Configuration
 * Covers all supported business movement types: 201, 241, 311, 301.
 *
 * SAP WM Customizing Requirements (Table T333 in Warehouse W01):
 * - 201: BWLVS 201, BETYP 'K', NKDYN 'X', NLTYP '911', NLPLA '' (dynamic bin generated from Cost Center BENUM).
 *        When WM_TR_REAL_MOVEMENT=true, uses real WM 201 with BETYP 'K' and padded Cost Center BENUM.
 *        Otherwise uses staging WM 311 where dynamic requirement tracking is not required.
 * - 241: BWLVS 241, BETYP 'A', NKDYN 'X', NLTYP '913', NLPLA '' (dynamic bin generated from Asset BENUM).
 *        When WM_TR_REAL_MOVEMENT=true, uses real WM 241 with BETYP 'A' and rightmost 10-char Asset BENUM.
 *        Otherwise uses staging WM 311.
 * - 311: BWLVS 311, BETYP '', NLTYP '921', NLPLA 'TRANSFER' (interim bin fixed).
 *        Preserves RSNUM and RSPOS cleanly on the WM staging TR header.
 * - 301: BWLVS 301, BETYP '', NLTYP '920', NLPLA 'TRANSFER' (interim bin fixed).
 *        Staging TR header RSNUM is omitted to prevent standard SAP L_TO_CREATE_TR XFELD_WRONG restrictions.
 * - 261: BWLVS 261, BETYP 'F', NKDYN 'X', NLTYP '914', NLPLA '' (dynamic bin generated from Order AUFNR BENUM).
 *        Uses real WM 261 with BETYP 'F' and rightmost 10-char Order BENUM.
 *        Requires Order Number (AUFNR). Rejects Cost Center, Asset, and Receiving Plant/SLoc.
 */
const C = require('../wm/goods-issue/validation/common');

const GM_CODE = Object.freeze({
  '201': '03',
  '241': '03',
  '311': '04',
  '301': '04',
  '261': '03'
});

const MOVEMENT_CONFIG = Object.freeze({
  '201': Object.freeze({
    movementType: '201',
    inventoryMovement: '201',
    configuredWmMovement: '201',
    // Confirmed in the D21 live audit: WM uses the same movement number as the inventory movement.
    useRealWmMovement: true,
    get wmMovement() {
      return this.configuredWmMovement;
    },
    requirementType: 'K',
    interimStorageType: '911',
    description: 'Goods Issue to Cost Center',
    gmCode: '03',
    requiresCostCenter: true,
    requiresAsset: false,
    requiresOrder: false,
    requiresReceivingPlant: false,
    requiresReceivingSloc: false,
    receivingPlantMustMatch: false,
    receivingSlocMustDiffer: false,
    receivingPlantMustDiffer: false,
    preserveReservationOnTr: true,
    requiredFields: Object.freeze(['Plant', 'StorageLocation', 'Material', 'Quantity', 'Unit', 'CostCenter']),
    requiredPostingFields: Object.freeze(['IssueQty', 'Unit', 'CostCenter']),
    forbiddenFields: Object.freeze(['ReceivingPlant', 'ReceivingStorageLocation', 'GLAccount', 'AssetNo', 'SubNumber', 'OrderID', 'OrderNo', 'OrderType']),
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
      interimStockForbidden: true
    }),
    serialRules: Object.freeze({
      supported: true,
      maxLength: 18,
      unique: true,
      onePerUnitForSerialManaged: true,
      sapPreCheckRequired: true
    }),
    reservationRules: Object.freeze({
      requiredForPosting: false,
      allowsReservation: true,
      reconcileMasterData: true,
      checkDeletion: true,
      checkFinalIssue: true,
      enforceOpenQuantityCeiling: true,
      preserveReservationOnTr: true
    }),
    accountAssignment: Object.freeze({
      type: 'CostCenter',
      field: 'CostCenter',
      mandatory: true,
      regex: /^[A-Za-z0-9_-]{1,10}$/,
      length: 10,
      padDigits: true,
      glAccountForbidden: true
    })
  }),
  '241': Object.freeze({
    movementType: '241',
    inventoryMovement: '241',
    configuredWmMovement: '241',
    // Confirmed in the D21 live audit: WM uses the same movement number as the inventory movement.
    useRealWmMovement: true,
    get wmMovement() {
      return this.configuredWmMovement;
    },
    requirementType: 'A',
    interimStorageType: '913',
    description: 'Goods Issue to Asset',
    gmCode: '03',
    requiresCostCenter: false,
    requiresAsset: true,
    requiresOrder: false,
    requiresReceivingPlant: false,
    requiresReceivingSloc: false,
    receivingPlantMustMatch: false,
    receivingSlocMustDiffer: false,
    receivingPlantMustDiffer: false,
    preserveReservationOnTr: true,
    requiredFields: Object.freeze(['Plant', 'StorageLocation', 'Material', 'Quantity', 'Unit', 'AssetNo', 'SubNumber']),
    requiredPostingFields: Object.freeze(['IssueQty', 'Unit', 'AssetNo']),
    forbiddenFields: Object.freeze(['CostCenter', 'ReceivingPlant', 'ReceivingStorageLocation', 'GLAccount', 'OrderID', 'OrderNo', 'OrderType']),
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
      interimStockForbidden: true
    }),
    serialRules: Object.freeze({
      supported: true,
      maxLength: 18,
      unique: true,
      onePerUnitForSerialManaged: true,
      sapPreCheckRequired: true
    }),
    reservationRules: Object.freeze({
      requiredForPosting: false,
      allowsReservation: true,
      reconcileMasterData: true,
      checkDeletion: true,
      checkFinalIssue: true,
      enforceOpenQuantityCeiling: true,
      preserveReservationOnTr: true
    }),
    accountAssignment: Object.freeze({
      type: 'Asset',
      field: 'AssetNo',
      subField: 'SubNumber',
      mandatory: true,
      length: 12,
      subLength: 4,
      padDigits: true,
      glAccountForbidden: true
    })
  }),
  '311': Object.freeze({
    movementType: '311',
    inventoryMovement: '311',
    configuredWmMovement: '311',
    wmMovement: '311',
    requirementType: '',
    interimStorageType: '921',
    interimStorageBin: 'TRANSFER',
    description: 'Storage Location to Storage Location Transfer',
    gmCode: '04',
    requiresCostCenter: false,
    requiresAsset: false,
    requiresOrder: false,
    requiresReceivingPlant: false,
    requiresReceivingSloc: true,
    receivingPlantMustMatch: true,
    receivingSlocMustDiffer: true,
    receivingPlantMustDiffer: false,
    preserveReservationOnTr: true,
    requiredFields: Object.freeze(['Plant', 'StorageLocation', 'Material', 'Quantity', 'Unit', 'ReceivingStorageLocation']),
    requiredPostingFields: Object.freeze(['ReservationNo', 'ReservationItem', 'IssueQty', 'Unit', 'ReceivingStorageLocation']),
    forbiddenFields: Object.freeze(['CostCenter', 'AssetNo', 'SubNumber', 'GLAccount', 'OrderID', 'OrderNo', 'OrderType']),
    destinationRules: Object.freeze({
      type: 'intra_plant',
      requiresReceivingPlant: false,
      requiresReceivingSloc: true,
      receivingPlantMustMatch: true,
      receivingSlocMustDiffer: true,
      allowsReceivingPlant: true,
      allowsReceivingSloc: true,
      crossWarehouseForbidden: true
    }),
    batchRules: Object.freeze({
      supported: true,
      maxLength: 10,
      regex: /^[A-Za-z0-9]{1,10}$/,
      reconcileWithReservation: true,
      interimStockForbidden: true
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
      type: 'None',
      mandatory: false,
      forbidden: true
    })
  }),
  '301': Object.freeze({
    movementType: '301',
    inventoryMovement: '301',
    configuredWmMovement: '301',
    wmMovement: '301',
    requirementType: '',
    interimStorageType: '920',
    interimStorageBin: 'TRANSFER',
    description: 'Plant to Plant Transfer',
    gmCode: '04',
    requiresCostCenter: false,
    requiresAsset: false,
    requiresOrder: false,
    requiresReceivingPlant: true,
    requiresReceivingSloc: true,
    receivingPlantMustMatch: false,
    receivingSlocMustDiffer: false,
    receivingPlantMustDiffer: true,
    preserveReservationOnTr: false,
    requiredFields: Object.freeze(['Plant', 'StorageLocation', 'Material', 'Quantity', 'Unit', 'ReceivingPlant', 'ReceivingStorageLocation']),
    requiredPostingFields: Object.freeze(['ReservationNo', 'ReservationItem', 'IssueQty', 'Unit', 'ReceivingPlant', 'ReceivingStorageLocation']),
    forbiddenFields: Object.freeze(['CostCenter', 'AssetNo', 'SubNumber', 'GLAccount', 'OrderID', 'OrderNo', 'OrderType']),
    destinationRules: Object.freeze({
      type: 'inter_plant',
      requiresReceivingPlant: true,
      requiresReceivingSloc: true,
      receivingPlantMustDiffer: true,
      allowsReceivingPlant: true,
      allowsReceivingSloc: true
    }),
    batchRules: Object.freeze({
      supported: true,
      maxLength: 10,
      regex: /^[A-Za-z0-9]{1,10}$/,
      reconcileWithReservation: true,
      interimStockForbidden: true,
      validateReceivingBatch: true
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
      preserveReservationOnTr: false
    }),
    accountAssignment: Object.freeze({
      type: 'None',
      mandatory: false,
      forbidden: true
    })
  }),
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

const SUPPORTED_MOVEMENT_TYPES = Object.freeze(['201', '241', '311', '301', '261']);
const POSTABLE_MOVEMENT_TYPES = Object.freeze(['201', '301', '311', '261']);

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
 * Returns the normalized movement configuration for a movement type.
 * @param {string} movementType
 * @returns {object|null}
 */
function getMovementConfig(movementType) {
  if (!movementType) return null;
  const key = String(movementType).trim();
  return MOVEMENT_CONFIG[key] || null;
}

/**
 * Resolves the effective WM movement type for a movement type,
 * respecting the SAP WM configuration and WM_TR_REAL_MOVEMENT flag.
 * @param {string} movementType
 * @returns {string}
 */
function resolveWmMovement(movementType) {
  const cfg = getMovementConfig(movementType);
  if (!cfg) return String(movementType || '').trim();
  return cfg.wmMovement;
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
/** Reservation-create field names (PascalCase canonical, camelCase as used inside the adapter). */
const RES_FIELD_KEYS = Object.freeze({
  Plant: ['Plant', 'plant'],
  StorageLocation: ['StorageLocation', 'storageLocation'],
  Material: ['Material', 'material'],
  Quantity: ['Quantity', 'quantity'],
  Unit: ['Unit', 'unit'],
  CostCenter: ['CostCenter', 'costCenter'],
  AssetNo: ['AssetNo', 'assetNo'],
  SubNumber: ['SubNumber', 'subNumber'],
  OrderID: ['OrderID', 'orderId'],
  OrderNo: ['OrderNo', 'orderNo'],
  OrderType: ['OrderType', 'orderType'],
  GLAccount: ['GLAccount', 'glAccount'],
  ReceivingPlant: ['ReceivingPlant', 'receivingPlant'],
  ReceivingStorageLocation: ['ReceivingStorageLocation', 'receivingStorageLocation']
});
const RES_FIELD_LABELS = Object.freeze({
  CostCenter: 'Cost Center',
  AssetNo: 'Asset number',
  SubNumber: 'Asset sub-number',
  OrderID: 'Order number',
  OrderNo: 'Order number',
  OrderType: 'Order Type',
  GLAccount: 'G/L Account',
  ReceivingPlant: 'Receiving Plant',
  ReceivingStorageLocation: 'Receiving Storage Location'
});
const RES_TYPE_LABELS = Object.freeze({
  '201': 'GI to Cost Center',
  '241': 'GI to Asset',
  '261': 'GI to Order',
  '301': 'Plant to Plant Transfer',
  '311': 'SLoc Transfer'
});
// Checked once for every type by the base rules or the destination validator, never by the generic loops.
const RES_BASE_FIELDS = Object.freeze(['Plant', 'StorageLocation', 'Material', 'Quantity', 'Unit', 'ReceivingPlant', 'ReceivingStorageLocation']);

function pickResField(data, field) {
  for (const k of RES_FIELD_KEYS[field] || [field]) {
    if (data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== '') return String(data[k]).trim();
  }
  return '';
}

/**
 * Validates a reservation creation payload before calling SAP backend.
 * Single source of truth: MOVEMENT_CONFIG[mvt].requiredFields / forbiddenFields / destinationRules / batchRules.
 * Base rules for every type: Plant and StorageLocation (4 alphanumeric), Material (<= 40), Quantity (> 0, <= 3
 * decimals), Unit (<= 3), Batch (batchRules.regex), no serial numbers (captured at goods issue, not on RESB).
 *
 * @param {object} data Payload with PascalCase (service) or camelCase (adapter) properties
 * @param {object} [options]
 * @param {boolean} [options.throwError=false] If true, throws Error with status 400 on first error
 * @param {object} [options.req=null] CAP request object; calls req.error(400, msg) for errors
 * @returns {{ isValid: boolean, errors: string[], config: object|null }}
 */
function validateReservationInput(data = {}, options = {}) {
  const errors = [];
  const addError = (msg) => {
    errors.push(msg);
    if (options.req && typeof options.req.error === 'function') {
      options.req.error(400, msg);
    }
  };

  const mvt = String(data.MovementType || data.movementType || '').trim();
  const plant = pickResField(data, 'Plant');
  const sloc = pickResField(data, 'StorageLocation');
  const material = pickResField(data, 'Material');
  const qtyRaw = data.Quantity !== undefined ? data.Quantity : data.quantity;
  const qty = Number(qtyRaw);
  const unit = String(data.Unit || data.unit || data.Uom || data.uom || '').trim();
  const resDate = data.ReservationDate !== undefined ? data.ReservationDate : data.reservationDate;
  const batch = String(data.Batch || data.batch || '').trim();
  const serials = data.Serials || data.serials;
  const serialNo = String(data.SerialNo || data.serialNo || '').trim();
  const cfg = MOVEMENT_CONFIG[mvt] || null;
  const typeLabel = RES_TYPE_LABELS[mvt] || '';

  // 1. Movement Type
  if (!mvt) {
    addError('MovementType is mandatory (201, 241, 311, 301, 261)');
  } else if (!cfg) {
    addError(`Unsupported movement type '${mvt}'. Valid movement types are: 201, 241, 311, 301, 261`);
  }

  // 2.-4. Plant, Storage Location, Material
  if (!plant) addError('Plant is mandatory');
  else if (!C.PLANT_REGEX.test(plant)) addError(`Plant '${plant}' must be exactly 4 alphanumeric characters`);
  if (!sloc) addError('StorageLocation is mandatory');
  else if (!C.SLOC_REGEX.test(sloc)) addError(`Storage Location '${sloc}' must be exactly 4 alphanumeric characters`);
  if (!material) addError('Material is mandatory');
  else if (material.length > 40) addError('Material number exceeds maximum length of 40 characters');

  // 5. Quantity
  if (qtyRaw === undefined || qtyRaw === null || qtyRaw === '' || isNaN(qty) || qty <= 0) {
    addError('Quantity must be greater than 0');
  } else if (!C.QTY_DECIMAL_REGEX.test(String(qtyRaw).trim())) {
    addError('Quantity exceeds maximum precision of 3 decimal places');
  }

  // 6. Unit of Measure
  if (!unit) addError('Unit is mandatory');
  else if (unit.length > 3) addError(`Unit '${unit}' exceeds maximum length of 3 characters`);

  // 7. Reservation Date (optional, but if provided must be valid)
  if (resDate !== undefined && resDate !== null && resDate !== '') {
    if (!(typeof resDate === 'string' && /^\d{8}$/.test(resDate)) && isNaN(new Date(resDate).getTime())) {
      addError('Invalid ReservationDate');
    }
  }

  // 8. Batch (optional) and serial numbers (never part of a reservation)
  if (batch && cfg && cfg.batchRules && !cfg.batchRules.regex.test(batch)) {
    addError(`Batch '${batch}' must be 1-${cfg.batchRules.maxLength} alphanumeric characters`);
  }
  if ((Array.isArray(serials) && serials.some((v) => String(v || '').trim() !== '')) || serialNo) {
    addError('Serial numbers are not accepted at reservation creation; they are captured at goods issue posting');
  }

  // 9. Movement-specific policy from MOVEMENT_CONFIG
  if (cfg) {
    const recPlant = pickResField(data, 'ReceivingPlant');
    const recSLoc = pickResField(data, 'ReceivingStorageLocation');
    if (cfg.destinationRules.type === 'inter_plant') {
      validateMovement301Destination(plant, recPlant, recSLoc).errors.forEach((e) => addError(e.message));
    } else if (cfg.destinationRules.type === 'intra_plant') {
      validateMovement311Destination(plant, sloc, recPlant, recSLoc).errors.forEach((e) => addError(e.message));
    }
    for (const f of cfg.requiredFields) {
      if (!RES_BASE_FIELDS.includes(f) && !pickResField(data, f)) {
        addError(`${RES_FIELD_LABELS[f] || f} is mandatory for Movement Type ${mvt} (${typeLabel})`);
      }
    }
    for (const f of cfg.forbiddenFields) {
      if (pickResField(data, f)) {
        addError(`${RES_FIELD_LABELS[f] || f} is not allowed for Movement Type ${mvt} (${typeLabel})`);
      }
    }
  }

  const isValid = errors.length === 0;
  if (!isValid && options.throwError && (!options.req || typeof options.req.error !== 'function')) {
    const err = new Error(errors[0]);
    err.status = 400;
    err.errors = errors;
    throw err;
  }

  return {
    isValid,
    errors,
    config: cfg
  };
}

/**
 * Canonical destination validation for Movement 301 (Plant-to-Plant Transfer).
 * Authoritative single policy for Movement 301 destination requirements.
 *
 * Rules:
 * - ReceivingPlant: REQUIRED. Rejects missing, empty, whitespace, invalid plant format (!= 4 alphanumeric chars),
 *   and same as issuing plant.
 * - ReceivingStorageLocation: REQUIRED. Rejects missing, empty, whitespace, and invalid sloc format (!= 4 alphanumeric chars).
 *
 * @param {string} plant - Issuing Plant
 * @param {string} receivingPlant - Receiving Plant (REQUIRED)
 * @param {string} receivingStorageLocation - Receiving Storage Location (REQUIRED)
 * @param {object} [options]
 * @param {boolean} [options.requireSLoc=true] - When explicitly false, SLoc is validated for format only if supplied.
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }> }}
 */
function validateMovement301Destination(plant, receivingPlant, receivingStorageLocation, options = {}) {
  const errors = [];
  const sPlant = String(plant || '').trim().toUpperCase();
  const requireSLoc = options.requireSLoc !== false;

  // 1. Receiving Plant: REQUIRED
  if (receivingPlant === undefined || receivingPlant === null || String(receivingPlant).trim() === '') {
    errors.push({
      field: 'ReceivingPlant',
      message: 'Receiving Plant is mandatory for Movement Type 301 (Plant Transfer)'
    });
  } else {
    const sRecPlant = String(receivingPlant).trim().toUpperCase();
    if (!/^[A-Za-z0-9]{4}$/.test(sRecPlant)) {
      errors.push({
        field: 'ReceivingPlant',
        message: `Receiving Plant '${receivingPlant}' must be exactly 4 alphanumeric characters`
      });
    } else if (sPlant && sRecPlant === sPlant) {
      errors.push({
        field: 'ReceivingPlant',
        message: 'Receiving Plant must be different from Issuing Plant'
      });
    }
  }

  // 2. Receiving Storage Location: REQUIRED
  if (receivingStorageLocation === undefined || receivingStorageLocation === null || String(receivingStorageLocation).trim() === '') {
    if (requireSLoc) {
      errors.push({
        field: 'ReceivingStorageLocation',
        message: 'Receiving Storage Location is mandatory for Movement Type 301 (Plant to Plant Transfer)'
      });
    }
  } else {
    const sRecSLoc = String(receivingStorageLocation).trim().toUpperCase();
    if (!/^[A-Za-z0-9]{4}$/.test(sRecSLoc)) {
      errors.push({
        field: 'ReceivingStorageLocation',
        message: `Receiving Storage Location '${receivingStorageLocation}' must be exactly 4 alphanumeric characters`
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Canonical destination validation for Movement 311 (Storage Location Transfer within Plant).
 * Authoritative single policy for Movement 311 destination requirements.
 *
 * Rules:
 * - ReceivingStorageLocation: REQUIRED.
 *   - Rejects missing, empty, whitespace, and format != 4 alphanumeric characters.
 *   - Must always enforce: Receiving SLoc != Issuing SLoc.
 * - ReceivingPlant:
 *   - Must always enforce: Receiving Plant == Issuing Plant (intra-plant transfer).
 *   - If supplied, validates 4 alphanumeric characters format.
 *   - If supplied and differs from issuing plant, rejects.
 *
 * @param {string} plant - Issuing Plant
 * @param {string} storageLocation - Issuing Storage Location
 * @param {string} receivingPlant - Receiving Plant (optional in input; if supplied must equal issuing plant)
 * @param {string} receivingStorageLocation - Receiving Storage Location (REQUIRED)
 * @param {object} [options]
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }> }}
 */
function validateMovement311Destination(plant, storageLocation, receivingPlant, receivingStorageLocation, _options = {}) {
  const errors = [];
  const sPlant = String(plant || '').trim().toUpperCase();
  const sSLoc = String(storageLocation || '').trim().toUpperCase();

  // 1. Receiving Storage Location: REQUIRED
  if (receivingStorageLocation === undefined || receivingStorageLocation === null || String(receivingStorageLocation).trim() === '') {
    errors.push({
      field: 'ReceivingStorageLocation',
      message: 'Receiving Storage Location is mandatory for Movement Type 311 (SLoc Transfer)'
    });
  } else {
    const sRecSLoc = String(receivingStorageLocation).trim().toUpperCase();
    if (!/^[A-Za-z0-9]{4}$/.test(sRecSLoc)) {
      errors.push({
        field: 'ReceivingStorageLocation',
        message: `Receiving Storage Location '${receivingStorageLocation}' must be exactly 4 alphanumeric characters`
      });
    } else if (sSLoc && sRecSLoc === sSLoc) {
      errors.push({
        field: 'ReceivingStorageLocation',
        message: 'Receiving Storage Location must be different from Issuing Storage Location'
      });
    }
  }

  // 2. Receiving Plant: Must match Issuing Plant (intra-plant transfer)
  if (receivingPlant !== undefined && receivingPlant !== null && String(receivingPlant).trim() !== '') {
    const sRecPlant = String(receivingPlant).trim().toUpperCase();
    if (!/^[A-Za-z0-9]{4}$/.test(sRecPlant)) {
      errors.push({
        field: 'ReceivingPlant',
        message: `Receiving Plant '${receivingPlant}' must be exactly 4 alphanumeric characters`
      });
    } else if (sPlant && sRecPlant !== sPlant) {
      errors.push({
        field: 'ReceivingPlant',
        message: 'Receiving Plant must match Issuing Plant for Movement Type 311 (SLoc Transfer)'
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
/**
 * Authoritative SAP backend verification for Transfer Movement (301 and 311) Receiving Location.
 * Verifies that ReceivingPlant + ReceivingStorageLocation are valid in SAP:
 * 1. Destination format & mandatory requirements.
 * 2. T320: WM configuration check.
 *    - For Movement 311: verifies receiving and issuing storage locations belong to compatible
 *      warehouse configurations in T320 (rejects cross-warehouse transfers where both are mapped
 *      to different warehouses). Supports non-WM receiving SLoc when not mapped in T320.
 * 3. T001L: Receiving Storage Location exists in Receiving Plant.
 * 4. Material checks (if material is provided):
 *    - MARC: Material is extended to Receiving Plant.
 *    - MARD: Material is extended to Receiving Storage Location in Receiving Plant.
 *
 * @param {object} rfc - SAP RFC client (must have readTable method)
 * @param {object} params
 * @param {string} params.movementType - '301' or '311'
 * @param {string} [params.plant] - Issuing Plant (required for 311; used as receivingPlant for 311 if receivingPlant omitted)
 * @param {string} [params.storageLocation] - Issuing Storage Location (used for 311 T320 comparison and intra-plant check)
 * @param {string} [params.receivingPlant] - Receiving Plant (mandatory for 301; for 311 must match plant if supplied)
 * @param {string} params.receivingStorageLocation - Receiving Storage Location (REQUIRED)
 * @param {string} [params.material]
 * @param {boolean} [params.requireSLoc=true]
 * @param {boolean} [params.checkT001L=true]
 * @param {boolean} [params.checkT320=true]
 * @param {boolean} [params.checkMarc=true]
 * @param {boolean} [params.checkMard=true]
 * @returns {Promise<{ valid: boolean, error?: string, initialDestStock?: number }>}
 */
async function verifyReceivingLocationInSap(rfc, {
  movementType,
  receivingPlant,
  receivingStorageLocation,
  plant,
  storageLocation,
  material,
  requireSLoc = true,
  checkT001L = true,
  checkT320 = true,
  checkMarc = true,
  checkMard = true
} = {}) {
  const sMvt = String(movementType || '').trim();
  if (!['301', '311'].includes(sMvt)) {
    return { valid: false, error: 'MovementType is required and must be 301 or 311' };
  }
  if (!rfc || typeof rfc.readTable !== 'function') {
    return { valid: true };
  }
  const sPlant = String(plant || '').trim().toUpperCase();
  const sRecPlant = String(receivingPlant || (sMvt === '311' ? plant : '') || '').trim().toUpperCase();
  const sSLoc = String(storageLocation || '').trim().toUpperCase();
  const sRecSLoc = String(receivingStorageLocation || '').trim().toUpperCase();

  let initialDestStock = undefined;

  if (!sRecPlant) {
    return {
      valid: false,
      error: sMvt === '311'
        ? 'Plant is mandatory for Movement Type 311 (SLoc Transfer)'
        : 'Receiving Plant is mandatory for Movement Type 301 (Plant Transfer)'
    };
  }

  // 1. MARC check: Verify material extended to Receiving Plant (for 301)
  if (material && checkMarc && sMvt !== '311') {
    const sMat = String(material).trim();
    const padMat = (m) => (/^\d+$/.test(m) ? m.padStart(18, '0') : m);
    const s4Mat = padMat(sMat);
    const alphaOut = (m) => String(m).replace(/^0+/, '');

    try {
      const marcRec = await rfc.readTable('MARC', ['WERKS'], [
        `MATNR = '${s4Mat}'`,
        `AND WERKS = '${sRecPlant}'`
      ], 1);
      if (!marcRec || !marcRec.length) {
        return {
          valid: false,
          error: `Material ${alphaOut(s4Mat)} is not extended to receiving plant ${sRecPlant} (MARC)`
        };
      }
    } catch (mErr) {
      if (mErr.status === 400 || mErr.statusCode === 400) {
        return { valid: false, error: mErr.message };
      }
      if (mErr.status === 503 || /not configured|not available/i.test(mErr.message)) {
        return { valid: true, initialDestStock };
      }
      throw mErr;
    }
  }

  // 2. Receiving Storage Location requirement check
  if (!sRecSLoc) {
    if (requireSLoc) {
      return {
        valid: false,
        error: sMvt === '311'
          ? 'Receiving Storage Location is mandatory for Movement Type 311 (SLoc Transfer)'
          : 'Receiving Storage Location is mandatory for Movement Type 301 (Plant to Plant Transfer)'
      };
    }
    return { valid: true };
  }

  // 3. Intra-plant check for 311
  if (sMvt === '311') {
    if (sSLoc && sRecSLoc === sSLoc) {
      return {
        valid: false,
        error: 'Receiving Storage Location must be different from Issuing Storage Location'
      };
    }
    if (receivingPlant && sPlant && String(receivingPlant).trim().toUpperCase() !== sPlant) {
      return {
        valid: false,
        error: 'Receiving Plant must match Issuing Plant for Movement Type 311 (SLoc Transfer)'
      };
    }
  }

  // 4. T320: WM configuration check (no cross-warehouse transfer on 311)
  if (checkT320 && (sMvt === '311' || sSLoc)) {
    try {
      const t320Rec = await rfc.readTable('T320', ['LGNUM', 'WERKS', 'LGORT'], [
        `WERKS = '${sRecPlant}'`,
        `AND LGORT = '${sRecSLoc}'`
      ], 1);
      if (t320Rec && t320Rec.length > 0) {
        const recWh = String(t320Rec[0]?.LGNUM || '').trim();
        const issSLoc = sSLoc;
        if (issSLoc) {
          const t320Iss = await rfc.readTable('T320', ['LGNUM', 'WERKS', 'LGORT'], [
            `WERKS = '${sPlant || sRecPlant}'`,
            `AND LGORT = '${issSLoc}'`
          ], 1);
          const issWh = String(t320Iss?.[0]?.LGNUM || '').trim();
          if (issWh && recWh && recWh !== issWh) {
            return {
              valid: false,
              error: `Receiving storage location ${sRecSLoc} belongs to warehouse ${recWh}, but issuing storage location belongs to warehouse ${issWh} (cross-warehouse transfer not supported in 311)`
            };
          }
        }
      }
    } catch (tErr) {
      if (tErr.status === 400 || tErr.statusCode === 400) {
        return { valid: false, error: tErr.message };
      }
      if (tErr.status === 503 || /not configured|not available/i.test(tErr.message)) {
        return { valid: true, initialDestStock };
      }
      throw tErr;
    }
  }

  // 5. MARD check: Material extended to Receiving Storage Location in Plant
  if (material && checkMard && sRecSLoc) {
    const sMat = String(material).trim();
    const padMat = (m) => (/^\d+$/.test(m) ? m.padStart(18, '0') : m);
    const s4Mat = padMat(sMat);
    const alphaOut = (m) => String(m).replace(/^0+/, '');

    try {
      const mardRec = await rfc.readTable('MARD', ['LGORT', 'LABST'], [
        `MATNR = '${s4Mat}'`,
        `AND WERKS = '${sRecPlant}'`,
        `AND LGORT = '${sRecSLoc}'`
      ], 1);
      if (!mardRec || !mardRec.length) {
        return {
          valid: false,
          error: `Material ${alphaOut(s4Mat)} is not extended to receiving storage location ${sRecSLoc} in plant ${sRecPlant} (MARD)`
        };
      }
      if (mardRec[0].LABST !== undefined) {
        initialDestStock = Number(mardRec[0].LABST);
      }
    } catch (mErr) {
      if (mErr.status === 400 || mErr.statusCode === 400) {
        return { valid: false, error: mErr.message };
      }
      if (mErr.status === 503 || /not configured|not available/i.test(mErr.message)) {
        return { valid: true, initialDestStock };
      }
      throw mErr;
    }
  }

  // 6. T001L: Verify Receiving Storage Location exists in Receiving Plant
  if (checkT001L) {
    try {
      const t001l = await rfc.readTable('T001L', ['LGORT'], [
        `WERKS = '${sRecPlant}'`,
        `AND LGORT = '${sRecSLoc}'`
      ], 1);
      if (!t001l || !t001l.length) {
        return {
          valid: false,
          error: `Receiving Storage Location ${sRecSLoc} does not exist in plant ${sRecPlant} (T001L)`
        };
      }
    } catch (err) {
      if (err.status === 400 || err.statusCode === 400) {
        return { valid: false, error: err.message };
      }
      if (err.status === 503 || /not configured|not available/i.test(err.message)) {
        return { valid: true, initialDestStock };
      }
      throw err;
    }
  }

  return { valid: true, initialDestStock };
}

/**
 * Dedicated destination verification helper for Movement 311.
 * Delegates to verifyReceivingLocationInSap with movementType: '311'.
 */
async function verifyMovement311DestinationInSap(rfc, options = {}) {
  return verifyReceivingLocationInSap(rfc, {
    ...options,
    movementType: '311'
  });
}

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
 * Canonical centralized Goods Issue posting validator.
 * Validates a Goods Issue posting payload against the single source of truth in MOVEMENT_CONFIG.
 *
 * @param {string} movementType
 * @param {object} data
 * @param {object} [options]
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }>, message: string }}
 */
function validateMovementPostingPayload(movementType, data, options = {}) {
  if (!data || typeof data !== 'object') {
    return C.buildResult([{ field: 'body', message: 'Request body must be a valid JSON object' }]);
  }

  const mvt = String(movementType || '').trim();
  const cfg = getMovementConfig(mvt);

  if (!cfg) {
    return C.buildResult([{
      field: 'MovementType',
      message: `Unsupported movement type '${mvt}'. Valid movement types are: ${SUPPORTED_MOVEMENT_TYPES.join(', ')}`
    }]);
  }

  if (!POSTABLE_MOVEMENT_TYPES.includes(mvt)) {
    return C.buildResult([{
      field: 'MovementType',
      message: `Movement Type '${mvt}' is not a supported Goods Issue posting type. Postable movement types are: ${POSTABLE_MOVEMENT_TYPES.join(', ')}`
    }]);
  }

  const errors = [];
  const push = (e) => { if (e) errors.push(e); };

  const movementTypeAliases = ['MovementType', 'movementType']
    .filter((key) => data[key] !== undefined && data[key] !== null)
    .map((key) => String(data[key]).trim());
  if (!movementTypeAliases.length || movementTypeAliases.some((value) => value !== mvt)) {
    push({ field: 'MovementType', message: `MovementType must be explicitly supplied and exactly '${mvt}'` });
  }

  // 1. Reservation check
  const resRules = cfg.reservationRules || {};
  let hasReservation = false;
  if (resRules.requiredForPosting) {
    hasReservation = C.checkReservationRequired(data, errors);
  } else {
    // Optional reservation: if partially supplied, validate lengths
    const sResv = String(data.ReservationNo || data.reservation || '').trim();
    const sItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : (data.item != null ? String(data.item).trim() : '');
    hasReservation = Boolean(sResv && sItem);
    if (sResv && sResv.length > 10) {
      push({ field: 'ReservationNo', message: 'ReservationNo exceeds maximum length of 10 characters' });
    }
    if (sItem && sItem.length > 4) {
      push({ field: 'ReservationItem', message: 'ReservationItem exceeds maximum length of 4 characters' });
    }
  }

  // 2. Quantity
  const qtyVal = data.IssueQty !== undefined ? data.IssueQty : data.quantity;
  push(C.checkQuantity(qtyVal));

  // 3. Master data (Material, Plant, StorageLocation, Unit)
  const matVal = data.Material !== undefined ? data.Material : data.material;
  const plantVal = data.Plant !== undefined ? data.Plant : data.plant;
  const slocVal = data.StorageLocation !== undefined ? data.StorageLocation : data.storageLocation;
  const unitVal = data.Unit !== undefined ? data.Unit : data.unit;

  push(C.checkMaterial(matVal, !hasReservation));
  push(C.checkPlant(plantVal, !hasReservation));
  push(C.checkStorageLocation(slocVal, !hasReservation));

  if (unitVal !== undefined || !hasReservation || mvt !== '261') {
    if (unitVal !== undefined || mvt !== '261') {
      push(C.checkUnit(unitVal));
    }
  }

  // 4. Destination rules
  const destRules = cfg.destinationRules || {};
  const recPlant = data.ReceivingPlant !== undefined ? data.ReceivingPlant : data.receivingPlant;
  const recSLoc = data.ReceivingStorageLocation !== undefined ? data.ReceivingStorageLocation : data.receivingStorageLocation;

  if (destRules.type === 'inter_plant') {
    const destVal = validateMovement301Destination(plantVal, recPlant, recSLoc, options);
    destVal.errors.forEach(push);
  } else if (destRules.type === 'intra_plant') {
    const destVal = validateMovement311Destination(plantVal, slocVal, recPlant, recSLoc, options);
    destVal.errors.forEach(push);
  } else {
    if (recPlant !== undefined && recPlant !== null && String(recPlant).trim() !== '') {
      push({ field: 'ReceivingPlant', message: `Receiving Plant is not allowed for Movement Type ${mvt}` });
    }
    if (recSLoc !== undefined && recSLoc !== null && String(recSLoc).trim() !== '') {
      push({ field: 'ReceivingStorageLocation', message: `Receiving Storage Location is not allowed for Movement Type ${mvt}` });
    }
  }

  // 5. Account assignment
  const accRules = cfg.accountAssignment || {};
  const sCostCenter = String(data.CostCenter || data.costCenter || '').trim();
  const sAssetNo = String(data.AssetNo || data.assetNo || '').trim();
  const sOrderId = String(data.OrderID || data.orderId || data.OrderNo || data.orderNo || '').trim();

  if (accRules.type === 'CostCenter') {
    if (!sCostCenter) {
      push({ field: 'CostCenter', message: 'Cost Center is mandatory for Movement Type 201 (Goods Issue to Cost Center)' });
    } else if (accRules.regex && !accRules.regex.test(sCostCenter)) {
      push({ field: 'CostCenter', message: `Cost Center '${sCostCenter}' must be 1 to 10 alphanumeric characters` });
    }
    if (data.GLAccount !== undefined && data.GLAccount !== null && String(data.GLAccount).trim() !== '') {
      push({ field: 'GLAccount', message: 'GLAccount cannot be supplied for Movement Type 201: the G/L account is system-determined from Cost Center via OBYC/GBB-VBR and is read-only' });
    }
  } else if (accRules.type === 'Asset') {
    if (!sAssetNo) {
      push({ field: 'AssetNo', message: 'Asset number is mandatory for Movement Type 241 (GI to Asset)' });
    }
  } else if (accRules.type === 'Order') {
    if (!hasReservation && !sOrderId) {
      push({ field: 'OrderID', message: 'Order number is mandatory for Movement Type 261 (GI to Order)' });
    }
    if (sCostCenter) {
      push({ field: 'CostCenter', message: 'Cost Center is not allowed for Movement Type 261 (GI to Order)' });
    }
    if (sAssetNo) {
      push({ field: 'AssetNo', message: 'Asset number is not allowed for Movement Type 261 (GI to Order)' });
    }
  } else {
    // None (301, 311)
    if (sCostCenter && cfg.forbiddenFields.includes('CostCenter')) {
      push({ field: 'CostCenter', message: `Cost Center is not allowed for Movement Type ${mvt}` });
    }
    if (sAssetNo && cfg.forbiddenFields.includes('AssetNo')) {
      push({ field: 'AssetNo', message: `Asset number is not allowed for Movement Type ${mvt}` });
    }
    if (data.GLAccount && cfg.forbiddenFields.includes('GLAccount')) {
      push({ field: 'GLAccount', message: `GLAccount is not allowed for Movement Type ${mvt}` });
    }
  }

  // 6. Centralized forbidden fields enforcement
  if (Array.isArray(cfg.forbiddenFields)) {
    for (const f of cfg.forbiddenFields) {
      const lowerF = f.charAt(0).toLowerCase() + f.slice(1);
      const val = data[f] !== undefined ? data[f] : data[lowerF];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        if (!errors.some((e) => e.field === f)) {
          push({ field: f, message: `${f} is not allowed for Movement Type ${mvt}` });
        }
      }
    }
  }

  // 7. Dates, Serials, Batch
  C.checkDates(data).forEach(push);
  C.checkSerialNumbers(data).forEach(push);
  push(C.checkBatch(data.Batch !== undefined ? data.Batch : data.batch));

  return C.buildResult(errors);
}

/**
 * Canonical destination validation across all movement types.
 *
 * @param {string} movementType
 * @param {string} plant
 * @param {string} storageLocation
 * @param {string} receivingPlant
 * @param {string} receivingStorageLocation
 * @param {object} [options]
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }> }}
 */
function validateMovementDestination(movementType, plant, storageLocation, receivingPlant, receivingStorageLocation, options = {}) {
  const cfg = getMovementConfig(movementType);
  if (!cfg) {
    return {
      isValid: false,
      errors: [{ field: 'MovementType', message: `Unsupported movement type '${movementType}'` }]
    };
  }

  const destRules = cfg.destinationRules || {};
  if (destRules.type === 'inter_plant') {
    return validateMovement301Destination(plant, receivingPlant, receivingStorageLocation, options);
  } else if (destRules.type === 'intra_plant') {
    return validateMovement311Destination(plant, storageLocation, receivingPlant, receivingStorageLocation, options);
  }

  // type === 'none' (201, 241, 261)
  const errors = [];
  if (receivingPlant !== undefined && receivingPlant !== null && String(receivingPlant).trim() !== '') {
    errors.push({ field: 'ReceivingPlant', message: `Receiving Plant is not allowed for Movement Type ${cfg.movementType}` });
  }
  if (receivingStorageLocation !== undefined && receivingStorageLocation !== null && String(receivingStorageLocation).trim() !== '') {
    errors.push({ field: 'ReceivingStorageLocation', message: `Receiving Storage Location is not allowed for Movement Type ${cfg.movementType}` });
  }
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Canonical account assignment validator across all movement types.
 *
 * @param {string} movementType
 * @param {object} data
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }> }}
 */
function validateMovementAccountAssignment(movementType, data = {}) {
  const cfg = getMovementConfig(movementType);
  if (!cfg) {
    return {
      isValid: false,
      errors: [{ field: 'MovementType', message: `Unsupported movement type '${movementType}'` }]
    };
  }

  const errors = [];
  const acc = cfg.accountAssignment || {};
  const costCenter = String(data.CostCenter || data.costCenter || '').trim();
  const assetNo = String(data.AssetNo || data.assetNo || '').trim();
  const orderId = String(data.OrderID || data.orderId || data.OrderNo || data.orderNo || '').trim();
  const orderType = String(data.OrderType || data.orderType || '').trim();

  if (acc.type === 'CostCenter') {
    if (!costCenter) {
      errors.push({ field: 'CostCenter', message: `Cost Center is mandatory for Movement Type ${cfg.movementType} (GI to Cost Center)` });
    } else if (acc.regex && !acc.regex.test(costCenter)) {
      errors.push({ field: 'CostCenter', message: `Cost Center '${costCenter}' must be 1 to 10 alphanumeric characters` });
    }
    if (data.GLAccount !== undefined && data.GLAccount !== null && String(data.GLAccount).trim() !== '') {
      errors.push({ field: 'GLAccount', message: `GLAccount cannot be supplied for Movement Type ${cfg.movementType}: the G/L account is system-determined from Cost Center via OBYC/GBB-VBR and is read-only` });
    }
  } else if (acc.type === 'Asset') {
    if (!assetNo) {
      errors.push({ field: 'AssetNo', message: `Asset number is mandatory for Movement Type ${cfg.movementType} (GI to Asset)` });
    }
  } else if (acc.type === 'Order') {
    if (acc.secondaryField === 'OrderType' && !orderType && data.isReservationCreation) {
      errors.push({ field: 'OrderType', message: `Order Type is mandatory for Movement Type ${cfg.movementType} (GI to Order)` });
    }
    if (!orderId) {
      errors.push({ field: 'OrderID', message: `Order number is mandatory for Movement Type ${cfg.movementType} (GI to Order)` });
    }
    if (costCenter) {
      errors.push({ field: 'CostCenter', message: `Cost Center is not allowed for Movement Type ${cfg.movementType} (GI to Order)` });
    }
    if (assetNo) {
      errors.push({ field: 'AssetNo', message: `Asset number is not allowed for Movement Type ${cfg.movementType} (GI to Order)` });
    }
  } else {
    // None
    if (costCenter) {
      errors.push({ field: 'CostCenter', message: `Cost Center is not allowed for Movement Type ${cfg.movementType}` });
    }
    if (assetNo) {
      errors.push({ field: 'AssetNo', message: `Asset number is not allowed for Movement Type ${cfg.movementType}` });
    }
    if (data.GLAccount) {
      errors.push({ field: 'GLAccount', message: `GLAccount is not allowed for Movement Type ${cfg.movementType}` });
    }
  }

  const fieldAliases = {
    CostCenter: ['CostCenter', 'costCenter'],
    AssetNo: ['AssetNo', 'assetNo'],
    SubNumber: ['SubNumber', 'subNumber'],
    ReceivingPlant: ['ReceivingPlant', 'receivingPlant'],
    ReceivingStorageLocation: ['ReceivingStorageLocation', 'receivingStorageLocation'],
    GLAccount: ['GLAccount', 'glAccount'],
    OrderID: ['OrderID', 'OrderId', 'orderId'],
    OrderNo: ['OrderNo', 'orderNo'],
    OrderType: ['OrderType', 'orderType']
  };
  for (const field of cfg.forbiddenFields || []) {
    const aliases = fieldAliases[field] || [field, field.charAt(0).toLowerCase() + field.slice(1)];
    const supplied = aliases.some((key) => data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '');
    if (supplied && !errors.some((error) => error.field === field)) {
      errors.push({ field, message: `${field} is not allowed for Movement Type ${cfg.movementType}` });
    }
  }

  return {
    isValid: errors.length === 0,
    errors
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
  SUPPORTED_MOVEMENT_TYPES,
  POSTABLE_MOVEMENT_TYPES,
  GM_CODE,
  getGmCode,
  getMovementConfig,
  resolveWmMovement,
  validateReservationInput,
  validateMovementPostingPayload,
  validateMovementDestination,
  validateMovementAccountAssignment,
  validateMovement261Payload,
  validateMovement301Destination,
  validateMovement311Destination,
  verifyReceivingLocationInSap,
  verifyMovement311DestinationInSap,
  calculateMovement261StockEligibility
};
