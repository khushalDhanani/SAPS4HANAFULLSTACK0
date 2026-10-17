'use strict';

/**
 * The plants a user may access, derived server-side from the authenticated user (never from the browser).
 *   null  -> Admin / unrestricted (all plants)
 *   []    -> no plants (a non-Admin with no, empty, or blank Plant attribute sees nothing)
 *   [..]  -> exactly those plant codes, trimmed + upper-cased (a malformed value simply matches no real plant)
 *
 * @param {object} user  the CAP request user (req.user)
 * @returns {string[]|null}
 */
module.exports = function plantScope(user) {
  if (user && typeof user.is === 'function' && user.is('Admin')) { return null; }
  const attr = user && user.attr && user.attr.Plant;
  return [].concat(attr || []).map((p) => String(p).trim().toUpperCase()).filter(Boolean);
};
