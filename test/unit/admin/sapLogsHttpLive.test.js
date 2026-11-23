'use strict';

/**
 * Live HTTP E2E authorization & response verification for SapLogsService against DS4/220.
 * Gated by ALLOW_LIVE_SAP_TOOLS=1.
 */

const isLive = process.env.ALLOW_LIVE_SAP_TOOLS === '1';
if (isLive) {
  require('dotenv').config({ path: '.env.local', quiet: true });
  require('dotenv').config({ quiet: true });
  process.env.CDS_CONFIG = require('../../testUsers').cdsConfig;
}

(isLive ? describe : describe.skip)('SapLogsService Live HTTP E2E (DS4/220)', () => {
  const cds = require('@sap/cds');
  const { GET } = cds.test(__dirname + '/../../..', 'srv/admin/sap-logs-service.cds');

  const now = new Date();
  const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const from10m = new Date(now.getTime() - 10 * 60 * 1000);

  const sysUrl10m = `/odata/v4/sap-logs/getSystemLog(fromUtc='${from10m.toISOString()}',toUtc='${now.toISOString()}')`;
  const sysUrl24h = `/odata/v4/sap-logs/getSystemLog(fromUtc='${from24h.toISOString()}',toUtc='${now.toISOString()}',top=500)`;
  const auditUrl10m = `/odata/v4/sap-logs/getSecurityAuditLog(fromUtc='${from10m.toISOString()}',toUtc='${now.toISOString()}')`;

  test('[1] getSystemLog with test-logs-reader returns 200 with sanitized fields and no PII leak', async () => {
    const res = await GET(sysUrl10m, { auth: { username: 'test-logs-reader', password: '' } });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('entries');
    expect(res.data).toHaveProperty('count');
    expect(res.data).toHaveProperty('truncated');
    expect(res.data).toHaveProperty('nextSkip');

    if (res.data.entries.length > 0) {
      const e0 = res.data.entries[0];
      expect(e0).toHaveProperty('entryType');
      expect(e0).toHaveProperty('timestamp');
      expect(e0).toHaveProperty('serverTimestamp');
      expect(e0).toHaveProperty('message');
      expect(e0).toHaveProperty('instance');
      expect(e0).not.toHaveProperty('user'); // SAPLOGS_INCLUDE_USER=false
    }
  }, 60000);

  test('[2] getSystemLog 24h scan: AB1 and Q04 entries redact user and instance/host when includeUser=false', async () => {
    const res = await GET(sysUrl24h, { auth: { username: 'test-logs-reader', password: '' } });
    expect(res.status).toBe(200);

    const specialEntries = (res.data.entries || []).filter(e =>
      ['AB1', 'sAB1', 'Q04', 'mQ04', 'AB6', 'sAB6'].includes(e.entryType.trim())
    );

    for (const e of specialEntries) {
      expect(e).not.toHaveProperty('user');
      // No live host names (vheudds4*)
      expect(e.message).not.toMatch(/vheudds4/i);
      if (e.messageText) {
        expect(e.messageText).not.toMatch(/vheudds4/i);
      }
      // No live instance names (_DS4_00)
      expect(e.message).not.toMatch(/_DS4_00/i);
      if (e.messageText) {
        expect(e.messageText).not.toMatch(/_DS4_00/i);
      }
    }
  }, 60000);

  test('[3] getSecurityAuditLog with test-logs-reader returns 200 with sanitized fields', async () => {
    const res = await GET(auditUrl10m, { auth: { username: 'test-logs-reader', password: '' } });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('entries');
    expect(res.data).toHaveProperty('count');
    expect(res.data).toHaveProperty('truncated');
    expect(res.data).toHaveProperty('warnings');

    if (res.data.entries.length > 0) {
      const e0 = res.data.entries[0];
      expect(e0).toHaveProperty('systemId');
      expect(e0).toHaveProperty('date');
      expect(e0).toHaveProperty('time');
      expect(e0).toHaveProperty('utcTimestamp');
      expect(e0).toHaveProperty('message');
      expect(e0).not.toHaveProperty('user');
    }
  }, 60000);

  test('[4] unauthorized user (test-logs-viewer) gets 403 on getSystemLog', async () => {
    try {
      await GET(sysUrl10m, { auth: { username: 'test-logs-viewer', password: '' } });
      throw new Error('Expected 403');
    } catch (err) {
      expect(err.response).toBeDefined();
      expect(err.response.status).toBe(403);
    }
  }, 30000);

  test('[5] unauthorized user (test-logs-viewer) gets 403 on getSecurityAuditLog', async () => {
    try {
      await GET(auditUrl10m, { auth: { username: 'test-logs-viewer', password: '' } });
      throw new Error('Expected 403');
    } catch (err) {
      expect(err.response).toBeDefined();
      expect(err.response.status).toBe(403);
    }
  }, 30000);

  test('[6] anonymous caller gets 401 on getSystemLog', async () => {
    try {
      await GET(sysUrl10m);
      throw new Error('Expected 401');
    } catch (err) {
      expect(err.response).toBeDefined();
      expect(err.response.status).toBe(401);
    }
  }, 30000);
});

if (!isLive) {
  describe('SapLogsService Live HTTP E2E (skipped — set ALLOW_LIVE_SAP_TOOLS=1)', () => {
    test('intentionally skipped without gate', () => {
      expect(process.env.ALLOW_LIVE_SAP_TOOLS).not.toBe('1');
    });
  });
}
