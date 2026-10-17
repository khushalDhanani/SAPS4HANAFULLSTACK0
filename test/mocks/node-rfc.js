'use strict';

function blockedRfcError() {
  return Object.assign(new Error('Jest blocks node-rfc connections; inject an explicit RFC mock for this test.'), {
    code: 'JEST_OUTBOUND_NETWORK_BLOCKED'
  });
}

class Client {
  constructor() {
    this.open = async () => { throw blockedRfcError(); };
    this.call = async () => { throw blockedRfcError(); };
    this.close = async () => {};
  }
}

module.exports = { Client };
