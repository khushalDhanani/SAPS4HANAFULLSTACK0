/**
 * s4Config.js
 * Environment configuration module for S/4HANA connectivity.
 *
 * Scope: system identity, destination, client (SAP Mandant).
 * These are connection/infrastructure values that come from BTP service bindings
 * or the operator's environment — never from business documents or admin tables.
 *
 * Business-data (salesOrganization, distributionChannel, division, currency,
 * inquiryType, orderType, conditionType, shippingPoints, salesMaterialTypes,
 * mvt261NotReadyBins, plant, storageLocation) are NOT here.
 * Use BusinessConfigResolver to resolve them per request context.
 *
 * Resolution order:
 *   1. cds.env.s4.<key>  (set by BTP service bindings or CDS_S4_* env vars)
 *   2. process.env S4_* / CDS_S4_* fallback
 *   3. ConfigurationError — never falls back to a hardcoded default
 */

'use strict';

let cds;
try {
  cds = require('@sap/cds');
} catch (_) {
  cds = { env: {} };
}

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

class S4Config {
  /**
   * Access the active cds.env object dynamically to support runtime and test updates.
   */
  get env() {
    return (cds && cds.env) ? cds.env : {};
  }

  /**
   * Retrieves a raw value from cds.env.s4 / cds.env.s4hana, then falls back to
   * the listed process.env variable names.
   * @private
   */
  _getRaw(key, envVars = []) {
    const s4Section = (this.env.s4 || this.env.s4hana) || {};
    let val = s4Section[key];

    if (val === undefined || val === null || val === '') {
      for (const envName of envVars) {
        if (process.env[envName] !== undefined && process.env[envName] !== '') {
          val = process.env[envName];
          break;
        }
      }
    }

    return val;
  }

  /**
   * Retrieves a non-empty string or throws ConfigurationError.
   * @private
   */
  _requireString(key, envVars = []) {
    const val = this._getRaw(key, envVars);
    if (val === undefined || val === null || String(val).trim() === '') {
      const candidates = [`cds.s4.${key}`, ...envVars].join(' / ');
      throw new ConfigurationError(
        `Missing required S/4HANA connectivity configuration: ${key}. ` +
        `Set it via BTP service binding or environment variable (${candidates}).`
      );
    }
    return String(val).trim();
  }

  // ─── System Identity ────────────────────────────────────────────────────────

  /** S/4 System Name (e.g. 'DEV', 'PRD') */
  getSystemName() {
    const val = this._getRaw('systemName', ['CDS_S4_SYSTEM_NAME', 'S4_SYSTEM_NAME']);
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
    return process.env.NODE_ENV === 'production' ? 'PRD' : 'DEV';
  }

  /**
   * Builds the formatted system label: `${systemName} - Client ${client}`.
   * @param {string} [clientOverride]
   * @param {string} [systemNameOverride]
   */
  getSystemLabel(clientOverride, systemNameOverride) {
    const systemName = (systemNameOverride && String(systemNameOverride).trim()) || this.getSystemName();
    let client = clientOverride;
    if (!client) {
      try { client = this.getClient(); } catch (_) { /* label without client */ }
    }
    if (client && String(client).trim() !== '') {
      return `${systemName} - Client ${String(client).trim()}`;
    }
    return systemName;
  }

  // ─── Connectivity ────────────────────────────────────────────────────────────

  /** SAP Client / Mandant (e.g. '220') */
  getClient() {
    return this._requireString('client', ['CDS_S4_CLIENT', 'S4_CLIENT']);
  }

  // ─── Feature flags that are truly env-config (not business data) ─────────────

  /** SAP-side reservation lock via Z_WM_RES_LOCK. OFF unless explicitly 'true'/'X'. */
  getResLockEnabled() {
    const v = this._getRaw('resLockEnabled', ['CDS_S4_RES_LOCK_ENABLED', 'S4_RES_LOCK_ENABLED']);
    return v === true || ['TRUE', 'X'].includes(String(v ?? '').trim().toUpperCase());
  }

  // ─── Property aliases ─────────────────────────────────────────────────────────

  get systemName()  { return this.getSystemName(); }
  get systemLabel() { return this.getSystemLabel(); }
  get client()      { return this.getClient(); }
  get resLockEnabled() { return this.getResLockEnabled(); }

  // ─── Snapshot / validation ────────────────────────────────────────────────────

  /**
   * Returns the connectivity config snapshot (client only — system name has a safe default).
   * Throws ConfigurationError if the SAP client is missing.
   */
  getAll() {
    return {
      systemName: this.getSystemName(),
      client:     this.getClient()
    };
  }

  /** Validates connectivity config. Throws ConfigurationError if the client is missing. */
  validate() {
    return this.getAll();
  }
}

const s4ConfigInstance = new S4Config();
s4ConfigInstance.S4Config = S4Config;
s4ConfigInstance.ConfigurationError = ConfigurationError;

module.exports = s4ConfigInstance;
