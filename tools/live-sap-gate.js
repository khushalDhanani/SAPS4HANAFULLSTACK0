
'use strict';

module.exports = function requireLiveSapTool() {
  const flagIndex = process.argv.indexOf('--allow-live-sap');
  if (process.env.ALLOW_LIVE_SAP_TOOLS !== '1' || flagIndex < 0) {
    throw new Error('Blocked: live integration tool requires ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap');
  }
  process.argv.splice(flagIndex, 1);
};
