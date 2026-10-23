'use strict';

/**
 * transferPathHelper.js
 *
 * Implements read-side path classification, shared shipping-managed check,
 * pre-check blockers & warnings, HU assignment rule among competing reservations,
 * and storage type configuration resolution via BusinessConfigResolver.
 * Zero SAP writes.
 */

const businessConfigResolver = require('../../../common/BusinessConfigResolver');

/**
 * Classifies the transfer path based on T001L storage location fields:
 * - 'A': Shipping-managed source SLoc (VSTEL, VKORG, or KUNNR not blank) -> Outbound delivery creation flow.
 * - 'B': HU-managed source SLoc without shipping point (XHUPF = 'X', VSTEL blank) -> Direct HU movement.
 * - 'standard': Non-HUM, Non-shipping SLoc.
 *
 * @param {Object|null} t001lRow - T001L record with VSTEL, VKORG, KUNNR, and XHUPF fields.
 * @returns {'A' | 'B' | 'standard'}
 */
function classifyTransferPath(t001lRow) {
  if (!t001lRow) return 'standard';
  const vstel = String(t001lRow.VSTEL || '').trim();
  const vkorg = String(t001lRow.VKORG || '').trim();
  const kunnr = String(t001lRow.KUNNR || '').trim();
  const xhupf = String(t001lRow.XHUPF || '').trim().toUpperCase();

  if (vstel || vkorg || kunnr) {
    return 'A';
  }
  if (xhupf === 'X') {
    return 'B';
  }
  return 'standard';
}

/**
 * Evaluates whether a storage location is shipping-managed based strictly on T001L fields.
 * Shared between the Fiori cockpit and simulation/CLI tools.
 *
 * @param {Object|null} t001lRow
 * @returns {boolean}
 */
function isShippingManaged(t001lRow) {
  return classifyTransferPath(t001lRow) === 'A';
}

/**
 * Executes read-only pre-checks for Path A delivery completion flow.
 * Detects operational blockers and warnings before attempting any SAP transaction:
 * - Blockers (prevent execution):
 *   1. Open delivery exists for the reservation item (OPEN_DELIVERY_EXISTS).
 *   2. HU is not in stock in source plant/SLoc (HU_NOT_IN_STOCK).
 *   3. Serial numbers are required for material (MARC-SERNP / T377) but none are selectable (SERIAL_REQUIRED_NONE_SELECTABLE).
 * - Warnings (informational, do not block validation):
 *   4. HU packaging type has no entry in T319A for the warehouse (NO_T319A_ROW).
 *
 * @param {Object} reservation - Reservation header/item data.
 * @param {Object|string} item - Item number or item object.
 * @param {Object} hu - Handling unit data.
 * @param {Object} [context={}] - Preloaded context or mock data (openDelivery, t319aRows, marc, t377Rows, rfc).
 * @returns {Promise<{ valid: boolean, path: 'A', blockers: string[], blockerDetails: Array<{ code: string, key: string, message: string, params: any[] }>, warnings: string[], warningDetails: Array<{ code: string, key: string, severity: 'warning', message: string, params: any[] }> }>}
 */
async function precheckPathA(reservation = {}, item = {}, hu = {}, context = {}) {
  const blockers = [];
  const warnings = [];

  const resNo = String(reservation.ReservationNo || reservation.RSNUM || reservation.reservation || '').replace(/^0+/, '') || '0';
  const resItem = String(item.ReservationItem || item.RSPOS || item.item || (typeof item === 'string' ? item : '') || '1').replace(/^0+/, '') || '1';
  const matnr = String(reservation.MATNR || reservation.Material || hu.Material || hu.matnr || '').trim();
  const plant = String(reservation.WERKS || reservation.Plant || hu.Plant || hu.plant || '').trim();
  const sloc = String(reservation.LGORT || reservation.StorageLocation || hu.StorageLocation || hu.sloc || '').trim();
  const huId = String(hu.unitNumber || hu.EXIDV || hu.lenum || hu.huId || (typeof hu === 'string' ? hu : '')).trim();
  const warehouse = String(reservation.warehouse || reservation.Warehouse || hu.warehouse || hu.Warehouse || 'W01').trim();
  const packagingType = String(hu.packagingType || hu.vhart || hu.VHART || '').trim();

  // 1. Blocker: Open delivery exists for this reservation item
  let openDelivery = context.openDelivery || null;
  if (!openDelivery && context.rfc && resNo && resItem) {
    try {
      const lips = await context.rfc.readTable(
        'LIPS',
        ['VBELN', 'POSNR'],
        [`RSNUM = '${resNo.padStart(10, '0')}'`, `AND RSPOS = '${resItem.padStart(4, '0')}'`],
        10
      );
      if (lips && lips.length) {
        for (const lp of lips) {
          const likp = await context.rfc.readTable('LIKP', ['VBELN', 'WBSTK'], [`VBELN = '${lp.VBELN}'`], 1);
          if (likp && likp[0] && String(likp[0].WBSTK || '').trim() !== 'C') {
            openDelivery = lp.VBELN.trim();
            break;
          }
        }
      }
    } catch (_) {
      // suppress query errors in precheck
    }
  }

  if (openDelivery) {
    blockers.push({
      code: 'OPEN_DELIVERY_EXISTS',
      key: 'blockerOpenDeliveryExists',
      message: `Open outbound delivery ${openDelivery} already exists for reservation ${resNo}/${resItem}.`,
      params: [openDelivery, resNo, resItem]
    });
  }

  // 2. Blocker: HU not in stock
  const inStock = hu.inStock !== undefined ? Boolean(hu.inStock) : (parseFloat(hu.availableStock || hu.availableQuantity || 0) > 0);
  if (!inStock) {
    blockers.push({
      code: 'HU_NOT_IN_STOCK',
      key: 'blockerHuNotInStock',
      message: `Handling unit ${huId || 'N/A'} is not in stock in plant ${plant} / storage location ${sloc}.`,
      params: [huId || 'N/A', plant, sloc]
    });
  }

  // 3. Warning (not a blocker): HU packaging type has no T319A row
  let t319aRows = context.t319aRows || null;
  if (!t319aRows && context.rfc && warehouse) {
    try {
      t319aRows = await context.rfc.readTable('T319A', ['LGNUM', 'VHART', 'LETYP'], [`LGNUM = '${warehouse}'`], 100);
    } catch (_) {}
  }

  if (packagingType && t319aRows) {
    const normWh = warehouse.toUpperCase();
    const normType = packagingType.toUpperCase();
    const matchingRow = t319aRows.find(
      r => String(r.LGNUM || '').trim().toUpperCase() === normWh &&
           String(r.VHART || '').trim().toUpperCase() === normType
    );
    if (!matchingRow) {
      warnings.push({
        code: 'NO_T319A_ROW',
        key: 'warningNoT319ARow',
        severity: 'warning',
        message: `Packaging type ${packagingType} has no storage unit type in warehouse ${warehouse}. Contact the SAP administrator.`,
        params: [packagingType, warehouse]
      });
    }
  } else if (packagingType && !t319aRows && context.t319aMissing) {
    warnings.push({
      code: 'NO_T319A_ROW',
      key: 'warningNoT319ARow',
      severity: 'warning',
      message: `Packaging type ${packagingType} has no storage unit type in warehouse ${warehouse}. Contact the SAP administrator.`,
      params: [packagingType, warehouse]
    });
  }

  // 4. Blocker: Serial required but none selectable
  let sernp = (context.marc && context.marc.SERNP) || hu.sernp || reservation.sernp || '';
  if (!sernp && context.rfc && matnr && plant) {
    try {
      const marcRows = await context.rfc.readTable('MARC', ['MATNR', 'WERKS', 'SERNP'], [`MATNR = '${matnr.padStart(18, '0')}'`, `AND WERKS = '${plant}'`], 1);
      if (marcRows && marcRows[0]) sernp = String(marcRows[0].SERNP || '').trim();
    } catch (_) {}
  }

  if (sernp && sernp !== '0000') {
    let isSerialMandatoryOnDelivery = true; // default true for ZSN2
    if (context.t377Rows) {
      const sdls = context.t377Rows.find(r => r.BELEG === 'SDLS' || r.BELEG === 'SDCC');
      if (sdls && sdls.SERPFLICHT !== '03') {
        isSerialMandatoryOnDelivery = false;
      }
    }

    if (isSerialMandatoryOnDelivery) {
      const serials = hu.serials || hu.selectableSerials || (hu.serialNumber ? [hu.serialNumber] : []);
      if (!Array.isArray(serials) || serials.length === 0) {
        blockers.push({
          code: 'SERIAL_REQUIRED_NONE_SELECTABLE',
          key: 'blockerSerialRequired',
          message: `Serial numbers are required for material ${matnr} but none are selectable or available.`,
          params: [matnr]
        });
      }
    }
  }

  return {
    valid: blockers.length === 0,
    path: 'A',
    blockers: blockers.map(b => b.message),
    blockerDetails: blockers,
    warnings: warnings.map(w => w.message),
    warningDetails: warnings
  };
}

/**
 * Default comparator for ranking competing reservations for the same stock/HU.
 * Rule: Earliest Requirement Date (BDTER), then ascending Reservation Number (RSNUM).
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function defaultReservationComparator(a, b) {
  const dateA = String(a.BDTER || a.RequirementDate || a.date || '').trim();
  const dateB = String(b.BDTER || b.RequirementDate || b.date || '').trim();
  if (dateA && dateB && dateA !== dateB) {
    return dateA.localeCompare(dateB);
  }
  if (dateA && !dateB) return -1;
  if (!dateA && dateB) return 1;

  const resA = String(a.RSNUM || a.ReservationNo || a.reservation || '').trim();
  const resB = String(b.RSNUM || b.ReservationNo || b.reservation || '').trim();
  const numA = parseInt(resA, 10);
  const numB = parseInt(resB, 10);
  if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
    return numA - numB;
  }
  if (resA !== resB) {
    return resA.localeCompare(resB);
  }

  const itemA = parseInt(a.RSPOS || a.ReservationItem || a.item || '1', 10);
  const itemB = parseInt(b.RSPOS || b.ReservationItem || b.item || '1', 10);
  return itemA - itemB;
}

/**
 * Assigns an available HU to competing reservations based on the prioritization rule.
 *
 * @param {Object|string} hu - Handling unit info or ID.
 * @param {Array<Object>} reservations - Competing reservation candidate objects.
 * @param {Function} [comparator=defaultReservationComparator] - Prioritization rule.
 * @returns {{ huId: string, assignedReservation: Object|null, rankedCandidates: Array<Object> } | null}
 */
function assignHuToCompetingReservations(hu, reservations, comparator = defaultReservationComparator) {
  if (!Array.isArray(reservations) || reservations.length === 0) return null;
  const sorted = [...reservations].sort(comparator);
  const huId = String(hu.unitNumber || hu.EXIDV || hu.lenum || hu.huId || (typeof hu === 'string' ? hu : '')).trim();
  return {
    huId,
    assignedReservation: sorted[0] || null,
    rankedCandidates: sorted
  };
}

/**
 * Returns competing reservations ranked by priority.
 *
 * @param {Array<Object>} reservations
 * @param {Function} [comparator=defaultReservationComparator]
 * @returns {Array<Object>}
 */
function rankCompetingReservations(reservations, comparator = defaultReservationComparator) {
  if (!Array.isArray(reservations)) return [];
  return [...reservations].sort(comparator);
}

/**
 * Resolves pickable, hold, and interim storage type rules dynamically via BusinessConfigResolver.
 * Fails closed without hardcoded literals when configuration is missing.
 *
 * @param {Object} [context={}]
 * @param {Object} [resolver=businessConfigResolver]
 * @returns {Promise<{ pickableStorageTypes: string[], holdStorageTypes: string[], interimStorageTypes: string[], isPickable: Function, isOnHold: Function, isInterim: Function }>}
 */
async function resolveHuStorageTypeRules(context = {}, resolver = businessConfigResolver) {
  return resolver.resolveHuStorageTypeRules(context);
}

module.exports = {
  classifyTransferPath,
  isShippingManaged,
  precheckPathA,
  defaultReservationComparator,
  assignHuToCompetingReservations,
  rankCompetingReservations,
  resolveHuStorageTypeRules
};
