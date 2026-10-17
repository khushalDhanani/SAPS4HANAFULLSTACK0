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

      case '311': {
        const destVal = validateMovement311Destination(plant, sloc, recPlant, recSLoc);
        destVal.errors.forEach((e) => addError(e.message));
        break;
      }

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
 * @param {string} [params.movementType='301'] - '301' or '311'
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
  movementType = '301',
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
  if (!rfc || typeof rfc.readTable !== 'function') {
    return { valid: true };
  }

  const sMvt = String(movementType || '').trim();
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

module.exports = {
  MOVEMENT_CONFIG,
  SUPPORTED_MOVEMENT_TYPES,
  getMovementConfig,
  resolveWmMovement,
  validateReservationInput,
  validateMovement301Destination,
  validateMovement311Destination,
  verifyReceivingLocationInSap,
  verifyMovement311DestinationInSap,
  calculateMovement261StockEligibility
};
