'use strict';

const { RfcClient } = require('../RfcClient');
const { sapKey } = require('../sapKey');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const FIELD_NAME = /^[A-Z0-9_]{1,30}$/;
const DD03L_FIELDS = ['TABNAME', 'FIELDNAME', 'POSITION', 'KEYFLAG', 'ROLLNAME'];

function findUniqueKeyField(metadataRows, matches, label) {
  const fieldNames = [...new Set(metadataRows
    .filter((row) => String(row.KEYFLAG || '').trim().toUpperCase() === 'X' && matches(row))
    .map((row) => String(row.FIELDNAME || '').trim().toUpperCase())
    .filter(Boolean))];
  if (fieldNames.length !== 1 || !FIELD_NAME.test(fieldNames[0])) {
    throw httpError(503, `T301 ${label} key field could not be identified unambiguously from DD03L.`);
  }
  return fieldNames[0];
}

/**
 * Validates BusinessConfig storage-type codes against T301 for a warehouse.
 * T301 projection fields are discovered from DD03L at runtime; if metadata is
 * unreadable or ambiguous, the BusinessConfig write fails closed.
 */
class StorageTypeConfigAdapter {
  constructor({ rfcClient = null } = {}) {
    this.rfc = rfcClient || new RfcClient();
  }

  async validateStorageTypeListsForWarehouse(warehouseNumber, lists) {
    let warehouse;
    try {
      warehouse = sapKey(warehouseNumber, 'lgnum');
    } catch (error) {
      throw httpError(400, error.message);
    }

    const requestedCodes = [...new Set([
      ...(lists?.pickableStorageTypes || []),
      ...(lists?.holdStorageTypes || []),
      ...(lists?.interimStorageTypes || [])
    ].map((value) => String(value).trim().toUpperCase()))];
    if (!requestedCodes.length) throw httpError(400, 'At least one configured storage type is required.');

    let metadataRows;
    try {
      metadataRows = await this.rfc.readTable('DD03L', DD03L_FIELDS, ["TABNAME = 'T301'"], 9999);
    } catch (_) {
      throw httpError(503, 'SAP DD03L metadata for T301 is unavailable; BusinessConfig update is blocked.');
    }
    if (!Array.isArray(metadataRows) || !metadataRows.length) {
      throw httpError(503, 'SAP DD03L returned no T301 metadata; BusinessConfig update is blocked.');
    }

    const warehouseField = findUniqueKeyField(metadataRows,
      (row) => String(row.FIELDNAME || '').trim().toUpperCase() === 'LGNUM' ||
        String(row.ROLLNAME || '').trim().toUpperCase() === 'LGNUM',
      'warehouse');
    const storageTypeField = findUniqueKeyField(metadataRows,
      (row) => String(row.FIELDNAME || '').trim().toUpperCase() === 'LGTYP' ||
        String(row.ROLLNAME || '').trim().toUpperCase() === 'LGTYP',
      'storage type');

    let rows;
    try {
      rows = await this.rfc.readTable('T301', [warehouseField, storageTypeField], [
        `${warehouseField} = '${warehouse}'`
      ], 9999);
    } catch (_) {
      throw httpError(503, 'SAP T301 storage types are unreadable; BusinessConfig update is blocked.');
    }
    if (!Array.isArray(rows) || rows.length >= 9999) {
      throw httpError(503, 'SAP T301 storage-type result is missing or may be truncated; BusinessConfig update is blocked.');
    }

    const available = new Set(rows
      .filter((row) => String(row[warehouseField] || '').trim().toUpperCase() === warehouse)
      .map((row) => String(row[storageTypeField] || '').trim().toUpperCase())
      .filter(Boolean));
    const missing = requestedCodes.filter((code) => !available.has(code));
    if (missing.length) {
      throw httpError(400, `Storage types not found in T301 for warehouse ${warehouse}: ${missing.join(', ')}.`);
    }

    return { warehouse, verifiedStorageTypes: requestedCodes };
  }
}

module.exports = StorageTypeConfigAdapter;
