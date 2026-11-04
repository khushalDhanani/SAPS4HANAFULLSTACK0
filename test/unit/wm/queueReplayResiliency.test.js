/**
 * test/unit/wm/queueReplayResiliency.test.js
 *
 * Phase 3: Operational Error Classification, Pending-State Gating & Response Resiliency
 *
 * Validates:
 *  1. Operational Error Classification (classifyPostingError):
 *     - Categorizes backend errors into never_reached (503), auth_error (403), unknown_outcome (504), and rejected_by_sap (400/422).
 *     - Distinguishes definitive failures (definitive: true, safe to retry) from ambiguous in-flight failures (definitive: false, do not post again).
 *
 * [mock only, not SAP verification]
 */

'use strict';

const cds = require('@sap/cds');

// Test DB initialization
cds.test(__dirname + '/../../../');

const { classifyPostingError } = require('../../../srv/wm/goods-issue/classifyPostingError');

describe('Phase 3: Operational Error Classification & Pending-State Gating', () => {

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Operational Error Classification
  // =========================================================================
  describe('1. Operational Error Classification (classifyPostingError)', () => {

    test('never_reached: classifies HTTP 503 as definitive failure (status 503, safe to retry)', () => {
      const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
      const c = classifyPostingError(err);

      expect(c.category).toBe('never_reached');
      expect(c.status).toBe(503);
      expect(c.definitive).toBe(true);
      expect(c.message).toMatch(/service unreachable or posting capability unavailable/i);
      expect(c.message).toMatch(/can be tried again/i);
    });

    test('never_reached: classifies connection refused and DNS resolution failure as definitive failure', () => {
      const connErr = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' });
      const c1 = classifyPostingError(connErr);
      expect(c1.category).toBe('never_reached');
      expect(c1.status).toBe(503);
      expect(c1.definitive).toBe(true);

      const dnsErr = Object.assign(new Error('getaddrinfo ENOTFOUND s4app.internal'), { code: 'ENOTFOUND' });
      const c2 = classifyPostingError(dnsErr);
      expect(c2.category).toBe('never_reached');
      expect(c2.status).toBe(503);
      expect(c2.definitive).toBe(true);
    });

    test('never_reached: a rejected TLS certificate is definitive even when the adapter wrapped it as 502', () => {
      const tlsErr = Object.assign(new Error('Reverse: S/4HANA POST /x failed: self-signed certificate'), { status: 502 });
      const c = classifyPostingError(tlsErr);
      expect(c.category).toBe('never_reached');
      expect(c.status).toBe(503);
      expect(c.definitive).toBe(true);
    });

    test('a business message that only mentions a certificate stays an SAP rejection', () => {
      const c = classifyPostingError(Object.assign(new Error('Quality certificate is missing for batch B1'), { status: 422 }));
      expect(c.category).toBe('rejected_by_sap');
    });

    test('never_reached: classifies HTTP 403 with /IWFND/MED/170 (service inactive) as 503 never_reached', () => {
      const med170Err = Object.assign(new Error('/IWFND/MED/170 No service found for namespace /SAP/, name API_SERVICE'), { status: 403 });
      const c = classifyPostingError(med170Err);

      expect(c.category).toBe('never_reached');
      expect(c.status).toBe(503);
      expect(c.definitive).toBe(true);
    });

    test('auth_error: classifies plain HTTP 403 as authorization error pointing to SU53', () => {
      const authErr = Object.assign(new Error('Forbidden'), { status: 403 });
      const c = classifyPostingError(authErr);

      expect(c.category).toBe('auth_error');
      expect(c.status).toBe(403);
      expect(c.definitive).toBe(true);
      expect(c.message).toMatch(/check your SAP authorizations in transaction SU53/i);
    });

    test('unknown_outcome: classifies 504 / timeout as unconfirmed outcome (definitive: false, do not post again)', () => {
      const timeoutErr = Object.assign(new Error('Gateway Timeout after 30000ms'), { status: 504, code: 'ETIMEDOUT' });
      const c = classifyPostingError(timeoutErr);

      expect(c.category).toBe('unknown_outcome');
      expect(c.status).toBe(504);
      expect(c.definitive).toBe(false);
      expect(c.message).toMatch(/outcome unconfirmed in SAP S\/4HANA/i);
      expect(c.message).toMatch(/do not post again/i);
    });

    test('unknown_outcome: classifies ECONNRESET mid-call as unconfirmed outcome', () => {
      const resetErr = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      const c = classifyPostingError(resetErr);

      expect(c.category).toBe('unknown_outcome');
      expect(c.definitive).toBe(false);
      expect(c.message).toMatch(/outcome unconfirmed/i);
    });

    test('rejected_by_sap: classifies 400 / 422 business rejection with SAP message', () => {
      const sapErr = Object.assign(new Error('Posting period 09/2026 is closed for company code 1000'), { status: 422 });
      const c = classifyPostingError(sapErr);

      expect(c.category).toBe('rejected_by_sap');
      expect(c.status).toBe(422);
      expect(c.definitive).toBe(true);
      expect(c.message).toContain('Posting period 09/2026 is closed');
    });
  });

  // =========================================================================
  // 2. Pending Confirmation Gating
  // =========================================================================

  // =========================================================================
  // 3. UI / Client Response Representation
  // =========================================================================
});
