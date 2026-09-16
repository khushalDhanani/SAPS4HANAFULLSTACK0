/**
 * Shared User Identity Resolution for CAP Services
 *
 * Resolves the authenticated user identity according to the following precedence:
 *   1. XSUAA user attributes (e.g. logon_name, email)
 *   2. CAP authenticated user ID (req.user.id !== 'anonymous')
 *   3. CAP user name (req.user.name !== 'anonymous')
 *   4. Custom forwarded 'x-user-id' header (strictly non-production / local dev only)
 *   5. Configured environment fallback (S4_USER || 'SYSTEM') (non-production only)
 *
 * In production (process.env.NODE_ENV === 'production'):
 *   - Client-supplied 'x-user-id' headers are strictly rejected.
 *   - Unauthenticated requests fail closed and throw an error.
 *   - Missing request context throws an error.
 *
 * @param {import('@sap/cds').Request} req
 * @returns {string}
 */
function resolveUserIdentity(req) {
    if (!req) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Authentication required: Missing request context in production');
        }
        return process.env.S4_USER || 'SYSTEM';
    }

    // 1. XSUAA user attributes (e.g. logon_name, email)
    if (req.user?.attr?.logon_name) {
        return String(req.user.attr.logon_name).trim();
    }
    if (req.user?.attr?.email) {
        return String(req.user.attr.email).split('@')[0].trim();
    }

    // 2. CAP user ID (ignore default 'anonymous' in unauthenticated requests)
    if (req.user?.id && req.user.id !== 'anonymous') {
        return String(req.user.id).trim();
    }

    // 3. CAP user name property if present
    if (req.user?.name && req.user.name !== 'anonymous') {
        return String(req.user.name).trim();
    }

    // In production, do NOT trust client headers or silently fall back to privileged system users
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Authentication required: Trusted user identity cannot be determined');
    }

    // 4. Custom forwarded user header (strictly non-production / local dev only)
    const headerUser = req.headers?.['x-user-id'] || req._?.req?.headers?.['x-user-id'];
    if (headerUser && String(headerUser).trim() !== '') {
        return String(headerUser).trim();
    }

    // 5. Configured system / service user fallback (non-production only)
    return process.env.S4_USER || 'SYSTEM';
}

module.exports = {
    resolveUserIdentity
};
