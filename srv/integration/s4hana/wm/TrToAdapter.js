'use strict';

const LOG = require('../logger')('tr-to-adapter');
const { RfcClient } = require('../RfcClient');

/**
 * TR -> TO over RFC, using only objects that already exist in SAP (no ABAP change):
 *  - Z_WM_GET_TR_MATERIAL_LIST  (TR header + items, RFC-enabled)
 *  - RFC_READ_TABLE             (LQUA quants on the SU, MAKT descriptions)
 *  - ZWM_TO_CREATE_FROM_TR      (L_TO_CREATE_TR, RFC-enabled; create only, no confirm)
 * Validation and TO item mapping mirror the production RF transaction ZTO (SAPMZWM_E_001):
 * SU must hold an open TR material in the same plant (batch not compared); qty <= min(SU stock, TR open).
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
      .map((q) => ({ quant: q, item: open.find((i) => i.Material === alphaOut(q.MATNR) && i.Plant === q.WERKS) }))
      .find((m) => m.item);

    let error = null;
    if (!quants.length) error = ['SU_NO_STOCK', `Storage Unit ${alphaOut(su)} not found in warehouse ${wh} or has no available stock`];
    else if (!open.length) error = ['TR_NO_OPEN_ITEMS', `Transfer Requirement ${alphaOut(tr.Tbnum)} has no open items`];
    else if (!match) error = ['SU_MATERIAL_MISMATCH', `Material on Storage Unit ${alphaOut(su)} does not match any open item on TR ${alphaOut(tr.Tbnum)}`];

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
}

TrToAdapter._internals = { sapNum, alphaIn, alphaOut, sapDate };
module.exports = TrToAdapter;
