'use strict';

function assertMismatchOverrideAllowed(env = process.env) {
  if (env.WM_ALLOW_MISMATCHED_TR !== 'true') return false;

  if (String(env.SAP_SYSTEM_TYPE || '').trim().toLowerCase() !== 'sandbox') {
    throw new Error('WM_ALLOW_MISMATCHED_TR=true requires SAP_SYSTEM_TYPE=sandbox');
  }

  return true;
}

function isMismatchOverrideEnabled(env = process.env) {
  return assertMismatchOverrideAllowed(env);
}

module.exports = { assertMismatchOverrideAllowed, isMismatchOverrideEnabled };
