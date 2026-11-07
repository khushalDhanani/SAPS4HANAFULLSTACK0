'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '../../../app/fiori-app/webapp/controller/BaseController.js');

/** The real BaseController.blockSubmitIfNotConfirmed, for controller tests whose BaseController is otherwise mocked. */
function realBlockSubmit() {
  let proto;
  const sap = { ui: { define: (_deps, factory) => factory({ extend: (_name, p) => { proto = p; return p; } }) } };
  new Function('sap', fs.readFileSync(FILE, 'utf8'))(sap);
  return proto.blockSubmitIfNotConfirmed;
}

module.exports = { realBlockSubmit };
