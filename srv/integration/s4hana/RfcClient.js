'use strict';

/**
 * SAP RFC client (node-rfc). Used where no OData service exists yet.
 * Note: node-rfc is marked unsupported by SAP (github.com/SAP/node-rfc/issues/329);
 * swap this file for an OData client once the ABAP side publishes a service.
 * Supports single-connection session LUWs (BAPI + commit) and connection pooling (noderfc.Pool),
 * with concurrency throttling, timeout safety, and real BTP RFC destination property resolution.
 * A session is one SAP LUW: a BAPI and its BAPI_TRANSACTION_COMMIT must run inside the same session().
 */
const REQUIRED_ENV = ['S4_DESTINATION_URL', 'S4_RFC_SYSNR', 'S4_CLIENT', 'S4_USERNAME', 'S4_PASSWORD'];
const LOG = require('./logger')('rfc-client');

const unavailable = (msg) => Object.assign(new Error(msg), { status: 503 });
// A call that was sent and got no answer in time. The timeout does not cancel the function module in SAP, so
// this is never "not sent" (503): for a write the outcome is unknown.
const timedOut = (msg) => Object.assign(new Error(msg), { status: 504, statusCode: 504, code: 'RFC_TIMEOUT', timedOut: true });

const DEFAULT_RFC_TIMEOUT_MS = 30000;
const DEFAULT_MAX_CONCURRENT = 10;
const DESTINATION_PARAMS_TTL_MS = 5 * 60 * 1000;

function withTimeout(promise, timeoutMs, operationName, makeError = unavailable) {
  if (!promise || typeof promise.then !== 'function') {
    promise = Promise.resolve(promise);
  }
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(makeError(`RFC call to ${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  });
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutPromise
  ]);
}

function getProp(props, ...keys) {
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return undefined;
}

const defaultLoader = () => {
  if (process.env.ALLOW_LIVE_SAP_TOOLS === '1') {
    try {
      return require('../../../node_modules/node-rfc');
    } catch {
      return require('node-rfc');
    }
  }
  return require('node-rfc');
};

class RfcClient {
  /**
   * @param {object} [env] - process.env
   * @param {Function} [loader] - node-rfc loader (tests)
   * @param {Function} [getDestination] - Cloud SDK destination lookup (tests); used when S4_RFC_DESTINATION_NAME is set
   */
  constructor(env = process.env, loader = defaultLoader, getDestination) {
    this.env = env;
    this.loader = loader;
    this._getDestination = getDestination;
    this._destinationParams = null;
    this.timeoutMs = parseInt(this.env.S4_RFC_TIMEOUT_MS, 10) || DEFAULT_RFC_TIMEOUT_MS;
    this.maxConcurrent = parseInt(this.env.S4_RFC_MAX_CONCURRENT, 10) || DEFAULT_MAX_CONCURRENT;
    this.poolEnabled = String(this.env.S4_RFC_POOL_ENABLED || '').toLowerCase() === 'true';
    this._activeCount = 0;
    this._waitQueue = [];
    this._pool = null;
  }

  /** Check whether all local environment connection variables are present. */
  hasLocalConnectionParams() {
    return REQUIRED_ENV.every((k) => Boolean(this.env[k]));
  }

  /**
   * Connection parameters from the BTP RFC destination named by S4_RFC_DESTINATION_NAME (deployed environments),
   * otherwise from the local environment (development only; refused in production).
   * Supports standard JCo properties, message server load balancing, gateway, and alias names.
   */
  async resolveConnectionParams() {
    const destinationName = String(this.env.S4_RFC_DESTINATION_NAME || '').trim();
    const isProduction = String(this.env.NODE_ENV || '').toLowerCase() === 'production';
    if (!destinationName) {
      if (isProduction) {
        throw unavailable('RFC connection in production must come from a BTP RFC destination: set S4_RFC_DESTINATION_NAME (credentials in environment variables are not allowed)');
      }
      return this.connectionParams();
    }
    const cached = this._destinationParams;
    if (cached && cached.expiresAt > Date.now()) return cached.params;
    const getDestination = this._getDestination || require('@sap-cloud-sdk/connectivity').getDestination;
    let dest;
    try {
      dest = await getDestination({ destinationName });
    } catch (e) {
      if (!isProduction && this.hasLocalConnectionParams()) {
        LOG.warn(`RFC destination '${destinationName}' could not be read (${e.message}); falling back to local environment connection parameters.`);
        return this.connectionParams();
      }
      throw unavailable(`RFC destination '${destinationName}' could not be read from the Destination service: ${e.message}`);
    }
    if (!dest) {
      if (!isProduction && this.hasLocalConnectionParams()) {
        LOG.warn(`RFC destination '${destinationName}' not found; falling back to local environment connection parameters.`);
        return this.connectionParams();
      }
      throw unavailable(`RFC destination '${destinationName}' not found in the Destination service`);
    }

    const props = dest.originalProperties || {};
    const params = {};
    const missing = [];

    const isMessageServer = Boolean(getProp(props, 'jco.client.mshost', 'mshost'));

    if (isMessageServer) {
      const mshost = getProp(props, 'jco.client.mshost', 'mshost');
      const r3name = getProp(props, 'jco.client.r3name', 'r3name');
      const group = getProp(props, 'jco.client.group', 'group');
      const msserv = getProp(props, 'jco.client.msserv', 'msserv');

      if (!mshost) missing.push('jco.client.mshost');
      if (!r3name) missing.push('jco.client.r3name');
      if (!group) missing.push('jco.client.group');

      if (mshost) params.mshost = mshost;
      if (r3name) params.r3name = r3name;
      if (group) params.group = group;
      if (msserv) params.msserv = msserv;
    } else {
      const ashost = getProp(props, 'jco.client.ashost', 'ashost');
      const sysnr = getProp(props, 'jco.client.sysnr', 'sysnr');

      if (!ashost) missing.push('jco.client.ashost');
      if (!sysnr) missing.push('jco.client.sysnr');

      if (ashost) params.ashost = ashost;
      if (sysnr) params.sysnr = sysnr;
    }

    const client = getProp(props, 'jco.client.client', 'client');
    const user = getProp(props, 'jco.client.user', 'user', 'username');
    const passwd = getProp(props, 'jco.client.passwd', 'passwd', 'password');

    if (!client) missing.push('jco.client.client');
    if (!user) missing.push('jco.client.user');
    if (!passwd) missing.push('jco.client.passwd');

    if (client) params.client = client;
    if (user) params.user = user;
    if (passwd) params.passwd = passwd;

    if (missing.length) {
      if (!isProduction && this.hasLocalConnectionParams()) {
        LOG.warn(`RFC destination '${destinationName}' lacks RFC properties (${missing.join(', ')}); falling back to local environment connection parameters.`);
        return this.connectionParams();
      }
      throw unavailable(`RFC destination '${destinationName}' lacks ${missing.join(', ')} (properties present: ${Object.keys(props).filter((k) => !/passwd|password/i.test(k)).join(', ') || 'none'})`);
    }

    const gwhost = getProp(props, 'jco.client.gwhost', 'gwhost');
    const gwserv = getProp(props, 'jco.client.gwserv', 'gwserv');
    if (gwhost) params.gwhost = gwhost;
    if (gwserv) params.gwserv = gwserv;

    const poolCapacity = getProp(props, 'jco.destination.pool_capacity', 'pool_capacity');
    const peakLimit = getProp(props, 'jco.destination.peak_limit', 'peak_limit');
    if (poolCapacity) params.pool_capacity = poolCapacity;
    if (peakLimit) params.peak_limit = peakLimit;

    params.lang = getProp(props, 'jco.client.lang', 'lang') || 'EN';
    params.trace = getProp(props, 'jco.client.trace', 'trace') || this.env.S4_RFC_TRACE || '0';

    this._destinationParams = { params, expiresAt: Date.now() + DESTINATION_PARAMS_TTL_MS };
    return params;
  }

  /** Check if the native node-rfc module is available and can be loaded. */
  isAvailable() {
    try {
      this.loader();
      return true;
    } catch {
      return false;
    }
  }

  static isAvailable() {
    try {
      require('node-rfc');
      return true;
    } catch {
      return false;
    }
  }

  connectionParams() {
    const missing = REQUIRED_ENV.filter((k) => !this.env[k]);
    if (missing.length) throw unavailable(`RFC connection not configured: set ${missing.join(', ')} in .env.local`);
    return {
      ashost: new URL(this.env.S4_DESTINATION_URL).hostname,
      sysnr: this.env.S4_RFC_SYSNR,
      client: this.env.S4_CLIENT,
      user: this.env.S4_USERNAME,
      passwd: this.env.S4_PASSWORD,
      lang: 'EN',
      // NW RFC SDK trace level. Default '0' (off): otherwise the SDK drops an rfc*.trc file per connection
      // into the project root (38 MB seen). Set S4_RFC_TRACE=1..3 to re-enable while debugging RFC calls.
      trace: this.env.S4_RFC_TRACE || '0'
    };
  }

  /**
   * Acquire execution slot under concurrency limit, queueing excess callers.
   */
  async _withConcurrency(fn) {
    if (this._activeCount >= this.maxConcurrent) {
      await new Promise((resolve, reject) => {
        let timer;
        if (this.timeoutMs > 0) {
          timer = setTimeout(() => {
            const idx = this._waitQueue.findIndex((item) => item.resolve === resolve);
            if (idx >= 0) this._waitQueue.splice(idx, 1);
            reject(unavailable(`RFC concurrency limit reached (${this.maxConcurrent}) and wait queue timed out`));
          }, this.timeoutMs);
          if (timer && typeof timer.unref === 'function') timer.unref();
        }
        this._waitQueue.push({ resolve, timer });
      });
    }
    this._activeCount++;
    try {
      return await fn();
    } finally {
      this._activeCount--;
      if (this._waitQueue.length > 0) {
        const next = this._waitQueue.shift();
        if (next.timer) clearTimeout(next.timer);
        next.resolve();
      }
    }
  }

  _getPool(noderfc, params) {
    if (!this._pool) {
      const low = parseInt(this.env.S4_RFC_POOL_LOW, 10) || 2;
      const high = parseInt(this.env.S4_RFC_POOL_HIGH, 10) || parseInt(params.peak_limit, 10) || this.maxConcurrent;
      this._pool = new noderfc.Pool({
        connectionParameters: params,
        poolOptions: { low, high }
      });
    }
    return this._pool;
  }

  async _acquireConnection(noderfc, params) {
    if (this.poolEnabled && typeof noderfc.Pool === 'function') {
      const pool = this._getPool(noderfc, params);
      return await withTimeout(pool.acquire(), this.timeoutMs, 'pool acquire');
    }
    const client = new noderfc.Client(params);
    await withTimeout(client.open(), this.timeoutMs, 'connection open');
    return client;
  }

  async _releaseConnection(client, isFaulted) {
    if (!client) return;
    try {
      if (this.poolEnabled && this._pool && typeof this._pool.release === 'function' && !isFaulted) {
        await this._pool.release(client);
        return;
      }
      if (typeof client.close === 'function') {
        await client.close();
      }
    } catch (e) {
      LOG.warn('RFC connection close/release failed:', e.message);
    }
  }

  /**
   * Run several function modules on ONE connection (= one ABAP session / LUW), e.g.
   * `session(async (call) => { await call('BAPI_HU_CREATE', ...); await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' }); })`.
   * Enforces concurrency limits and timeout protection. On error or timeout, the connection is closed/discarded.
   * A timeout of a call that was sent rejects with 504 / RFC_TIMEOUT / timedOut; a timeout before that with 503.
   */
  async session(fn) {
    let noderfc;
    try {
      noderfc = this.loader();
    } catch (e) {
      const why = e.code === 'MODULE_NOT_FOUND' ? 'not installed' : e.message.split('\n')[0];
      throw unavailable(`node-rfc is not available (${why}). Install the SAP NW RFC SDK, then run: npm install node-rfc`);
    }

    const params = await this.resolveConnectionParams();

    return this._withConcurrency(async () => {
      let client;
      let isFaulted = false;
      try {
        client = await this._acquireConnection(noderfc, params);
        const timeoutMs = this.timeoutMs;
        let callSent = false;
        const callWrapper = (fm, callParams = {}) => {
          callSent = true;
          const callPromise = client.call(fm, callParams);
          if (timeoutMs > 0) {
            return withTimeout(callPromise, timeoutMs, fm, timedOut);
          }
          return callPromise;
        };

        const sessionPromise = fn(callWrapper);
        if (timeoutMs > 0) {
          // Before the first call nothing reached SAP (503); afterwards the outcome is unknown (504).
          return await withTimeout(sessionPromise, timeoutMs, 'session', (msg) => (callSent ? timedOut(msg) : unavailable(msg)));
        }
        return await sessionPromise;
      } catch (err) {
        isFaulted = true;
        throw err;
      } finally {
        await this._releaseConnection(client, isFaulted);
      }
    });
  }

  /** One function module on its own connection. */
  call(fm, params = {}) {
    return this.session((call) => call(fm, params));
  }

  /**
   * RFC_READ_TABLE -> [{FIELD: trimmed string}]. Each WHERE line must stay <= 72 chars and every
   * token must be space-separated (live: `RSNUM='x'` fails, `( A = 'x' OR B = 'y' )` works).
   * A field that does not exist in the table fails with AD 718 (TABLE_WITHOUT_DATA).
   * rowCount > 0 caps the rows SAP returns (ROWCOUNT).
   */
  async readTable(table, fields, where = [], rowCount = 0, rowSkips = 0, getSorted = false) {
    const res = await this.call('RFC_READ_TABLE', {
      QUERY_TABLE: table,
      DELIMITER: '|',
      FIELDS: fields.map((f) => ({ FIELDNAME: f })),
      OPTIONS: where.map((t) => ({ TEXT: t })),
      ...(rowCount > 0 ? { ROWCOUNT: rowCount } : {}),
      ...(rowCount > 0 && getSorted ? { GET_SORTED: 'X' } : {}),
      ...(rowSkips > 0 ? { ROWSKIPS: rowSkips } : {})
    });
    return (res.DATA || []).map(({ WA }) => {
      const vals = WA.split('|');
      return Object.fromEntries(fields.map((f, i) => [f, (vals[i] || '').trim()]));
    });
  }

  async close() {
    if (this._pool && typeof this._pool.closeAll === 'function') {
      await this._pool.closeAll();
      this._pool = null;
    }
  }
}

module.exports = { RfcClient };
