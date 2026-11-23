'use strict';

/**
 * Who may sign in through the login action, and with which roles.
 *
 * Sources, merged:
 *   1. cds.requires.auth.users      - the development users of the active profile (entries set to false are off)
 *   2. APP_USER_ROLES               - JSON map of SAP user name to roles, e.g. {"JSMITH":["Viewer","SalesManager"]}
 *
 * A user in neither is refused before SAP is asked, so the login action cannot be used to test or lock
 * arbitrary SAP users, and a valid SAP logon alone grants nothing. User names ignore case.
 */

const KNOWN_ROLES = Object.freeze([
  'Admin', 'Viewer', 'PurchasingManager', 'SalesRepresentative', 'SalesManager',
  'WarehouseClerk', 'WarehouseManager', 'SapLogsReader'
]);

function rolesOf(config) {
  if (!config || !config.roles) return [];
  if (Array.isArray(config.roles)) return config.roles;
  if (typeof config.roles === 'object') return Object.keys(config.roles).filter((k) => config.roles[k]);
  if (typeof config.roles === 'string') return [config.roles];
  return [];
}

/**
 * Parses APP_USER_ROLES. Throws on malformed JSON or an unknown role, so a typing mistake is seen at startup
 * (server.js calls this once) instead of silently granting nothing or the wrong thing.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Map<string, string[]>} lower-cased user name -> roles
 */
function parseAppUserRoles(env = process.env) {
  const raw = String(env.APP_USER_ROLES || '').trim();
  const users = new Map();
  if (!raw) return users;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('APP_USER_ROLES is not valid JSON; expected {"USER":["Role", ...]}');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('APP_USER_ROLES must be a JSON object of user name to roles');
  }
  for (const [name, value] of Object.entries(parsed)) {
    const user = String(name).trim().toLowerCase();
    if (!/^[a-z0-9@._-]{1,40}$/.test(user)) throw new Error('APP_USER_ROLES contains an invalid user name');
    const roles = Array.isArray(value) ? value.map((r) => String(r).trim()) : [];
    const unknown = roles.filter((r) => !KNOWN_ROLES.includes(r));
    if (!Array.isArray(value) || unknown.length) {
      throw new Error(`APP_USER_ROLES: roles of '${name}' must be a list drawn from ${KNOWN_ROLES.join(', ')}`);
    }
    users.set(user, roles.length ? roles : ['Viewer']);
  }
  return users;
}

/**
 * Roles of a user who may sign in, or null when the user is not allowed.
 *
 * @param {string} username
 * @param {{users?: object}} [auth] - the effective cds.requires.auth
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]|null}
 */
function resolveAppUser(username, auth, env = process.env) {
  const user = String(username || '').trim().toLowerCase();
  if (!user) return null;

  let fromEnv;
  try {
    fromEnv = parseAppUserRoles(env).get(user);
  } catch {
    fromEnv = undefined; // reported at startup; a broken list allows nobody
  }
  if (fromEnv) return fromEnv;

  const configured = (auth && auth.users) || {};
  for (const [name, config] of Object.entries(configured)) {
    if (name === '*' || !config || String(name).toLowerCase() !== user) continue;
    const roles = rolesOf(config);
    if (roles.length) return roles;
  }
  return null;
}

module.exports = { KNOWN_ROLES, parseAppUserRoles, resolveAppUser };
