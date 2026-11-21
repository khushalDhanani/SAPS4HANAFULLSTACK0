'use strict';

/**
 * BusinessConfigCustomizer
 *
 * Queries SAP customizing tables (T001L, T001K, T001, T320, TVSTZ) via RFC
 * or customizer provider function for BusinessConfigResolver.
 */

async function querySapCustomizing(context, defaultSapCustomizing, defaultRfc) {
  const customizer = context.sapCustomizing || defaultSapCustomizing;
  if (typeof customizer === 'function') {
    try {
      const res = await customizer(context);
      if (res && typeof res === 'object') return res;
    } catch (_err) {
      // Continue to next resolution step
    }
  } else if (customizer && typeof customizer === 'object') {
    return customizer;
  }

  const rfc = context.rfc || defaultRfc;
  if (rfc && typeof rfc.readTable === 'function') {
    const result = {};
    const plant = context.plant;
    const sLoc = context.storageLocation;
    const wh = context.warehouse;
    const sapReadErrors = [];
    const readFailed = (table, e) => sapReadErrors.push(`${table}: ${e && e.message ? e.message : e}`);

    // 1. T001L: Storage Location in Plant (gives VKORG, VTWEG, SPART)
    if (plant && sLoc) {
      try {
        const t001l = await rfc.readTable('T001L', ['WERKS', 'LGORT', 'VKORG', 'VTWEG', 'SPART'], [
          `WERKS = '${plant}'`,
          `AND LGORT = '${sLoc}'`,
        ]);
        if (t001l && t001l[0]) {
          if (t001l[0].VKORG && t001l[0].VKORG.trim()) result.salesOrganization = t001l[0].VKORG.trim();
          if (t001l[0].VTWEG && t001l[0].VTWEG.trim()) result.distributionChannel = t001l[0].VTWEG.trim();
          if (t001l[0].SPART && t001l[0].SPART.trim()) result.division = t001l[0].SPART.trim();
        }
      } catch (e) { readFailed('T001L', e); }
    }

    // 1b. T001K (valuation area = plant) -> company code, T001 -> company code currency
    if (plant) {
      try {
        const t001k = await rfc.readTable('T001K', ['BWKEY', 'BUKRS'], [`BWKEY = '${plant}'`], 1);
        const bukrs = String(t001k?.[0]?.BUKRS || '').trim();
        if (bukrs) {
          result.companyCode = bukrs;
          const t001 = await rfc.readTable('T001', ['BUKRS', 'WAERS'], [`BUKRS = '${bukrs}'`], 1);
          const waers = String(t001?.[0]?.WAERS || '').trim();
          if (waers) result.currency = waers;
        }
      } catch (e) { readFailed('T001K/T001', e); }
    }

    // 2. T320: Warehouse assignment
    if (plant && sLoc && !wh) {
      try {
        const t320 = await rfc.readTable('T320', ['LGNUM'], [
          `WERKS = '${plant}'`,
          `AND LGORT = '${sLoc}'`,
        ]);
        if (t320 && t320[0] && t320[0].LGNUM) {
          result.warehouseNumber = t320[0].LGNUM.trim();
          result.warehouse = result.warehouseNumber;
        }
      } catch (e) { readFailed('T320', e); }
    } else if (wh && !plant) {
      try {
        const t320 = await rfc.readTable('T320', ['WERKS'], [`LGNUM = '${wh}'`]);
        if (t320 && t320[0] && t320[0].WERKS) {
          result.plant = t320[0].WERKS.trim();
        }
      } catch (e) { readFailed('T320', e); }
    }

    // 3. TVSTZ: Plant to Shipping Point assignment
    if (plant && result.shippingPoints === undefined) {
      try {
        const tvstz = await rfc.readTable('TVSTZ', ['WERKS', 'VSTEL'], [
          `WERKS = '${plant}'`,
        ]);
        if (Array.isArray(tvstz) && tvstz.length > 0) {
          const points = Array.from(new Set(tvstz.map((r) => r.VSTEL && r.VSTEL.trim()).filter(Boolean)));
          if (points.length > 0) {
            result.shippingPoints = points;
          }
        }
      } catch (e) { readFailed('TVSTZ', e); }
    }

    if (sapReadErrors.length) result.sapReadErrors = sapReadErrors;
    return Object.keys(result).length > 0 ? result : null;
  }

  return null;
}

/**
 * Applies resolved SAP customizing fields to the business config result.
 * @param {object} sapData
 * @param {object} result
 * @param {Function} parseCsv
 */
function applySapCustomizingData(sapData, result, parseCsv) {
  if (!sapData) return;
  if (sapData.companyCode && result.companyCode === undefined) result.companyCode = sapData.companyCode;
  if (sapData.salesOrganization && result.salesOrganization === undefined) result.salesOrganization = sapData.salesOrganization;
  if (sapData.salesOrg && result.salesOrganization === undefined) result.salesOrganization = sapData.salesOrg;
  if (sapData.distributionChannel && result.distributionChannel === undefined) result.distributionChannel = sapData.distributionChannel;
  if (sapData.distChannel && result.distributionChannel === undefined) result.distributionChannel = sapData.distChannel;
  if (sapData.division && result.division === undefined) result.division = sapData.division;
  if (sapData.currency && result.currency === undefined) result.currency = sapData.currency;
  if (sapData.orderType && result.orderType === undefined) result.orderType = sapData.orderType;
  if (sapData.inquiryType && result.inquiryType === undefined) result.inquiryType = sapData.inquiryType;
  if (sapData.conditionType && result.conditionType === undefined) result.conditionType = sapData.conditionType;
  if (sapData.shippingPoints && result.shippingPoints === undefined) {
    result.shippingPoints = typeof sapData.shippingPoints === 'string' ? parseCsv(sapData.shippingPoints) : sapData.shippingPoints;
  }
  if (sapData.salesMaterialTypes && result.salesMaterialTypes === undefined) {
    result.salesMaterialTypes = typeof sapData.salesMaterialTypes === 'string' ? parseCsv(sapData.salesMaterialTypes) : sapData.salesMaterialTypes;
  }
  if (sapData.materialTypes && result.salesMaterialTypes === undefined) {
    result.salesMaterialTypes = typeof sapData.materialTypes === 'string' ? parseCsv(sapData.materialTypes) : sapData.materialTypes;
  }
  if (sapData.differenceStorageType && result.differenceStorageType === undefined) {
    result.differenceStorageType = sapData.differenceStorageType;
  }
  if (sapData.plant && !result.plant) result.plant = sapData.plant;
  if (sapData.warehouse && !result.warehouse) {
    result.warehouse = sapData.warehouse;
    result.warehouseNumber = sapData.warehouse;
  }
}

module.exports = {
  querySapCustomizing,
  applySapCustomizingData,
};
