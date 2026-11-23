'use strict';

const crypto = require('crypto');

/**
 * CAP accepts any password for a mocked user that has none (@sap/cds mocked-users.js, verify()). Outside the test
 * profile, anyone who reaches the port could then sign in with Basic authentication as a development user that
 * holds every role.
 *
 * This gives each mocked user without a password one: LOCAL_DEV_PASSWORD when it is set, otherwise a random value
 * nobody knows, so Basic authentication is refused. Sign-in through the login action (srv/auth-service.js) checks
 * its own credentials and is not affected. A '*' wildcard user is switched off.
 *
 * A test-profile server keeps passwordless users only while it cannot reach SAP: no S4_DESTINATION_URL, no
 * VCAP_SERVICES and not the Docker `cap-local` role. That covers Jest (test/setupEnv.js removes those variables)
 * and the isolated E2E server; a test-profile container with SAP connectivity is protected like development.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{kind?: string, users?: object}} [auth] - the effective cds.requires.auth; its `users` are changed in place
 * @returns {{applied: boolean, source?: 'LOCAL_DEV_PASSWORD'|'random', users?: number, reason?: string}}
 */
function isIsolatedTestProfile(env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'test') return false;
  const has = (key) => String(env[key] || '').trim() !== '';
  return !has('S4_DESTINATION_URL') && !has('VCAP_SERVICES') && String(env.APP_ROLE || '').trim() !== 'cap-local';
}

function protectMockUsers(env = process.env, auth) {
  if (isIsolatedTestProfile(env)) return { applied: false };
  const kind = String((auth && auth.kind) || '').trim().toLowerCase();
  if ((kind !== 'mocked' && kind !== 'basic') || !auth.users || typeof auth.users !== 'object') return { applied: false };

  const configured = String(env.LOCAL_DEV_PASSWORD || '').trim();
  // Basic authentication splits "user:password" at every colon, so a password with one could never match.
  const usable = configured !== '' && !configured.includes(':');
  const password = usable ? configured : crypto.randomBytes(32).toString('hex');

  let users = 0;
  for (const [id, config] of Object.entries(auth.users)) {
    if (id === '*') {
      auth.users[id] = false;
    } else if (config === true) {
      auth.users[id] = { password };
      users++;
    } else if (config && typeof config === 'object' && !config.password) {
      auth.users[id] = { ...config, password };
      users++;
    }
  }

  const result = { applied: true, source: usable ? 'LOCAL_DEV_PASSWORD' : 'random', users };
  if (!usable) result.reason = configured ? 'LOCAL_DEV_PASSWORD contains a colon' : 'LOCAL_DEV_PASSWORD is not set';
  return result;
}

module.exports = { protectMockUsers, isIsolatedTestProfile };
