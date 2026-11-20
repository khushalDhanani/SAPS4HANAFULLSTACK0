/**
 * srv/wm/goods-receipt/validation/common.js
 * Field-format checks applied before calling SAP for Goods Receipt.
 */

'use strict';

const PLANT_REGEX = /^[A-Za-z0-9]{4}$/;
const SLOC_REGEX = /^[A-Za-z0-9]{4}$/;

/**
 * @param {*} value
 * @param {boolean} required
 * @returns {{field:string,message:string}|null}
 */
function checkMaterial(value, required) {
  const s = String(value || '').trim();
  if (!s) {
    return required ? { field: 'Material', message: 'Material number is required' } : null;
  }
  if (s.length > 40) {
    return { field: 'Material', message: 'Material number exceeds maximum length of 40 characters' };
  }
  return null;
}

/**
 * @param {*} value
 * @param {boolean} required
 * @returns {{field:string,message:string}|null}
 */
function checkPlant(value, required) {
  const s = String(value || '').trim();
  if (!s) {
    return required ? { field: 'Plant', message: 'Plant is required' } : null;
  }
  if (!PLANT_REGEX.test(s)) {
    return { field: 'Plant', message: `Plant '${s}' must be exactly 4 alphanumeric characters` };
  }
  return null;
}

/**
 * @param {*} value
 * @param {boolean} required
 * @returns {{field:string,message:string}|null}
 */
function checkStorageLocation(value, required) {
  const s = String(value || '').trim();
  if (!s) {
    return required ? { field: 'StorageLocation', message: 'Storage Location is required' } : null;
  }
  if (!SLOC_REGEX.test(s)) {
    return { field: 'StorageLocation', message: `Storage Location '${s}' must be exactly 4 alphanumeric characters` };
  }
  return null;
}

/**
 * @param {*} value
 * @param {boolean} required
 * @returns {{field:string,message:string}|null}
 */
function checkBatch(value, required) {
  const s = String(value || '').trim();
  if (!s) {
    return required ? { field: 'Batch', message: 'Batch number is required' } : null;
  }
  if (s.length > 10) {
    return { field: 'Batch', message: `Batch '${s}' exceeds maximum length of 10 characters` };
  }
  return null;
}

module.exports = {
  checkMaterial,
  checkPlant,
  checkStorageLocation,
  checkBatch
};
