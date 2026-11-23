'use strict';

const cds = require('@sap/cds');
const { SystemLogAdapter }       = require('../integration/s4hana/admin/SystemLogAdapter');
const { SecurityAuditLogAdapter } = require('../integration/s4hana/admin/SecurityAuditLogAdapter');
const LOG = require('../common/logger')('sap-logs-service');

/** Default and boundary constants. */
const DEFAULT_ROW_CAP          = 500;
const DEFAULT_MAX_SM21_HOURS   = 24;
const DEFAULT_MAX_SM20_HOURS   = 6;
const MIN_TOP = 1;

/** Tolerated clock skew for future 'to' checks (60 seconds). */
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Validate and normalise pagination/window parameters.
 * Rejects missing/invalid dates, reversed windows, spans exceeding config,
 * and 'toUtc' timestamps in the future.
 */
function validateWindow(req, fromUtc, toUtc, top, skip, maxSpanHours) {
  if (!fromUtc) return req.error(400, 'fromUtc is required');
  if (!toUtc)   return req.error(400, 'toUtc is required');

  const fromDate = new Date(fromUtc);
  const toDate   = new Date(toUtc);

  if (isNaN(fromDate.getTime())) return req.error(400, 'fromUtc is not a valid ISO date string');
  if (isNaN(toDate.getTime()))   return req.error(400, 'toUtc is not a valid ISO date string');
  if (fromDate >= toDate)        return req.error(400, 'fromUtc must be before toUtc');

  // Reject future 'to' timestamps (enforces fixed snapshot for pagination)
  if (toDate.getTime() > Date.now() + CLOCK_SKEW_TOLERANCE_MS) {
    return req.error(400, 'toUtc cannot be in the future');
  }

  const spanHours = (toDate - fromDate) / (1000 * 60 * 60);
  if (spanHours > maxSpanHours) {
    return req.error(400, `Time span exceeds the maximum of ${maxSpanHours} hours for this log. ` +
      `Requested span is ${spanHours.toFixed(2)} hours.`);
  }

  const rowCap = envInt('SAPLOGS_DEFAULT_ROW_CAP', DEFAULT_ROW_CAP);
  const topN   = typeof top  === 'number' ? Math.min(Math.max(top, MIN_TOP), rowCap) : rowCap;
  const skipN  = typeof skip === 'number' && skip > 0 ? Math.floor(skip) : 0;

  if (typeof top === 'number' && (top < MIN_TOP || top > rowCap)) {
    return req.error(400, `top must be between ${MIN_TOP} and ${rowCap}`);
  }

  return { fromDate, toDate, topN, skipN };
}

/**
 * Enforce SapLogsReader role at handler level (defense-in-depth alongside CDS @requires: 'SapLogsReader').
 */
function checkLogsReaderRole(req) {
  if (!req.user || !req.user.id || req.user.id === 'anonymous') {
    return req.reject(401, 'Authentication required');
  }
  if (typeof req.user.is === 'function' && !req.user.is('SapLogsReader') && !req.user.is('Admin')) {
    return req.reject(403, 'Forbidden: SapLogsReader role required');
  }
}

/**
 * SapLogsService Handler
 *
 * Implements getSystemLog (SM21) and getSecurityAuditLog (SM20).
 * Both functions are read-only and require the SapLogsReader role.
 */
module.exports = class SapLogsService extends cds.ApplicationService {
  async init() {
    this._syslogAdapter   = null;
    this._auditLogAdapter = null;

    this.on('getSystemLog',        this._handleGetSystemLog.bind(this));
    this.on('getSecurityAuditLog',  this._handleGetSecurityAuditLog.bind(this));

    return super.init();
  }

  _getSyslogAdapter() {
    if (!this._syslogAdapter) {
      this._syslogAdapter = new SystemLogAdapter();
    }
    return this._syslogAdapter;
  }

  _getAuditLogAdapter() {
    if (!this._auditLogAdapter) {
      this._auditLogAdapter = new SecurityAuditLogAdapter();
    }
    return this._auditLogAdapter;
  }

  // ---------------------------------------------------------------------------
  // SM21 — System Log
  // ---------------------------------------------------------------------------
  async _handleGetSystemLog(req) {
    if (checkLogsReaderRole(req)) return;

    const { fromUtc, toUtc, instance, top, skip } = req.data;
    const maxSpan = envInt('SAPLOGS_MAX_SPAN_SM21_HOURS', DEFAULT_MAX_SM21_HOURS);

    const validated = validateWindow(req, fromUtc, toUtc, top, skip, maxSpan);
    if (!validated) return;

    const { fromDate, toDate, topN, skipN } = validated;

    LOG.info('sap-logs access', {
      user: req.user && req.user.id ? req.user.id : '[unknown]',
      log:  'sm21',
      from: fromDate.toISOString(),
      to:   toDate.toISOString(),
      top:  topN,
      skip: skipN,
      instance: instance || 'all',
    });

    let result;
    try {
      result = await this._getSyslogAdapter().readSyslog({
        fromUtc:  fromDate,
        toUtc:    toDate,
        instance: instance || undefined,
        maxRows:  topN + skipN,
      });
    } catch (err) {
      LOG.error('getSystemLog adapter error', { message: err.message, status: err.status });
      const httpStatus = err.status === 400 ? 400 : 503;
      return req.error(httpStatus, err.message);
    }

    const allEntries = result.entries || [];
    const paged      = allEntries.slice(skipN, skipN + topN);
    const truncated  = result.truncated || paged.length < allEntries.length - skipN;
    const nextSkip   = truncated ? skipN + paged.length : 0;

    return {
      entries:   paged,
      count:     paged.length,
      truncated: result.truncated || skipN + paged.length < (result.count || 0) + (result.truncated ? 1 : 0),
      nextSkip,
    };
  }

  // ---------------------------------------------------------------------------
  // SM20 — Security Audit Log
  // ---------------------------------------------------------------------------
  async _handleGetSecurityAuditLog(req) {
    if (checkLogsReaderRole(req)) return;

    const { fromUtc, toUtc, top, skip, user } = req.data;
    const maxSpan = envInt('SAPLOGS_MAX_SPAN_SM20_HOURS', DEFAULT_MAX_SM20_HOURS);

    const validated = validateWindow(req, fromUtc, toUtc, top, skip, maxSpan);
    if (!validated) return;

    const { fromDate, toDate, topN, skipN } = validated;

    let validatedUser = undefined;
    if (user !== undefined && user !== null && String(user).trim() !== '') {
      const includeUser = process.env.SAPLOGS_INCLUDE_USER === 'true';
      if (!includeUser) {
        return req.reject(400, 'User filtering is disabled when SAPLOGS_INCLUDE_USER is false');
      }
      const trimmedUser = String(user).trim();
      if (trimmedUser.length > 12 || !/^[A-Za-z0-9_.\-@]+$/.test(trimmedUser) || /[*%?]/.test(trimmedUser)) {
        return req.reject(400, 'Invalid user filter: must be alphanumeric (max 12 characters, no wildcards allowed)');
      }
      validatedUser = trimmedUser;
    }

    LOG.info('sap-logs access', {
      user: req.user && req.user.id ? req.user.id : '[unknown]',
      log:  'sm20',
      from: fromDate.toISOString(),
      to:   toDate.toISOString(),
      top:  topN,
      skip: skipN,
      userFilter: validatedUser ? '[filtered]' : undefined,
    });

    let result;
    try {
      result = await this._getAuditLogAdapter().readAuditLog({
        fromUtc:    fromDate,
        toUtc:      toDate,
        maxRows:    topN + skipN,
        userFilter: validatedUser,
      });
    } catch (err) {
      LOG.error('getSecurityAuditLog adapter error', { message: err.message, status: err.status });
      const httpStatus = err.status === 400 ? 400 : (err.status === 502 ? 502 : 503);
      return req.error(httpStatus, err.message);
    }

    const allEntries = result.entries || [];
    const paged      = allEntries.slice(skipN, skipN + topN);
    const truncated  = result.truncated || skipN + paged.length < allEntries.length;
    const nextSkip   = truncated ? skipN + paged.length : 0;

    return {
      entries:   paged,
      count:     paged.length,
      truncated,
      nextSkip,
      warnings:  result.warnings || [],
    };
  }
};
