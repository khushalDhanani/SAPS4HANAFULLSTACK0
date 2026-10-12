'use strict';

const { httpError } = require('../sapKey');

/**
 * SAP authorization pre-check through the RFC-enabled FM AUTHORITY_CHECK (docs/abap/system-metadata.md §16/§17/§20).
 * The FM always signals its result as a classic exception: USER_IS_AUTHORIZED = ok, USER_NOT_AUTHORIZED = 403.
 * Objects and fields verified in TOBJ (§15): L_LGNUM (LGNUM, LGTYP), L_BWLVS (LGNUM, BWLVS),
 * M_MSEG_BWA (ACTVT, BWART), M_MSEG_WWA (ACTVT, WERKS). Only the fields given are checked.
 */
async function checkAuthorization(rfc, object, fields = {}) {
  const names = Object.keys(fields);
  const params = { OBJECT: object };
  names.forEach((f, i) => { params[`FIELD${i + 1}`] = f; params[`VALUE${i + 1}`] = String(fields[f]); });
  const detail = `${object} (${names.map((f) => `${f}=${fields[f]}`).join(', ')})`;
  try {
    await rfc.call('AUTHORITY_CHECK', params);
  } catch (err) {
    if (err.key === 'USER_IS_AUTHORIZED') return true;
    if (err.key === 'USER_NOT_AUTHORIZED') throw httpError(403, `No SAP authorization for ${detail}`);
    throw httpError(502, `Authorization check ${detail} failed: ${err.key || err.message}`);
  }
  return true; // not expected (the FM always raises); a normal return is treated as authorized
}

module.exports = { checkAuthorization };
