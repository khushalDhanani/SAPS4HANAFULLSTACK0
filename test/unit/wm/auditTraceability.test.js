/**
 * test/unit/wm/auditTraceability.test.js
 *
 * Phase 3: Observability, Correlation Tracking, Secret Redaction & Production Guards
 *
 * Validates:
 *  1. Correlation ID Propagation & Logger Formatting:
 *     - Binds CAP context correlation ID (cds.context.id / correlation_id) to application log messages.
 *     - Formats plain log messages with [label] [correlation-id] - message.
 *  2. Sensitive Credential Redaction & Session Protection:
 *     - S4HttpClient strips Authorization, Cookie, and CSRF token headers before dispatch.
 *     - S4HttpClient.toS4HttpError normalizes Gateway errors without exposing system secrets.
 *  3. Production Startup & Environment Security Guards:
 *     - productionGuard.assertDevFlagsOff forbids dev JWT issuer, local signing secrets, and dummy auth in production.
 *     - productionGuard.assertS4ConnectionConfig forbids environment credentials in production and enforces BTP Destination bindings.
 *     - RfcClient.resolveConnectionParams enforces BTP RFC destination in production and forbids raw environment passwords.
 *
 * [mock only, not SAP verification]
 */

'use strict';

const cds = require('@sap/cds');
const logger = require('../../../srv/common/logger');
const { S4HttpClient, S4HttpError } = require('../../../srv/integration/s4hana/S4HttpClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
const { assertDevFlagsOff, assertS4ConnectionConfig, ProductionGuardError } = require('../../../srv/common/productionGuard');

describe('Phase 3: Observability, Correlation Tracking & Security Gating', () => {

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Correlation ID Propagation & Formatting
  // =========================================================================
  describe('1. Correlation ID Propagation & Logger Formatting', () => {

    test('logger formats plain messages with [label] [correlation-id] when correlation ID is set', () => {
      const origContext = cds.context;
      try {
        cds.context = { id: 'req-corr-uuid-12345' };
        const testLog = logger('test-wm');

        let formattedMsg = '';
        jest.spyOn(console, 'info').mockImplementation((...args) => {
          formattedMsg = args.join(' ');
        });

        testLog.info('Processing goods issue for reservation 520001');

        expect(formattedMsg).toContain('[test-wm]');
        expect(formattedMsg).toContain('[req-corr-uuid-12345]');
        expect(formattedMsg).toContain('Processing goods issue for reservation 520001');
      } finally {
        cds.context = origContext;
      }
    });

    test('logger formats plain messages with [label] when no correlation ID is set', () => {
      const origContext = cds.context;
      try {
        cds.context = undefined;
        const testLog = logger('test-wm-nocorr');

        let formattedMsg = '';
        jest.spyOn(console, 'info').mockImplementation((...args) => {
          formattedMsg = args.join(' ');
        });

        testLog.info('Normal background task');

        expect(formattedMsg).toContain('[test-wm-nocorr] - Normal background task');
        expect(formattedMsg).not.toContain('undefined');
      } finally {
        cds.context = origContext;
      }
    });
  });

  // =========================================================================
  // 2. Sensitive Credential Redaction & Session Protection
  // =========================================================================
  describe('2. Credential Redaction & Session Protection', () => {

    test('S4HttpClient strips Authorization, Cookie, and CSRF token headers before dispatch', async () => {
      let interceptedHeaders = {};
      const mockExecutor = jest.fn().mockImplementation(async (dest, config) => {
        interceptedHeaders = config.headers;
        return { status: 200, data: { d: { results: [] } }, headers: {} };
      });

      const client = new S4HttpClient({
        destinationName: 'MOCK_DEST',
        getDestination: jest.fn().mockResolvedValue({ url: 'https://mock.s4.local', headers: {} }),
        executeHttpRequest: mockExecutor
      });

      // Probe CSRF fetch mock
      jest.spyOn(client, 'fetchCsrfSession').mockResolvedValue({ token: 'mock-csrf-tok', cookie: 'MOCK_SESSION_ID=abc' });

      await client.post('/sap/opu/odata/sap/MOCK_SRV/ItemSet', {
        data: { Material: '8000000023' },
        headers: {
          'Authorization': 'Bearer super-secret-user-token',
          'authorization': 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
          'Cookie': 'SECRET_AUTH_COOKIE=xyz123',
          'x-csrf-token': 'old-stale-token',
          'X-Custom-Client-Header': 'ClientTrace123'
        }
      });

      // Headers sent to S/4 must NOT contain the caller's raw authorization or leaked cookies
      expect(interceptedHeaders['Authorization']).toBeUndefined();
      expect(interceptedHeaders['authorization']).toBeUndefined();
      expect(interceptedHeaders['SECRET_AUTH_COOKIE']).toBeUndefined();
      // Only the per-call session context token/cookie and benign custom headers survive
      expect(interceptedHeaders['x-csrf-token']).toBe('mock-csrf-tok');
      expect(interceptedHeaders['Cookie']).toBe('MOCK_SESSION_ID=abc');
      expect(interceptedHeaders['X-Custom-Client-Header']).toBe('ClientTrace123');
    });

    test('S4HttpClient.toS4HttpError sanitizes Gateway errors and returns clean S4HttpError', () => {
      const networkErr = {
        message: 'Request failed with status code 400',
        response: {
          status: 400,
          data: {
            error: {
              code: 'M7/021',
              message: { value: 'Deficit of BA Unrestricted-use stock 10.000 EA' }
            }
          },
          headers: {
            'set-cookie': ['MYSAPSSO2=secret-session-cookie; Path=/'],
            'sap-server': 's4app01.internal'
          }
        }
      };

      const s4Err = S4HttpClient.toS4HttpError(networkErr, 'POST', '/sap/opu/odata/sap/SERVICE/Post');

      expect(s4Err).toBeInstanceOf(S4HttpError);
      expect(s4Err.status).toBe(400);
      expect(s4Err.code).toBe('M7/021');
      expect(s4Err.message).toContain('Deficit of BA Unrestricted-use stock 10.000 EA');
      // Secret cookies are not serialized in message
      expect(s4Err.message).not.toContain('MYSAPSSO2');
    });
  });

  // =========================================================================
  // 3. Production Startup & Environment Security Guards
  // =========================================================================
  describe('3. Production Startup & Security Guards', () => {

    describe('productionGuard.assertDevFlagsOff', () => {
      test('throws ProductionGuardError in production if ENABLE_DEV_TOKEN_ISSUER=true', () => {
        expect(() => {
          assertDevFlagsOff({ NODE_ENV: 'production', ENABLE_DEV_TOKEN_ISSUER: 'true' }, { kind: 'xsuaa' });
        }).toThrow(ProductionGuardError);
      });

      test('throws ProductionGuardError in production if LOCAL_AUTH_SECRET is set', () => {
        expect(() => {
          assertDevFlagsOff({ NODE_ENV: 'production', LOCAL_AUTH_SECRET: 'dev-jwt-secret-xyz' }, { kind: 'xsuaa' });
        }).toThrow(ProductionGuardError);
      });

      test('throws ProductionGuardError in production if WM_ALLOW_MISMATCHED_TR=true', () => {
        expect(() => {
          assertDevFlagsOff({ NODE_ENV: 'production', WM_ALLOW_MISMATCHED_TR: 'true' }, { kind: 'xsuaa' });
        }).toThrow(ProductionGuardError);
      });

      test('throws ProductionGuardError in production if auth.kind is mocked/dummy/basic', () => {
        expect(() => {
          assertDevFlagsOff({ NODE_ENV: 'production' }, { kind: 'mocked' });
        }).toThrow(ProductionGuardError);

        expect(() => {
          assertDevFlagsOff({ NODE_ENV: 'production' }, { kind: 'dummy' });
        }).toThrow(ProductionGuardError);

        expect(() => {
          assertDevFlagsOff({ NODE_ENV: 'production' }, { kind: 'basic' });
        }).toThrow(ProductionGuardError);
      });

      test('passes cleanly in production when all dev flags are off and auth is XSUAA', () => {
        expect(() => {
          assertDevFlagsOff({
            NODE_ENV: 'production',
            ENABLE_DEV_TOKEN_ISSUER: 'false',
            LOCAL_AUTH_SECRET: '',
            WM_ALLOW_MISMATCHED_TR: 'false'
          }, { kind: 'xsuaa' });
        }).not.toThrow();
      });

      test('does not throw in development or test even if dev flags are active', () => {
        expect(() => {
          assertDevFlagsOff({
            NODE_ENV: 'development',
            ENABLE_DEV_TOKEN_ISSUER: 'true',
            LOCAL_AUTH_SECRET: 'secret',
            WM_ALLOW_MISMATCHED_TR: 'true'
          }, { kind: 'mocked' });
        }).not.toThrow();
      });
    });

    describe('productionGuard.assertS4ConnectionConfig', () => {
      test('throws ProductionGuardError in production if raw credentials/passwords exist in env vars', () => {
        expect(() => {
          assertS4ConnectionConfig({
            NODE_ENV: 'production',
            VCAP_SERVICES: JSON.stringify({ destination: [{ name: 'dest-svc' }] }),
            S4_DESTINATION_NAME: 'S4_HTTP',
            S4_RFC_DESTINATION_NAME: 'S4_RFC',
            S4_PASSWORD: 'plain-text-sap-password' // Forbidden!
          });
        }).toThrow(ProductionGuardError);
      });

      test('throws ProductionGuardError in production if Destination service binding is missing', () => {
        expect(() => {
          assertS4ConnectionConfig({
            NODE_ENV: 'production',
            VCAP_SERVICES: '{}',
            S4_DESTINATION_NAME: 'S4_HTTP',
            S4_RFC_DESTINATION_NAME: 'S4_RFC'
          });
        }).toThrow(ProductionGuardError);
      });

      test('passes cleanly in production with BTP destination bindings and zero env secrets', () => {
        expect(() => {
          assertS4ConnectionConfig({
            NODE_ENV: 'production',
            VCAP_SERVICES: JSON.stringify({ destination: [{ name: 'dest-svc' }] }),
            S4_DESTINATION_NAME: 'S4_HTTP',
            S4_RFC_DESTINATION_NAME: 'S4_RFC'
          });
        }).not.toThrow();
      });
    });

    describe('RfcClient.resolveConnectionParams', () => {
      test('enforces BTP RFC destination in production and forbids raw env credentials', async () => {
        const client = new RfcClient({
          NODE_ENV: 'production',
          S4_DESTINATION_URL: 's4app01.internal',
          S4_RFC_SYSNR: '00',
          S4_CLIENT: '100',
          S4_USERNAME: 'BATCH_USER',
          S4_PASSWORD: 'SecretPassword'
        });

        await expect(client.resolveConnectionParams()).rejects.toMatchObject({
          status: 503,
          message: expect.stringMatching(/must come from a BTP RFC destination/i)
        });
      });

      test('resolves parameters cleanly from BTP RFC destination in production', async () => {
        const mockGetDestination = jest.fn().mockResolvedValue({
          originalProperties: {
            'jco.client.ashost': 's4prod01.corp.internal',
            'jco.client.sysnr': '01',
            'jco.client.client': '100',
            'jco.client.user': 'RFC_TECH_USER',
            'jco.client.passwd': 'VaultManagedPassword'
          }
        });

        const client = new RfcClient({
          NODE_ENV: 'production',
          S4_RFC_DESTINATION_NAME: 'PRD_RFC_DEST'
        }, undefined, mockGetDestination);

        const params = await client.resolveConnectionParams();

        expect(params).toMatchObject({
          ashost: 's4prod01.corp.internal',
          sysnr: '01',
          client: '100',
          user: 'RFC_TECH_USER'
        });
      });
    });
  });
});
