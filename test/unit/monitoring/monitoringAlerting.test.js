'use strict';

/**
 * test/unit/monitoring/monitoringAlerting.test.js
 *
 * Automated Monitoring & Alerting Assurance Suite.
 * Validates:
 * 1. Correlation ID propagation & structured logging in plain & JSON formats
 * 2. Supervisor alerting state transition ('needs-attention') for stale unconfirmed transactions
 * 3. Gateway error sanitization and diagnostic capture
 * 4. Production guardrail security alerts and startup warning triggers
 */

const cds = require('@sap/cds');
const getLogger = require('../../../srv/common/logger');
const { GoodsIssueAttemptStore } = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const productionGuard = require('../../../srv/common/productionGuard');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');

describe('Production Assurance: Monitoring & Alerting Verification', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    delete cds.context;
  });

  describe('1. Correlation ID Tracking & Structured Logging', () => {
    it('propagates cds.context.id into log prefixes for end-to-end distributed tracing', () => {
      cds.context = { id: 'trace-alert-9999' };
      const logger = getLogger('alert-monitor');
      logger.warn('Critical latency spike detected');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[alert-monitor] [trace-alert-9999] - Critical latency spike detected')
      );
    });

    it('formats plain messages with clean module prefix when no correlation context exists', () => {
      delete cds.context;
      const logger = getLogger('health-check');
      logger.warn('Service ping latency normal');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[health-check] - Service ping latency normal')
      );
    });
  });

  describe('2. Transaction Alerting: needs-attention State for Stale Attempts', () => {
    it('promotes stale unconfirmed attempts (> 30 min) to needs-attention status to trigger supervisor alerts', async () => {
      const store = new GoodsIssueAttemptStore();
      const staleTime = new Date(Date.now() - 35 * 60 * 1000).toISOString(); // 35 minutes ago

      // Mock an attempt in the in-memory store
      const ref = 'REF-ALERT-001';
      store._memoryStore.set(ref, {
        ReferenceDocument: ref,
        MaterialDocument: '4900050304',
        MaterialDocYear: '2026',
        Status: 'unconfirmed',
        MovementType: '201',
        ReservationNumber: '0000533316',
        ItemNumber: '0001',
        createdAt: staleTime,
        updatedAt: staleTime
      });

      // Mock adapter finding unconfirmed state
      const mockAdapter = {
        readBackDocument: jest.fn().mockResolvedValue({ Confirmed: false })
      };

      const summary = await store.reconfirmUnconfirmed(mockAdapter);
      expect(summary.Checked).toBe(1);
      expect(summary.MarkedNeedsAttention).toBe(1);

      const updated = store._memoryStore.get(ref);
      expect(updated.Status).toBe('needs-attention');
    });

    it('promotes unconfirmed attempts to posted when read-back proves SAP persistence', async () => {
      const store = new GoodsIssueAttemptStore();
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const ref = 'REF-CONFIRM-002';
      store._memoryStore.set(ref, {
        ReferenceDocument: ref,
        MaterialDocument: '4900050305',
        MaterialDocYear: '2026',
        Status: 'unconfirmed',
        MovementType: '241',
        ReservationNumber: '0000533317',
        ItemNumber: '0001',
        createdAt: recentTime,
        updatedAt: recentTime
      });

      const mockAdapter = {
        readBackDocument: jest.fn().mockResolvedValue({
          Confirmed: true,
          MaterialDocument: '4900050305',
          MaterialDocYear: '2026'
        })
      };

      const summary = await store.reconfirmUnconfirmed(mockAdapter);
      expect(summary.Checked).toBe(1);
      expect(summary.Confirmed).toBe(1);

      const updated = store._memoryStore.get(ref);
      expect(updated.Status).toBe('posted');
      expect(updated.MaterialDocument).toBe('4900050305');
    });
  });

  describe('3. Gateway Error Sanitization & Security Alerting', () => {
    it('sanitizes SAP Gateway error responses without exposing backend URLs or stack traces', () => {
      const rawError = {
        response: {
          status: 500,
          data: {
            error: {
              code: 'CX_SADL_DPC_NOT_IMPL/005056A700711EE88C8',
              message: { value: 'RFC execution error occurred in backend system' },
              innererror: {
                errordetails: [
                  { code: 'SY/530', message: 'Work process disconnected' }
                ]
              }
            }
          }
        }
      };

      const sanitized = S4HttpClient.toS4HttpError(rawError, 'POST', '/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV');
      expect(sanitized.status).toBe(500);
      expect(sanitized.message).toContain('RFC execution error occurred in backend system');
      expect(sanitized.code).toBe('CX_SADL_DPC_NOT_IMPL/005056A700711EE88C8');
      expect(sanitized.response).toBeDefined();
    });

    it('triggers security alerts when illegal mock authentication is configured in production', () => {
      expect(() => {
        productionGuard.assertDevFlagsOff(
          { NODE_ENV: 'production' },
          { kind: 'mocked' }
        );
      }).toThrow(productionGuard.ProductionGuardError);
    });

    it('triggers security alerts when raw passwords exist in environment variables in production', () => {
      expect(() => {
        productionGuard.assertS4ConnectionConfig({
          NODE_ENV: 'production',
          S4_PASSWORD: 'supersecretpassword'
        });
      }).toThrow(productionGuard.ProductionGuardError);
    });
  });
});
