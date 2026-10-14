'use strict';

function shouldRunLiveSapTests(env = process.env) {
  const systemType = String(env.SAP_SYSTEM_TYPE || '').trim().toLowerCase();
  return env.RUN_LIVE_SAP === '1' && Boolean(systemType) && systemType !== 'prod';
}

module.exports = { shouldRunLiveSapTests };
