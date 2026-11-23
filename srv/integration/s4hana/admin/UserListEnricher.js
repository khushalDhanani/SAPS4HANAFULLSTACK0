'use strict';

/**
 * UserListEnricher
 *
 * Enriches BAPI_USER_GETLIST results with BAPI_USER_GET_DETAIL data
 * using a bounded pool of concurrent RFC connections.
 */

const LOG = require('../../../common/logger')('user-management-adapter');
const { readUserDetail } = require('./UserDetailReader');

// List enrichment: at most this many RFC connections read user details at once.
// One more connection is opened per this many uncached users.
const LIST_DETAIL_CONNECTIONS = 4;
const LIST_USERS_PER_EXTRA_CONNECTION = 25;

/**
 * Enriches filtered user rows with details on bounded connections.
 * @param {object} params
 * @param {object} params.rfc
 * @param {Function} params.call
 * @param {Array<object>} params.filtered
 * @param {boolean} params.forceRefresh
 * @param {Function} params.getCachedDetail
 * @param {Function} params.setCachedDetail
 * @param {number} [params.listDetailConnections]
 * @returns {Promise<Array<object>>}
 */
async function enrichUserList({
  rfc,
  call,
  filtered,
  forceRefresh,
  getCachedDetail,
  setCachedDetail,
  listDetailConnections = LIST_DETAIL_CONNECTIONS,
}) {
  const enrichOne = async (rfcCall, user) => {
    const username = String(user.USERNAME || '').trim();
    const listedUser = {
      username,
      firstName: String(user.FIRSTNAME || '').trim(),
      lastName: String(user.LASTNAME || '').trim(),
      fullName: String(user.FULLNAME || '').trim(),
    };

    try {
      let detail = !forceRefresh ? getCachedDetail(username) : null;
      if (!detail) {
        detail = await readUserDetail(rfcCall, username.toUpperCase());
        setCachedDetail(username, detail);
      }
      const fullName = detail.fullName
        || listedUser.fullName
        || [detail.firstName || listedUser.firstName, detail.lastName || listedUser.lastName].filter(Boolean).join(' ');
      return {
        ...listedUser,
        fullName,
        detailsAvailable: true,
        isLocked: detail.isLocked,
        userType: detail.userType,
        validFrom: detail.validFrom,
        validTo: detail.validTo,
        lastChanged: detail.lastChanged,
        lastChangedBy: detail.lastChangedBy,
      };
    } catch (e) {
      LOG.warn('Could not enrich SAP user list row:', username, e.message);
      return {
        ...listedUser,
        detailsAvailable: false,
        isLocked: null,
        userType: null,
        validFrom: null,
        validTo: null,
        lastChanged: null,
        lastChangedBy: null,
      };
    }
  };

  // Workers share one queue, so a slow read or a connection that fails to open never loses a row:
  // the connection that read the list always drains whatever is left.
  const enriched = new Array(filtered.length);
  let next = 0;
  const worker = async (rfcCall) => {
    while (next < filtered.length) {
      const index = next++;
      enriched[index] = await enrichOne(rfcCall, filtered[index]);
    }
  };
  const uncached = forceRefresh
    ? filtered.length
    : filtered.filter((user) => !getCachedDetail(String(user.USERNAME || '').trim())).length;
  const extraConnections = Math.min(listDetailConnections - 1, Math.floor(uncached / LIST_USERS_PER_EXTRA_CONNECTION));
  const startedAt = Date.now();
  await Promise.all([
    worker(call),
    ...Array.from({ length: Math.max(0, extraConnections) }, () => rfc.session(worker).catch((e) => {
      LOG.warn('Extra RFC connection for the user list failed; the remaining connections continue:', e.message);
    })),
  ]);
  LOG.info('listUsers details read', {
    users: filtered.length, detailReads: uncached, connections: 1 + Math.max(0, extraConnections), ms: Date.now() - startedAt,
  });
  return enriched;
}

module.exports = {
  LIST_DETAIL_CONNECTIONS,
  LIST_USERS_PER_EXTRA_CONNECTION,
  enrichUserList,
};
