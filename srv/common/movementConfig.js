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
const MOVEMENT_CONFIG = Object.freeze({
  '201': Object.freeze({
    movementType: '201',
    inventoryMovement: '201',
    configuredWmMovement: '201',
    stagingWmMovement: '311',
    get wmMovement() {
      return process.env.WM_TR_REAL_MOVEMENT === 'true' ? '201' : '311';
    },
    requirementType: 'K',
    interimStorageType: '911',
    description: 'Goods Issue to Cost Center',
    requiresCostCenter: true,
    requiresAsset: false,
    requiresOrder: false,
    requiresReceivingPlant: false,
    requiresReceivingSloc: false,
    preserveReservationOnTr: true,
    gmCode: '03'
  }),
  '241': Object.freeze({
    movementType: '241',
    inventoryMovement: '241',
    configuredWmMovement: '241',
    stagingWmMovement: '311',
    get wmMovement() {
      return process.env.WM_TR_REAL_MOVEMENT === 'true' ? '241' : '311';
    },
    requirementType: 'A',
    interimStorageType: '913',
    description: 'Goods Issue to Asset',
    requiresCostCenter: false,
    requiresAsset: true,
    requiresOrder: false,
    requiresReceivingPlant: false,
    requiresReceivingSloc: false,
    preserveReservationOnTr: true,
    gmCode: '03'
  }),
  '311': Object.freeze({
    movementType: '311',
    inventoryMovement: '311',
    configuredWmMovement: '311',
    stagingWmMovement: '311',
    wmMovement: '311',
    requirementType: '',
    interimStorageType: '921',
    interimStorageBin: 'TRANSFER',
    description: 'Storage Location to Storage Location Transfer',
    requiresCostCenter: false,
    requiresAsset: false,
    requiresOrder: false,
    requiresReceivingPlant: false,
    requiresReceivingSloc: true,
    receivingPlantMustMatch: true,
    receivingSlocMustDiffer: true,
    preserveReservationOnTr: true,
    gmCode: '04'
  }),
  '301': Object.freeze({
    movementType: '301',
    inventoryMovement: '301',
    configuredWmMovement: '301',
    stagingWmMovement: '301',
    wmMovement: '301',
    requirementType: '',
    interimStorageType: '920',
    interimStorageBin: 'TRANSFER',
    description: 'Plant to Plant Transfer',
    requiresCostCenter: false,
    requiresAsset: false,
    requiresOrder: false,
    requiresReceivingPlant: true,
    requiresReceivingSloc: true,
    receivingPlantMustDiffer: true,
    preserveReservationOnTr: false,
    gmCode: '04'
  }),
  '261': Object.freeze({
    movementType: '261',
    inventoryMovement: '261',
    configuredWmMovement: '261',
    stagingWmMovement: '261',
    wmMovement: '261',
    requirementType: 'F',
    interimStorageType: '914',
    description: 'Goods Issue to Order',
    requiresCostCenter: false,
    requiresAsset: false,
    requiresOrder: true,
    requiresReceivingPlant: false,
    requiresReceivingSloc: false,
    preserveReservationOnTr: true,
    gmCode: '03'
  })
});

const SUPPORTED_MOVEMENT_TYPES = Object.freeze(['201', '241', '311', '301', '261']);

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
function validateReservationInput(data = {}, options = {}) {
  const errors = [];
  const addError = (msg) => {
    errors.push(msg);
    if (options.req && typeof options.req.error === 'function') {
      options.req.error(400, msg);
    }
  };

  const mvt = String(data.MovementType || data.movementType || '').trim();
  const plant = String(data.Plant || data.plant || '').trim();
  const sloc = String(data.StorageLocation || data.storageLocation || '').trim();
  const material = String(data.Material || data.material || '').trim();
  const qtyRaw = data.Quantity !== undefined ? data.Quantity : data.quantity;
  const qty = Number(qtyRaw);
  const unit = String(data.Unit || data.unit || data.Uom || data.uom || '').trim();
  const resDate = data.ReservationDate !== undefined ? data.ReservationDate : data.reservationDate;
  const recPlant = String(data.ReceivingPlant || data.receivingPlant || '').trim();
  const recSLoc = String(data.ReceivingStorageLocation || data.receivingStorageLocation || '').trim();
  const costCenter = String(data.CostCenter || data.costCenter || '').trim();
  const assetNo = String(data.AssetNo || data.assetNo || '').trim();
  const orderId = String(data.OrderID || data.orderId || data.OrderNo || data.orderNo || data.Aufnr || data.aufnr || '').trim();
  const orderType = String(data.OrderType || data.orderType || data.Auart || data.auart || '').trim();

  // 1. Movement Type
  if (!mvt) {
    addError('MovementType is mandatory (201, 241, 311, 301, 261)');
  } else if (!MOVEMENT_CONFIG[mvt]) {
    addError(`Unsupported movement type '${mvt}'. Valid movement types are: 201, 241, 311, 301, 261`);
  }

  // 2. Plant
  if (!plant) {
    addError('Plant is mandatory');
  }

  // 3. Storage Location
  if (!sloc) {
    addError('StorageLocation is mandatory');
  }

  // 4. Material
  if (!material) {
    addError('Material is mandatory');
  }

  // 5. Quantity
  if (qtyRaw === undefined || qtyRaw === null || qtyRaw === '' || isNaN(qty) || qty <= 0) {
    addError('Quantity must be greater than 0');
  }

  // 6. Unit of Measure
  if (!unit) {
    addError('Unit is mandatory');
  }

  // 7. Reservation Date (optional, but if provided must be valid)
  if (resDate !== undefined && resDate !== null && resDate !== '') {
    if (typeof resDate === 'string' && /^\d{8}$/.test(resDate)) {
      // Valid SAP YYYYMMDD string format
    } else {
      const d = new Date(resDate);
      if (isNaN(d.getTime())) {
        addError('Invalid ReservationDate');
      }
    }
  }

  // 8. Movement-specific account assignment & routing validations
  const cfg = MOVEMENT_CONFIG[mvt];
  if (cfg) {
    switch (mvt) {
      case '201':
        if (!costCenter) {
          addError('Cost Center is mandatory for Movement Type 201 (GI to Cost Center)');
        }
        break;

      case '241':
        if (!assetNo) {
          addError('Asset number is mandatory for Movement Type 241 (GI to Asset)');
        }
        break;

      case '311':
        if (!recSLoc) {
          addError('Receiving Storage Location is mandatory for Movement Type 311 (SLoc Transfer)');
        } else if (recSLoc === sloc) {
          addError('Receiving Storage Location must be different from Issuing Storage Location');
        }
        if (recPlant && recPlant !== plant) {
          addError('Receiving Plant must match Issuing Plant for Movement Type 311 (SLoc Transfer)');
        }
        break;

      case '301': {
        const destVal = validateMovement301Destination(plant, recPlant, recSLoc);
        destVal.errors.forEach((e) => addError(e.message));
        break;
      }

      case '261':
        if (!orderType) {
          addError('Order Type is mandatory for Movement Type 261 (GI to Order)');
        }
        if (!orderId) {
          addError('Order number is mandatory for Movement Type 261 (GI to Order)');
        }
        if (costCenter) {
          addError('Cost Center is not allowed for Movement Type 261 (GI to Order)');
        }
        if (assetNo) {
          addError('Asset number is not allowed for Movement Type 261 (GI to Order)');
        }
        if (recPlant) {
          addError('Receiving Plant is not allowed for Movement Type 261 (GI to Order)');
        }
        if (recSLoc) {
          addError('Receiving Storage Location is not allowed for Movement Type 261 (GI to Order)');
        }
        break;

      default:
        break;
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
    config: cfg || null
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
 * Authoritative SAP backend verification for Movement 301 Receiving Location.
 * Verifies that ReceivingPlant + ReceivingStorageLocation are valid in SAP:
 * 1. T001L: Receiving Storage Location exists in Receiving Plant.
 * 2. If material is provided:
 *    - MARC: Material is extended to Receiving Plant.
 *    - MARD: Material is extended to Receiving Storage Location in Receiving Plant.
 *
 * @param {object} rfc - SAP RFC client (must have readTable method)
 * @param {object} params
 * @param {string} params.receivingPlant
 * @param {string} params.receivingStorageLocation
 * @param {string} [params.plant]
 * @param {string} [params.material]
 * @param {boolean} [params.checkT001L=true]
 * @param {boolean} [params.checkMarc=true]
 * @param {boolean} [params.checkMard=true]
 * @returns {Promise<{ valid: boolean, error?: string, initialDestStock?: number }>}
 */
async function verifyReceivingLocationInSap(rfc, {
  receivingPlant,
  receivingStorageLocation,
  _plant,
  material,
  requireSLoc = true,
  checkT001L = true,
  checkMarc = true,
  checkMard = true
} = {}) {
  if (!rfc || typeof rfc.readTable !== 'function') {
    return { valid: true };
  }

  const sRecPlant = String(receivingPlant || '').trim().toUpperCase();
  const sRecSLoc = String(receivingStorageLocation || '').trim().toUpperCase();

  if (!sRecPlant) {
    return {
      valid: false,
      error: 'Receiving Plant is mandatory for Movement Type 301 (Plant Transfer)'
    };
  }

  let initialDestStock = undefined;

  // 1. If material is provided, verify MARC extension to Receiving Plant
  if (material && checkMarc) {
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
      if (mErr.status === 503 || /not configured/i.test(mErr.message)) {
        return { valid: true, initialDestStock };
      }
      throw mErr;
    }

    // 2. If storage location is provided, verify MARD extension
    if (checkMard && sRecSLoc) {
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
        if (mErr.status === 503 || /not configured/i.test(mErr.message)) {
          return { valid: true, initialDestStock };
        }
        throw mErr;
      }
    }
  }

  // 3. Receiving Storage Location requirement check
  if (!sRecSLoc) {
    if (requireSLoc) {
      return {
        valid: false,
        error: 'Receiving Storage Location is mandatory for Movement Type 301 (Plant to Plant Transfer)'
      };
    }
    return { valid: true, initialDestStock };
  }

  // 4. T001L: Verify Receiving Storage Location exists in Receiving Plant
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
      if (err.status === 503 || /not configured/i.test(err.message)) {
        return { valid: true, initialDestStock };
      }
      throw err;
    }
  }

  return { valid: true, initialDestStock };
}

module.exports = {
  MOVEMENT_CONFIG,
  SUPPORTED_MOVEMENT_TYPES,
  getMovementConfig,
  resolveWmMovement,
  validateReservationInput,
  validateMovement301Destination,
  verifyReceivingLocationInSap
};
