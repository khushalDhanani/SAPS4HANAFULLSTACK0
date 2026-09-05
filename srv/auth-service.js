const cds = require("@sap/cds");
const authAdapter = require("./integration/s4hana/AuthAdapter");

/**
 * CAP Authentication Service Handler
 *
 * Validates user credentials against S/4HANA Gateway via AuthAdapter
 * in srv/integration/s4hana/.
 */
module.exports = class AuthServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("login", this._handleLogin.bind(this));
    await super.init();
  }

  async _handleLogin(req) {
    const { username, password } = req.data || {};

    const authResult = await authAdapter.validateCredentials(username, password);
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

    return {
      authenticated: true,
      message: authResult.message || "Authentication successful.",
      username: sUser,
      avatarInitials: sInitials,
      system: authResult.system || "PRD",
      loginTimestamp: sTimestamp,
    };
  }
};
