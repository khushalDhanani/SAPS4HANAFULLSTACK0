const cds = require("@sap/cds");
const fs = require("fs");
const path = require("path");

// Load .env.local into process.env (CAP auto-loads .env but not .env.local)
(function loadEnvLocal() {
  try {
    const envPath = path.resolve(cds.root || process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          // Only set if not already present in environment
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (e) {
    // Silently ignore — deployed environments use BTP service bindings
  }
})();

/**
 * CAP Authentication Service Handler
 *
 * Validates user credentials against the actual S/4HANA Gateway system.
 * The frontend sends credentials here; this handler performs a safe read-only
 * HTTP Basic auth request to the S/4 Gateway to verify them.
 *
 * Environment variables used (from .env.local):
 *   S4_DESTINATION_URL  — e.g. http://172.27.100.32:8000
 *   S4_CLIENT           — e.g. 220
 */
module.exports = class AuthServiceHandler extends cds.ApplicationService {
  async init() {
    this.on("login", this._handleLogin.bind(this));
    await super.init();
  }

  async _handleLogin(req) {
    const { username, password } = req.data;

    // Validate required fields
    if (!username || !username.trim()) {
      return req.reject(400, "Username is required.");
    }
    if (!password || !password.trim()) {
      return req.reject(400, "Password is required.");
    }

    const sUser = username.trim();
    const sPass = password.trim();

    // Read S/4HANA connection from environment
    const sDestUrl = process.env.S4_DESTINATION_URL;
    const sClient = process.env.S4_CLIENT || "220";

    if (!sDestUrl) {
      console.error("[AuthService] S4_DESTINATION_URL is not configured.");
      return req.reject(
        500,
        "S/4HANA system is not configured. Contact your administrator."
      );
    }

    // Build a safe read-only validation URL against Gateway catalog
    const sValidationUrl =
      sDestUrl +
      "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$top=1&sap-client=" +
      sClient;

    let response;
    try {
      // Use native fetch (Node 18+) to validate Basic auth against S/4
      const sAuthHeader =
        "Basic " + Buffer.from(sUser + ":" + sPass).toString("base64");

      response = await fetch(sValidationUrl, {
        method: "GET",
        headers: {
          Authorization: sAuthHeader,
          Accept: "application/json",
        },
      });
    } catch (err) {
      // Network-level errors (DNS, connection refused, timeout, etc.)
      console.error("[AuthService] S/4HANA connection error:", err.message);
      return req.reject(
        503,
        "Cannot connect to S/4HANA system. Please check network connectivity and try again."
      );
    }

    // Handle the S/4HANA response outside try-catch so req.reject doesn't get re-caught
    if (response.ok) {
      // Credentials are valid — S/4HANA accepted the Basic auth
      const sCapitalized =
        sUser.charAt(0).toUpperCase() + sUser.slice(1);
      const sInitials = sCapitalized.substring(0, 2).toUpperCase();
      const sTimestamp = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      return {
        authenticated: true,
        username: sUser,
        avatarInitials: sInitials,
        system: "PRD - Client " + sClient,
        loginTimestamp: sTimestamp,
      };
    } else if (response.status === 401 || response.status === 403) {
      return req.reject(
        401,
        "Invalid username or password. Please verify your S/4HANA credentials."
      );
    } else {
      console.error(
        "[AuthService] Unexpected S/4 response: " + response.status
      );
      return req.reject(
        502,
        "S/4HANA system returned an unexpected response (HTTP " +
          response.status +
          "). Please try again."
      );
    }
  }
};

