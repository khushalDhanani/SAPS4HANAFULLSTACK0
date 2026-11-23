'use strict';

function blockedRfcError() {
  return Object.assign(new Error('Jest blocks node-rfc connections; inject an explicit RFC mock for this test.'), {
    code: 'JEST_OUTBOUND_NETWORK_BLOCKED'
  });
}

class Client {
  constructor(params = {}) {
    this.params = params;
    this.open = async () => { throw blockedRfcError(); };
    this.call = async () => { throw blockedRfcError(); };
    this.close = async () => {};
  }
}

class Pool {
  constructor(options = {}) {
    this.options = options;
    this.status = { ready: 0, used: 0 };
  }
  async acquire() {
    throw blockedRfcError();
  }
  async release() {}
  async closeAll() {}
}

module.exports = { Client, Pool };
