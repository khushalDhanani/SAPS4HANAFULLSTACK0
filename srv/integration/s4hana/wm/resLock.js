'use strict';

const LOG = require('../logger')('res-lock');
const s4Config = require('../s4Config');
const { sapKey, httpError } = require('../sapKey');

/**
 * SAP-side reservation lock through the proposed RFC wrapper Z_WM_RES_LOCK (docs/abap/z_wm_res_lock.fugr.abap;
 * NOT deployed - parameter names come from that proposal, UNSURE until the FM exists). Behind a feature flag that is
 * OFF by default (cds.s4.resLockEnabled / S4_RES_LOCK_ENABLED). Flag off: fn(undefined) is called and no RFC call
 * is made. Flag on: lock, fn and unlock run on ONE RFC session (the lock is session-scoped, _SCOPE '1'); a refused
 * lock fails closed with HTTP 409 before any step runs. fn receives an rfc whose call/session reuse that connection.
 * UNSURE: whether the step FMs' own EMRESB enqueue collides with this lock in the same session (needs a live test).
 */
async function withReservationLock(rfc, key, fn) {
  if (!s4Config.getResLockEnabled() || !rfc || !key) return fn(undefined);
  const rsnum = sapKey(key.rsnum, 'rsnum').padStart(10, '0');
  const rspos = sapKey(key.rspos || '0001', 'rspos').padStart(4, '0');
  return rfc.session(async (call) => {
    const lock = await call('Z_WM_RES_LOCK', { IV_RSNUM: rsnum, IV_RSPOS: rspos, IV_ACTION: 'L', IV_WAIT: ' ' });
    if (lock?.EV_SUCCESS !== 'S') {
      throw Object.assign(httpError(409, lock?.EV_MESSAGE || `Reservation ${rsnum}/${rspos} is locked in SAP`), { code: 'RES_LOCKED' });
    }
    const scoped = Object.create(rfc, { call: { value: (fm, p = {}) => call(fm, p) }, session: { value: (f) => f(call) } });
    try {
      return await fn(scoped);
    } finally {
      try { await call('Z_WM_RES_LOCK', { IV_RSNUM: rsnum, IV_RSPOS: rspos, IV_ACTION: 'U' }); } catch (e) { LOG.warn(`Unlock of reservation ${rsnum}/${rspos} failed: ${e.message}`); }
    }
  });
}

/** Lock conflicts must reach the client as 409, never be recorded as a failed process step. */
const isLockConflict = (err) => err && err.code === 'RES_LOCKED';

module.exports = { withReservationLock, isLockConflict };
