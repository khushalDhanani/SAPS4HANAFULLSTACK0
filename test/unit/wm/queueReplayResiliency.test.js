/**
 * test/unit/wm/queueReplayResiliency.test.js
 *
 * Phase 3: Operational Error Classification, Pending-State Gating & Response Resiliency
 *
 * Validates:
 *  1. Operational Error Classification (classifyPostingError):
 *     - Categorizes backend errors into never_reached (503), auth_error (403), unknown_outcome (504), and rejected_by_sap (400/422).
 *     - Distinguishes definitive failures (definitive: true, safe to retry) from ambiguous in-flight failures (definitive: false, do not post again).
 *  2. Duplicate Submission & In-Flight Protection (checkPendingConfirmation):
 *     - Blocks duplicate submissions with HTTP 409 when an attempt is in-flight (sending) or unconfirmed.
 *     - Returns cached attemptResponse when identical ClientAttemptId is re-submitted.
 *  3. UI / Client Response Representation (attemptResponse):
 *     - Translates attempt states (posted, queued, delivery_created, unconfirmed, rejected, not_posted) into honest Fiori payloads.
 *
 * [mock only, not SAP verification]
 */

'use strict';

const cds = require('@sap/cds');

// Test DB initialization
cds.test(__dirname + '/../../../');

const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');

const { classifyPostingError, checkPendingConfirmation, attemptResponse } = PerTypeGoodsIssueHandler;

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
  describe('2. Pending Confirmation Gating (checkPendingConfirmation)', () => {

    test('permits request to proceed when no open attempt exists for reservation item', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'hasOpenAttemptForReservation').mockResolvedValue(false);

      const mockReq = { error: jest.fn() };
      const normalized = {
        ReservationNo: '520001',
        ReservationItem: '0001',
        ClientAttemptId: 'attempt-001'
      };

      const result = await checkPendingConfirmation(mockReq, normalized);

      expect(result).toBe(true);
      expect(mockReq.error).not.toHaveBeenCalled();
    });

    test('blocks duplicate submission with HTTP 409 when reservation item has an in-flight attempt', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'hasOpenAttemptForReservation').mockResolvedValue(true);
      jest.spyOn(GoodsIssueAttemptStore, 'getByReference').mockResolvedValue(null);

      const mockReq = { error: jest.fn() };
      const normalized = {
        ReservationNo: '520001',
        ReservationItem: '0001',
        ClientAttemptId: 'attempt-new-different-key'
      };

      const result = await checkPendingConfirmation(mockReq, normalized);

      expect(result).toBe(false);
      expect(mockReq.error).toHaveBeenCalledWith(
        409,
        expect.stringMatching(/has a Goods Issue posting attempt pending confirmation, do not post again/i)
      );
    });

    test('returns cached attemptResponse when identical ClientAttemptId is re-submitted', async () => {
      const cachedAttempt = {
        ReferenceDocument: 'GI-IDEMPOTENT-01',
        RequestHash: 'hash-idem-01',
        Status: 'posted',
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026'
      };

      jest.spyOn(GoodsIssueAttemptStore, 'getByReference').mockResolvedValue(cachedAttempt);

      const mockReq = { error: jest.fn() };
      const normalized = {
        ReferenceDocument: 'GI-IDEMPOTENT-01',
        RequestHash: 'hash-idem-01',
        ClientAttemptId: 'attempt-same-01',
        ReservationNo: '520001',
        ReservationItem: '0001'
      };

      const response = await checkPendingConfirmation(mockReq, normalized);

      expect(mockReq.error).not.toHaveBeenCalled();
      expect(response).toMatchObject({
        PostingStatus: 'POSTED',
        Success: true,
        Confirmed: true,
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026'
      });
    });
  });

  // =========================================================================
  // 3. UI / Client Response Representation
  // =========================================================================
  describe('3. Response State Mapping (attemptResponse)', () => {

    test('maps posted attempt to Success: true and Confirmed: true', () => {
      const res = attemptResponse({
        Status: 'posted',
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026'
      });

      expect(res).toMatchObject({
        PostingStatus: 'POSTED',
        Success: true,
        Confirmed: true,
        ConfirmationStatus: 'CONFIRMED',
        MaterialDocument: '5000000201',
        MaterialDocYear: '2026'
      });
      expect(res.Message).toMatch(/already posted in SAP/i);
    });

    test('maps queued attempt to PostingStatus: QUEUED with empty MaterialDocument', () => {
      const res = attemptResponse({
        Status: 'queued',
        MaterialDocument: 'ignored-mock-doc'
      });

      expect(res).toMatchObject({
        PostingStatus: 'QUEUED',
        Success: false,
        Confirmed: false,
        MaterialDocument: ''
      });
      expect(res.Message).toMatch(/safely queued/i);
    });

    test('maps delivery_created attempt to DELIVERY_CREATED and identifies delivery number', () => {
      const res = attemptResponse({
        Status: 'delivery_created',
        DeliveryNumber: '0080000134'
      });

      expect(res).toMatchObject({
        PostingStatus: 'DELIVERY_CREATED',
        Success: false,
        Confirmed: false,
        DeliveryNumber: '0080000134'
      });
      expect(res.Message).toMatch(/outbound delivery 0080000134/i);
      expect(res.Message).toMatch(/do not post again/i);
    });

    test('maps unconfirmed attempt to UNKNOWN with confirmation pending message', () => {
      const res = attemptResponse({
        Status: 'unconfirmed',
        MaterialDocument: '5000000999',
        MaterialDocYear: '2026'
      });

      expect(res).toMatchObject({
        PostingStatus: 'UNKNOWN',
        Success: false,
        Confirmed: false
      });
      expect(res.Message).toMatch(/confirmation is pending\. Do not post again/i);
    });

    test('maps rejected attempt to FAILED with SAP error message', () => {
      const res = attemptResponse({
        Status: 'rejected',
        LastError: 'Cost center 1011201301 is closed'
      });

      expect(res).toMatchObject({
        PostingStatus: 'FAILED',
        Success: false,
        Confirmed: false,
        Message: 'Cost center 1011201301 is closed'
      });
    });
  });
});
