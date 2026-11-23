# Frontend Authentication Storage Security Architecture

## 1. Executive Summary & Objective

This document specifies the authoritative frontend authentication storage and token security architecture for the SAP S/4HANA Full-Stack application (`app/fiori-app`). It addresses **Finding UI-02 (P2 / SEC-02 frontend manifestation)**:

> **Finding UI-02**: Review persistent browser token storage. Treat authentication storage as part of the frontend security design, not just a login implementation detail.

In enterprise logistics and supply-chain environments, user workstations and mobile terminals present unique physical and operational security profiles:
- **Shared Warehouse Kiosks & Ruggedized Terminals**: RF scanning guns, forklift-mounted touchscreens, and packing stations are used sequentially by multiple operators across changing shifts.
- **Client Disk Exposure**: Web browser persistent storage (`localStorage`, `indexedDB`, WebSQL) writes unencrypted data directly to the workstation filesystem, where it persists indefinitely across browser restarts, user logouts (if unmanaged), and shift handovers.
- **XSS & Extension Blast Radius**: Any third-party script, injected XSS payload, or malicious browser extension running in the origin can read arbitrary items in `localStorage`. If sensitive Bearer tokens reside on disk, token theft allows persistent session hijacking long after the user leaves the physical workstation.

Therefore, authentication storage is **not** an ad-hoc login implementation detail. It is a formal architectural boundary governing data classification, storage tiering, token lifetime, and automatic disk sanitization.

---

## 2. Dual Deployment Authentication Architecture

The application operates in two distinct runtime topologies, each with strict authentication transport boundaries:

```
+-----------------------------------------------------------------------------------------+
|                                    DEPLOYED TOPOLOGY                                    |
|                                                                                         |
|  [ Browser Client ] -------- HTTPS (Same-Origin) --------> [ SAP BTP Approuter ]        |
|     (No JS Token)           Cookie: <HttpOnly, Secure>          | (XSUAA OAuth2)        |
|                                                                 v                       |
|                                                      [ CAP Backend Services ]           |
|                                                                                         |
+-----------------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------------+
|                                  STANDALONE / LOCAL DEV                                 |
|                                                                                         |
|  [ Browser Client ] --- Authorization: Bearer <JWT> ----> [ CAP Backend (server.js) ]  |
|  (Volatile Session)                                      [ localTokenUtil ]             |
|                                                                                         |
+-----------------------------------------------------------------------------------------+
```

### 2.1 Production Mode: SAP BTP Approuter / XSUAA (Zero-Token Storage)
In deployed Cloud Foundry environments, authentication is managed by the SAP BTP Approuter and XSUAA:
- Authentication state is maintained via **`HttpOnly`**, **`Secure`**, **`SameSite=Lax/Strict`** session cookies issued by Approuter.
- Frontend JavaScript does **not** have access to the session cookie (`document.cookie` cannot read `HttpOnly` cookies).
- When `AuthService.fetchCurrentUserInfo()` queries `/odata/v4/auth/getUserInfo()`, the backend returns `{ authenticated: true, username: "...", token: null }`.
- Transport uses standard `credentials: "same-origin"` (`fetch` in `ODataClient`).
- **Invariant**: In production, zero Bearer tokens exist in frontend JavaScript memory or browser storage.

### 2.2 Standalone / Local Development Mode (Volatile Bearer Token)
In local development or standalone testing environments:
- The developer logs in via `/odata/v4/auth/login` (`AuthService.login()`).
- The backend generates a signed HMAC-SHA256 development JWT via `localTokenUtil`.
- The token is transmitted in the response payload.
- Frontend services (`ODataClient`, UI5 OData V4 models via `changeHttpHeaders`) must inject `Authorization: Bearer <token>` into outgoing HTTP requests.
- **Security Requirement**: Because a Bearer token is present in client JavaScript, storage of that token must be strictly bounded by lifetime and storage tier.

---

## 3. Browser Storage Tiering & Data Classification

To eliminate token persistence risks while maintaining enterprise user experience, data is classified into three strict tiers:

| Storage Tier | Technology | Lifetime | Scope | Disk Persistence | Allowed Data Classes | Forbidden Data Classes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 0: Runtime RAM** | JavaScript Heap (`AuthService._oModel`, `AuthStorage`) | Single page lifecycle; cleared on refresh/navigation | Current execution context | **None** (RAM only) | Active user object, decoded roles/scopes, in-flight token | Unvalidated input |
| **Tier 1: Volatile Session** | `sessionStorage` (`saps4hana_fiori_auth_session`) | Current tab/window session; **automatically wiped** when tab or browser window closes | Single browser tab / window | **None** (in-memory per tab; not shared across tabs) | Ephemeral session payload, active Bearer token, session timestamp | Persistent identity, cross-tab state |
| **Tier 2: Persistent Disk** | `localStorage` (`saps4hana_fiori_remember_user`) | Indefinite; survives browser restart and system reboot | Shared across all tabs of the origin | **Yes** (written to disk) | Non-sensitive UI preference: plain `username` string hint (ONLY when opted-in) | **Bearer tokens, passwords, session objects, sensitive payloads** |

### 3.1 The "Remember Me" Security Distinction
In legacy implementations, selecting "Remember Me" frequently persisted the full session token to `localStorage`, allowing anyone with access to the machine to impersonate the user days or weeks later.

Under this security architecture:
- **"Remember Me" = Identity Hint Only**: Persists strictly the non-sensitive username string (`saps4hana_fiori_remember_user`) in `localStorage`.
- **Bearer Tokens Never Persist**: The session token is **always** written strictly to `sessionStorage` regardless of whether "Remember Me" is checked or unchecked.
- When "Remember Me" is unchecked, `localStorage.removeItem("saps4hana_fiori_remember_user")` is immediately executed.

---

## 4. Threat Modeling & Security Invariants

### 4.1 Threat 1: Shared Workstation / Kiosk Session Hijacking
- **Attack Scenario**: Operator A finishes shift at packing station W01 and closes browser window without clicking logout. Operator B opens browser 10 minutes later.
- **Mitigation**: Active session tokens reside strictly in `sessionStorage`. Closing the tab/window instantly destroys the session token. Operator B opening a new tab receives a clean login screen pre-filled only with the username hint (if remembered), requiring re-authentication.

### 4.2 Threat 2: Persistent Token Exfiltration via XSS or Rogue Extension
- **Attack Scenario**: An attacker exploits a DOM-based injection or malicious browser extension to read `window.localStorage`.
- **Mitigation**: `localStorage` contains zero tokens and zero credential payloads. Even with full `localStorage` exfiltration, the attacker only acquires non-sensitive UI preferences and an identity hint.

### 4.3 Threat 3: Legacy Token Migration & Disk Sanitization
- **Attack Scenario**: A user previously logged in using an older release that stored session tokens in `localStorage`.
- **Mitigation**: `AuthStorage.loadSession()` and `AuthStorage.sanitizeLocalStorage()` implement an automatic migration and immediate purge guard:
  ```javascript
  if (oLocalStorage.getItem(STORAGE_KEY)) {
      if (!sRawSession) {
          oSessionStorage.setItem(STORAGE_KEY, sLegacySession);
      }
      oLocalStorage.removeItem(STORAGE_KEY); // Purged from disk immediately
  }
  ```
  Any legacy token on disk is promoted to active `sessionStorage` for the current tab and erased from disk on the very first read.

### 4.4 Threat 4: Stale / Expired Token Replay
- **Attack Scenario**: A browser tab remains open overnight. An operation is triggered with an expired Bearer token, causing unhandled 401 exceptions or corrupting transactional state.
- **Mitigation**: `AuthStorage.isTokenExpired()` decodes the JWT base64 payload and checks the `exp` claim against current epoch seconds. If expired, `loadSession()` automatically purges the storage and returns `null`, causing the router to redirect to `#/login` cleanly.

### 4.5 Threat 5: Private Browsing Mode & Blocked Storage Quotas
- **Attack Scenario**: A user runs in Safari Private Browsing mode or an environment where `localStorage`/`sessionStorage` throws `SecurityError` / `QuotaExceededError`.
- **Mitigation**: All storage interactions in `AuthStorage` are wrapped in defensive `try/catch` guards. If browser storage is disabled or blocked, the application degrades gracefully to Tier 0 (In-Memory RAM) without throwing unhandled exceptions.

---

## 5. Modular Architecture: `AuthStorage` Contract

Storage management is encapsulated in `app/fiori-app/webapp/service/AuthStorage.js`. Neither `AuthService.js` nor `ODataClient.js` interacts directly with raw storage APIs or magic key strings.

```
+-----------------------------------------------------------------------------+
|                               UI Controllers                                |
|                        (Login, Dashboard, MIB, etc.)                        |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                     saps4hana.fiori.service.AuthService                     |
|  - Manages JSONModel auth state (/isAuthenticated, /user, /rememberMe)      |
|  - Role / Scope evaluation (hasAnyRole, canCreateDelivery)                   |
|  - UI5 V4 model header synchronization (syncModelHeaders)                   |
+-----------------------------------------------------------------------------+
                       |                               |
                       v                               v
+-------------------------------+       +-------------------------------------+
|          ODataClient          |       |             AuthStorage             |
|  - CSRF acquisition & refresh | ----> |  - Encapsulated STORAGE_KEY &       |
|  - Automatic request retry    |       |    REMEMBER_KEY                     |
|  - Bearer header injection    |       |  - Volatile sessionStorage writes   |
|  - 401 unauth session wipe    |       |  - Disk localStorage sanitization   |
+-------------------------------+       |  - JWT expiration validation        |
                                        |  - Private browsing error handling  |
                                        +-------------------------------------+
```

### 5.1 Public Interface of `AuthStorage`

```typescript
interface IAuthStorage {
    STORAGE_KEY: string;      // "saps4hana_fiori_auth_session"
    REMEMBER_KEY: string;     // "saps4hana_fiori_remember_user"

    // Session Management
    saveSession(userSession: object): boolean;
    loadSession(): object | null;
    clearSession(): void;

    // Token & Header Resolution
    getToken(): string | null;
    getAuthHeader(): { Authorization?: string };
    isTokenExpired(token: string): boolean;

    // Remember Me (Identity Hint)
    saveRememberUsername(username: string): void;
    getRememberUsername(): string;
    clearRememberUsername(): void;

    // Disk Sanitization
    sanitizeLocalStorage(): boolean;
}
```

---

## 6. Verification & Automated Test Coverage

Compliance with this security architecture is enforced by dedicated unit and integration suites:

1. **`test/unit/auth/authStorage.test.js`** (NEW):
   - Direct unit testing of `AuthStorage` methods in isolation.
   - Verifies `saveSession` writes exclusively to `sessionStorage` and cleans `localStorage`.
   - Verifies `loadSession` rejects expired tokens and sanitizes legacy disk sessions.
   - Verifies `saveRememberUsername` and `clearRememberUsername` handle non-sensitive strings without touching tokens.
   - Verifies private browsing / throwing storage exceptions degrade safely.

2. **`test/unit/auth/frontendAuthStorage.test.js`**:
   - Integration testing across `AuthService`, `ODataClient`, and `AuthStorage`.
   - Tests login with `rememberMe: true` and `rememberMe: false`.
   - Tests session restore, token retrieval fallback, clean logout, and ODataClient `authHeaders()` resolution.

3. **Playwright Browser E2E Suite (`test/e2e/wm/verifyMibLabels.e2e.js`, `test/e2e/support/screenCheck.js`)**:
   - Tests run in real Chromium instances behind `test/e2e/support/writeGuard.js`.
   - Verifies session tokens in `sessionStorage` provide authenticated access to all protected screens without writing tokens to disk.
