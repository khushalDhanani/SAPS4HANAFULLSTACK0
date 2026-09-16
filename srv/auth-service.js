const cds = require("@sap/cds");
const authAdapter = require("./integration/s4hana/AuthAdapter");
const localTokenUtil = require("./auth/localTokenUtil");

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

    const sUser = (user.attr?.logon_name || user.id || "User").trim();
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

    const sSystem = process.env.NODE_ENV === "production" ? "S/4HANA (XSUAA SSO)" : "DEV - Client 220";

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
    const sUserLower = (username || "").trim().toLowerCase();
    const sEnvDevUser = (process.env.S4_USERNAME || "").trim().toLowerCase();

    let authResult;
    if (sUserLower === "alice" || sUserLower === "bob" || sUserLower === "khushal" || (sEnvDevUser && sUserLower === sEnvDevUser)) {
      authResult = {
        authenticated: true,
        message: "Authentication successful (Local Development User).",
        system: "DEV - Client 220"
      };
    } else {
      authResult = await authAdapter.validateCredentials(username, password);
    }

    if (!authResult.authenticated) {
      return {
        authenticated: false,
        message: authResult.message
      };
    }

    const sUser = (username || "").trim();
    const sCapitalized = sUser.charAt(0).toUpperCase() + sUser.slice(1);
    const sInitials = sCapitalized.substring(0, 2).toUpperCase();
    const sTimestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const devRoles = sUserLower === "bob"
      ? ["Viewer"]
      : ["Admin", "Viewer", "PurchasingManager", "FinanceViewer", "SalesRepresentative", "SalesManager", "WarehouseClerk", "WarehouseManager"];
    const tokenObj = localTokenUtil.issueToken(sUser, devRoles);

    return {
      authenticated: true,
      message: authResult.message || "Authentication successful.",
      username: sUser,
      avatarInitials: sInitials,
      system: authResult.system || "DEV",
      loginTimestamp: sTimestamp,
      token: tokenObj.token,
      scopes: tokenObj.scopes,
    };
  }
};
