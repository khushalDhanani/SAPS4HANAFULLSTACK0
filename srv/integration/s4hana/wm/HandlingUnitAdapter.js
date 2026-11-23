'use strict';

const LOG = require('../logger')('handling-unit-adapter');
const { S4HttpClient } = require('../S4HttpClient');
const { RfcClient } = require('../RfcClient');
const TtlCache = require('../../../common/TtlCache');
const { httpError } = require('./handlingUnitUtils');

const HandlingUnitListReader = require('./HandlingUnitListReader');
const HandlingUnitDetailReader = require('./HandlingUnitDetailReader');
const HandlingUnitHierarchyKpiReader = require('./HandlingUnitHierarchyKpiReader');
const HandlingUnitSerialReader = require('./HandlingUnitSerialReader');
const HandlingUnitBapiWriter = require('./HandlingUnitBapiWriter');

class HandlingUnitAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.rfc = options.rfc || new RfcClient();
    this.vhCache = new TtlCache({ defaultTtlMs: 10 * 60 * 1000, maxEntries: 20 });
    this.kpiCache = new TtlCache({ defaultTtlMs: 30 * 1000, maxEntries: 10 });
    this.huPlantSlocCache = new TtlCache({ defaultTtlMs: 10 * 60 * 1000, maxEntries: 5000 });

    const resultsFn = this._results.bind(this);
    this.listReader = new HandlingUnitListReader({ results: resultsFn, huPlantSlocCache: this.huPlantSlocCache });
    this.detailReader = new HandlingUnitDetailReader({ results: resultsFn });
    this.hierarchyKpiReader = new HandlingUnitHierarchyKpiReader({
      results: resultsFn, client: this.client, vhCache: this.vhCache, kpiCache: this.kpiCache
    });
    this.serialReader = new HandlingUnitSerialReader({ results: resultsFn, rfc: this.rfc });
    this.writer = new HandlingUnitBapiWriter({
      rfc: this.rfc, kpiCache: this.kpiCache, huPlantSlocCache: this.huPlantSlocCache
    });
  }

  async _results(path, params, context) {
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    try {
      const { data } = await this.client.get(path, { query });
      return data?.d || {};
    } catch (e) {
      LOG.error(`${context}: ${e.message}`);
      throw httpError(e.status || 502, `${context}: ${e.message}`);
    }
  }

  async list(input = {}) {
    return this.listReader.list(input);
  }

  async detail(input = {}) {
    return this.detailReader.detail(input);
  }

  async hierarchy(input = {}) {
    return this.hierarchyKpiReader.hierarchy(input);
  }

  async valueHelp(input = {}) {
    return this.hierarchyKpiReader.valueHelp(input);
  }

  async statusKpis(input = {}) {
    return this.hierarchyKpiReader.statusKpis(input);
  }

  async serials(input = {}) {
    return this.serialReader.serials(input);
  }

  async labels(input = {}) {
    return this.serialReader.labels(input);
  }

  async _bapi(context, fn, keyAfter) {
    return this.writer._bapi(context, fn, keyAfter);
  }

  async _readBack(key) {
    return this.writer._readBack(key);
  }

  async create(input = {}) {
    return this.writer.create(input, this._bapi.bind(this));
  }

  async pack(input = {}) {
    return this.writer.pack(input, this._bapi.bind(this));
  }

  async unpack(input = {}) {
    return this.writer.unpack(input, this._bapi.bind(this));
  }

  async remove(input = {}) {
    return this.writer.remove(input, this._bapi.bind(this));
  }
}

module.exports = HandlingUnitAdapter;
