'use strict';

/**
 * BusinessConfigOverrides
 *
 * Extracts and normalizes trusted server-side business config overrides.
 */

const DIRECT_KEYS = [
  'salesOrganization', 'salesOrg',
  'distributionChannel', 'distChannel',
  'division', 'currency',
  'inquiryType', 'orderType', 'conditionType',
  'shippingPoints',
  'salesMaterialTypes', 'materialTypes',
  'differenceStorageType',
  'pickableStorageTypes',
  'holdStorageTypes',
  'interimStorageTypes',
];

/**
 * Extracts trusted overrides into result object.
 * @param {object} context
 * @param {object} result
 * @param {Function} parseCsv
 * @returns {object} overrides map
 */
function extractTrustedOverrides(context, result, parseCsv) {
  const isTrusted = context.isTrusted === true || context.trustedContext === true;
  let overrides = {};

  if (context.trustedOverrides && typeof context.trustedOverrides === 'object') {
    overrides = { ...context.trustedOverrides };
  } else if (isTrusted && context.overrides && typeof context.overrides === 'object') {
    overrides = { ...context.overrides };
  } else if (isTrusted) {
    for (const k of DIRECT_KEYS) {
      if (context[k] !== undefined) {
        overrides[k] = context[k];
      }
    }
  }

  // Normalize trusted override keys
  if (overrides.salesOrg !== undefined && overrides.salesOrganization === undefined) {
    overrides.salesOrganization = overrides.salesOrg;
  }
  if (overrides.distChannel !== undefined && overrides.distributionChannel === undefined) {
    overrides.distributionChannel = overrides.distChannel;
  }
  if (overrides.materialTypes !== undefined && overrides.salesMaterialTypes === undefined) {
    overrides.salesMaterialTypes = overrides.materialTypes;
  }

  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== null && v !== '') {
      if (k === 'shippingPoints' && typeof v === 'string') {
        result[k] = parseCsv(v);
      } else if (k === 'salesMaterialTypes' && typeof v === 'string') {
        result[k] = parseCsv(v);
      } else if ((k === 'pickableStorageTypes' || k === 'holdStorageTypes' || k === 'interimStorageTypes') && typeof v === 'string') {
        result[k] = parseCsv(v);
      } else if ((k === 'pickableStorageTypes' || k === 'holdStorageTypes' || k === 'interimStorageTypes') && Array.isArray(v)) {
        result[k] = v.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
      } else {
        result[k] = v;
      }
    }
  }

  return overrides;
}

module.exports = {
  extractTrustedOverrides,
};
