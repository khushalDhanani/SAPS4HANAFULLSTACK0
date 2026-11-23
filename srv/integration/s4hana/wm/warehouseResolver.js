'use strict';

const { sapKey, httpError } = require('../sapKey');

const padded = (value, pattern, length) => sapKey(value, pattern).padStart(length, '0');

async function uniqueHeaderWarehouse(rfc, table, keyField, keyValue, context) {
  const rows = await rfc.readTable(table, ['LGNUM'], [`${keyField} = '${keyValue}'`], 10);
  const warehouses = [...new Set((rows || []).map((row) => String(row.LGNUM || '').trim()).filter(Boolean))];
  if (warehouses.length > 1) {
    throw httpError(409, `Cannot resolve warehouse: ${context} exists in multiple warehouses (${warehouses.join(', ')})`);
  }
  return warehouses[0] || '';
}

/** Resolve LGNUM from request context; never use a process-wide warehouse default. */
async function resolveWarehouse(rfc, {
  warehouseNumber = '',
  lgnum = '',
  trNumber = '',
  tbnum = '',
  toNumber = '',
  tanum = '',
  reservationNumber = '',
  rsnum = '',
  plant = '',
  storageLocation = ''
} = {}) {
  const routeWarehouse = String(warehouseNumber || lgnum || '').trim();
  if (routeWarehouse) return sapKey(routeWarehouse, 'lgnum');

  if (!rfc?.readTable) {
    throw httpError(400, 'Cannot resolve warehouse: provide a warehouse number; SAP document lookup is unavailable.');
  }

  const tr = trNumber || tbnum;
  if (tr) {
    const key = padded(tr, 'tbnum', 10);
    const found = await uniqueHeaderWarehouse(rfc, 'LTBK', 'TBNUM', key, `Transfer Requirement ${String(tr).trim()}`);
    if (found) return sapKey(found, 'lgnum');
  }

  const to = toNumber || tanum;
  if (to) {
    const key = padded(to, 'tanum', 10);
    const found = await uniqueHeaderWarehouse(rfc, 'LTAK', 'TANUM', key, `Transfer Order ${String(to).trim()}`);
    if (found) return sapKey(found, 'lgnum');
  }

  const reservation = reservationNumber || rsnum;
  if (reservation) {
    const key = padded(reservation, 'rsnum', 10);
    const found = await uniqueHeaderWarehouse(rfc, 'LTBK', 'RSNUM', key, `Reservation ${String(reservation).trim()}`);
    if (found) return sapKey(found, 'lgnum');
  }

  const sPlant = plant ? sapKey(plant, 'plant') : '';
  const sLocation = storageLocation ? sapKey(storageLocation, 'lgort') : '';
  if (sPlant && sLocation) {
    const rows = await rfc.readTable(
      'T320',
      ['LGNUM'],
      [`( WERKS = '${sPlant}' AND LGORT = '${sLocation}' )`],
      10
    );
    const warehouses = [...new Set((rows || []).map((row) => String(row.LGNUM || '').trim()).filter(Boolean))];
    if (warehouses.length > 1) {
      throw httpError(409, `Cannot resolve warehouse: plant ${sPlant} / storage location ${sLocation} maps to multiple warehouses (${warehouses.join(', ')})`);
    }
    if (warehouses[0]) return sapKey(warehouses[0], 'lgnum');
    throw httpError(400, `Cannot resolve warehouse: SAP T320 has no assignment for plant ${sPlant} / storage location ${sLocation}.`);
  }

  throw httpError(400, 'Cannot resolve warehouse: provide a route warehouse, a TR/TO/reservation number with a SAP header, or both plant and storage location.');
}

module.exports = { resolveWarehouse };
