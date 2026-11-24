const crypto = require('crypto');
const cds = require('@sap/cds');
const { resolveAppUser, getExplicitAppUserRoles, isAllowAnySapUser, parseDefaultRoles, KNOWN_ROLES } = require('./appUsers');
const { parseAdminUsers } = require('./sapRoleMapper');
const { isIsolatedTestProfile } = require('./mockUserPasswords');

const LOCAL_DEV_ISSUER = 'saps4hana-local-auth-service';
const LOCAL_DEV_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours
// A short signing secret can be guessed offline from one captured token, and then any user can be forged.
const MIN_SECRET_LENGTH = 32;
// Token claim `role_source`. Set when SAP checked the password and the roles were mapped from the user's SAP
// roles (or APP_DEFAULT_ROLES) at sign-in: such roles exist only in the token, not in a sign-in list.
const ROLE_SOURCE_SAP = 'sap';

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
 * via ENABLE_DEV_TOKEN_ISSUER=true and a LOCAL_AUTH_SECRET of at least 32 characters.
 *
 * @returns {boolean}
 */
function isDevTokenIssuerEnabled() {
    return process.env.NODE_ENV !== 'production' &&
           process.env.ENABLE_DEV_TOKEN_ISSUER === 'true' &&
           typeof process.env.LOCAL_AUTH_SECRET === 'string' &&
           process.env.LOCAL_AUTH_SECRET.trim().length >= MIN_SECRET_LENGTH;
}

/**
 * Resolves the signing secret for local dev tokens.
 * Throws if the dev token issuer is not explicitly enabled or secret is missing.
 *
 * @returns {string}
 */
function getLocalDevSecret() {
    if (!isDevTokenIssuerEnabled()) {
        throw new Error('Local development token issuer is disabled. Set ENABLE_DEV_TOKEN_ISSUER=true and provide a LOCAL_AUTH_SECRET of at least 32 characters in the environment.');
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
 * @param {string} [options.roleSource] - 'sap' when the roles were mapped from SAP at sign-in (see currentRoles)
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
    if (aRoles.includes('Admin') && !aRoles.includes('SapLogsReader')) {
        aRoles.push('SapLogsReader');
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
    if (options.roleSource === ROLE_SOURCE_SAP) {
        payload.role_source = ROLE_SOURCE_SAP;
    }

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
 * The roles a verified token grants on this request, or null when its user may no longer sign in.
 *
 * A token without `role_source` belongs to a user of a sign-in list (srv/auth/appUsers.js). The list is read on
 * every request: a user taken off it is refused at once, and a change of roles applies at once.
 *
 * A token with `role_source: 'sap'` belongs to a user whose password SAP checked and whose roles were mapped from
 * SAP at sign-in (srv/auth/sapRoleMapper.js). No list holds those roles, so the signed token is their only record:
 *   - an entry in APP_USER_ROLES / APP_USERS_FILE added since sign-in wins at once (it also wins at sign-in);
 *   - a user in no list is accepted only while APP_ALLOW_ANY_SAP_USER is on, so turning it off ends the session;
 *   - Admin needs APP_ADMIN_USERS on every request, exactly as at sign-in, and unknown roles are dropped.
 * A change of roles or a lock in SAP itself applies at the next sign-in (the token lives 24 hours at most).
 *
 * @param {{user_name: string, role_source?: string}} payload - verified token payload
 * @param {string[]} tokenRoles - roles carried by the token
 * @returns {string[]|null}
 */
function currentRoles(payload, tokenRoles) {
    const auth = cds.env?.requires?.auth;
    const listed = resolveAppUser(payload.user_name, auth);

    if (payload.role_source !== ROLE_SOURCE_SAP) {
        return listed ? [...listed] : null;
    }

    const explicit = getExplicitAppUserRoles(payload.user_name, process.env);
    if (explicit) return [...explicit];
    if (!listed && !isAllowAnySapUser(process.env)) return null;

    const adminAllowed = parseAdminUsers(process.env).has(payload.user_name.trim().toLowerCase());
    // SapLogsReader is added to an Admin token when it is issued, so it goes with a refused Admin.
    const refused = !adminAllowed && tokenRoles.includes('Admin') ? ['Admin', 'SapLogsReader'] : [];
    const roles = [...new Set(tokenRoles)].filter((r) => KNOWN_ROLES.includes(r) && !refused.includes(r));
    if (roles.length) return roles;
    try {
        return parseDefaultRoles(process.env);
    } catch {
        return ['Viewer']; // a malformed APP_DEFAULT_ROLES is reported at startup
    }
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

    const header = base64UrlDecode(headerB64);
    if (!header || header.alg !== 'HS256') return null;

    const payload = base64UrlDecode(payloadB64);
    if (!payload || typeof payload.user_name !== 'string' || !payload.user_name) return null;
    if (payload.iss !== LOCAL_DEV_ISSUER) return null;

    // A token without an expiry time would be valid for ever: it is refused.
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || now > payload.exp) return null;

    // Map XSUAA scopes ($XSAPPNAME.<Role>) to CAP roles (<Role>)
    const aScopes = Array.isArray(payload.scope) ? payload.scope : [];
    let aRoles = aScopes.map(s => s.replace(/^\$XSAPPNAME\./, ''));

    // Who may sign in is checked on every request, not only at login (see currentRoles). An isolated test server
    // (no SAP connectivity) keeps the roles in the token.
    if (!isIsolatedTestProfile(process.env)) {
        aRoles = currentRoles(payload, aRoles);
        if (!aRoles) return null;
    }
    if (aRoles.includes('Admin') && !aRoles.includes('SapLogsReader')) {
        aRoles.push('SapLogsReader');
    }

    return new cds.User({
        id: payload.user_name,
        roles: aRoles,
        attr: {
            logon_name: payload.user_name,
            email: payload.email || `${payload.user_name.toLowerCase()}@example.corp`
        }
    });
}

/**
 * Express / CAP middleware: signs in the request's user from a valid local dev Bearer token.
 * Does nothing when the dev token issuer is disabled, which it always is in production.
 *
 * Finding DEBT-02: Registered at both Express bootstrap (for custom non-OData routes like /ai/chat/stream)
 * and CAP OData middleware chain ({ before: 'auth' }). To eliminate redundant cryptographic verification
 * (HMAC SHA-256 calculation) and prevent inconsistent identities across middleware boundaries, the verified
 * user is cached on the request (`req._verifiedBearerToken`).
 *
 * Full specification: docs/architecture/authentication-middleware-ordering.md
 */
function applyBearerToken(req, res, next) {
    const [, token] = /^bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [];
    if (!token) {
        return next();
    }

    let user;
    if (req._verifiedBearerToken === token && req.user && !req.user._is_anonymous) {
        // Cache hit from earlier middleware boundary (e.g. Express bootstrap -> CAP OData)
        user = req.user;
    } else {
        user = verifyToken(token);
        if (user) {
            req._verifiedBearerToken = token;
            req.user = user;
        }
    }

    if (user && cds.context) {
        cds.context.user = user;
    }

    next();
}

module.exports = {
    issueToken,
    verifyToken,
    applyBearerToken,
    isDevTokenIssuerEnabled,
    MIN_SECRET_LENGTH,
    ROLE_SOURCE_SAP,
    timingSafeEqual
};
