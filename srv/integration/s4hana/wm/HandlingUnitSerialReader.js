'use strict';

const LOG = require('../logger')('handling-unit-adapter');
const { strip, httpError, inPlantScope, clean, RE } = require('./handlingUnitUtils');

const ITEM_COMBINED = '/sap/opu/odata/sap/C_HANDLINGUNITMONITOR_CDS/I_HandlingUnitItemCombined';
const LABEL_HU_CHUNK = 50;
const SERIAL_RFC_CHUNK = 40;
const MAX_LABEL_IDS = 2000;
const LABEL_ITEM_SELECT = 'HandlingUnitExternalID,HandlingUnitItem,Material,MaterialName,HandlingUnitNumberOfSerialNumb,HandlingUnitInternalID,Plant';

class HandlingUnitSerialReader {
  constructor(options = {}) {
    this.results = options.results;
    this.rfc = options.rfc;
  }

  /**
   * Serial numbers assigned to one handling unit, via RFC:
   * SER06 (VENUM = HU internal number) -> OBKNR -> OBJK (SERNR, MATNR, EQUNR).
   */
  async serials(input = {}) {
    const venum = clean(input.handlingUnitInternalNumber, 'Handling unit internal number', RE.venum, true).padStart(10, '0');
    if (Array.isArray(input.allowedPlants)) {
      const [vekp] = await this.rfc.readTable('VEKP', ['WERKS'], [`VENUM = '${venum}'`]).catch(() => []);
      if (!inPlantScope(input.allowedPlants, vekp && vekp.WERKS)) { return { Items: [] }; }
    }
    const read = (table, fields, where) => this.rfc.readTable(table, fields, where).catch((e) => {
      LOG.error(`Read ${table} serials for HU ${venum}: ${e.message}`);
      throw httpError(e.status || 502, `Read ${table} serials for HU ${venum}: ${e.message}`);
    });

    const ser06 = await read('SER06', ['OBKNR', 'VENUM'], [`VENUM = '${venum}'`]);
    const obknrs = [...new Set(ser06.map((r) => r.OBKNR).filter(Boolean))];
    if (!obknrs.length) return { Items: [] };

    const Items = [];
    for (let i = 0; i < obknrs.length; i += 40) {
      const or = obknrs.slice(i, i + 40).map((o, n) => `${n ? 'OR ' : '( '}OBKNR = '${o}'`);
      const rows = await read('OBJK', ['OBKNR', 'SERNR', 'MATNR', 'EQUNR'], [...or, ')']);
      for (const r of rows) {
        if (!r.SERNR) continue;
        Items.push({ SerialNumber: r.SERNR, Material: strip(r.MATNR), Equipment: strip(r.EQUNR) });
      }
    }
    return { Items };
  }

  /**
   * Label fields (first item's material name + first serial number) for a set of HUs in one batched join.
   */
  async labels(input = {}) {
    const aInput = [].concat(input.handlingUnitExternalIDs || []);
    if (aInput.length > MAX_LABEL_IDS) {
      throw httpError(400, `Too many handling units requested (${aInput.length}); the maximum is ${MAX_LABEL_IDS} per call`);
    }
    const ids = [...new Set(aInput.map((h) => clean(h, 'Handling unit', RE.hu)).filter(Boolean))];
    if (!ids.length) return { Items: [] };

    const byHu = {};
    for (let i = 0; i < ids.length; i += LABEL_HU_CHUNK) {
      const slice = ids.slice(i, i + LABEL_HU_CHUNK);
      const filter = '(' + slice.map((id) => `HandlingUnitExternalID eq '${id}'`).join(' or ') + ')';
      const d = await this.results(ITEM_COMBINED, {
        $filter: filter, $select: LABEL_ITEM_SELECT, $top: 5000, $format: 'json'
      }, 'Read handling unit items for labels');
      for (const r of d.results || []) {
        const h = strip(r.HandlingUnitExternalID);
        (byHu[h] = byHu[h] || []).push(r);
      }
    }

    const allowed = input.allowedPlants;
    const venums = new Set();
    for (const h of Object.keys(byHu)) {
      byHu[h].sort((a, b) => strip(a.HandlingUnitItem).localeCompare(strip(b.HandlingUnitItem)));
      const serialCount = byHu[h].reduce((s, r) => s + (Number(r.HandlingUnitNumberOfSerialNumb) || 0), 0);
      if (serialCount > 0 && inPlantScope(allowed, byHu[h][0].Plant)) venums.add(strip(byHu[h][0].HandlingUnitInternalID));
    }

    const serialByVenum = await this._bulkFirstSerial([...venums].filter(Boolean));

    const Items = ids.map((id) => {
      const g = byHu[id] || [];
      const first = g[0] || {};
      const ok = g.length && inPlantScope(allowed, first.Plant);
      const name = (first.MaterialName || strip(first.Material) || '') + (g.length > 1 ? ` +${g.length - 1} more` : '');
      return {
        HandlingUnitExternalID: id,
        MaterialName: ok ? name : '',
        SerialNumber: ok ? (serialByVenum[strip(first.HandlingUnitInternalID)] || '') : ''
      };
    });
    return { Items };
  }

  /** First serial number per HU internal number (VENUM) via SER06 -> OBJK, OR-batched. */
  async _bulkFirstSerial(venums) {
    const out = {};
    if (!venums.length) return out;
    const padded = venums.map((v) => String(v).padStart(10, '0'));
    const obknrToVenum = {};
    for (let i = 0; i < padded.length; i += SERIAL_RFC_CHUNK) {
      const or = padded.slice(i, i + SERIAL_RFC_CHUNK).map((v, n) => `${n ? 'OR ' : '( '}VENUM = '${v}'`);
      const rows = await this.rfc.readTable('SER06', ['OBKNR', 'VENUM'], [...or, ')']);
      for (const r of rows) if (r.OBKNR) obknrToVenum[r.OBKNR] = r.VENUM;
    }
    const obknrs = Object.keys(obknrToVenum);
    for (let i = 0; i < obknrs.length; i += SERIAL_RFC_CHUNK) {
      const or = obknrs.slice(i, i + SERIAL_RFC_CHUNK).map((o, n) => `${n ? 'OR ' : '( '}OBKNR = '${o}'`);
      const rows = await this.rfc.readTable('OBJK', ['OBKNR', 'SERNR'], [...or, ')']);
      for (const r of rows) { if (!r.SERNR) continue; const v = strip(obknrToVenum[r.OBKNR]); if (!out[v]) out[v] = r.SERNR; }
    }
    return out;
  }
}

module.exports = HandlingUnitSerialReader;
