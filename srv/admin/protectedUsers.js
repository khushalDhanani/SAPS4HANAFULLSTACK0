'use strict';

/**
 * Who must never be locked. This is the one place to change it: listUsers flags the rows from it and
 * lockUser enforces it, so the UI holds no copy of the rule.
 */

// Domain XUUSTYP on DS4/220 (DD07T, 2026-11-05): B = System, S = Service.
const PROTECTED_USER_TYPES = ['B', 'S'];

const upper = (value) => String(value || '').trim().toUpperCase();

/**
 * @param {{username: string, userType?: string}} target
 * @param {{actor?: string, connectionUser?: string}} context
 * @returns {'self'|'connection'|'type'|''} why the target is protected, or '' when it is not
 */
function protectionReason(target, { actor, connectionUser } = {}) {
  const username = upper(target.username);
  if (username && username === upper(actor)) return 'self';
  if (username && username === upper(connectionUser)) return 'connection';
  return PROTECTED_USER_TYPES.includes(upper(target.userType)) ? 'type' : '';
}

module.exports = { PROTECTED_USER_TYPES, protectionReason };
