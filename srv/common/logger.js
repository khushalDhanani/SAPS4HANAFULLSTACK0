'use strict';

const cds = require('@sap/cds');

/**
 * Formatter that injects the CAP context correlation ID (cds.context.id)
 * into plain text log outputs, while maintaining full argument compatibility
 * with Jest spy assertions (e.g. expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(...))).
 */
function correlationPlainFormat(label, level, ...args) {
  const corrId = cds.context?.id || cds.context?.correlation_id;
  const prefix = corrId ? `[${label}] [${corrId}] - ` : `[${label}] - `;

  if (args.length === 1 && typeof args[0] === 'string') {
    return [`${prefix}${args[0]}`];
  }
  if (typeof args[0] === 'string') {
    return [`${prefix}${args[0]}`, ...args.slice(1)];
  }
  return [prefix.trimEnd(), ...args];
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
