'use strict';

/**
 * sapRoleMapper.js
 *
 * Maps a user's SAP PFCG activity-group names (AGR_NAME from BAPI_USER_GET_DETAIL ACTIVITYGROUPS)
 * to application roles.
 *
 * Mapping mechanism:
 *   1. Prefix match: by default, any SAP role matching ^ZAPP_(.+)$ whose suffix is a KNOWN_ROLE
 *      (case-insensitive, e.g. ZAPP_SalesManager or ZAPP_SALES_MANAGER) grants that application role.
 *      The prefix is configurable via APP_SAP_ROLE_PREFIX (default "ZAPP_").
 *   2. Optional role-map.json: entries in config/role-map.json override or augment the prefix convention for
 *      SAP roles with other names, as {"<SAP role name>": ["AppRole", ...]}. It holds only role names that
 *      exist in the connected SAP system (read from AGR_USERS), never samples; an empty file ({}) maps nothing.
 *
 * Rules enforced here:
 *   1. Result = union of all app roles mapped from the user's AGR_NAMEs.
 *   2. If no AGR_NAME matches, return APP_DEFAULT_ROLES (never empty, never Admin).
 *   3. Admin is NEVER granted through role mapping (prefix or role-map.json). It is given only to the users
 *      named in APP_ADMIN_USERS (comma-separated SAP logon names, case-insensitive), whatever their SAP roles.
 *   4. If the BAPI call fails or times out, fall back to APP_DEFAULT_ROLES only.
 *      Never fail open to higher roles.
 *   5. All credentials are injected; none are logged.
 */

const fs = require('fs');
const path = require('path');
const { KNOWN_ROLES, parseDefaultRoles, parseAdminUsers, applyAdminRule } = require('./appUsers');
const LOG = require('../common/logger')('auth');

const DEFAULT_ROLE_MAP_PATH = path.resolve(__dirname, '../../config/role-map.json');
const DEFAULT_SAP_ROLE_PREFIX = 'ZAPP_';

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the configured SAP role prefix (default: "ZAPP_").
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function getSapRolePrefix(env = process.env) {
  if (env.APP_SAP_ROLE_PREFIX !== undefined && env.APP_SAP_ROLE_PREFIX !== null) {
    return String(env.APP_SAP_ROLE_PREFIX);
  }
  return DEFAULT_SAP_ROLE_PREFIX;
}

/**
 * Matches a suffix against KNOWN_ROLES (case-insensitive, with optional underscores).
 *
 * @param {string} suffix
 * @returns {string|null} canonical role name from KNOWN_ROLES, or null
 */
function matchKnownRole(suffix) {
  if (!suffix) return null;
  // Admin is not a role an SAP role name can stand for: it comes from APP_ADMIN_USERS only.
  const mappable = KNOWN_ROLES.filter((role) => role !== 'Admin');
  const s = String(suffix).trim().toLowerCase();
  for (const role of mappable) {
    if (role.toLowerCase() === s) return role;
  }
  // Also check without underscores (e.g. SALES_MANAGER -> SalesManager)
  const clean = s.replace(/_/g, '');
  for (const role of mappable) {
    if (role.toLowerCase() === clean) return role;
  }
  return null;
}

/**
 * Loads and validates optional config/role-map.json.
 * Returns null when the file is absent (feature is off / prefix matching alone used).
 * Throws on malformed JSON or an unknown app role if the file exists.
 *
 * @param {string} [mapPath] - path override for tests
 * @param {object} [fsImpl]  - injectable fs for tests
 * @returns {Object.<string, string[]>|null} SAP AGR_NAME -> app role[], or null if absent
 */
function loadRoleMap(mapPath = DEFAULT_ROLE_MAP_PATH, fsImpl = fs) {
  let text;
  try {
    text = fsImpl.readFileSync(mapPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null; // absent = optional file not present
    return null;
  }

  const trimmed = (text || '').trim();
  if (!trimmed || trimmed === '{}') return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`role-map.json at '${mapPath}' contains invalid JSON`);
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`role-map.json must be a JSON object {"SAP_ROLE": ["AppRole", ...]}`);
  }

  // Validate every mapped app role up front so a typo in the map is caught immediately.
  for (const [agrName, appRoles] of Object.entries(parsed)) {
    if (!Array.isArray(appRoles)) {
      throw new Error(`role-map.json: value for '${agrName}' must be an array of app role names`);
    }
    const unknown = appRoles.filter((r) => !KNOWN_ROLES.includes(r));
    if (unknown.length) {
      throw new Error(
        `role-map.json: '${agrName}' maps to unknown app role(s) [${unknown.join(', ')}]; ` +
        `allowed: ${KNOWN_ROLES.join(', ')}`
      );
    }
  }

  return parsed;
}

/**
 * Maps an array of SAP AGR_NAMEs to app roles using prefix matching and optional role-map.json.
 *
 * Admin is never a result: not from the prefix (ZAPP_ADMIN) and not from role-map.json. Such an SAP role is
 * logged and otherwise ignored; Admin comes from APP_ADMIN_USERS only (appUsers.applyAdminRule).
 * Returns null when no AGR_NAME matched anything (caller should fall back to defaults).
 *
 * @param {string}   username  - SAP logon name (for the log entry)
 * @param {string[]} agrNames  - AGR_NAME values from BAPI_USER_GET_DETAIL ACTIVITYGROUPS
 * @param {Object|null} [roleMap] - optional loaded role map (SAP role -> app role[])
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]|null}    - deduplicated app roles, or null if nothing matched
 */
function mapRoles(username, agrNames, roleMap = null, env = process.env) {
  const prefix = getSapRolePrefix(env);
  const adminClaims = [];
  const prefixRegex = new RegExp(`^${escapeRegExp(prefix)}(.+)$`, 'i');
  const appRoles = new Set();
  const map = roleMap || {};

  for (const rawAgr of agrNames) {
    const agr = String(rawAgr || '').trim();
    if (!agr) continue;

    // 1. Check optional role-map.json override first if present
    const mapped = map[agr] || map[agr.toUpperCase()] || null;
    if (Array.isArray(mapped) && mapped.length) {
      for (const role of mapped) {
        if (role === 'Admin') adminClaims.push(agr);
        else if (KNOWN_ROLES.includes(role)) appRoles.add(role);
      }
      continue;
    }

    // 2. Prefix match: ^ZAPP_(.+)$
    const match = agr.match(prefixRegex);
    if (match) {
      const suffix = match[1];
      const matchedRole = matchKnownRole(suffix);
      if (matchedRole) {
        appRoles.add(matchedRole);
      } else if (suffix.trim().toLowerCase() === 'admin') {
        adminClaims.push(agr);
      }
    }
  }

  if (adminClaims.length) {
    LOG.warn(
      `SAP role(s) [${adminClaims.join(', ')}] of '${String(username || '').toLowerCase()}' do not grant Admin: ` +
      'Admin is given only to the users named in APP_ADMIN_USERS'
    );
  }

  const result = [...appRoles];
  return result.length ? result : null; // null = "no match"
}

/**
 * The roles of a user whose own password SAP has accepted and who has no override entry.
 *
 * Reads the user's SAP PFCG roles via BAPI_USER_GET_DETAIL and maps them to app roles (mapRoles).
 * Falls back to parseDefaultRoles() (never Admin, never empty) when:
 *   - The BAPI call throws for any reason, including a timeout (RfcClient) and RFC not being available.
 *   - No AGR_NAME in the response matched prefix or role map.
 * Either case is logged as a warning that names the user. It never fails open to more roles.
 *
 * Admin is added last, and only for a user named in APP_ADMIN_USERS (appUsers.applyAdminRule): it does not
 * depend on the SAP role lookup, so an administrator stays one while RFC is down.
 *
 * The roles go into the token at sign-in: a role change in SAP applies at the user's next sign-in.
 *
 * Never throws.
 *
 * @param {string} username          - SAP logon name (upper/lower case preserved from login)
 * @param {Function} fetchDetail     - async (username) => { roles: [{name: string}] }
 *                                     Inject from readUserDetail(rfcClient.call.bind(rfcClient), ...)
 *                                     or a mock in tests.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [mapPath]         - path override for tests
 * @param {object} [fsImpl]          - injectable fs for tests
 * @returns {Promise<string[]>}      - always resolves with a non-empty role array
 */
async function fetchAndMapRoles(username, fetchDetail, env = process.env, mapPath, fsImpl) {
  // Load optional role map if present; failure to read file falls back to prefix matching alone
  let roleMap = null;
  try {
    const effectivePath = mapPath || env.ROLE_MAP_PATH || env.APP_ROLE_MAP_FILE || DEFAULT_ROLE_MAP_PATH;
    roleMap = module.exports.loadRoleMap(effectivePath, fsImpl);
  } catch (e) {
    LOG.warn(`role-map.json could not be loaded: ${e.message}; continuing with prefix matching`);
  }

  // Call the BAPI. Any error (RFC not configured, BAPI error, timeout) -> safe fallback.
  let detail;
  try {
    if (typeof fetchDetail !== 'function') {
      LOG.warn(
        `SAP roles of '${String(username).toLowerCase()}' could not be read (RFC is not available); ` +
        'using APP_DEFAULT_ROLES'
      );
      return applyAdminRule(username, parseDefaultRoles(env), env);
    }
    detail = await fetchDetail(username);
  } catch (e) {
    LOG.warn(
      `BAPI_USER_GET_DETAIL for '${String(username).toLowerCase()}' failed: ${e.message}; ` +
      'falling back to APP_DEFAULT_ROLES'
    );
    return applyAdminRule(username, parseDefaultRoles(env), env);
  }

  const agrNames = (detail && detail.roles || []).map((r) => String(r.name || '').trim()).filter(Boolean);
  const mapped = mapRoles(username, agrNames, roleMap, env);

  if (!mapped) {
    LOG.warn(
      `No SAP role matched prefix or role-map for '${String(username).toLowerCase()}' ` +
      `(${agrNames.length} SAP role(s) checked); using APP_DEFAULT_ROLES`
    );
    return applyAdminRule(username, parseDefaultRoles(env), env);
  }

  LOG.info(
    `Mapped SAP roles for '${String(username).toLowerCase()}': [${mapped.join(', ')}] ` +
    `(from ${agrNames.length} SAP role(s))`
  );
  return applyAdminRule(username, mapped, env);
}

/**
 * Creates the production fetchDetail function backed by RfcClient + readUserDetail.
 * Returns null when RFC is not available (node-rfc not installed or env vars missing),
 * so the caller can skip the BAPI path and fall straight to defaults.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Function|null} async (username) => detail, or null
 */
function createRfcFetchDetail(env = process.env) {
  const { RfcClient } = require('../integration/s4hana/RfcClient');
  const rfc = new RfcClient(env);

  if (!rfc.isAvailable()) {
    return null; // node-rfc not installed; feature unavailable
  }

  const { readUserDetail } = require('../integration/s4hana/admin/UserDetailReader');
  return (username) => rfc.session((call) => readUserDetail(call, username));
}

module.exports = {
  DEFAULT_SAP_ROLE_PREFIX,
  getSapRolePrefix,
  matchKnownRole,
  loadRoleMap,
  mapRoles,
  parseAdminUsers,
  fetchAndMapRoles,
  createRfcFetchDetail,
};
