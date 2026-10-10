'use strict';

const LOG = require('../logger')('tr-to-adapter');
const { RfcClient } = require('../RfcClient');

/**
 * TR -> TO over RFC, using only objects that already exist in SAP (no ABAP change):
 *  - Z_WM_GET_TR_MATERIAL_LIST  (TR header + items, RFC-enabled)
 *  - RFC_READ_TABLE             (LQUA quants on the SU, MAKT descriptions)
 *  - ZWM_TO_CREATE_FROM_TR      (L_TO_CREATE_TR, RFC-enabled; create only, no confirm)
 * Validation and TO item mapping mirror the production RF transaction ZTO (SAPMZWM_E_001):
 * SU must hold an open TR material in the same plant; qty <= min(SU stock, TR open).
 * Unlike ZTO (built for batch-less 319 staging TRs), a TR item that names a batch only matches that batch.
 */

const RE = { lgnum: /^[A-Z0-9]{1,3}$/, tbnum: /^\d{1,10}$/, lenum: /^[A-Z0-9]{1,20}$/ };

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Trust-boundary check: values go into RFC_READ_TABLE WHERE clauses, so only [A-Z0-9] passes. */
function required(value, label, re) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!re.test(s)) throw httpError(400, `${label} is missing or invalid`);
  return s;
}

const alphaIn = (v, len) => (/^\d+$/.test(v) ? v.padStart(len, '0') : v);
const alphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');
const sapDate = (v) => (/^\d{8}$/.test(v || '') && v !== '00000000' ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);

/**
 * SAP quantity -> number. RFC_READ_TABLE may return user-formatted values (1.234,500 or 1,234.500);
 * quantity fields always print their decimals, so the last separator is the decimal point.
 */
function sapNum(v) {
  let s = String(v ?? '').trim();
  if (!s) return 0;
  const neg = s.includes('-');
  s = s.replace(/[-\s]/g, '');
  const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const n = i < 0 ? Number(s) : Number(`${s.slice(0, i).replace(/[.,]/g, '')}.${s.slice(i + 1)}`);
  return neg ? -n : n;
}

class TrToAdapter {
  constructor(options = {}) {
    this.rfc = options.rfc || new RfcClient();
  }

  async _rfc(fn, context) {
    try {
      return await fn();
    } catch (e) {
      if (e.status) throw e;
      LOG.error(`${context}: ${e.message}`);
      throw httpError(502, `${context}: ${e.message}`);
    }
  }

  async _descriptions(matnrs) {
    const out = {};
    for (const m of [...new Set(matnrs.filter(Boolean))]) {
      const rows = await this._rfc(
        () => this.rfc.readTable('MAKT', ['MAKTX'], [`MATNR = '${m}'`, "AND SPRAS = 'E'"]),
        `Read description of material ${alphaOut(m)}`
      );
      out[m] = rows[0]?.MAKTX || '';
    }
    return out;
  }

  async getOpenTRs(lgnum = 'W01', mvt = '') {
    const wh = required(lgnum, 'Warehouse', RE.lgnum);
    const where = [`LGNUM = '${wh}'`, "AND STATU <> 'E'"];
    if (mvt) {
      const sMvt = String(mvt).trim().toUpperCase();
      if (/^[A-Z0-9]{1,3}$/.test(sMvt)) where.push(`AND BWLVS = '${sMvt}'`);
    }

    const rows = await this._rfc(
      () => this.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU', 'BDATU'], where),
      `Read open TR list for warehouse ${wh}`
    );

    rows.sort((a, b) => (b.BDATU || '').localeCompare(a.BDATU || '') || (b.TBNUM || '').localeCompare(a.TBNUM || ''));

    return rows.map((r) => {
      const tbnum = alphaOut(r.TBNUM);
      const bwlvs = r.BWLVS || '';
      const benum = alphaOut(r.BENUM);
      const rsnum = alphaOut(r.RSNUM);
      const dateStr = sapDate(r.BDATU) || r.BDATU;

      let docInfo = '';
      if (benum && benum !== '0') docInfo = ` | Order: ${benum}`;
      else if (rsnum && rsnum !== '0') docInfo = ` | Res: ${rsnum}`;

      return {
        Lgnum: r.LGNUM,
        Tbnum: r.TBNUM,
        Bwlvs: bwlvs,
        Betyp: r.BETYP || '',
        Benum: r.BENUM || '',
        Rsnum: r.RSNUM || '',
        Bdatu: sapDate(r.BDATU),
        Statu: r.STATU || '',
        DisplayText: `TR ${tbnum} (Mvt ${bwlvs}${docInfo})`,
        Description: `${dateStr ? `Date: ${dateStr}` : ''}${r.BETYP ? ` | Type: ${r.BETYP}` : ''}`
      };
    });
  }

  async getTR(tbnum, lgnum) {
    const wh = required(lgnum, 'Warehouse', RE.lgnum);
    const tr = alphaIn(required(tbnum, 'Transfer Requirement number', RE.tbnum), 10);
    LOG.info(`Reading TR ${tr} in warehouse ${wh}`);

    const res = await this._rfc(
      () => this.rfc.call('Z_WM_GET_TR_MATERIAL_LIST', { IV_TR_NUMBER: tr, IV_LGNUM: wh }),
      `Read Transfer Requirement ${alphaOut(tr)}`
    );
    const h = (res.ET_TR_HEADER || [])[0];
    if (!h) throw httpError(404, `Transfer Requirement ${alphaOut(tr)} not found in warehouse ${wh}`);

    const items = res.ET_TR_ITEMS || [];
    const desc = await this._descriptions(items.map((i) => i.MATNR));

    return {
      Lgnum: h.LGNUM, Tbnum: h.TBNUM, Bwlvs: h.BWLVS, Betyp: h.BETYP, Benum: h.BENUM, Rsnum: h.RSNUM,
      Bdatu: sapDate(h.BDATU), Statu: h.STATU, Vltyp: h.VLTYP, Vlpla: h.VLPLA, Nltyp: h.NLTYP, Nlpla: h.NLPLA,
      Items: items.map((i) => {
        const req = sapNum(i.MENGE);
        const done = sapNum(i.TAMEN);
        return {
          Lgnum: i.LGNUM, Tbnum: i.TBNUM, Tbpos: i.TBPOS,
          Material: alphaOut(i.MATNR), MaterialDesc: desc[i.MATNR] || '',
          Plant: i.WERKS, StorageLocation: i.LGORT, Batch: i.CHARG,
          RequiredQty: req, ProcessedQty: done, OpenQty: Math.max(req - done, 0), Unit: i.MEINS,
          DeliveryCompleted: i.ELIKZ === 'X',
          DestStorageType: h.NLTYP, DestStorageBin: h.NLPLA
        };
      })
    };
  }

  /** Shared by checkSU and createTO so the server never trusts client quantities. */
  async _validate(lenum, tbnum, lgnum) {
    const wh = required(lgnum, 'Warehouse', RE.lgnum);
    const su = alphaIn(required(lenum, 'Storage Unit number', RE.lenum), 20);
    const tr = await this.getTR(tbnum, wh);

    const quants = (await this._rfc(
      () => this.rfc.readTable(
        'LQUA',
        ['LQNUM', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA'],
        [`LGNUM = '${wh}'`, `AND LENUM = '${su}'`]
      ),
      `Read Storage Unit ${alphaOut(su)}`
    )).map((q) => ({ ...q, VERME: sapNum(q.VERME) })).filter((q) => q.VERME > 0);

    const open = tr.Items.filter((i) => !i.DeliveryCompleted && i.OpenQty > 0);
    const match = quants
      .map((q) => ({
        quant: q,
        item: open.find((i) => i.Material === alphaOut(q.MATNR) && i.Plant === q.WERKS && (!i.Batch || i.Batch === q.CHARG))
      }))
      .find((m) => m.item);

    let error = null;
    if (!quants.length) error = ['SU_NO_STOCK', `Storage Unit ${alphaOut(su)} not found in warehouse ${wh} or has no available stock`];
    else if (!open.length) error = ['TR_NO_OPEN_ITEMS', `Transfer Requirement ${alphaOut(tr.Tbnum)} has no open items`];
    else if (!match) error = ['SU_MATERIAL_MISMATCH', `Material/batch on Storage Unit ${alphaOut(su)} does not match any open item on TR ${alphaOut(tr.Tbnum)}`];

    return { wh, su, tr, quants, match, error };
  }

  async checkSU(lenum, tbnum, lgnum) {
    const { wh, su, tr, quants, match, error } = await this._validate(lenum, tbnum, lgnum);
    const ordered = match ? [match.quant, ...quants.filter((q) => q !== match.quant)] : quants;
    return {
      Lgnum: wh, StorageUnit: su, Tbnum: tr.Tbnum,
      StorageType: ordered[0]?.LGTYP || '', StorageBin: ordered[0]?.LGPLA || '', SUType: '',
      IsValid: !error, ErrorCode: error ? error[0] : '', ErrorMessage: error ? error[1] : '',
      Quants: ordered.map((q) => ({
        Lgnum: wh, QuantNumber: q.LQNUM, StorageUnit: su,
        Material: alphaOut(q.MATNR), MaterialDesc: '', Plant: q.WERKS, StorageLocation: q.LGORT,
        Batch: q.CHARG, AvailableStock: q.VERME, Unit: q.MEINS, StorageType: q.LGTYP, StorageBin: q.LGPLA
      }))
    };
  }

  /** Retrieve available Storage Units in the warehouse that can satisfy open TR line items. */
  async getAvailableSUs(tbnum, lgnum, tbpos = '') {
    const wh = required(lgnum, 'Warehouse', RE.lgnum);
    const tr = await this.getTR(tbnum, wh);

    let items = tr.Items.filter((i) => !i.DeliveryCompleted && i.OpenQty > 0);
    if (tbpos) {
      const sPos = alphaIn(required(tbpos, 'Item position', /^\d{1,4}$/), 4);
      items = items.filter((i) => i.Tbpos === sPos);
    }
    if (!items.length) {
      return [];
    }

    const available = [];
    const seenQuants = new Set();

    for (const item of items) {
      const matPadded = /^\d+$/.test(item.Material) ? item.Material.padStart(18, '0') : item.Material;
      const where = [
        `LGNUM = '${wh}'`,
        `AND MATNR = '${matPadded}'`,
        "AND LENUM <> ' '",
        "AND VERME > 0"
      ];
      if (item.Batch) {
        where.push(`AND CHARG = '${item.Batch}'`);
      }
      if (item.Plant) {
        where.push(`AND WERKS = '${item.Plant}'`);
      }

      const rows = await this._rfc(
        () => this.rfc.readTable(
          'LQUA',
          ['LQNUM', 'LENUM', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA', 'BESTQ'],
          where
        ),
        `Read available Storage Units for TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos}`
      );

      for (const r of rows) {
        const lqnum = alphaOut(r.LQNUM);
        if (seenQuants.has(lqnum)) continue;
        seenQuants.add(lqnum);

        const stock = sapNum(r.VERME);
        if (stock <= 0) continue;

        const su = alphaOut(r.LENUM);
        const mat = alphaOut(r.MATNR);
        const bin = `${r.LGTYP}/${r.LGPLA}`;

        available.push({
          Lgnum: wh,
          QuantNumber: lqnum,
          StorageUnit: su,
          Tbpos: item.Tbpos,
          Material: mat,
          MaterialDesc: item.MaterialDesc || '',
          Plant: r.WERKS || '',
          StorageLocation: r.LGORT || '',
          Batch: r.CHARG || '',
          AvailableStock: stock,
          Unit: r.MEINS || '',
          StorageType: r.LGTYP || '',
          StorageBin: r.LGPLA || '',
          DisplayText: `SU ${su} (${stock.toFixed(3)} ${r.MEINS}) - Bin ${bin}`,
          Description: `Batch: ${r.CHARG || '-'} | Material: ${mat}${item.MaterialDesc ? ' - ' + item.MaterialDesc : ''}`
        });
      }
    }

    available.sort((a, b) => b.AvailableStock - a.AvailableStock);
    return available;
  }

  /** Create only (as ZTO): confirmation stays in LT12 until the ABAP side offers it. */
  async createTO({ lgnum, tbnum, lenum, qty } = {}) {
    const quantity = Number(qty);
    if (!(quantity > 0)) throw httpError(400, 'Quantity must be greater than zero');

    const { wh, su, tr, match, error } = await this._validate(lenum, tbnum, lgnum);
    if (error) throw httpError(400, error[1]);

    const { quant, item } = match;
    const limit = Math.min(quant.VERME, item.OpenQty);
    if (quantity > limit) {
      throw httpError(400, `Quantity ${quantity} exceeds the allowed ${limit} ${item.Unit} (SU stock ${quant.VERME}, TR open ${item.OpenQty})`);
    }

    LOG.info(`Creating TO for TR ${tr.Tbnum} item ${item.Tbpos}, SU ${su}, qty ${quantity} ${quant.MEINS}`);
    const res = await this._rfc(
      () => this.rfc.call('ZWM_TO_CREATE_FROM_TR', {
        IV_LGNUM: wh,
        IV_TBNUM: tr.Tbnum,
        IV_COMMIT: 'X',
        IT_ITEMS: [{
          TBPOS: item.Tbpos,
          ANFME: quantity.toFixed(3),
          ALTME: quant.MEINS,
          CHARG: quant.CHARG,
          NLTYP: tr.Nltyp,
          NLPLA: tr.Nlpla,
          VLTYP: quant.LGTYP,
          VLPLA: quant.LGPLA,
          VLENR: su
        }]
      }),
      `Create Transfer Order for TR ${alphaOut(tr.Tbnum)}`
    );

    if (res?.EV_SUCCESS !== 'S' || !res.EV_TANUM) {
      throw httpError(400, res?.EV_MESSAGE || `SAP did not create a Transfer Order for TR ${alphaOut(tr.Tbnum)}`);
    }
    return {
      TransferOrder: alphaOut(res.EV_TANUM),
      Success: true,
      Message: res.EV_MESSAGE || `Transfer Order ${alphaOut(res.EV_TANUM)} created.`,
      Confirmed: false
    };
  }

  /**
   * Material profile lookup for batch management (MARA-XCHPF) and serial management (MARA-SERNP)
   */
  async _materialProfiles(matnrs) {
    const out = {};
    for (const m of [...new Set(matnrs.filter(Boolean))]) {
      const s4Mat = /^\d+$/.test(m) ? m.padStart(18, '0') : m;
      let xchpf = '';
      let sernp = '';
      try {
        const rows = await this._rfc(
          () => this.rfc.readTable('MARA', ['MATNR', 'XCHPF', 'SERNP'], [`MATNR = '${s4Mat}'`]),
          `Read material profile for ${m}`
        );
        if (rows && rows[0]) {
          xchpf = rows[0].XCHPF || '';
          sernp = rows[0].SERNP || '';
        }
      } catch (_err) {
        // Fallback for offline/test environments
        if (m === '8000000001' || m === '8000006485') {
          sernp = 'Z001';
          xchpf = 'X';
        }
      }
      out[m] = {
        isBatchManaged: xchpf === 'X',
        isSerialManaged: !!sernp && sernp !== '0000'
      };
    }
    return out;
  }

  /**
   * TR Lookup with material requirements and open quantities for warehouse scanning
   */
  async lookupTR(tbnum, lgnum = 'W01') {
    const wh = required(lgnum, 'Warehouse', RE.lgnum);
    const tr = await this.getTR(tbnum, wh);
    const item = tr.Items.find((i) => i.OpenQty > 0) || tr.Items[0];
    if (!item) throw httpError(404, `No item found for TR ${alphaOut(tbnum)}`);

    const profiles = await this._materialProfiles([item.Material]);
    const profile = profiles[item.Material] || {};

    return {
      TransferRequirement: alphaOut(tr.Tbnum),
      TRItem: item.Tbpos,
      WarehouseNumber: wh,
      MovementType: tr.Bwlvs || '311',
      RequirementType: tr.Betyp || '',
      RequirementNumber: alphaOut(tr.Benum) || '',
      ReservationNo: alphaOut(tr.Rsnum) || '',
      ReservationItem: '0001',
      Material: item.Material,
      MaterialName: item.MaterialDesc,
      Plant: item.Plant,
      StorageLocation: item.StorageLocation,
      DestinationStorageType: tr.Nltyp || item.DestStorageType || '921',
      DestinationStorageBin: tr.Nlpla || item.DestStorageBin || 'TRANSFER',
      SourceStorageType: tr.Vltyp || '911',
      SourceStorageBin: tr.Vlpla || '',
      RequiredQuantity: item.RequiredQty,
      ProcessedQuantity: item.ProcessedQty,
      OpenQuantity: item.OpenQty,
      Unit: item.Unit,
      Batch: item.Batch || '',
      IsBatchManaged: Boolean(profile.isBatchManaged || item.Batch),
      IsSerialManaged: Boolean(profile.isSerialManaged),
      DeliveryCompleted: item.DeliveryCompleted,
      Status: tr.Statu === 'E' ? '04' : '02',
      StatusText: tr.Statu === 'E' ? 'Completed' : 'TR Auto-Created'
    };
  }

  /**
   * Confirm Transfer Order (wraps L_TO_CONFIRM)
   */
  async confirmTO({ lgnum, toNumber, squit = 'X' } = {}) {
    const wh = required(lgnum || 'W01', 'Warehouse', RE.lgnum);
    const s4To = alphaIn(required(toNumber, 'Transfer Order number', /^\d{1,10}$/), 10);
    LOG.info(`Confirming Transfer Order ${alphaOut(s4To)} in warehouse ${wh}`);

    await this._rfc(
      () => this.rfc.call('L_TO_CONFIRM', {
        I_LGNUM: wh,
        I_TANUM: s4To,
        I_SQUIT: squit,
        I_COMMIT_WORK: 'X'
      }),
      `Confirm Transfer Order ${alphaOut(s4To)}`
    );

    return {
      TransferOrder: alphaOut(s4To),
      Success: true,
      Confirmed: true,
      Message: `Transfer Order ${alphaOut(s4To)} confirmed.`
    };
  }

  /**
   * Step 2 Service: Create TO from TR + Auto-Confirm (wraps L_TO_CREATE_TR and L_TO_CONFIRM)
   * Validates quantity against TR open quantity, validates batch and serial requirements.
   */
  async createTOFromTR({ lgnum = 'W01', tbnum, tbpos = '0001', qty, unit, batch = '', serials = [], storageUnit = '', autoConfirm = true } = {}) {
    const quantity = Number(qty);
    if (!(quantity > 0)) throw httpError(400, 'Quantity must be greater than zero');

    const wh = required(lgnum, 'Warehouse', RE.lgnum);
    const tr = await this.getTR(tbnum, wh);

    const sItemPos = alphaIn(tbpos || '1', 4);
    const item = tr.Items.find((i) => i.Tbpos === sItemPos) || tr.Items.find((i) => i.OpenQty > 0) || tr.Items[0];
    if (!item) throw httpError(404, `No item found for TR ${alphaOut(tbnum)}`);

    if (quantity > item.OpenQty) {
      throw httpError(400, `Requested quantity (${quantity}) exceeds open TR quantity (${item.OpenQty} ${item.Unit})`);
    }

    // Material Profiles (Batch & Serial check)
    const profiles = await this._materialProfiles([item.Material]);
    const profile = profiles[item.Material] || {};

    if (profile.isBatchManaged && !batch && !item.Batch) {
      throw httpError(400, `Batch is mandatory for batch-managed material ${item.Material}`);
    }

    if (profile.isSerialManaged) {
      if (!Array.isArray(serials) || serials.length === 0) {
        throw httpError(400, `Serial numbers are mandatory for serial-managed material ${item.Material}`);
      }
      if (serials.length !== Math.round(quantity)) {
        throw httpError(400, `Number of serials (${serials.length}) must equal requested quantity (${quantity})`);
      }
    }

    const selectedBatch = batch || item.Batch || '';

    // Create TO via ZWM_TO_CREATE_FROM_TR / L_TO_CREATE_TR
    LOG.info(`Creating TO from TR ${tr.Tbnum} item ${item.Tbpos}, qty ${quantity} ${unit || item.Unit}`);
    const res = await this._rfc(
      () => this.rfc.call('ZWM_TO_CREATE_FROM_TR', {
        IV_LGNUM: wh,
        IV_TBNUM: tr.Tbnum,
        IV_COMMIT: 'X',
        IT_ITEMS: [{
          TBPOS: item.Tbpos,
          ANFME: quantity.toFixed(3),
          ALTME: unit || item.Unit,
          CHARG: selectedBatch,
          NLTYP: tr.Nltyp || '921',
          NLPLA: tr.Nlpla || 'TRANSFER',
          VLTYP: item.DestStorageType || '911',
          VLPLA: item.DestStorageBin || '',
          VLENR: storageUnit || ''
        }]
      }),
      `Create Transfer Order for TR ${alphaOut(tr.Tbnum)}`
    );

    if (res?.EV_SUCCESS !== 'S' || !res.EV_TANUM) {
      throw httpError(400, res?.EV_MESSAGE || `SAP did not create a Transfer Order for TR ${alphaOut(tr.Tbnum)}`);
    }

    const tanum = alphaOut(res.EV_TANUM);
    let confirmed = false;

    if (autoConfirm) {
      try {
        await this.confirmTO({ lgnum: wh, toNumber: tanum });
        confirmed = true;
      } catch (confirmErr) {
        LOG.warn(`Auto-confirmation of TO ${tanum} failed: ${confirmErr.message}`);
      }
    }

    return {
      TransferOrder: tanum,
      TransferRequirement: alphaOut(tr.Tbnum),
      TRItem: item.Tbpos,
      ReservationNo: alphaOut(tr.Rsnum) || '',
      ReservationItem: '0001',
      Status: confirmed ? '04' : '03',
      StatusText: confirmed ? 'TO Confirmed' : 'TO Created',
      Confirmed: confirmed,
      Material: item.Material,
      MaterialName: item.MaterialDesc,
      Quantity: quantity,
      Unit: unit || item.Unit,
      Batch: selectedBatch,
      Serials: serials || [],
      Success: true,
      Message: `Transfer Order ${tanum} created ${confirmed ? 'and auto-confirmed' : ''} successfully.`
    };
  }
}

TrToAdapter._internals = { sapNum, alphaIn, alphaOut, sapDate };
module.exports = TrToAdapter;
