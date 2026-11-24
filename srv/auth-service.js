const cds = require("@sap/cds");
const authAdapter = require("./integration/s4hana/AuthAdapter");
const localTokenUtil = require("./auth/localTokenUtil");
const { resolveUserIdentity } = require("./auth/userIdentity");
const s4Config = require("./common/s4Config");
const loginThrottle = require("./auth/loginThrottle");
const {
  resolveAppUser, isAllowAnySapUser, getExplicitAppUserRoles, holdsConfiguredAdmin,
  parseAppUserRoles, parseAdminUsers, loadUsersFile
} = require("./auth/appUsers");
const { fetchAndMapRoles, createRfcFetchDetail } = require("./auth/sapRoleMapper");
const LOG = require("./common/logger")("auth");

/**
 * CAP Authentication Service Handler
 *
 * In deployed environments, authentication is managed exclusively via SAP BTP XSUAA SSO,
 * and user identity is read via getUserInfo().
 * Custom username/password login is strictly gated to local development when the dev issuer
 * is explicitly enabled via ENABLE_DEV_TOKEN_ISSUER=true and LOCAL_AUTH_SECRET.
 */
module.exports = class AuthServiceHandler extends cds.ApplicationService {
  /**
   * Configuration that cannot work as written, reported once at startup as warnings (never an error):
   *   - the SAP connection user (S4_USERNAME) named in APP_ADMIN_USERS or APP_USER_ROLES: the login action refuses
   *     that name in every branch, so the entry has no effect;
   *   - Admin listed in APP_USER_ROLES / APP_USERS_FILE for a user who is not in APP_ADMIN_USERS: Admin is given
   *     only through APP_ADMIN_USERS, so the entry grants nothing.
   * The messages name settings and user names, never a password.
   *
   * @param {NodeJS.ProcessEnv} [env]
   * @param {object} [fsImpl] - injectable fs for tests
   * @returns {string[]}
   */
  static startupWarnings(env = process.env, fsImpl) {
    const warnings = [];
    const admins = parseAdminUsers(env);
    let listed = new Map();
    try { listed = parseAppUserRoles(env); } catch (_) { /* reported by server.js at startup */ }
    let fromFile = new Map();
    try { fromFile = loadUsersFile(env, fsImpl); } catch (_) { /* reported by server.js at startup */ }

    const sConnUser = String(env.S4_USERNAME || "").trim().toLowerCase();
    if (sConnUser) {
      const where = [];
      if (admins.has(sConnUser)) where.push("APP_ADMIN_USERS");
      if (listed.has(sConnUser)) where.push("APP_USER_ROLES");
      if (where.length) {
        warnings.push(
          `The SAP connection user (S4_USERNAME) is named in ${where.join(" and ")}, but it can never sign in: ` +
          "the login action refuses its name. Use a technical SAP user for the connection, or name a personal user there."
        );
      }
    }

    for (const [setting, users] of [["APP_USER_ROLES", listed], ["APP_USERS_FILE", fromFile]]) {
      const ignored = [...users].filter(([name, roles]) => roles.includes("Admin") && !admins.has(name)).map(([name]) => name);
      if (ignored.length) {
        warnings.push(
          `${setting} lists Admin for ${ignored.length} user(s) not named in APP_ADMIN_USERS ` +
          `(${ignored.slice(0, 5).join(", ")}${ignored.length > 5 ? ", ..." : ""}): Admin is not granted. ` +
          "Add them to APP_ADMIN_USERS to make them administrators."
        );
      }
    }
    return warnings;
  }

  async init() {
    for (const sWarning of AuthServiceHandler.startupWarnings(process.env)) LOG.warn(sWarning);
    this._fetchDetail = createRfcFetchDetail(process.env);
    this.on("getUserInfo", this._handleGetUserInfo.bind(this));
    this.on("login", this._handleLogin.bind(this));
    await super.init();
  }

  async _handleGetUserInfo(req) {
    const user = req.user;
    if (!user || user._is_anonymous) {
      return {
        authenticated: false,
        message: "Unauthenticated",
        username: "",
        avatarInitials: "",
        system: "",
        loginTimestamp: "",
        token: null,
        scopes: []
      };
    }

    let sUser = "User";
    try {
      sUser = resolveUserIdentity(req) || "User";
    } catch (_) {
      sUser = (user.attr?.logon_name || user.id || "User").trim();
    }
    const sCapitalized = sUser.charAt(0).toUpperCase() + sUser.slice(1);
    const sInitials = sCapitalized.substring(0, 2).toUpperCase();
    const sTimestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    let aRoles = [];
    if (Array.isArray(user.roles)) {
      aRoles = user.roles;
    } else if (user.roles && typeof user.roles === "object") {
      aRoles = Object.keys(user.roles);
    }

    const sSystem = process.env.NODE_ENV === "production" ? "S/4HANA (XSUAA SSO)" : s4Config.getSystemLabel();

    return {
      authenticated: true,
      message: "Authenticated via XSUAA / SSO.",
      username: sUser,
      avatarInitials: sInitials,
      system: sSystem,
      loginTimestamp: sTimestamp,
      token: user.token || null,
      scopes: aRoles.map(r => r.startsWith("$XSAPPNAME.") ? r : `$XSAPPNAME.${r}`)
    };
  }

  async _handleLogin(req) {
    // Custom login is strictly disabled in deployed environments (production or without explicit dev token issuer)
    if (process.env.NODE_ENV === "production" || !localTokenUtil.isDevTokenIssuerEnabled()) {
      return req.error(
        403,
        "Custom username/password authentication is disabled in deployed environments. Authentication is enforced via SAP BTP XSUAA Single Sign-On."
      );
    }

    const { username, password } = req.data || {};
    const sUser = (username || "").trim();
    const sUserLower = sUser.toLowerCase();
    const sPass = (password || "").trim();

    if (!sUser) {
      return {
        authenticated: false,
        message: "Username is required."
      };
    }
    if (!sPass) {
      return {
        authenticated: false,
        message: "Password is required."
      };
    }

    // A local password exists only when LOCAL_DEV_PASSWORD is set; a username is never a password.
    // It is one shared password that skips the SAP check, so it works only on a development server
    // (NODE_ENV=development) or in the isolated Docker profile (APP_ROLE=cap-local), and never for a user who
    // is set up as an administrator (APP_ADMIN_USERS, or an Admin entry in any list): an administrator always
    // proves a password of their own to SAP.
    const bLocalPasswordAllowed = process.env.NODE_ENV === "development" || process.env.APP_ROLE === "cap-local";
    const sLocalDevPass = bLocalPasswordAllowed ? (process.env.LOCAL_DEV_PASSWORD || "").trim() : "";
    const bIsLocalDevPass = Boolean(sLocalDevPass) && localTokenUtil.timingSafeEqual(sPass, sLocalDevPass);
    const bConfiguredAdmin = holdsConfiguredAdmin(sUser, cds.env?.requires?.auth);
    const oHttpReq = req.http?.req || req._?.req;
    const sClientIp = oHttpReq?.ip || "";
    if (loginThrottle.proxyNotTrusted(oHttpReq)) {
      LOG.warn(
        "A sign-in request came through a reverse proxy (X-Forwarded-For) but TRUST_PROXY_HOPS is not set: all users " +
        "count as one address, so LOGIN_MAX_FAILURES_PER_IP failed sign-ins lock everybody out. " +
        "Set TRUST_PROXY_HOPS to the number of proxies in front of the app."
      );
    }
    const failed = (message) => {
      loginThrottle.recordFailure(sUser, sClientIp);
      return { authenticated: false, message };
    };

    // Before any credential check: a locked-out caller learns nothing and SAP sees no further logon attempt.
    const throttle = loginThrottle.check(sUser, sClientIp);
    if (!throttle.allowed) {
      LOG.warn(`login refused for ${sUserLower}: too many failed attempts`);
      return {
        authenticated: false,
        message: `Too many failed sign-in attempts. Try again in ${Math.max(1, Math.ceil(throttle.retryAfterSec / 60))} minute(s).`
      };
    }

    // The SAP connection user (S4_USERNAME / S4_PASSWORD) is the technical logon the app itself uses. It is never an
    // application user: its name and its password are refused here, ahead of every branch and before SAP is asked.
    const sConnUser = (process.env.S4_USERNAME || "").trim().toLowerCase();
    const sConnPass = (process.env.S4_PASSWORD || "").trim();
    if ((sConnUser && sUserLower === sConnUser) || (sConnPass && localTokenUtil.timingSafeEqual(sPass, sConnPass))) {
      LOG.warn(`login refused for ${sUserLower}: the name or the password of the SAP connection user was used`);
      return failed("Invalid username or password.");
    }

    let authResult;
    let devRoles;
    // Set when the roles were mapped from SAP at sign-in and are in no sign-in list: the token then records
    // that, so the per-request check (localTokenUtil.verifyToken) takes the roles from the token.
    let roleSource;

    if (process.env.APP_ROLE === "cap-local") {
      // The isolated Docker profile has no SAP connectivity or SAP credentials.
      devRoles = resolveAppUser(sUser, cds.env?.requires?.auth);
      if (!devRoles || !bIsLocalDevPass || bConfiguredAdmin) {
        if (devRoles && bIsLocalDevPass) LOG.warn(`login refused for ${sUserLower}: LOCAL_DEV_PASSWORD is not accepted for a user holding Admin`);
        return failed("Invalid local credentials. Use a whitelisted user without the Admin role and the configured LOCAL_DEV_PASSWORD.");
      }
      authResult = {
        authenticated: true,
        message: "Authentication successful (local development).",
        system: s4Config.getSystemLabel()
      };
    } else {
      // Role resolution once SAP has accepted the user's own password (docs/architecture/sign-in-and-roles.md):
      //   1. Admin only for a user named in APP_ADMIN_USERS;
      //   2. an override entry in APP_USER_ROLES / APP_USERS_FILE, when there is one;
      //   3. otherwise the user's SAP roles (ZAPP_<Role>, optional role-map.json);
      //   4. otherwise, or when SAP cannot be asked, APP_DEFAULT_ROLES.
      // A known user (any list, APP_ADMIN_USERS) may sign in whatever APP_ALLOW_ANY_SAP_USER says.
      devRoles = resolveAppUser(sUser, cds.env?.requires?.auth);

      if (!devRoles) {
        // When APP_ALLOW_ANY_SAP_USER=true, let SAP decide — read SAP roles or default
        if (!isAllowAnySapUser(process.env)) {
          return failed("Invalid username or password.");
        }
        // Validate against SAP first; if that fails, the user is simply refused.
        authResult = await authAdapter.validateCredentials(username, password);
        if (!authResult.authenticated) {
          const status = authResult.statusCode;
          if (!status || status === 401 || status === 403) loginThrottle.recordFailure(sUser, sClientIp);
          return { authenticated: false, message: authResult.message || "Invalid username or password." };
        }
        // SAP accepted the user; map roles via BAPI_USER_GET_DETAIL or fall back to default
        devRoles = await fetchAndMapRoles(sUser, this._fetchDetail, process.env);
        roleSource = localTokenUtil.ROLE_SOURCE_SAP;
        LOG.info(`login: ${sUserLower} not in explicit user source; roles assigned via SAP mapping / defaults`);
      } else if (bIsLocalDevPass) {
        // A whitelisted user authenticated by LOCAL_DEV_PASSWORD (bypasses SAP for dev convenience).
        if (bConfiguredAdmin) {
          // Not forwarded to SAP either: the shared password is not this user's SAP password.
          LOG.warn(`login refused for ${sUserLower}: LOCAL_DEV_PASSWORD is not accepted for a user holding Admin`);
          return failed("Invalid username or password.");
        }
        authResult = {
          authenticated: true,
          message: "Authentication successful (local development).",
          system: s4Config.getSystemLabel()
        };
      } else {
        // SAP checks the password. The connection password (S4_PASSWORD) was refused above.
        authResult = await authAdapter.validateCredentials(username, password);
        if (authResult.authenticated) {
          // Explicit entries in APP_USER_ROLES / APP_USERS_FILE still override.
          const explicit = getExplicitAppUserRoles(sUser, process.env);
          if (explicit && explicit.length) {
            devRoles = explicit;
          } else {
            // Listed user without explicit APP_USER_ROLES / APP_USERS_FILE override: map from SAP!
            devRoles = await fetchAndMapRoles(sUser, this._fetchDetail, process.env);
            roleSource = localTokenUtil.ROLE_SOURCE_SAP;
          }
        }
      }
    }

    if (!authResult.authenticated) {
      // Only a refused logon counts; SAP being unreachable or misconfigured is not a failed attempt.
      const status = authResult.statusCode;
      if (!status || status === 401 || status === 403) loginThrottle.recordFailure(sUser, sClientIp);
      return {
        authenticated: false,
        message: authResult.message || "Invalid username or password."
      };
    }
    loginThrottle.recordSuccess(sUser);

    const sCapitalized = sUser.charAt(0).toUpperCase() + sUser.slice(1);
    const sInitials = sCapitalized.substring(0, 2).toUpperCase();
    const sTimestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const tokenObj = localTokenUtil.issueToken(sUser, devRoles, roleSource ? { roleSource } : {});

    return {
      authenticated: true,
      message: authResult.message || "Authentication successful.",
      username: sUser,
      avatarInitials: sInitials,
      system: authResult.system || s4Config.getSystemLabel(),
      loginTimestamp: sTimestamp,
      token: tokenObj.token,
      scopes: tokenObj.scopes,
    };
  }
};
