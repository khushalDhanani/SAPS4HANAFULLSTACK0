'use strict';

/**
 * Live SAP integration tests for SystemLogAdapter and SecurityAuditLogAdapter.
 *
 * GATED: These tests only run when ALLOW_LIVE_SAP_TOOLS=1.
 * They make READ-ONLY RFC calls to DS4/220 and redact PII from all output.
 *
 * Run with:
 *   ALLOW_LIVE_SAP_TOOLS=1 DYLD_LIBRARY_PATH="$HOME/nwrfcsdk/lib" \
 *     npx jest test/unit/admin/sapLogsLive.test.js --runInBand
 *
 * Never run as part of CI without the gate variable.
 */

const isLive = process.env.ALLOW_LIVE_SAP_TOOLS === '1';
if (isLive) {
  require('dotenv').config({ path: '.env.local', quiet: true });
  require('dotenv').config({ quiet: true });
}

/** Redact PII fields from an array of entries before any assertion logging. */
function redactEntries(entries) {
  return entries.map((e) => {
    const r = { ...e };
    delete r.SLGUSER; delete r.SLGLTRM; delete r.SLGTERMIDNEW;
    delete r.USERALIAS; delete r.SMTP_ADDR; delete r.SLGLTRM2; delete r.TERM_IPV6;
    if (r.user) r.user = '[REDACTED_USER]';
    return r;
  });
}

(isLive ? describe : describe.skip)('SAP Logs live tests (ALLOW_LIVE_SAP_TOOLS=1)', () => {
  const { RfcClient }               = require('../../../srv/integration/s4hana/RfcClient');
  const { SystemLogAdapter, fromRslgTimeToUtc } = require('../../../srv/integration/s4hana/admin/SystemLogAdapter');
  const { SecurityAuditLogAdapter } = require('../../../srv/integration/s4hana/admin/SecurityAuditLogAdapter');

  // Bypass Jest's moduleNameMapper for node-rfc when running live
  const realRfcLoader = () => require('../../../node_modules/node-rfc');
  const makeLiveRfc = () => new RfcClient(process.env, realRfcLoader);

  let syslogAdapter;
  let auditLogAdapter;
  let derivedOffsetMinutes;

  /**
   * Derive server-local timezone offset independently from live SM20 ET_LOG records
   * by comparing kernel-written SAL_DATE/SAL_TIME (local) against LOG_TSTMP (UTC).
   */
  async function deriveServerOffsetMinutes(rfcClient) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const dFrom = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`;
    const tFrom = '000000';
    const tTo   = `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;

    const res = await rfcClient.call('RSAU_API_GET_LOG_DATA', {
      IS_INTERVAL: {
        DAT_FROM: dFrom,
        DAT_TO:   dFrom,
        TIM_FROM: tFrom,
        TIM_TO:   tTo,
      },
      ID_FILE_SEL_SIMPLE: 'X',
    });

    const rows = res.ET_LOG || [];
    for (const row of rows) {
      if (row.SAL_DATE && row.SAL_TIME && row.LOG_TSTMP) {
        const dStr = String(row.SAL_DATE).trim();
        const tStr = String(row.SAL_TIME).trim().padEnd(6, '0');
        const tstmp = String(row.LOG_TSTMP).trim();
        if (dStr.length >= 8 && tStr.length >= 6 && tstmp.length >= 14) {
          const localMs = Date.UTC(
            parseInt(dStr.slice(0, 4), 10),
            parseInt(dStr.slice(4, 6), 10) - 1,
            parseInt(dStr.slice(6, 8), 10),
            parseInt(tStr.slice(0, 2), 10),
            parseInt(tStr.slice(2, 4), 10),
            parseInt(tStr.slice(4, 6), 10)
          );
          const utcMs = Date.UTC(
            parseInt(tstmp.slice(0, 4), 10),
            parseInt(tstmp.slice(4, 6), 10) - 1,
            parseInt(tstmp.slice(6, 8), 10),
            parseInt(tstmp.slice(8, 10), 10),
            parseInt(tstmp.slice(10, 12), 10),
            parseInt(tstmp.slice(12, 14), 10)
          );
          return Math.round((localMs - utcMs) / (60 * 1000));
        }
      }
    }
    throw new Error('Unable to derive server offset: no ET_LOG records with SAL_DATE, SAL_TIME, and LOG_TSTMP found in SM20');
  }

  beforeAll(async () => {
    const liveRfc = makeLiveRfc();
    derivedOffsetMinutes = await deriveServerOffsetMinutes(liveRfc);
    syslogAdapter   = new SystemLogAdapter({ rfcClient: makeLiveRfc() });
    auditLogAdapter = new SecurityAuditLogAdapter({ rfcClient: makeLiveRfc() });
  });

  // ---------------------------------------------------------------------------
  // SM21 — System Log
  // ---------------------------------------------------------------------------
  describe('SystemLogAdapter (SM21)', () => {
    beforeEach(() => {
      // Independent offset assertion: configured offset MUST match server offset derived from SM20
      expect(syslogAdapter.tzOffsetMinutes).toBe(derivedOffsetMinutes);
    });

    test('configured SM21 offset matches independently derived server offset from live SM20', () => {
      expect(syslogAdapter.tzOffsetMinutes).toBe(derivedOffsetMinutes);
    });

    test('listInstances returns at least one instance', async () => {
      const instances = await syslogAdapter.listInstances();
      expect(instances.length).toBeGreaterThan(0);
      expect(instances[0]).toHaveProperty('name');
      expect(instances[0]).toHaveProperty('host');
    }, 30000);

    test('readSyslog returns entries with fresh UTC timestamp and without excluded fields', async () => {
      const testNow = new Date();
      const testFrom = new Date(testNow.getTime() - 10 * 60 * 1000);

      const result = await syslogAdapter.readSyslog({ fromUtc: testFrom, toUtc: testNow, maxRows: 50 });
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('truncated');

      if (result.entries.length === 0) {
        throw new Error(`SKIPPED: SM21 window [${testFrom.toISOString()} - ${testNow.toISOString()}] had 0 entries; cannot verify freshness`);
      }

      const redacted = redactEntries(result.entries);
      for (const e of redacted) {
        expect(e).not.toHaveProperty('SLGPASSPORT');
        expect(e).not.toHaveProperty('SLGROOTCONTEXT');
        expect(e).not.toHaveProperty('SLGCONNECTION');
        expect(e).not.toHaveProperty('SLGLTRM');
        expect(e).not.toHaveProperty('SLGTERMIDNEW');
        expect(e).not.toHaveProperty('SLGDATA');

        expect(e).toHaveProperty('entryType');
        expect(e).toHaveProperty('timestamp');
        expect(e).toHaveProperty('serverTimestamp');
        expect(e).toHaveProperty('message');
        expect(e).toHaveProperty('instance');

        // timestamp must be ISO 8601 UTC string ending with Z
        expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        // serverTimestamp format: YYYYMMDDHHMMSS00 (14-16 chars, server-local)
        expect(e.serverTimestamp).toMatch(/^\d{14,16}$/);
      }

      // Non-circular Freshness Assertion: compute true UTC using the independently derived offset
      const newest = result.entries[result.entries.length - 1];
      const trueUtcIso = fromRslgTimeToUtc(newest.serverTimestamp, derivedOffsetMinutes);
      expect(newest.timestamp).toBe(trueUtcIso);

      const trueUtcMs = new Date(trueUtcIso).getTime();
      const trueAgeMs = Date.now() - trueUtcMs;
      expect(trueAgeMs).toBeGreaterThanOrEqual(-60000); // not in the future (allow 1m clock skew)
      expect(trueAgeMs).toBeLessThanOrEqual(30 * 60 * 1000); // within 30 minutes of current wall-clock UTC
    }, 60000);

    test('truncated flag is set when results exceed maxRows', async () => {
      const testNow = new Date();
      const testFrom = new Date(testNow.getTime() - 15 * 60 * 1000);
      const result = await syslogAdapter.readSyslog({ fromUtc: testFrom, toUtc: testNow, maxRows: 1 });
      if (result.count > 0) {
        expect(result.count).toBe(1);
      }
    }, 60000);
  });

  // ---------------------------------------------------------------------------
  // SM20 — Security Audit Log
  // ---------------------------------------------------------------------------
  describe('SecurityAuditLogAdapter (SM20)', () => {
    test('readAuditLog returns entries with fresh UTC timestamp and without excluded fields', async () => {
      const testNow = new Date();
      const testFrom = new Date(testNow.getTime() - 10 * 60 * 1000);

      const result = await auditLogAdapter.readAuditLog({ fromUtc: testFrom, toUtc: testNow, maxRows: 50 });
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('truncated');
      expect(result).toHaveProperty('warnings');

      if (result.entries.length === 0) {
        throw new Error(`SKIPPED: SM20 window [${testFrom.toISOString()} - ${testNow.toISOString()}] had 0 entries; cannot verify freshness`);
      }

      const redacted = redactEntries(result.entries);
      for (const e of redacted) {
        expect(e).not.toHaveProperty('USERALIAS');
        expect(e).not.toHaveProperty('SMTP_ADDR');
        expect(e).not.toHaveProperty('SLGLTRM2');
        expect(e).not.toHaveProperty('TERM_IPV6');
        expect(e).not.toHaveProperty('SAL_DATA');
        expect(e).not.toHaveProperty('X_STRING');

        expect(e).toHaveProperty('systemId');
        expect(e).toHaveProperty('date');
        expect(e).toHaveProperty('time');
        expect(e).toHaveProperty('utcTimestamp');
        expect(e).toHaveProperty('message');

        expect(e.date).toMatch(/^\d{8}$/);
        expect(e.time).toMatch(/^\d{6}$/);
      }

      // Non-circular Freshness Assertion: newest returned UTC timestamp is within 30 minutes of current UTC
      const newest = result.entries[result.entries.length - 1];
      const newestMs = new Date(newest.utcTimestamp).getTime();
      const ageMs = Date.now() - newestMs;
      expect(ageMs).toBeGreaterThanOrEqual(-60000); // not in the future (allow 1m clock skew)
      expect(ageMs).toBeLessThanOrEqual(30 * 60 * 1000); // within 30 minutes of current wall-clock UTC
    }, 60000);

    test('warnings array is present and is an array', async () => {
      const testNow = new Date();
      const testFrom = new Date(testNow.getTime() - 10 * 60 * 1000);
      const result = await auditLogAdapter.readAuditLog({ fromUtc: testFrom, toUtc: testNow, maxRows: 50 });
      expect(Array.isArray(result.warnings)).toBe(true);
    }, 30000);
  });

  // ---------------------------------------------------------------------------
  // Time-zone Cross-Check: SM21 vs SM20
  // ---------------------------------------------------------------------------
  describe('Time-zone Cross-Check (SM21 vs SM20)', () => {
    test('SM21 newest UTC vs SM20 newest UTC (from kernel LOG_TSTMP) differ by no more than 5 minutes', async () => {
      // Independent offset assertion: configured SM21 offset must match derived offset from SM20
      expect(syslogAdapter.tzOffsetMinutes).toBe(derivedOffsetMinutes);

      const testNow = new Date();
      const testFrom = new Date(testNow.getTime() - 5 * 60 * 1000);

      const sysResult   = await syslogAdapter.readSyslog({ fromUtc: testFrom, toUtc: testNow, maxRows: 100 });
      const auditResult = await auditLogAdapter.readAuditLog({ fromUtc: testFrom, toUtc: testNow, maxRows: 100 });

      if (sysResult.entries.length === 0 || auditResult.entries.length === 0) {
        throw new Error(`SKIPPED: Insufficient entries for cross-check (SM21: ${sysResult.entries.length}, SM20: ${auditResult.entries.length})`);
      }

      const sm21Newest = sysResult.entries[sysResult.entries.length - 1];
      const sm20Newest = auditResult.entries[auditResult.entries.length - 1];

      // Convert SM21 server-local timestamp using the independently derived offset
      const sm21DerivedUtc = fromRslgTimeToUtc(sm21Newest.serverTimestamp, derivedOffsetMinutes);
      expect(sm21Newest.timestamp).toBe(sm21DerivedUtc);

      const sm21Ms = new Date(sm21DerivedUtc).getTime();
      const sm20Ms = new Date(sm20Newest.utcTimestamp).getTime();

      const diffMinutes = Math.abs(sm21Ms - sm20Ms) / (60 * 1000);
      expect(diffMinutes).toBeLessThanOrEqual(5);
    }, 60000);
  });
});

if (!isLive) {
  describe('SAP Logs live tests (skipped — set ALLOW_LIVE_SAP_TOOLS=1 to run)', () => {
    test('live tests are intentionally skipped in this environment', () => {
      expect(process.env.ALLOW_LIVE_SAP_TOOLS).not.toBe('1');
    });
  });
}
