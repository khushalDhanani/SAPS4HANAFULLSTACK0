'use strict';

/**
 * Who may sign in through the login action, and with which roles.
 *
 * No list is needed for ordinary users: with APP_ALLOW_ANY_SAP_USER=true every user whose own password SAP
 * accepts may sign in, and the roles come from the user's SAP roles (srv/auth/sapRoleMapper.js) or
 * APP_DEFAULT_ROLES. The lists below are optional overrides, empty by default.
 *
 * Admin is granted to users named in APP_ADMIN_USERS (comma-separated, case-insensitive) or explicitly
 * assigned "Admin" in APP_USER_ROLES / APP_USERS_FILE. No default (APP_DEFAULT_ROLES), no SAP role, no
 * role-map.json entry, and no package.json mocked user grants Admin on its own (applyAdminRule).
 *
 * Optional overrides, evaluated in priority order on every login (no restart needed for 2–3):
 *   1. APP_USER_ROLES    – JSON map env var; validated at startup
 *   2. APP_USERS_FILE    – path to a JSON or CSV file (hot-reloaded on every call; mount as a Docker volume)
 *   3. cds.requires.auth.users – development profile users (entries set to false are off)
 *
 * With APP_ALLOW_ANY_SAP_USER unset or false, a user in none of the sources and not in APP_ADMIN_USERS is refused
 * before SAP is asked.
 * User names are case-insensitive throughout.
 *
 * APP_USERS_FILE format
 * ─────────────────────
 * JSON  { "JSMITH": ["Viewer","SalesManager"], "ACLARKE": ["PurchasingManager"] }
 * CSV   username,roles   (header required; roles column is comma-separated inside quotes)
 *       JSMITH,"Viewer,SalesManager"
 *       ACLARKE,PurchasingManager
 */

const fs = require('fs');
const LOG = require('../common/logger')('auth');

const KNOWN_ROLES = Object.freeze([
  'Admin', 'Viewer', 'PurchasingManager', 'SalesRepresentative', 'SalesManager',
  'WarehouseClerk', 'WarehouseManager', 'SapLogsReader'
]);

/** Roles that APP_ALLOW_ANY_SAP_USER may never grant, even via APP_DEFAULT_ROLES. */
const NEVER_DEFAULT_ROLES = new Set(['Admin']);

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
 * Validates and normalises a list of role strings.
 * Throws when any role name is unknown.
 *
 * @param {string[]} roles
 * @param {string} context – for error messages
 * @returns {string[]} deduplicated, known roles; falls back to ['Viewer'] when empty
 */
function validateRoles(roles, context) {
  const unknown = roles.filter((r) => !KNOWN_ROLES.includes(r));
  if (unknown.length) {
    throw new Error(`${context}: unknown role(s) ${unknown.join(', ')}; allowed: ${KNOWN_ROLES.join(', ')}`);
  }
  const deduped = [...new Set(roles)];
  return deduped.length ? deduped : ['Viewer'];
}

/**
 * Parses a CSV text with a "username,roles" header.
 * The roles cell may be a single role or a quoted comma-list: JSMITH,"Viewer,SalesManager"
 *
 * @param {string} text
 * @returns {Map<string, string[]>}
 */
function parseCsv(text) {
  const users = new Map();
  // Blank lines and comment lines (#) are ignored everywhere, also before the header; `no` is the line in the file.
  const rows = text.split(/\r?\n/)
    .map((l, index) => ({ line: l.trim(), no: index + 1 }))
    .filter((row) => row.line && !row.line.startsWith('#'));
  if (!rows.length) return users;

  if (!rows[0].line.toLowerCase().startsWith('username')) {
    throw new Error('APP_USERS_FILE CSV must start with a "username,roles" header row');
  }

  for (const { line, no } of rows.slice(1)) {
    // Split on the first comma; the roles cell may be quoted
    const sep = line.indexOf(',');
    if (sep === -1) continue; // no comma -> no roles column, skip
    const rawUser = line.slice(0, sep).trim();
    const rawRoles = line.slice(sep + 1).trim().replace(/^"|"$/g, ''); // strip optional quotes

    const user = rawUser.toLowerCase();
    if (!user || !/^[a-z0-9@._-]{1,40}$/.test(user)) {
      throw new Error(`APP_USERS_FILE CSV line ${no}: invalid user name '${rawUser}'`);
    }
    const roles = rawRoles.split(',').map((r) => r.trim()).filter(Boolean);
    users.set(user, validateRoles(roles, `APP_USERS_FILE CSV line ${no}`));
  }
  return users;
}

/**
 * Loads APP_USERS_FILE and returns a Map<lc-username, roles[]>.
 * Returns an empty map when APP_USERS_FILE is not set.
 * Reads the file on every call so changes take effect without a restart or rebuild.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [fsImpl] - injectable fs for tests
 * @returns {Map<string, string[]>}
 */
function loadUsersFile(env = process.env, fsImpl = fs) {
  const filePath = String(env.APP_USERS_FILE || '').trim();
  if (!filePath) return new Map();

  let text;
  try {
    text = fsImpl.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`APP_USERS_FILE '${filePath}' could not be read: ${e.message}`);
  }

  const trimmed = text.trim();
  if (!trimmed) return new Map();

  // Detect format: JSON starts with {
  if (trimmed.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`APP_USERS_FILE '${filePath}' contains invalid JSON`);
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`APP_USERS_FILE '${filePath}' JSON must be an object {"USER":["Role",...]}`);
    }
    const users = new Map();
    for (const [name, value] of Object.entries(parsed)) {
      const user = String(name).trim().toLowerCase();
      if (!/^[a-z0-9@._-]{1,40}$/.test(user)) {
        throw new Error(`APP_USERS_FILE '${filePath}': invalid user name '${name}'`);
      }
      const roles = Array.isArray(value) ? value.map((r) => String(r).trim()) : [];
      users.set(user, validateRoles(roles, `APP_USERS_FILE '${filePath}' user '${name}'`));
    }
    return users;
  }

  // Otherwise treat as CSV
  try {
    return parseCsv(trimmed);
  } catch (e) {
    throw new Error(`APP_USERS_FILE '${filePath}': ${e.message}`);
  }
}

// The file is read on every request, so one fault is logged once a minute, not once per request.
const FILE_ERROR_LOG_INTERVAL_MS = 60 * 1000;
let lastFileError = { message: '', at: 0 };

/**
 * The users of APP_USERS_FILE for a sign-in decision. A file that became unreadable or malformed after startup
 * allows nobody from it (startup itself fails on a broken file, server.js), and that is logged: without the log
 * entry every user of the file is refused with no trace of the reason.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {object} fsImpl
 * @returns {Map<string, string[]>}
 */
function usersFileOrNobody(env, fsImpl) {
  try {
    const users = loadUsersFile(env, fsImpl);
    lastFileError = { message: '', at: 0 };
    return users;
  } catch (e) {
    const now = Date.now();
    if (e.message !== lastFileError.message || now - lastFileError.at >= FILE_ERROR_LOG_INTERVAL_MS) {
      lastFileError = { message: e.message, at: now };
      LOG.error(`${e.message}. Nobody listed in the file can sign in until it is corrected.`);
    }
    return new Map();
  }
}

/**
 * Parses APP_DEFAULT_ROLES (comma-separated string). Never includes Admin.
 * Returns ['Viewer'] when the var is unset or empty.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function parseDefaultRoles(env = process.env) {
  const raw = String(env.APP_DEFAULT_ROLES || '').trim();
  if (!raw) return ['Viewer'];
  const roles = raw.split(',').map((r) => r.trim()).filter(Boolean);
  const unknown = roles.filter((r) => !KNOWN_ROLES.includes(r));
  if (unknown.length) {
    throw new Error(`APP_DEFAULT_ROLES: unknown role(s) ${unknown.join(', ')}; allowed: ${KNOWN_ROLES.join(', ')}`);
  }
  const safe = roles.filter((r) => !NEVER_DEFAULT_ROLES.has(r));
  if (safe.length !== roles.length) {
    throw new Error(`APP_DEFAULT_ROLES must not include Admin; Admin is never granted to unlisted users`);
  }
  return safe.length ? safe : ['Viewer'];
}

/**
 * Returns true when APP_ALLOW_ANY_SAP_USER is set to "true" (case-insensitive).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isAllowAnySapUser(env = process.env) {
  return String(env.APP_ALLOW_ANY_SAP_USER || '').trim().toLowerCase() === 'true';
}

/**
 * Parses APP_ADMIN_USERS (comma-separated logon names, case-insensitive).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Set<string>} lower-cased user names
 */
function parseAdminUsers(env = process.env) {
  return new Set(
    String(env.APP_ADMIN_USERS || '')
      .split(',')
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Whether APP_ADMIN_USERS names the user or APP_USER_ROLES / APP_USERS_FILE assigns Admin to them. */
function isAdminUser(username, env = process.env, fsImpl = fs) {
  const user = String(username || '').trim().toLowerCase();
  if (!user) return false;
  if (parseAdminUsers(env).has(user)) return true;
  const explicit = listedExplicitRoles(user, env, fsImpl);
  return Boolean(explicit && explicit.includes('Admin'));
}

/**
 * The Admin rule: Admin is stripped from untrusted sources (cds.requires.auth.users, SAP roles, defaults)
 * and granted when APP_ADMIN_USERS names the user or APP_USER_ROLES / APP_USERS_FILE explicitly lists Admin.
 * A user left without any role gets APP_DEFAULT_ROLES (never Admin).
 *
 * @param {string} username
 * @param {string[]} roles - roles from a list, the SAP role lookup or the defaults
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [fsImpl]
 * @returns {string[]} non-empty
 */
function applyAdminRule(username, roles, env = process.env, fsImpl = fs) {
  const result = [...new Set(roles || [])].filter((role) => role !== 'Admin');
  if (isAdminUser(username, env, fsImpl)) return [...result, 'Admin'];
  if (result.length) return result;
  try {
    return parseDefaultRoles(env);
  } catch {
    return ['Viewer']; // a malformed APP_DEFAULT_ROLES is reported at startup
  }
}

/** Roles exactly as APP_USER_ROLES / APP_USERS_FILE list them, or null. Admin rule not applied. */
function listedExplicitRoles(user, env, fsImpl) {
  try {
    const fromEnv = parseAppUserRoles(env).get(user);
    if (fromEnv && fromEnv.length) return fromEnv;
  } catch {
    // reported at startup; a broken list allows nobody
  }
  const fromFile = usersFileOrNobody(env, fsImpl).get(user);
  return fromFile && fromFile.length ? fromFile : null;
}

/** Roles exactly as the first source that knows the user lists them, or null. Admin rule not applied. */
function listedRoles(user, auth, env, fsImpl) {
  const explicit = listedExplicitRoles(user, env, fsImpl);
  if (explicit) return explicit;

  // cds.requires.auth.users (dev profile)
  const configured = (auth && auth.users) || {};
  for (const [name, config] of Object.entries(configured)) {
    if (name === '*' || !config || String(name).toLowerCase() !== user) continue;
    const roles = rolesOf(config);
    if (roles.length) return roles;
  }
  return null;
}

/**
 * Returns the override roles of a user from APP_USER_ROLES or APP_USERS_FILE, or null if the user has no entry
 * in either. Admin is granted when listed in either override or in APP_ADMIN_USERS.
 *
 * @param {string} username
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [fsImpl]
 * @returns {string[]|null}
 */
function getExplicitAppUserRoles(username, env = process.env, fsImpl = fs) {
  const user = String(username || '').trim().toLowerCase();
  if (!user) return null;
  const explicit = listedExplicitRoles(user, env, fsImpl);
  return explicit ? applyAdminRule(user, explicit, env, fsImpl) : null;
}

/**
 * Whether a user is set up as an administrator anywhere: named in APP_ADMIN_USERS, or listed with Admin in
 * APP_USER_ROLES, APP_USERS_FILE or cds.requires.auth.users (even though such an entry no longer grants Admin).
 * The login action uses it to keep the shared LOCAL_DEV_PASSWORD away from every such user.
 *
 * @param {string} username
 * @param {{users?: object}} [auth]
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [fsImpl]
 * @returns {boolean}
 */
function holdsConfiguredAdmin(username, auth, env = process.env, fsImpl = fs) {
  const user = String(username || '').trim().toLowerCase();
  if (!user) return false;
  if (isAdminUser(user, env)) return true;
  const listed = listedRoles(user, auth, env, fsImpl);
  return Boolean(listed && listed.includes('Admin'));
}

/**
 * Roles of a user who is known by name, or null when the user is in no list and not in APP_ADMIN_USERS.
 * Returns null even when APP_ALLOW_ANY_SAP_USER=true: the caller (auth-service) lets SAP check the password and
 * then takes the roles from the SAP role lookup. Admin follows applyAdminRule.
 *
 * @param {string} username
 * @param {{users?: object}} [auth] - the effective cds.requires.auth
 * @param {NodeJS.ProcessEnv} [env]
 * @param {object} [fsImpl] - injectable fs for tests
 * @returns {string[]|null}
 */
function resolveAppUser(username, auth, env = process.env, fsImpl = fs) {
  const user = String(username || '').trim().toLowerCase();
  if (!user) return null;

  const listed = listedRoles(user, auth, env, fsImpl);
  if (listed) return applyAdminRule(user, listed, env, fsImpl);
  // Naming a user in APP_ADMIN_USERS is enough for that user to be known.
  return isAdminUser(user, env, fsImpl) ? applyAdminRule(user, [], env, fsImpl) : null;
}

module.exports = {
  KNOWN_ROLES,
  NEVER_DEFAULT_ROLES,
  parseAppUserRoles,
  loadUsersFile,
  parseCsv,
  parseDefaultRoles,
  isAllowAnySapUser,
  parseAdminUsers,
  isAdminUser,
  applyAdminRule,
  holdsConfiguredAdmin,
  getExplicitAppUserRoles,
  resolveAppUser,
};
