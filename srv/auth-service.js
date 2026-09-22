const cds = require("@sap/cds");
const authAdapter = require("./integration/s4hana/AuthAdapter");
const localTokenUtil = require("./auth/localTokenUtil");
const { resolveUserIdentity } = require("./auth/userIdentity");
const s4Config = require("./common/s4Config");

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

    const sEnvDevUser = (process.env.S4_USERNAME || "").trim().toLowerCase();
    // Local mock passwords exist only when LOCAL_DEV_PASSWORD is set; a username is never a password.
    const sLocalDevPass = (process.env.LOCAL_DEV_PASSWORD || "").trim();

    let authResult;
    const isMockOnlyUser = sUserLower === "alice" || sUserLower === "bob";
    const isKhushalUser = sUserLower === "khushal";

    if (isMockOnlyUser) {
      if (!sLocalDevPass) {
        return {
          authenticated: false,
          message: "Local mock users are disabled: set LOCAL_DEV_PASSWORD to enable them."
        };
      }
      const isMatch = localTokenUtil.timingSafeEqual(sPass.toLowerCase(), sLocalDevPass.toLowerCase());
      if (isMatch) {
        authResult = {
          authenticated: true,
          message: "Authentication successful (Local Development User).",
          system: s4Config.getSystemLabel()
        };
      } else {
        authResult = {
          authenticated: false,
          message: "Invalid username or password."
        };
      }
    } else if (isKhushalUser) {
      // Allow 'khushal' with the local mock password (LOCAL_DEV_PASSWORD, if set),
      // or with real S/4 credentials (S4_PASSWORD or S/4 Gateway)
      const sEnvDevPass = (process.env.S4_PASSWORD || "").trim();
      if (sLocalDevPass && localTokenUtil.timingSafeEqual(sPass.toLowerCase(), sLocalDevPass.toLowerCase())) {
        authResult = {
          authenticated: true,
          message: "Authentication successful (Local Development User).",
          system: s4Config.getSystemLabel()
        };
      } else if (sEnvDevPass && localTokenUtil.timingSafeEqual(sPass, sEnvDevPass)) {
        authResult = {
          authenticated: true,
          message: "Authentication successful (S/4 Development User).",
          system: s4Config.getSystemLabel()
        };
      } else {
        authResult = await authAdapter.validateCredentials(username, password);
      }
    } else if (sEnvDevUser && sUserLower === sEnvDevUser) {
      const sEnvDevPass = (process.env.S4_PASSWORD || "").trim();
      if (sEnvDevPass && localTokenUtil.timingSafeEqual(sPass, sEnvDevPass)) {
        authResult = {
          authenticated: true,
          message: "Authentication successful (S/4 Development User).",
          system: s4Config.getSystemLabel()
        };
      } else {
        // Validate against S/4 Gateway if local password doesn't match
        authResult = await authAdapter.validateCredentials(username, password);
      }
    } else {
      authResult = await authAdapter.validateCredentials(username, password);
    }

    if (!authResult.authenticated) {
      return {
        authenticated: false,
        message: authResult.message || "Invalid username or password."
      };
    }

    const sCapitalized = sUser.charAt(0).toUpperCase() + sUser.slice(1);
    const sInitials = sCapitalized.substring(0, 2).toUpperCase();
    const sTimestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const configuredUsers = cds.env?.requires?.auth?.users || {};
    const extractRoles = (userConfig) => {
      if (!userConfig || !userConfig.roles) return null;
      if (Array.isArray(userConfig.roles)) return userConfig.roles;
      if (typeof userConfig.roles === 'object') return Object.keys(userConfig.roles).filter(k => userConfig.roles[k]);
      if (typeof userConfig.roles === 'string') return [userConfig.roles];
      return null;
    };
    let devRoles = extractRoles(configuredUsers[sUserLower]) || extractRoles(configuredUsers[sUser]);
    if (!devRoles || devRoles.length === 0) {
      // Roles come only from cds.requires.auth.users; nothing is granted implicitly.
      devRoles = ["Viewer"];
    }
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
