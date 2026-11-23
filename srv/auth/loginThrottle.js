'use strict';

/**
 * Failed sign-in limiter for the login action (srv/auth-service.js).
 *
 * A wrong password for a real SAP user is forwarded to SAP and counts towards SAP's own lock
 * (login/fails_to_user_lock, default 5). Without a limit here, anyone who reaches the login action could
 * guess passwords or lock any SAP user. The per-user limit therefore defaults to 3, below SAP's default.
 *
 * Counters are held in memory: they suit the single-container standalone deployment and are cleared on restart.
 *
 *   LOGIN_MAX_FAILURES_PER_USER  default 3
 *   LOGIN_MAX_FAILURES_PER_IP    default 20
 *   LOGIN_FAILURE_WINDOW_SEC     default 900 (15 minutes)
 */

const MAX_ENTRIES = 10000;

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

class LoginThrottle {
  /**
   * @param {object} [options]
   * @param {NodeJS.ProcessEnv} [options.env]
   * @param {() => number} [options.now] - clock in ms (tests)
   */
  constructor({ env = process.env, now = Date.now } = {}) {
    this._env = env;
    this._now = now;
    this._failures = new Map();
  }

  _limits() {
    return {
      user: positiveInt(this._env.LOGIN_MAX_FAILURES_PER_USER, 3),
      ip: positiveInt(this._env.LOGIN_MAX_FAILURES_PER_IP, 20),
      windowMs: positiveInt(this._env.LOGIN_FAILURE_WINDOW_SEC, 900) * 1000,
    };
  }

  _keys(username, ip) {
    const keys = [];
    const user = String(username || '').trim().toLowerCase();
    const address = String(ip || '').trim();
    if (user) keys.push(['user', `u:${user}`]);
    if (address) keys.push(['ip', `ip:${address}`]);
    return keys;
  }

  _entry(key, windowMs) {
    const entry = this._failures.get(key);
    if (!entry) return null;
    if (this._now() - entry.first >= windowMs) {
      this._failures.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * Whether a sign-in attempt may proceed. Call before any credential check.
   * @returns {{allowed: boolean, retryAfterSec: number}}
   */
  check(username, ip) {
    const limits = this._limits();
    let retryAfterMs = 0;
    for (const [kind, key] of this._keys(username, ip)) {
      const entry = this._entry(key, limits.windowMs);
      if (entry && entry.count >= limits[kind]) {
        retryAfterMs = Math.max(retryAfterMs, entry.first + limits.windowMs - this._now());
      }
    }
    return { allowed: retryAfterMs <= 0, retryAfterSec: Math.max(0, Math.ceil(retryAfterMs / 1000)) };
  }

  /** Counts one failed attempt against the user name and the client address. */
  recordFailure(username, ip) {
    const { windowMs } = this._limits();
    for (const [, key] of this._keys(username, ip)) {
      const entry = this._entry(key, windowMs);
      if (entry) {
        entry.count++;
      } else {
        if (this._failures.size >= MAX_ENTRIES) this._prune(windowMs);
        this._failures.set(key, { count: 1, first: this._now() });
      }
    }
  }

  /** A successful sign-in clears the user's counter; the address counter runs out on its own. */
  recordSuccess(username) {
    const user = String(username || '').trim().toLowerCase();
    if (user) this._failures.delete(`u:${user}`);
  }

  _prune(windowMs) {
    const now = this._now();
    for (const [key, entry] of this._failures) {
      if (now - entry.first >= windowMs) this._failures.delete(key);
    }
    // Still full of live entries: drop the oldest so the map cannot grow without bound.
    while (this._failures.size >= MAX_ENTRIES) {
      this._failures.delete(this._failures.keys().next().value);
    }
  }

  reset() {
    this._failures.clear();
  }
}

const defaultThrottle = new LoginThrottle();
defaultThrottle.LoginThrottle = LoginThrottle;

module.exports = defaultThrottle;
