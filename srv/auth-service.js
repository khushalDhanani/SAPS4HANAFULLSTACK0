const cds = require("@sap/cds");
const authAdapter = require("./integration/s4hana/AuthAdapter");
const localTokenUtil = require("./auth/localTokenUtil");
const { resolveUserIdentity } = require("./auth/userIdentity");
const s4Config = require("./common/s4Config");
const loginThrottle = require("./auth/loginThrottle");
const { resolveAppUser, isAllowAnySapUser, getExplicitAppUserRoles } = require("./auth/appUsers");
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
  async init() {
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
    const sLocalDevPass = (process.env.LOCAL_DEV_PASSWORD || "").trim();
    const sClientIp = req.http?.req?.ip || req._?.req?.ip || "";
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

    let authResult;
    let devRoles;

    if (process.env.APP_ROLE === "cap-local") {
      // The isolated Docker profile has no SAP connectivity or SAP credentials.
      devRoles = resolveAppUser(sUser, cds.env?.requires?.auth);
      if (!devRoles || !sLocalDevPass || !localTokenUtil.timingSafeEqual(sPass, sLocalDevPass)) {
        return failed("Invalid local credentials. Use a whitelisted user and the configured LOCAL_DEV_PASSWORD.");
      }
      authResult = {
        authenticated: true,
        message: "Authentication successful (local development).",
        system: s4Config.getSystemLabel()
      };
    } else {
      // Look up explicit sources first (APP_USER_ROLES > APP_USERS_FILE > cds.requires.auth.users).
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
        LOG.info(`login: ${sUserLower} not in explicit user source; roles assigned via SAP mapping / defaults`);
      } else if (sLocalDevPass && localTokenUtil.timingSafeEqual(sPass, sLocalDevPass)) {
        // A whitelisted user authenticated by LOCAL_DEV_PASSWORD (bypasses SAP for dev convenience).
        authResult = {
          authenticated: true,
          message: "Authentication successful (local development).",
          system: s4Config.getSystemLabel()
        };
      } else {
        // SAP checks the password. The connection password (S4_PASSWORD) is never a login password.
        authResult = await authAdapter.validateCredentials(username, password);
        if (authResult.authenticated) {
          // Explicit entries in APP_USER_ROLES / APP_USERS_FILE still override.
          const explicit = getExplicitAppUserRoles(sUser, process.env);
          if (explicit && explicit.length) {
            devRoles = explicit;
          } else {
            // Listed user without explicit APP_USER_ROLES / APP_USERS_FILE override: map from SAP!
            devRoles = await fetchAndMapRoles(sUser, this._fetchDetail, process.env);
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

    const tokenObj = localTokenUtil.issueToken(sUser, devRoles);

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
