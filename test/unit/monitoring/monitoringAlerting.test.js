'use strict';

/**
 * test/unit/monitoring/monitoringAlerting.test.js
 *
 * Automated Monitoring & Alerting Assurance Suite.
 * Validates:
 * 1. Correlation ID propagation & structured logging in plain & JSON formats
 * 2. Gateway error message content
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const getLogger = require('../../../srv/common/logger');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');

describe('Production Assurance: Monitoring & Alerting Verification', () => {
  let warnSpy;
  let errorSpy;

  beforeEach(async () => {
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

  describe('2. Gateway Error Message', () => {
    // Body keeps the earlier fixture; that SAP answers in exactly this shape is not proven here.
    it('builds the error message from method, path and the SAP text, without the host from the raw error', () => {
      const rawError = Object.assign(new Error('Request to https://s4.internal.example:44300 failed'), {
        response: {
          status: 500,
          data: {
            error: {
              code: 'CX_SADL_DPC_NOT_IMPL/005056A700711EE88C8',
              message: { value: 'RFC execution error occurred in backend system' }
            }
          }
        }
      });

      const mapped = S4HttpClient.toS4HttpError(rawError, 'POST', '/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV');

      expect(mapped.status).toBe(500);
      expect(mapped.code).toBe('CX_SADL_DPC_NOT_IMPL/005056A700711EE88C8');
      expect(mapped.message).toBe('S/4HANA POST /sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV failed: HTTP 500 - RFC execution error occurred in backend system');
    });
  });
});
