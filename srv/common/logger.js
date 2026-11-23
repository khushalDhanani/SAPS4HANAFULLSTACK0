'use strict';

const cds = require('@sap/cds');

const CREDENTIAL_REGEX = /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*)|(?:Basic\s+[A-Za-z0-9+/]+=*)|(?:nvapi-[A-Za-z0-9\-_]{20,})|(?:sk-[A-Za-z0-9\-_]{20,})/gi;
const SENSITIVE_KEY_REGEX = /^(?:password|secret|client_secret|authorization)$/i;

function scrubArg(arg) {
  if (typeof arg === 'string') {
    return CREDENTIAL_REGEX.test(arg) ? arg.replace(CREDENTIAL_REGEX, '[REDACTED_CREDENTIAL]') : arg;
  }
  if (arg && typeof arg === 'object' && !(arg instanceof Error)) {
    let modified = false;
    const sanitized = Array.isArray(arg) ? [] : {};
    for (const [k, v] of Object.entries(arg)) {
      if (typeof k === 'string' && SENSITIVE_KEY_REGEX.test(k) && typeof v === 'string') {
        sanitized[k] = '[REDACTED_CREDENTIAL]';
        modified = true;
      } else if (typeof v === 'string' && CREDENTIAL_REGEX.test(v)) {
        sanitized[k] = v.replace(CREDENTIAL_REGEX, '[REDACTED_CREDENTIAL]');
        modified = true;
      } else {
        sanitized[k] = v;
      }
    }
    return modified ? sanitized : arg;
  }
  return arg;
}

/**
 * Formatter that injects the CAP context correlation ID (cds.context.id)
 * into plain text log outputs, while maintaining full argument compatibility
 * with Jest spy assertions (e.g. expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(...))).
 */
function correlationPlainFormat(label, level, ...args) {
  const corrId = cds.context?.id || cds.context?.correlation_id;
  const prefix = corrId ? `[${label}] [${corrId}] - ` : `[${label}] - `;

  const cleanArgs = args.map(scrubArg);

  if (cleanArgs.length === 1 && typeof cleanArgs[0] === 'string') {
    return [`${prefix}${cleanArgs[0]}`];
  }
  if (typeof cleanArgs[0] === 'string') {
    return [`${prefix}${cleanArgs[0]}`, ...cleanArgs.slice(1)];
  }
  return [prefix.trimEnd(), ...cleanArgs];
}

/**
 * Configure CAP logging formatters based on cds.env.log.format.
 * In JSON mode ('json'), uses CAP's built-in JSON formatter which automatically
 * binds correlation_id, timestamp, level, logger, msg, and stacktrace.
 * In plain mode (default), uses correlationPlainFormat.
 */
function configureLogger() {
  const isJson = cds.env?.log?.format === 'json';
  const formatter = isJson ? cds.log.formatters.json : correlationPlainFormat;

  if (!cds.log.formatters.plain || cds.log.formatters.plain !== correlationPlainFormat) {
    cds.log.formatters.plain = correlationPlainFormat;
  }
  cds.log.format = formatter;

  // Propagate updated formatter to any already-created loggers
  if (cds.log.loggers) {
    for (const id in cds.log.loggers) {
      const logger = cds.log.loggers[id];
      if (typeof logger?.setFormat === 'function') {
        logger.setFormat(formatter);
      }
    }
  }
}

// Initial configuration
configureLogger();

// If cds.env updates later, re-apply
if (cds.once) {
  cds.once('env', configureLogger);
}

/**
 * Retrieve a CAP logger instance for the specified module/label.
 *
 * @param {string} label - Logger identifier (e.g. 'purchase-order', 'sales-inquiry', 'auth')
 * @param {string|number|Object} [options] - Optional log level or logger options
 * @returns {Object} CAP logger with .error(), .warn(), .info(), .debug(), .trace(), and level gates
 */
function getLogger(label, options) {
  return cds.log(label, options);
}

module.exports = getLogger;
module.exports.getLogger = getLogger;
module.exports.configureLogger = configureLogger;
module.exports.correlationPlainFormat = correlationPlainFormat;
module.exports.log = cds.log;
