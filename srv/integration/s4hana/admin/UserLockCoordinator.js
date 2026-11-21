'use strict';

/**
 * UserLockCoordinator
 *
 * Coordinates SAP user lock and unlock transactions via BAPI_USER_LOCK / BAPI_USER_UNLOCK
 * and BAPI_TRANSACTION_COMMIT / BAPI_TRANSACTION_ROLLBACK.
 */

const LOG = require('../../../common/logger')('user-management-adapter');
const { toMessage } = require('./UserDetailReader');

/** SAP reports a failed commit in RETURN, without throwing, so RETURN decides whether the change really happened. */
async function commitOrFail(call, action, bname) {
  const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
  const failed = [].concat(commit?.RETURN || []).find((m) => m.TYPE === 'E' || m.TYPE === 'A');
  if (!failed) return;
  LOG.error('BAPI_TRANSACTION_COMMIT RETURN error:', failed.TYPE, failed.ID, failed.NUMBER, failed.MESSAGE);
  // A failed rollback must not hide the commit error, which is what the caller needs to see.
  await call('BAPI_TRANSACTION_ROLLBACK', {}).catch((e) => LOG.warn('BAPI_TRANSACTION_ROLLBACK failed:', e.message));
  throw Object.assign(new Error(`SAP did not commit the ${action} of user '${bname}': ${failed.MESSAGE}`), { status: 502, sapMessage: toMessage(failed) });
}

/** One lock or unlock BAPI in the caller's LUW: commits only when RETURN holds no E or A, otherwise rolls back. */
async function changeLock(call, fm, action, bname) {
  let res;
  try {
    res = await call(fm, { USERNAME: bname });
  } catch (e) {
    LOG.error(`${fm} failed:`, e.message);
    throw Object.assign(new Error(`Failed to ${action} user in SAP: ${e.message}`), { status: 502, cause: e });
  }

  const messages = [].concat(res.RETURN || []).map(toMessage);
  const errorMsg = messages.find((m) => m.type === 'E' || m.type === 'A');
  if (errorMsg) {
    LOG.error(`${fm} RETURN error:`, errorMsg.type, errorMsg.id, errorMsg.number, errorMsg.message);
    // A failed rollback must not hide the BAPI error, which is what the caller needs to see.
    await call('BAPI_TRANSACTION_ROLLBACK', {}).catch((e) => LOG.warn('BAPI_TRANSACTION_ROLLBACK failed:', e.message));
    throw Object.assign(new Error(`SAP error: ${errorMsg.message}`), { status: 502, sapMessage: errorMsg });
  }

  await commitOrFail(call, action, bname);
  return {
    success: true,
    status: messages.some((m) => m.type === 'W') ? 'warning' : 'success',
    messages,
    message: `User '${bname}' ${action}ed successfully in SAP`,
    username: bname,
  };
}

module.exports = {
  commitOrFail,
  changeLock,
};
