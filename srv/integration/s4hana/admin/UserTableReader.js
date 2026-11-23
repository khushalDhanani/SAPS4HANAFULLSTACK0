'use strict';

/**
 * UserTableReader
 *
 * Reads user tables (USR02, USER_ADDR, USH02) via RFC_READ_TABLE.
 * Named non-sensitive fields only; password hash columns are strictly excluded.
 */

const LOG = require('../../../common/logger')('user-management-adapter');

const {
  sapLiteral,
  historyCursor,
  compareHistoryRows,
  readUSH02,
} = require('./UserHistoryReader');

const { calculatePasswordStatus } = require('./UserPasswordExpiryUtil');

/**
 * USR02.UFLAG, read by name so no hash column is ever requested.
 * @param {object} rfc
 * @param {string} [username] - one user, or all when omitted
 * @returns {Promise<Array<{username: string, uflag: number}>>}
 */
async function readLockFlags(rfc, username) {
  const where = username ? [`BNAME = '${sapLiteral(username)}'`] : [];
  const rows = await rfc.readTable('USR02', ['BNAME', 'UFLAG'], where);
  return rows.map((row) => ({ username: row.BNAME, uflag: Number(row.UFLAG) || 0 }));
}

/**
 * All full names in one read of the view USER_ADDR.
 * @param {object} rfc
 * @returns {Promise<Map<string, string>>}
 */
async function readFullNames(rfc) {
  const rows = await rfc.readTable('USER_ADDR', ['BNAME', 'NAME_TEXTC']);
  return new Map(rows.map((row) => [row.BNAME, row.NAME_TEXTC]));
}

/**
 * Reads password and account expiry attributes from USR02, enriched with user full names from USER_ADDR.
 * Named non-sensitive fields only; password hash columns are strictly excluded.
 *
 * @param {object} rfc
 * @param {object} [options]
 * @param {string} [options.username] - filter by single username
 * @param {number} [options.expirationDays=90] - password validity period in days
 * @param {number} [options.warningDays=14] - threshold in days for 'expiring_soon' status
 * @param {string|Date} [options.referenceDate] - reference date for remaining days calculation
 * @returns {Promise<Array<object>>}
 */
async function readPasswordExpiryData(rfc, options = {}) {
  const where = options.username ? [`BNAME = '${sapLiteral(options.username)}'`] : [];
  const fields = ['BNAME', 'USTYP', 'UFLAG', 'GLTGV', 'GLTGB', 'PWDCHGDATE', 'TRDAT', 'LTIME'];

  const [usr02Rows, fullNames] = await Promise.all([
    rfc.readTable('USR02', fields, where),
    readFullNames(rfc).catch((err) => {
      LOG.warn('readFullNames for password expiry failed, continuing without full names:', err.message);
      return new Map();
    }),
  ]);

  return usr02Rows.map((row) => {
    const calc = calculatePasswordStatus(row, options);
    return {
      ...calc,
      fullName: fullNames.get(calc.username) || '',
    };
  });
}

/**
 * The newest USH02 row of a user.
 * @param {object} rfc
 * @param {string} username
 * @returns {Promise<{lockedAt: string, changedBy: string, uflag: number, historyKey: string}|null>}
 */
async function readLastLockChange(rfc, username) {
  const rows = await rfc.readTable(
    'USH02',
    ['MANDT', 'BNAME', 'MODDA', 'MODTI', 'MODBE', 'TCODE', 'REPID', 'UFLAG'],
    [`BNAME = '${sapLiteral(username)}'`]
  );
  if (!rows.length) return null;
  const latest = rows.reduce((newest, row) => (compareHistoryRows(row, newest) > 0 ? row : newest));
  const cursor = historyCursor(latest);
  return { lockedAt: cursor.at, changedBy: latest.MODBE, uflag: Number(latest.UFLAG) || 0, historyKey: cursor.key };
}

/**
 * Reads USH02 after the durable cursor and resolves each row's preceding same-user UFLAG.
 * @param {object} rfc
 * @param {{at: string, key: string}|null} cursor
 */
async function readLockHistory(rfc, cursor = null) {
  return readUSH02(rfc, cursor);
}

module.exports = {
  readLockFlags,
  readFullNames,
  readPasswordExpiryData,
  readLastLockChange,
  readLockHistory,
};
