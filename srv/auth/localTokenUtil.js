const crypto = require('crypto');
const cds = require('@sap/cds');

// Secret for local development token signing. In production, XSUAA asymmetric public/private keys are used.
const LOCAL_DEV_SECRET = process.env.LOCAL_AUTH_SECRET || 'saps4hana-local-dev-secret-key-2026';
const LOCAL_DEV_ISSUER = 'saps4hana-local-auth-service';
const LOCAL_DEV_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

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
 *
 * @param {string} username - Logon user ID
 * @param {string[]} [roles] - Application roles (e.g. ['PurchasingManager', 'Viewer', 'User'])
 * @param {Object} [options]
 * @param {number} [options.expiresInSeconds] - Token expiration in seconds
 * @returns {{ token: string, scopes: string[], expiresAt: number }}
 */
function issueToken(username, roles = ['PurchasingManager', 'Viewer', 'User'], options = {}) {
    if (!username || typeof username !== 'string') {
        throw new Error('Username is required to issue local development token.');
    }

    const sUser = username.trim();
    const aScopes = roles.map(r => `$XSAPPNAME.${r}`);
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
        .createHmac('sha256', LOCAL_DEV_SECRET)
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
 *
 * @param {string} token - Bearer token string
 * @returns {import('@sap/cds').User|null}
 */
function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;

    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;

    // Verify cryptographic signature
    const expectedSig = crypto
        .createHmac('sha256', LOCAL_DEV_SECRET)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

    if (signature !== expectedSig) return null;

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
    LOCAL_DEV_ISSUER,
    LOCAL_DEV_EXPIRY_SECONDS
};
