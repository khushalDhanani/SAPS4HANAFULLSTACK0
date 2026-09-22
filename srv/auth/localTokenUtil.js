const crypto = require('crypto');
const cds = require('@sap/cds');

const LOCAL_DEV_ISSUER = 'saps4hana-local-auth-service';
const LOCAL_DEV_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Performs a constant-time comparison of two strings to prevent timing attacks.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks whether the local development token issuer is explicitly enabled
 * via ENABLE_DEV_TOKEN_ISSUER=true and a non-empty LOCAL_AUTH_SECRET.
 *
 * @returns {boolean}
 */
function isDevTokenIssuerEnabled() {
    return process.env.NODE_ENV !== 'production' &&
           process.env.ENABLE_DEV_TOKEN_ISSUER === 'true' &&
           typeof process.env.LOCAL_AUTH_SECRET === 'string' &&
           process.env.LOCAL_AUTH_SECRET.trim().length > 0;
}

/**
 * Resolves the signing secret for local dev tokens.
 * Throws if the dev token issuer is not explicitly enabled or secret is missing.
 *
 * @returns {string}
 */
function getLocalDevSecret() {
    if (!isDevTokenIssuerEnabled()) {
        throw new Error('Local development token issuer is disabled. Set ENABLE_DEV_TOKEN_ISSUER=true and provide LOCAL_AUTH_SECRET in the environment.');
    }
    return process.env.LOCAL_AUTH_SECRET.trim();
}

/**
 * Encodes an object to Base64URL string.
 * @param {Object} obj
 * @returns {string}
 */
function base64UrlEncode(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/**
 * Decodes a Base64URL string to an object.
 * @param {string} str
 * @returns {Object|null}
 */
function base64UrlDecode(str) {
    try {
        return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

/**
 * Issues a signed local development JWT containing standard XSUAA/BTP claims.
 * Gated behind ENABLE_DEV_TOKEN_ISSUER=true and LOCAL_AUTH_SECRET.
 *
 * @param {string} username - Logon user ID
 * @param {string[]} [roles] - Application roles (e.g. ['PurchasingManager', 'Viewer'])
 * @param {Object} [options]
 * @param {number} [options.expiresInSeconds] - Token expiration in seconds
 * @returns {{ token: string, scopes: string[], expiresAt: number }}
 */
function issueToken(username, roles = ['PurchasingManager', 'Viewer'], options = {}) {
    const secret = getLocalDevSecret();

    if (!username || typeof username !== 'string') {
        throw new Error('Username is required to issue local development token.');
    }

    const sUser = username.trim();
    let aRoles = [];
    if (Array.isArray(roles)) {
        aRoles = roles;
    } else if (roles && typeof roles === 'object') {
        aRoles = Object.keys(roles).filter(k => roles[k]);
    } else if (typeof roles === 'string') {
        aRoles = [roles];
    } else {
        aRoles = ['PurchasingManager', 'Viewer'];
    }
    const aScopes = aRoles.map(r => `$XSAPPNAME.${r}`);
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (options.expiresInSeconds || LOCAL_DEV_EXPIRY_SECONDS);

    const header = {
        alg: 'HS256',
        typ: 'JWT'
    };

    const payload = {
        user_name: sUser,
        sub: sUser,
        email: `${sUser.toLowerCase()}@example.corp`,
        scope: aScopes,
        iss: LOCAL_DEV_ISSUER,
        iat: now,
        exp: exp
    };

    const headerB64 = base64UrlEncode(header);
    const payloadB64 = base64UrlEncode(payload);
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

    const token = `${headerB64}.${payloadB64}.${signature}`;

    return {
        token,
        scopes: aScopes,
        expiresAt: exp
    };
}

/**
 * Verifies a local development JWT and returns a decoded cds.User or null if invalid.
 * Validates in constant time and returns null if dev token issuer is disabled.
 *
 * @param {string} token - Bearer token string
 * @returns {import('@sap/cds').User|null}
 */
function verifyToken(token) {
    if (!isDevTokenIssuerEnabled()) return null;
    if (!token || typeof token !== 'string') return null;

    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    const secret = getLocalDevSecret();

    // Verify cryptographic signature in constant time
    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

    if (!timingSafeEqual(signature, expectedSig)) return null;

    const payload = base64UrlDecode(payloadB64);
    if (!payload || !payload.user_name) return null;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now > payload.exp) return null;

    // Map XSUAA scopes ($XSAPPNAME.<Role>) to CAP roles (<Role>)
    const aScopes = Array.isArray(payload.scope) ? payload.scope : [];
    const aRoles = aScopes.map(s => s.replace(/^\$XSAPPNAME\./, ''));

    return new cds.User({
        id: payload.user_name,
        roles: aRoles,
        attr: {
            logon_name: payload.user_name,
            email: payload.email || `${payload.user_name.toLowerCase()}@example.corp`
        }
    });
}

module.exports = {
    issueToken,
    verifyToken,
    isDevTokenIssuerEnabled,
    timingSafeEqual,
    LOCAL_DEV_ISSUER,
    LOCAL_DEV_EXPIRY_SECONDS
};
