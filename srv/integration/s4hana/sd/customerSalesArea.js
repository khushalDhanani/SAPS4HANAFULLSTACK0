'use strict';

const { sapKey } = require('../sapKey');

const fail = (status, message) => Object.assign(new Error(message), { status, code: status });
const fmt = (a) => `${a.salesOrganization}/${a.distributionChannel}/${a.division}`;

/**
 * Sales area (VKORG/VTWEG/SPART) of a customer, READ-ONLY from KNVV.
 * - requested values (from the request) are never trusted as such: they must match a maintained KNVV row
 * - nothing requested: exactly one maintained sales area is used; none or several -> error listing them
 * No default is ever assumed.
 */
async function resolveCustomerSalesArea(rfc, customer, requested = {}) {
  if (!rfc || typeof rfc.readTable !== 'function') {
    throw fail(503, 'Customer sales area cannot be resolved: the SAP RFC connection is not configured');
  }
  const kunnr = sapKey(customer, 'kunnr', 'Customer').padStart(10, '0');
  let rows;
  try {
    rows = await rfc.readTable('KNVV', ['VKORG', 'VTWEG', 'SPART', 'LOEVM'], [`KUNNR = '${kunnr}'`]);
  } catch (e) {
    throw Object.assign(fail(502, `Sales areas of customer ${customer} could not be read from SAP (KNVV): ${e.message}`), { cause: e });
  }
  const areas = (rows || [])
    .filter((r) => String(r.LOEVM || '').trim() !== 'X')
    .map((r) => ({ salesOrganization: String(r.VKORG || '').trim(), distributionChannel: String(r.VTWEG || '').trim(), division: String(r.SPART || '').trim() }))
    .filter((a) => a.salesOrganization);

  const req = {
    salesOrganization: String(requested.salesOrganization || '').trim(),
    distributionChannel: String(requested.distributionChannel || '').trim(),
    division: String(requested.division || '').trim()
  };
  if (req.salesOrganization || req.distributionChannel || req.division) {
    if (!(req.salesOrganization && req.distributionChannel && req.division)) {
      throw fail(400, 'Sales organization, distribution channel and division must be given together');
    }
    const hit = areas.find((a) => fmt(a) === fmt(req));
    if (!hit) throw fail(400, `Sales area ${fmt(req)} is not maintained for customer ${customer} in SAP (KNVV). Maintained: ${areas.map(fmt).join(', ') || 'none'}`);
    return hit;
  }
  if (areas.length === 1) return areas[0];
  if (areas.length === 0) throw fail(400, `Customer ${customer} has no sales area in SAP (KNVV); the return cannot be created`);
  throw fail(400, `Customer ${customer} has ${areas.length} sales areas in SAP (${areas.map(fmt).join(', ')}); the sales area must be chosen explicitly`);
}

module.exports = { resolveCustomerSalesArea };
