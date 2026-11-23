'use strict';

const LOG = require('../common/logger')('user-management-audit');

/** One log line per action, so refused and failed attempts are recorded too. Never pass secrets here. */
function audit({ who, target, action, result, reason = '' }) {
  LOG.info('AUDIT', JSON.stringify({ who, when: new Date().toISOString(), target, action, result, reason }));
}

module.exports = { audit };
