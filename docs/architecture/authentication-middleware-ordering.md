# Authentication Middleware Ordering & Dual-Boundary Identity Architecture

**Document Reference**: `docs/architecture/authentication-middleware-ordering.md`  
**Related Files**: `server.js`, `srv/auth/localTokenUtil.js`  
**Finding Reference**: DEBT-02 (Review duplicate authentication middleware responsibilities)  
**Status**: Accepted Architectural Baseline  
**Date**: 2026-11-19  

---

## 1. Overview & Context

In this enterprise SAP S/4HANA Full-Stack Cloud Application Programming (CAP) application, local development security emulates SAP BTP XSUAA authentication using signed JWT Bearer tokens carrying standard `$XSAPPNAME.<Role>` scopes (`srv/auth/localTokenUtil.js`).

During architectural audit of `server.js`, it was observed that `localTokenUtil.applyBearerToken` is registered at two distinct middleware attachment points:
1. **Express Bootstrap Layer** (Line 96): `app.use(localTokenUtil.applyBearerToken)` inside `cds.on('bootstrap', (app) => { ... })`.
2. **CAP Protocol Middleware Chain** (Line 148): `cds.middlewares.add(localTokenUtil.applyBearerToken, { before: 'auth' })`.

This document records:
- The architectural reason both registration boundaries are required.
- The precise request execution order across Express and CAP layers.
- The elimination of redundant cryptographic verification (HMAC SHA-256) via request-scoped caching.
- Proof that identity consistency is preserved without regression.

---

## 2. Middleware Execution Ordering

```mermaid
sequenceDiagram
    autonumber
    actor Client as HTTP Client (Browser / Tool)
    participant Exp as Express Pipeline (server.js bootstrap)
    participant Custom as Custom Routes (/ai/chat/stream, /health)
    participant CAPMid as CAP Middleware Chain (cds.middlewares)
    participant OData as CAP OData Handlers (/odata/v4/...)

    Client->>Exp: HTTP Request with Authorization: Bearer <token>
    Note over Exp: Boundary 1: Express Bootstrap Layer
    Exp->>Exp: applyBearerToken() (1st execution)
    Note over Exp: Verifies token signature & attaches req.user (caches token string)
    
    alt Custom Express Route (/ai/chat/stream, /admin/diagnostics/sap)
        Exp->>Custom: Handled directly by Express router
        Note over Custom: Accesses verified req.user; returns response
        Custom-->>Client: HTTP Response
    else CAP OData Route (/odata/v4/...)
        Exp->>CAPMid: Passes to CAP Protocol Adapter
        Note over CAPMid: Boundary 2: CAP Middleware Chain (before: 'auth')
        CAPMid->>CAPMid: applyBearerToken() (2nd execution)
        Note over CAPMid: O(1) Cache Hit! Reuses req.user; syncs cds.context.user
        CAPMid->>CAPMid: CAP built-in auth middleware (evaluates @requires)
        CAPMid->>OData: Service Event Handlers (srv.before, srv.on)
        Note over OData: cds.on('serving') context inheritance active
        OData-->>Client: HTTP OData Response
    end
```

---

## 3. Boundary Responsibilities: Why Both Registrations Are Required

Removing either registration causes critical security or functionality regressions:

### Boundary 1: Express Bootstrap Layer (`app.use`)
- **Attachment Point**: Registered on the root Express `app` during `cds.on('bootstrap')`.
- **Scope**: All HTTP traffic entering the Node.js server.
- **Why Required**: Custom endpoints registered directly on Express run **outside** the CAP OData dispatcher and bypass `cds.middlewares`. Examples include:
  * `/ai/chat/stream` (AI assistant server-sent events streaming handler).
  * `/admin/diagnostics/sap` (Separately controlled read-only integration diagnostic endpoint).
  * `/sap/bc/lrep/flex/...` (UI5 layered repository flexibility handlers).
- **Consequence of Removal**: If Boundary 1 were removed, all custom Express endpoints would receive an unauthenticated request with `req.user = undefined`, breaking AI streaming and diagnostic authorization.

### Boundary 2: CAP Middleware Chain (`cds.middlewares.add(..., { before: 'auth' })`)
- **Attachment Point**: Registered into CAP's internal protocol pipeline via `cds.middlewares.add` targeting `{ before: 'auth' }`.
- **Scope**: All CAP OData V4 services (`/odata/v4/...`).
- **Why Required**: In `@sap/cds` (versions 7, 8, and 10), the CAP protocol adapter initializes its own execution context (`cds.context`). CAP's internal `auth` middleware inspects `req.user` to populate `cds.context.user` and evaluate declarative authorization annotations (`@(requires: 'Admin')`, `@(requires: 'PurchasingManager')`).
- **Consequence of Removal**: In certain CAP execution paths or test environments where Express middlewares run before CAP context initialization, omitting Boundary 2 risks CAP resetting `req.user` to anonymous mock auth, leading to unexpected HTTP 403 Forbidden or 401 Unauthorized errors on OData services.

---

## 4. Elimination of Duplicate Verification (Idempotent Request Caching)

While both boundaries are structurally necessary, invoking the full verification logic twice on every OData request introduced:
1. **Redundant Cryptographic Computations**: Generating the HMAC SHA-256 signature twice per request.
2. **Duplicate Allocations**: Creating multiple `new cds.User(...)` instances and decoding Base64URL JSON twice.
3. **Risk of Identity Inconsistency**: If state or context drifted between the two boundaries, the user identity could diverge.

### The Solution: Request-Scoped Idempotent Verification

`srv/auth/localTokenUtil.js` implements request-scoped token caching:

```javascript
function applyBearerToken(req, res, next) {
    const [, token] = /^bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [];
    if (!token) {
        return next();
    }

    // 1. Check if this exact Bearer token was already verified on this request
    let user;
    if (req._verifiedBearerToken === token && req.user && !req.user._is_anonymous) {
        user = req.user; // O(1) Cache Hit: Zero HMAC calculation
    } else {
        user = verifyToken(token); // 1st invocation: Full cryptographic verification
        if (user) {
            req._verifiedBearerToken = token;
            req.user = user;
        }
    }

    // 2. Ensure CAP execution context inherits the identical verified user
    if (user && cds.context) {
        cds.context.user = user;
    }

    next();
}
```

### Invariants Guaranteed
1. **Exact-Reference Identity Sharing**: On Boundary 2, `req.user` is preserved and shared by reference. `user === req.user` is unconditionally true.
2. **Single Signature Computation**: The HMAC SHA-256 calculation executes exactly once per HTTP request.
3. **Automatic Cache Invalidation**: If the `Authorization` header is mutated or a different token is presented, `req._verifiedBearerToken !== token`, forcing re-verification.
4. **Context Synchronization**: Whether `cds.context` is initialized before Boundary 1, between boundaries, or in Boundary 2, `cds.context.user` is guaranteed to match `req.user`.

---

## 5. Controlled Regression Testing & Verification

A dedicated unit test suite (`test/unit/auth/authMiddlewareOrdering.test.js`) validates:
1. **Dual-Boundary Idempotency**: Simulates Express layer invocation followed by CAP OData middleware invocation; asserts `verifyToken` executes once and `req.user` reference is identical.
2. **Context Synchronization**: Confirms `cds.context.user` receives the exact same user object.
3. **Invalid Token Safety**: Confirms invalid or expired tokens do not get cached and reject consistently.
4. **Token Mutation Handling**: Confirms that changing the token on a request triggers clean re-verification without stale cache leaks.
5. **Route Parity**: Confirms both Express routes and OData routes receive identical roles and user attributes.
