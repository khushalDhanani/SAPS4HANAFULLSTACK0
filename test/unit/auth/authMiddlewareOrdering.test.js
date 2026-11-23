'use strict';

/**
 * test/unit/auth/authMiddlewareOrdering.test.js
 *
 * Unit tests for Authentication Middleware Ordering & Dual-Boundary Identity Architecture.
 * Resolves Finding DEBT-02 (P2): Review duplicate authentication middleware responsibilities.
 *
 * Verifies:
 * 1. Dual-boundary execution: Boundary 1 (Express bootstrap) followed by Boundary 2 (CAP OData middleware).
 * 2. Idempotent request-scoped caching: HMAC verification executes on first boundary; second boundary reuses req.user in O(1).
 * 3. Identity consistency: req.user and cds.context.user share the identical object reference across boundaries.
 * 4. Token change safety: changing token header evicts cache and triggers fresh verification.
 * 5. Invalid / expired token safety: non-tokens or expired tokens never populate cache or user identity.
 */

const cds = require('@sap/cds');
const localTokenUtil = require('../../../srv/auth/localTokenUtil');

describe('Finding DEBT-02: Authentication Middleware Ordering & Dual-Boundary Identity', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
    process.env.LOCAL_AUTH_SECRET = 'test-auth-secret-for-ordering-tests-1234567890';
    // The sign-in list is checked on every request outside the isolated test profile.
    process.env.APP_USER_ROLES = JSON.stringify({
      alice_ordering: ['PurchasingManager', 'Viewer'], user_a: ['Viewer'], user_b: ['Admin'],
      expired_user: ['Viewer'], admin_user: ['Admin']
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Dual-Boundary Idempotent Execution & Caching', () => {
    it('executes verification on Boundary 1 and reuses verified user on Boundary 2 without duplicate HMAC calculation', () => {
      const crypto = require('crypto');
      const { token } = localTokenUtil.issueToken('alice_ordering', ['PurchasingManager', 'Viewer']);
      const req = {
        headers: {
          authorization: `Bearer ${token}`
        }
      };
      const res = {};

      let next1Called = false;
      let next2Called = false;

      // Spy on crypto.createHmac to track HMAC SHA-256 signature verifications
      const hmacSpy = jest.spyOn(crypto, 'createHmac');

      // 1. Boundary 1: Express Bootstrap Layer (app.use)
      localTokenUtil.applyBearerToken(req, res, () => {
        next1Called = true;
      });

      expect(next1Called).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('alice_ordering');
      expect(req.user.is('PurchasingManager')).toBe(true);
      expect(req._verifiedBearerToken).toBe(token);
      // Exactly 1 HMAC verification computed during Boundary 1
      expect(hmacSpy).toHaveBeenCalledTimes(1);

      const verifiedUserRef = req.user;

      // 2. Boundary 2: CAP Protocol Middleware Chain (before: 'auth')
      // Simulate CAP initializing cds.context
      cds.context = { user: undefined };

      localTokenUtil.applyBearerToken(req, res, () => {
        next2Called = true;
      });

      expect(next2Called).toBe(true);
      // Identity MUST be identical by reference (zero divergence)
      expect(req.user).toBe(verifiedUserRef);
      expect(cds.context.user).toBe(verifiedUserRef);

      // Crucial: HMAC was NOT computed a second time (0 duplicate HMAC SHA-256 computations on Boundary 2)
      expect(hmacSpy).toHaveBeenCalledTimes(1);

      hmacSpy.mockRestore();
      delete cds.context;
    });

    it('re-verifies cleanly when token changes on the same request object', () => {
      const tokenA = localTokenUtil.issueToken('user_a', ['Viewer']).token;
      const tokenB = localTokenUtil.issueToken('user_b', ['Admin']).token;

      const req = {
        headers: {
          authorization: `Bearer ${tokenA}`
        }
      };
      const res = {};

      // First verification for user_a
      localTokenUtil.applyBearerToken(req, res, () => {});
      expect(req.user.id).toBe('user_a');
      expect(req._verifiedBearerToken).toBe(tokenA);

      // Mutate Authorization header to tokenB
      req.headers.authorization = `Bearer ${tokenB}`;
      localTokenUtil.applyBearerToken(req, res, () => {});

      expect(req.user.id).toBe('user_b');
      expect(req.user.is('Admin')).toBe(true);
      expect(req._verifiedBearerToken).toBe(tokenB);
    });

    it('does not cache or set identity when token is invalid or missing', () => {
      const reqWithoutToken = { headers: {} };
      const reqInvalidToken = { headers: { authorization: 'Bearer invalid.jwt.token' } };
      const res = {};

      localTokenUtil.applyBearerToken(reqWithoutToken, res, () => {});
      expect(reqWithoutToken.user).toBeUndefined();
      expect(reqWithoutToken._verifiedBearerToken).toBeUndefined();

      localTokenUtil.applyBearerToken(reqInvalidToken, res, () => {});
      expect(reqInvalidToken.user).toBeUndefined();
      expect(reqInvalidToken._verifiedBearerToken).toBeUndefined();
    });

    it('does not cache or set identity when token is expired', () => {
      const { token: expiredToken } = localTokenUtil.issueToken('expired_user', ['Viewer'], {
        expiresInSeconds: -10
      });
      const req = {
        headers: {
          authorization: `Bearer ${expiredToken}`
        }
      };
      const res = {};

      localTokenUtil.applyBearerToken(req, res, () => {});
      expect(req.user).toBeUndefined();
      expect(req._verifiedBearerToken).toBeUndefined();
    });
  });

  describe('Route Boundary Role Parity', () => {
    it('provides consistent roles including SapLogsReader expansion across both boundaries', () => {
      const { token } = localTokenUtil.issueToken('admin_user', ['Admin']);
      const req = {
        headers: {
          authorization: `Bearer ${token}`
        }
      };
      const res = {};

      // Boundary 1 (Express - e.g. for /admin/diagnostics/sap)
      localTokenUtil.applyBearerToken(req, res, () => {});
      expect(req.user.is('Admin')).toBe(true);
      expect(req.user.is('SapLogsReader')).toBe(true);

      // Boundary 2 (CAP OData - e.g. for /odata/v4/user-management)
      cds.context = {};
      localTokenUtil.applyBearerToken(req, res, () => {});
      expect(cds.context.user.is('Admin')).toBe(true);
      expect(cds.context.user.is('SapLogsReader')).toBe(true);
      expect(cds.context.user).toBe(req.user);

      delete cds.context;
    });
  });
});
