'use strict';

const LOG = require('../logger')('handling-unit-adapter');
const { strip, num, httpError, inPlantScope, clean, text, pad18, huKey, bapiError, RE } = require('./handlingUnitUtils');

class HandlingUnitBapiWriter {
  constructor(options = {}) {
    this.rfc = options.rfc;
    this.kpiCache = options.kpiCache;
    this.huPlantSlocCache = options.huPlantSlocCache;
  }

  /** One BAPI + BAPI_TRANSACTION_COMMIT on one connection; on RETURN E/A nothing is committed (422). */
  async _bapi(context, fn, keyAfter) {
    let key;
    let commitSent = false;
    try {
      await this.rfc.session(async (call) => {
        const res = await fn(call);
        const err = bapiError(res.RETURN);
        if (err) throw httpError(422, `${context}: ${err.MESSAGE || `${err.ID} ${err.NUMBER}`}`);
        key = (typeof res.HUKEY === 'string' && res.HUKEY) || keyAfter;
        commitSent = true;
        const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
        const cerr = bapiError(commit.RETURN);
        if (cerr) {
          commitSent = false;
          throw httpError(502, `${context}: commit failed: ${cerr.MESSAGE}`);
        }
      });
      return await this._readBack(key);
    } catch (e) {
      if (commitSent) {
        LOG.error(`${context}: outcome not confirmed: ${e.message}`);
        const hu = key ? ` to handling unit ${strip(key)}` : '';
        throw Object.assign(httpError(502, `${context}: SAP may have saved this change${hu}, but it could not be read back, so it is NOT confirmed. Check it in SAP before trying again.`), { $sanitize: false });
      }
      if (e.status) throw e;
      LOG.error(`${context}: ${e.message}`);
      throw httpError(502, `${context}: ${e.message}`);
    }
  }

  /** Committed state from VEKP / VEPO (what SAP persisted). Deleted = no VEKP row for the key. */
  async _readBack(key) {
    const [vekp] = await this.rfc.readTable('VEKP', ['VENUM', 'EXIDV', 'VHILM', 'WERKS', 'LGORT', 'STATUS', 'INHALT'], [`EXIDV = '${key}'`]);
    if (!vekp) return { HandlingUnitExternalID: strip(key), Deleted: true, Items: [] };
    const vepo = await this.rfc.readTable('VEPO', ['VEPOS', 'VELIN', 'MATNR', 'CHARG', 'VEMNG', 'VEMEH', 'WERKS', 'LGORT'], [`VENUM = '${vekp.VENUM}'`]);
    return {
      HandlingUnitExternalID: strip(vekp.EXIDV),
      HandlingUnitInternalNumber: vekp.VENUM,
      PackagingMaterial: strip(vekp.VHILM),
      Plant: vekp.WERKS,
      StorageLocation: vekp.LGORT,
      Status: vekp.STATUS,
      Content: vekp.INHALT,
      Deleted: false,
      Items: vepo.map((r) => ({
        HandlingUnitItem: strip(r.VEPOS), Material: strip(r.MATNR), Batch: r.CHARG, Quantity: num(r.VEMNG),
        Unit: r.VEMEH, Plant: r.WERKS, StorageLocation: r.LGORT
      }))
    };
  }

  _assertPlantAllowed(plant, allowed) {
    if (Array.isArray(allowed) && !inPlantScope(allowed, plant)) {
      throw httpError(403, `Not authorized for plant ${plant}`);
    }
  }

  async _assertHuInScope(key, allowed) {
    if (!Array.isArray(allowed)) return;
    const [vekp] = await this.rfc.readTable('VEKP', ['WERKS'], [`EXIDV = '${key}'`]).catch(() => []);
    if (!inPlantScope(allowed, vekp && vekp.WERKS)) {
      throw httpError(403, `Not authorized to change handling unit ${strip(key)}`);
    }
  }

  _itemFields(input) {
    const material = clean(input.material, 'Material', RE.material, true);
    const quantity = Number(input.quantity);
    if (!(quantity > 0)) throw httpError(400, 'Quantity must be greater than zero');
    const batch = clean(input.batch, 'Batch', RE.batch, false);
    return {
      MATERIAL: pad18(material),
      PACK_QTY: quantity.toFixed(3),
      BASE_UNIT_QTY: clean(input.unit, 'Unit', RE.unit, true),
      PLANT: clean(input.plant, 'Plant', RE.plant, true),
      STGE_LOC: clean(input.storageLocation, 'Storage location', RE.sloc, true),
      ...(batch ? { BATCH: batch } : {})
    };
  }

  async create(input = {}, bapiFn) {
    const fnBapi = bapiFn || this._bapi.bind(this);
    const plant = clean(input.plant, 'Plant', RE.plant, true);
    this._assertPlantAllowed(plant, input.allowedPlants);
    const header = {
      PACK_MAT: pad18(clean(input.packagingMaterial, 'Packaging material', RE.material, true)),
      PLANT: plant,
      STGE_LOC: clean(input.storageLocation, 'Storage location', RE.sloc, true)
    };
    const content = text(input.content, 'Content', 40);
    if (content) header.CONTENT = content;
    const r = await fnBapi('Create handling unit', (call) => call('BAPI_HU_CREATE', { HEADERPROPOSAL: header }));
    if (r.Deleted) {
      throw Object.assign(httpError(502, `Create handling unit: SAP committed handling unit ${r.HandlingUnitExternalID}, but it could not be read back, so it is NOT confirmed. Check it in SAP before creating it again.`), { $sanitize: false });
    }
    if (this.kpiCache) this.kpiCache.clear();
    return r;
  }

  async pack(input = {}, bapiFn) {
    const fnBapi = bapiFn || this._bapi.bind(this);
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    await this._assertHuInScope(key, input.allowedPlants);
    const item = { HU_ITEM_TYPE: '1', ...this._itemFields(input) };
    const res = await fnBapi('Pack handling unit item', (call) => call('BAPI_HU_PACK', { HUKEY: key, ITEMPROPOSAL: item }), key);
    if (this.huPlantSlocCache) this.huPlantSlocCache.delete(strip(key));
    return res;
  }

  async unpack(input = {}, bapiFn) {
    const fnBapi = bapiFn || this._bapi.bind(this);
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    await this._assertHuInScope(key, input.allowedPlants);
    const item = { HU_ITEM_TYPE: '1', HU_ITEM_NUMBER: clean(input.item, 'Item', RE.item, true).padStart(6, '0'), ...this._itemFields(input) };
    const res = await fnBapi('Unpack handling unit item', (call) => call('BAPI_HU_UNPACK', { HUKEY: key, ITEMUNPACK: item }), key);
    if (this.huPlantSlocCache) this.huPlantSlocCache.delete(strip(key));
    return res;
  }

  async remove(input = {}, bapiFn) {
    const fnBapi = bapiFn || this._bapi.bind(this);
    const key = huKey(clean(input.handlingUnitExternalID, 'Handling unit', RE.hu, true));
    await this._assertHuInScope(key, input.allowedPlants);
    const r = await fnBapi('Delete handling unit', (call) => call('BAPI_HU_DELETE', { HUKEY: key }), key);
    if (!r.Deleted) throw httpError(502, 'Delete handling unit: SAP did not delete the handling unit');
    if (this.huPlantSlocCache) this.huPlantSlocCache.delete(strip(key));
    if (this.kpiCache) this.kpiCache.clear();
    return r;
  }
}

module.exports = HandlingUnitBapiWriter;
