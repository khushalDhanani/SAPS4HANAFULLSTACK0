'use strict';

const loginThrottle = require('./loginThrottle');

/**
 * Failed sign-in limit for HTTP Basic authentication with the mocked development users.
 *
 * On a development server those users accept LOCAL_DEV_PASSWORD over Basic authentication
 * (srv/auth/mockUserPasswords.js). CAP's own Basic handler has no limit, so the shared password could be guessed
 * without end. This middleware runs ahead of it (server.js registers it for NODE_ENV=development only) and uses
 * the limiter of the login action: same counters, same limits (srv/auth/loginThrottle.js).
 *
 *   - a user name or client address at its limit gets HTTP 429 before the password is looked at;
 *   - an answer of HTTP 401 counts as one failed attempt for the user name and the address;
 *   - a request that was signed in as that user clears the user's counter.
 *
 * A request without a Basic header is passed on untouched.
 *
 * @param {object} [throttle] - injectable limiter (tests)
 * @returns {import('express').Handler}
 */
function createBasicAuthThrottle(throttle = loginThrottle) {
  return function basicAuthThrottle(req, res, next) {
    const [, encoded] = /^basic\s+(.+)$/i.exec((req.headers && req.headers.authorization) || '') || [];
    if (!encoded) return next();

    const [id] = Buffer.from(encoded, 'base64').toString().split(':');
    const ip = req.ip || '';
    const state = throttle.check(id, ip);
    if (!state.allowed) {
      const minutes = Math.max(1, Math.ceil(state.retryAfterSec / 60));
      return res.status(429).set('Retry-After', String(state.retryAfterSec)).json({
        error: { code: '429', message: `Too many failed sign-in attempts. Try again in ${minutes} minute(s).` }
      });
    }

    res.on('finish', () => {
      if (res.statusCode === 401) throttle.recordFailure(id, ip);
      else if (req.user && !req.user._is_anonymous && req.user.id === id) throttle.recordSuccess(id);
    });
    next();
  };
}

const basicAuthThrottle = createBasicAuthThrottle();
basicAuthThrottle.createBasicAuthThrottle = createBasicAuthThrottle;

module.exports = basicAuthThrottle;
