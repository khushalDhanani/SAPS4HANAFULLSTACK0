'use strict';

/**
 * Minimal SAP RFC client (node-rfc). Used where no OData service exists yet.
 * ponytail: node-rfc is marked unsupported by SAP (github.com/SAP/node-rfc/issues/329);
 * swap this file for an OData client once the ABAP side publishes a service.
 * ponytail: one connection per call/session; move to noderfc.Pool if call volume grows.
 * A session is one SAP LUW: a BAPI and its BAPI_TRANSACTION_COMMIT must run inside the same session().
 */
const REQUIRED_ENV = ['S4_DESTINATION_URL', 'S4_RFC_SYSNR', 'S4_CLIENT', 'S4_USERNAME', 'S4_PASSWORD'];

const unavailable = (msg) => Object.assign(new Error(msg), { status: 503 });

// Property names of an RFC-type destination as the Destination service returns them (originalProperties).
// Not verified against a live BTP destination yet: a destination without these keys fails closed with the keys it has.
const RFC_DESTINATION_PROPS = { ashost: 'jco.client.ashost', sysnr: 'jco.client.sysnr', client: 'jco.client.client', user: 'jco.client.user', passwd: 'jco.client.passwd' };
const DESTINATION_PARAMS_TTL_MS = 5 * 60 * 1000;

class RfcClient {
  /**
   * @param {object} [env] - process.env
   * @param {Function} [loader] - node-rfc loader (tests)
   * @param {Function} [getDestination] - Cloud SDK destination lookup (tests); used when S4_RFC_DESTINATION_NAME is set
   */
  constructor(env = process.env, loader = () => require('node-rfc'), getDestination) {
    this.env = env;
    this.loader = loader;
    this._getDestination = getDestination;
    this._destinationParams = null;
  }

  /**
   * Connection parameters from the BTP RFC destination named by S4_RFC_DESTINATION_NAME (deployed environments),
   * otherwise from the local environment (development only; refused in production).
   */
  async resolveConnectionParams() {
    const destinationName = String(this.env.S4_RFC_DESTINATION_NAME || '').trim();
    if (!destinationName) {
      if (String(this.env.NODE_ENV || '').toLowerCase() === 'production') {
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
      throw unavailable(`RFC destination '${destinationName}' could not be read from the Destination service: ${e.message}`);
    }
    if (!dest) throw unavailable(`RFC destination '${destinationName}' not found in the Destination service`);
    const props = dest.originalProperties || {};
    const params = {};
    const missing = [];
    for (const [key, prop] of Object.entries(RFC_DESTINATION_PROPS)) {
      const v = props[prop];
      if (v === undefined || v === null || String(v).trim() === '') missing.push(prop); else params[key] = String(v).trim();
    }
    if (missing.length) {
      throw unavailable(`RFC destination '${destinationName}' lacks ${missing.join(', ')} (properties present: ${Object.keys(props).filter((k) => !/passwd|password/i.test(k)).join(', ') || 'none'})`);
    }
    params.lang = String(props['jco.client.lang'] || 'EN').trim();
    params.trace = this.env.S4_RFC_TRACE || '0';
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
   * Run several function modules on ONE connection (= one ABAP session / LUW), e.g.
   * `session(async (call) => { await call('BAPI_HU_CREATE', ...); await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' }); })`.
   * The connection is closed afterwards even when fn throws; an uncommitted LUW is then discarded by SAP.
   */
  async session(fn) {
    let noderfc;
    try {
      noderfc = this.loader();
    } catch (e) {
      const why = e.code === 'MODULE_NOT_FOUND' ? 'not installed' : e.message.split('\n')[0];
      throw unavailable(`node-rfc is not available (${why}). Install the SAP NW RFC SDK, then run: npm install node-rfc`);
    }
    const client = new noderfc.Client(await this.resolveConnectionParams());
    await client.open();
    try {
      return await fn((fm, params = {}) => client.call(fm, params));
    } finally {
      await client.close();
    }
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
  async readTable(table, fields, where = [], rowCount = 0, rowSkips = 0) {
    const res = await this.call('RFC_READ_TABLE', {
      QUERY_TABLE: table,
      DELIMITER: '|',
      FIELDS: fields.map((f) => ({ FIELDNAME: f })),
      OPTIONS: where.map((t) => ({ TEXT: t })),
      ...(rowCount > 0 ? { ROWCOUNT: rowCount } : {}),
      ...(rowSkips > 0 ? { ROWSKIPS: rowSkips } : {})
    });
    return (res.DATA || []).map(({ WA }) => {
      const vals = WA.split('|');
      return Object.fromEntries(fields.map((f, i) => [f, (vals[i] || '').trim()]));
    });
  }
}

module.exports = { RfcClient };
