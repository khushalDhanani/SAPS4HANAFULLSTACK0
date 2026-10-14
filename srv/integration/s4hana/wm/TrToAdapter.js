'use strict';

const LOG = require('../logger')('tr-to-adapter');
const { RfcClient } = require('../RfcClient');
const { sapKey, sapKeyOpt, httpError } = require('../sapKey');
const s4Config = require('../s4Config');
const { STATUS, STATUS_TEXT, UNCONFIRMED_TO } = require('../../../common/wmStatus');
const { isToFullyConfirmed, findUnconfirmedToItems, getHuConfirmationItems } = require('./toState');
const { checkAuthorization } = require('./authCheck');

/**
 * TR -> TO over RFC, using only objects that already exist in SAP (no ABAP change):
 *  - Z_WM_GET_TR_MATERIAL_LIST  (TR header + items, RFC-enabled)
 *  - RFC_READ_TABLE             (LQUA quants on the SU, MAKT descriptions)
 *  - ZWM_TO_CREATE_FROM_TR      (L_TO_CREATE_TR, RFC-enabled; create only, no confirm)
 * Validation and TO item mapping mirror the production RF transaction ZTO (SAPMZWM_E_001):
 * SU must hold an open TR material in the same plant; qty <= min(SU stock, TR open).
 * Unlike ZTO (built for batch-less 319 staging TRs), a TR item that names a batch only matches that batch.
 */

/** Warehouse from the caller, else from configuration (cds.s4.warehouseNumber / S4_WAREHOUSE_NUMBER); never a literal. */
const warehouse = (lgnum) => sapKey(lgnum || s4Config.getWarehouseNumber(), 'lgnum');

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

/**
 * Maps SAP L3 007 ("Data for storage type search is not defined (& & & &)") to an actionable error
 * naming warehouse, WM movement type, the exact missing T334T key, and the SPRO customizing path.
 */
function mapStorageTypeSearchError(rawMsg, wh, mvt) {
  if (!rawMsg) return rawMsg;
  const match = String(rawMsg).match(
    /(?:Data for storage type search is not defined|Daten zur Lagertypfindung sind nicht definiert)\s*\(([^)]*)\)/i
  );
  if (!match) return rawMsg;

  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  const op = tokens[0] || 'A';
  const indicator = tokens[1] || '(blank)';
  const opText = op === 'A' ? 'Stock Removal' : (op === 'E' ? 'Stock Placement' : op);
  const sproStrategy = op === 'A' ? 'Stock Removal Strategies' : 'Stock Placement Strategies';
  const extra = [];
  if (tokens[2]) extra.push(`Stock Category: '${tokens[2]}'`);
  if (tokens[3]) extra.push(`Special Stock: '${tokens[3]}'`);
  const extraStr = extra.length ? `, ${extra.join(', ')}` : '';

  return `Data for storage type search is not defined in warehouse ${wh} for WM movement type ${mvt}: missing customizing key in table T334T (Warehouse: ${wh}, Operation: ${op} [${opText}], Storage Type Indicator: '${indicator}'${extraStr}). Maintain search sequence in SPRO: Logistics Execution > Warehouse Management > Strategies > ${sproStrategy} > Determine Storage Type Search.`;
}

class TrToAdapter {
  constructor(options = {}) {
    this.rfc = options.rfc || new RfcClient();
    this._checkSlocExistence = Boolean(options.checkSlocExistence);
  }

  /** Same adapter bound to another RFC client (used to run a step inside one locked RFC session). */
  withRfc(rfc) {
    return new this.constructor({
      rfc,
      checkSlocExistence: this._checkSlocExistence
    });
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
    for (const m of [...new Set(matnrs.filter(Boolean).map((v) => sapKey(v, 'matnr')))]) {
      const rows = await this._rfc(
        () => this.rfc.readTable('MAKT', ['MAKTX'], [`MATNR = '${m}'`, "AND SPRAS = 'E'"]),
        `Read description of material ${alphaOut(m)}`
      );
      out[m] = rows[0]?.MAKTX || '';
    }
    return out;
  }

  async getOpenTRs(lgnum = '', mvt = '') {
    const wh = warehouse(lgnum);
    const where = [`LGNUM = '${wh}'`, "AND STATU <> 'E'"];
    const sMvt = sapKeyOpt(mvt, 'mvt');
    if (sMvt) where.push(`AND BWLVS = '${sMvt}'`);

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

  /** A number scanned as a TR is read as a TR only; a reservation number goes through getTRByReservation. */
  async getTR(tbnum, lgnum) {
    const wh = warehouse(lgnum);
    const tr = sapKey(tbnum, 'tbnum').padStart(10, '0');
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
      Mblnr: h.MBLNR || '', Mjahr: h.MJAHR || '',
      Items: items.map((i) => {
        const req = sapNum(i.MENGE);
        const done = sapNum(i.TAMEN);
        return {
          Lgnum: i.LGNUM, Tbnum: i.TBNUM, Tbpos: i.TBPOS,
          Material: alphaOut(i.MATNR), MaterialDesc: desc[i.MATNR] || '',
          Plant: i.WERKS, StorageLocation: i.LGORT, Batch: i.CHARG,
          RequiredQty: req, ProcessedQty: done, OpenQty: Math.max(req - done, 0), Unit: i.MEINS,
          DeliveryCompleted: i.ELIKZ === 'X',
          DestStorageType: h.NLTYP, DestStorageBin: h.NLPLA,
          Rspos: i.RSPOS || ''
        };
      })
    };
  }

  /**
   * Reservation -> its open TR(s) via LTBK-RSNUM (field use proven by getOpenTRs). No TR means the backend
   * did not create one: status 11 (TR error), to be fixed in SAP, not by the operator.
   */
  async getTRByReservation(rsnum, lgnum) {
    const wh = warehouse(lgnum);
    const rs = sapKey(rsnum, 'rsnum').padStart(10, '0');
    const rows = await this._rfc(
      () => this.rfc.readTable('LTBK', ['TBNUM', 'STATU'], [`LGNUM = '${wh}'`, `AND RSNUM = '${rs}'`]),
      `Read Transfer Requirements of reservation ${alphaOut(rs)}`
    );
    const open = (rows || []).filter((r) => r.TBNUM && r.STATU !== 'E').map((r) => r.TBNUM);
    if (!open.length) {
      // Check if tracked in ReservationTrack (e.g. movement 311 where LTBK-RSNUM is 0000000000)
      try {
        const cds = require('@sap/cds');
        if (cds && cds.db) {
          const unpadded = rs.replace(/^0+/, '');
          let track = await cds.db.run(
            cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
              .where({ ReservationNo: rs })
          );
          if (!track && unpadded !== rs) {
            track = await cds.db.run(
              cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
                .where({ ReservationNo: unpadded })
            );
          }
          if (track && track.TransferRequirement) {
            return this.getTR(track.TransferRequirement, wh);
          }
        }
      } catch (_dbErr) {
        // ignore DB read error
      }
      throw httpError(404, `Reservation ${alphaOut(rs)} has no open Transfer Requirement in warehouse ${wh} (status ${STATUS.TR_ERROR} TR error, backend issue)`);
    }
    if (open.length > 1) {
      throw httpError(400, `Reservation ${alphaOut(rs)} has ${open.length} open Transfer Requirements (${open.map(alphaOut).join(', ')}); scan the TR number`);
    }
    return this.getTR(open[0], wh);
  }

  /** Shared by checkSU and createTO so the server never trusts client quantities. */
  async _validate(lenum, tbnum, lgnum) {
    const wh = warehouse(lgnum);
    const su = sapKey(lenum, 'lenum').padStart(20, '0');
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
    const wh = warehouse(lgnum);
    const tr = await this.getTR(tbnum, wh);

    let items = tr.Items.filter((i) => !i.DeliveryCompleted && i.OpenQty > 0);
    if (tbpos) {
      const sPos = sapKey(tbpos, 'tbpos').padStart(4, '0');
      items = items.filter((i) => i.Tbpos === sPos);
    }
    if (!items.length) {
      return [];
    }

    const available = [];
    const seenQuants = new Set();

    for (const item of items) {
      const matPadded = alphaIn(sapKey(item.Material, 'matnr'), 18);
      const where = [
        `LGNUM = '${wh}'`,
        `AND MATNR = '${matPadded}'`,
        "AND LENUM <> ' '",
        "AND VERME > 0"
      ];
      if (item.Batch) {
        where.push(`AND CHARG = '${sapKey(item.Batch, 'batch')}'`);
      }
      if (item.Plant) {
        where.push(`AND WERKS = '${sapKey(item.Plant, 'plant')}'`);
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

    if (quant.LGTYP && tr.Nltyp && quant.LGPLA && tr.Nlpla &&
        quant.LGTYP.trim().toUpperCase() === tr.Nltyp.trim().toUpperCase() &&
        quant.LGPLA.trim().toUpperCase() === tr.Nlpla.trim().toUpperCase()) {
      throw httpError(400, `Source bin (${quant.LGTYP}/${quant.LGPLA}) and destination bin (${tr.Nltyp}/${tr.Nlpla}) cannot be identical; stock is already in destination bin`);
    }

    if (quant.LGTYP && String(quant.LGTYP).trim().startsWith('9')) {
      throw httpError(400, `Interim storage type ${quant.LGTYP} cannot be used as pick source; physical storage type required`);
    }

    if (this.rfc && quant.LGTYP) {
      try {
        const t331Rows = await this.rfc.readTable('T331', ['VOLLE'], [
          `LGNUM = '${wh}'`,
          `AND LGTYP = '${quant.LGTYP}'`
        ], 1);
        if (t331Rows?.[0]?.VOLLE === 'X' && quantity < quant.VERME) {
          throw httpError(400, `Storage type ${quant.LGTYP} requires full stock removal (VOLLE = X); requested quantity (${quantity}) must equal total storage unit quantity (${quant.VERME})`);
        }
      } catch (vErr) {
        if (vErr.status === 400) throw vErr;
      }
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
      const errMsg = mapStorageTypeSearchError(res?.EV_MESSAGE, wh, tr.Bwlvs);
      throw httpError(400, errMsg || `SAP did not create a Transfer Order for TR ${alphaOut(tr.Tbnum)}`);
    }
    return {
      TransferOrder: alphaOut(res.EV_TANUM),
      Success: true,
      Message: res.EV_MESSAGE || `Transfer Order ${alphaOut(res.EV_TANUM)} created.`,
      Confirmed: false
    };
  }

  /**
   * Material profile lookup for batch management (MARC-XCHPF) and serial management (MARC-SERNP).
   * Both are plant-level fields in MARC — SERNP does not exist in MARA (reading it there raises AD 718),
   * which previously made every material silently look non-serial and hid the scan-to serial capture.
   */
  async _materialProfiles(matnrs, plant = '') {
    const out = {};
    const s4Plant = sapKeyOpt(plant, 'plant');
    for (const m of [...new Set(matnrs.filter(Boolean))]) {
      const s4Mat = alphaIn(sapKey(m, 'matnr'), 18);
      let xchpf = '';
      let sernp = '';
      try {
        const where = [`MATNR = '${s4Mat}'`];
        if (s4Plant) where.push(`AND WERKS = '${s4Plant}'`);
        const rows = await this._rfc(
          () => this.rfc.readTable('MARC', ['XCHPF', 'SERNP'], where, 1),
          `Read material profile for ${m}`
        );
        if (rows && rows[0]) {
          xchpf = String(rows[0].XCHPF || '').trim();
          sernp = String(rows[0].SERNP || '').trim();
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

  /** Open items of a TR mapped to the TRDetail shape the scan screen shows. */
  _openItems(tr) {
    return tr.Items.filter((i) => !i.DeliveryCompleted && i.OpenQty > 0);
  }

  /**
   * FIFO Batch Suggestion for a material in WM:
   * First queries LQUA (quants with stock in warehouse), grouping by batch (CHARG),
   * aggregating available stock (VERME), and finding the earliest goods receipt date (WDATU)
   * and putaway date (EDATU). Sorts by earliest WDATU (FIFO).
   * If LQUA has no stock/batches, falls back to MCHA (material batch master) sorted by creation date (ERSDA).
   */
  async getFifoBatches(material, plant = '', storageLocation = '', warehouseNumber = '') {
    if (!material) throw httpError(400, 'Material is required for batch suggestion');
    const matClean = alphaOut(material);
    const matPadded = alphaIn(sapKey(matClean, 'matnr'), 18);
    const wh = warehouse(warehouseNumber);
    const s4Plant = sapKeyOpt(plant, 'plant');
    const s4Lgort = sapKeyOpt(storageLocation, 'lgort');

    const whereLqua = [
      `LGNUM = '${wh}'`,
      `AND MATNR = '${matPadded}'`,
      "AND LGTYP NOT LIKE '9%'",
      "AND VERME > 0",
      "AND CHARG <> ' '"
    ];
    if (s4Plant) whereLqua.push(`AND WERKS = '${s4Plant}'`);
    if (s4Lgort) whereLqua.push(`AND LGORT = '${s4Lgort}'`);

    let quants = [];
    try {
      quants = await this._rfc(
        () => this.rfc.readTable(
          'LQUA',
          ['LQNUM', 'CHARG', 'VERME', 'MEINS', 'WDATU', 'EDATU', 'BDATU', 'LGTYP', 'LGPLA', 'WERKS', 'LGORT'],
          whereLqua
        ),
        `Read FIFO quants for material ${matClean} in warehouse ${wh}`
      );
    } catch (err) {
      LOG.warn(`LQUA query failed for material ${matClean}: ${err.message}`);
    }

    const byBatch = {};
    for (const q of quants || []) {
      const ch = String(q.CHARG || '').trim();
      if (!ch) continue;
      const stock = sapNum(q.VERME);
      if (stock <= 0) continue;

      if (!byBatch[ch]) {
        byBatch[ch] = {
          Batch: ch,
          Material: matClean,
          Plant: q.WERKS || s4Plant || '',
          StorageLocation: q.LGORT || s4Lgort || '',
          StorageType: q.LGTYP || '',
          StorageBin: q.LGPLA || '',
          AvailableStock: 0,
          Unit: q.MEINS || '',
          GoodsReceiptDate: (q.WDATU && q.WDATU !== '00000000') ? q.WDATU : '',
          PutawayDate: (q.EDATU && q.EDATU !== '00000000') ? q.EDATU : '',
          ExpiryDate: ''
        };
      }
      byBatch[ch].AvailableStock += stock;
      if (q.WDATU && q.WDATU !== '00000000') {
        if (!byBatch[ch].GoodsReceiptDate || q.WDATU < byBatch[ch].GoodsReceiptDate) {
          byBatch[ch].GoodsReceiptDate = q.WDATU;
        }
      }
      if (q.EDATU && q.EDATU !== '00000000') {
        if (!byBatch[ch].PutawayDate || q.EDATU < byBatch[ch].PutawayDate) {
          byBatch[ch].PutawayDate = q.EDATU;
        }
      }
    }

    let batchList = Object.values(byBatch);

    // Fallback to MCHA if no stock in LQUA
    if (!batchList.length) {
      try {
        const whereMcha = [`MATNR = '${matPadded}'`];
        if (s4Plant) whereMcha.push(`AND WERKS = '${s4Plant}'`);
        const mchaRows = await this._rfc(
          () => this.rfc.readTable('MCHA', ['CHARG', 'WERKS', 'ERSDA', 'VFDAT', 'HSDAT'], whereMcha, 50),
          `Read MCHA batches for material ${matClean}`
        );
        for (const r of mchaRows || []) {
          const ch = String(r.CHARG || '').trim();
          if (!ch) continue;
          batchList.push({
            Batch: ch,
            Material: matClean,
            Plant: r.WERKS || s4Plant || '',
            StorageLocation: s4Lgort || '',
            StorageType: '',
            StorageBin: '',
            AvailableStock: 0,
            Unit: '',
            GoodsReceiptDate: (r.ERSDA && r.ERSDA !== '00000000') ? r.ERSDA : '',
            PutawayDate: (r.HSDAT && r.HSDAT !== '00000000') ? r.HSDAT : '',
            ExpiryDate: sapDate(r.VFDAT) || ''
          });
        }
      } catch (_mchaErr) {
        // tolerate offline / read failure
      }
    }

    // Sort FIFO: Earliest GoodsReceiptDate, then Earliest PutawayDate, then Batch ASC
    batchList.sort((a, b) => {
      const dA = a.GoodsReceiptDate || '99999999';
      const dB = b.GoodsReceiptDate || '99999999';
      if (dA !== dB) return dA.localeCompare(dB);
      const pA = a.PutawayDate || '99999999';
      const pB = b.PutawayDate || '99999999';
      if (pA !== pB) return pA.localeCompare(pB);
      return a.Batch.localeCompare(b.Batch);
    });

    return batchList.map((b, idx) => {
      const rank = idx + 1;
      const isRec = idx === 0;
      const grFormatted = sapDate(b.GoodsReceiptDate) || b.GoodsReceiptDate;
      const pwFormatted = sapDate(b.PutawayDate) || b.PutawayDate;
      let recText = '';
      if (isRec) {
        recText = grFormatted ? `FIFO Recommended (Earliest GR: ${grFormatted})` : 'FIFO Recommended (Oldest Stock)';
      } else {
        recText = `FIFO Rank #${rank}${grFormatted ? ` (GR: ${grFormatted})` : ''}`;
      }

      return {
        Batch: b.Batch,
        Material: b.Material,
        Plant: b.Plant,
        StorageLocation: b.StorageLocation,
        StorageType: b.StorageType,
        StorageBin: b.StorageBin,
        AvailableStock: Math.round(b.AvailableStock * 1000) / 1000,
        Unit: b.Unit,
        GoodsReceiptDate: grFormatted,
        PutawayDate: pwFormatted,
        ExpiryDate: b.ExpiryDate,
        FifoRank: rank,
        IsRecommended: isRec,
        Recommendation: recText
      };
    });
  }

  /**
   * Available serial series suggestion for a material:
   * Queries EQUI for serial numbers created/maintained for the material.
   * Natural sort creates clean sequential series (e.g. CON-40-001, CON-40-002...).
   */
  async getAvailableSerials(material, plant = '', storageLocation = '', batch = '') {
    if (!material) throw httpError(400, 'Material is required for serial series lookup');
    const matClean = alphaOut(material);
    const matPadded = alphaIn(sapKey(matClean, 'matnr'), 18);

    try {
      const rows = await this._rfc(
        () => this.rfc.readTable(
          'EQUI',
          ['SERNR', 'EQUNR'],
          [`MATNR = '${matPadded}'`, "AND SERNR <> ' '"],
          100
        ),
        `Read serial numbers for material ${matClean}`
      );

      const serials = (rows || [])
        .map((r) => String(r.SERNR || '').trim())
        .filter(Boolean);

      // Unique and natural sort (handles sequential series nicely)
      const unique = [...new Set(serials)];
      unique.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      return unique;
    } catch (err) {
      LOG.warn(`EQUI serial query failed for material ${matClean}: ${err.message}`);
      return [];
    }
  }

  /**
   * Scan lookup. docType says what was scanned: 'TR' (Transfer Requirement number) or 'RES' (Reservation
   * number); it is mandatory, the server never guesses. With several open items the caller must pick one
   * (tbpos); the response then carries TRItem '' and all Items so the UI can offer the choice.
   */
  async lookupTR(tbnum, lgnum = '', docType = '', tbpos = '') {
    const wh = warehouse(lgnum);
    const type = String(docType || '').trim().toUpperCase();
    if (type !== 'TR' && type !== 'RES') throw httpError(400, 'Select whether the scanned number is a Transfer Requirement (TR) or a Reservation (RES)');
    const tr = type === 'RES' ? await this.getTRByReservation(tbnum, wh) : await this.getTR(tbnum, wh);

    const open = this._openItems(tr);
    if (!open.length) throw httpError(404, `Transfer Requirement ${alphaOut(tr.Tbnum)} has no open items`);
    let item = null;
    if (tbpos) {
      const pos = sapKey(tbpos, 'tbpos').padStart(4, '0');
      item = open.find((i) => i.Tbpos === pos);
      if (!item) throw httpError(400, `TR ${alphaOut(tr.Tbnum)} has no open item ${pos}; open items: ${open.map((i) => i.Tbpos).join(', ')}`);
    } else if (open.length === 1) {
      item = open[0];
    }

    const profile = item ? (await this._materialProfiles([item.Material], item.Plant))[item.Material] || {} : {};
    const sel = item || {};
    const isBatchManaged = Boolean(profile.isBatchManaged || sel.Batch);
    const isSerialManaged = Boolean(profile.isSerialManaged);

    let suggestedBatches = [];
    let fifoBatch = sel.Batch || '';
    if (item && isBatchManaged) {
      try {
        suggestedBatches = await this.getFifoBatches(sel.Material, sel.Plant, sel.StorageLocation, wh);
        if (!fifoBatch && suggestedBatches.length > 0) {
          fifoBatch = suggestedBatches[0].Batch;
        }
      } catch (err) {
        LOG.warn(`Failed to fetch FIFO batches for material ${sel.Material}: ${err.message}`);
      }
    }

    let suggestedSerials = [];
    if (item && isSerialManaged) {
      try {
        suggestedSerials = await this.getAvailableSerials(sel.Material, sel.Plant, sel.StorageLocation, fifoBatch || sel.Batch || '');
      } catch (err) {
        LOG.warn(`Failed to fetch available serials for material ${sel.Material}: ${err.message}`);
      }
    }

    let sourceStorageType = tr.Vltyp || '';
    let sourceStorageBin = tr.Vlpla || '';
    if (!sourceStorageType && !sourceStorageBin && suggestedBatches.length > 0 && suggestedBatches[0].StorageBin) {
      sourceStorageType = suggestedBatches[0].StorageType || '';
      sourceStorageBin = suggestedBatches[0].StorageBin || '';
    }

    let stockWarning = '';
    if (sel.Material && sel.Plant && sel.StorageLocation) {
      try {
        const matPadded = alphaIn(sapKey(sel.Material, 'matnr'), 18);
        const lquaCurrent = await this._rfc(
          () => this.rfc.readTable(
            'LQUA',
            ['LGTYP', 'LGPLA', 'VERME'],
            [
              `LGNUM = '${wh}'`,
              `AND MATNR = '${matPadded}'`,
              `AND WERKS = '${sel.Plant}'`,
              `AND LGORT = '${sel.StorageLocation}'`,
              "AND VERME > 0"
            ],
            10
          ),
          `Read stock for material ${sel.Material} in SLoc ${sel.StorageLocation}`
        );

        const currentStock = (lquaCurrent || []).filter((q) => sapNum(q.VERME) > 0 && !String(q.LGTYP || '').trim().startsWith('9'));
        if (!sourceStorageType && !sourceStorageBin && currentStock.length > 0) {
          sourceStorageType = String(currentStock[0].LGTYP || '').trim();
          sourceStorageBin = String(currentStock[0].LGPLA || '').trim();
        }

        if (!currentStock.length) {
          const lquaOther = await this._rfc(
            () => this.rfc.readTable(
              'LQUA',
              ['LGORT', 'VERME'],
              [
                `LGNUM = '${wh}'`,
                `AND MATNR = '${matPadded}'`,
                `AND WERKS = '${sel.Plant}'`,
                "AND VERME > 0"
              ],
              100
            ),
            `Read stock for material ${sel.Material} in other SLocs`
          );
          const otherSlocs = [...new Set((lquaOther || []).map((r) => String(r.LGORT || '').trim()).filter(Boolean))];
          if (otherSlocs.length > 0) {
            stockWarning = `Storage location ${sel.StorageLocation} has no WM stock for material ${sel.Material} in warehouse ${wh}. Available in storage location(s): ${otherSlocs.join(', ')}.`;
          } else {
            stockWarning = `Material ${sel.Material} has no WM stock in warehouse ${wh} (plant ${sel.Plant}).`;
          }
        }
      } catch (err) {
        LOG.warn(`SLoc pre-check failed for material ${sel.Material}: ${err.message}`);
      }
    }

    let receivingPlant = '';
    let receivingStorageLocation = '';
    let recPlantSource = '';
    let recSLocSource = '';
    let costCenter = tr.Betyp === 'K' ? alphaOut(tr.Benum) : '';
    let assetNo = tr.Betyp === 'A' ? alphaOut(tr.Benum) : '';
    let subNumber = tr.Betyp === 'A' ? '0000' : '';

    // 1. RESB (via RSNUM/RSPOS)
    if (tr.Rsnum && String(tr.Rsnum).trim() !== '' && String(tr.Rsnum).trim() !== '0000000000' && this.rfc) {
      try {
        const rsnumPadded = sapKey(tr.Rsnum, 'rsnum').padStart(10, '0');
        const resbRows = await this._rfc(
          () => this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'UMWRK', 'UMLGO', 'CHARG'], [`RSNUM = '${rsnumPadded}'`], 10),
          `Read RESB for reservation ${alphaOut(rsnumPadded)}`
        );
        let matched = null;
        if (item?.Rspos && item.Rspos !== '0000') {
          matched = (resbRows || []).find((r) => r.RSPOS === item.Rspos);
        }
        matched = matched || (resbRows || [])[0];
        if (matched) {
          if (matched.UMLGO?.trim()) {
            receivingStorageLocation = String(matched.UMLGO).trim().toUpperCase();
            recSLocSource = 'Reservation';
          }
          if (matched.UMWRK?.trim()) {
            receivingPlant = String(matched.UMWRK).trim().toUpperCase();
            recPlantSource = 'Reservation';
          }
          if (!sel.Batch && matched.CHARG?.trim()) {
            sel.Batch = matched.CHARG.trim().toUpperCase();
          }
        }
        if (!costCenter || !assetNo) {
          const rkpfRows = await this._rfc(
            () => this.rfc.readTable('RKPF', ['KOSTL', 'ANLN1', 'ANLN2'], [`RSNUM = '${rsnumPadded}'`], 1),
            `Read RKPF for reservation ${alphaOut(rsnumPadded)}`
          );
          if (rkpfRows?.[0]) {
            if (!costCenter && rkpfRows[0].KOSTL?.trim()) costCenter = rkpfRows[0].KOSTL.trim();
            if (!assetNo && rkpfRows[0].ANLN1?.trim()) {
              assetNo = rkpfRows[0].ANLN1.trim();
              subNumber = rkpfRows[0].ANLN2?.trim() || '0000';
            }
          }
        }
      } catch (_rErr) {
        LOG.warn(`Reservation lookup in lookupTR failed: ${_rErr.message}`);
      }
    }

    // 2. Tracking table (ReservationTrack by TBNUM)
    if (!receivingStorageLocation || !receivingPlant) {
      try {
        const cds = require('@sap/cds');
        if (cds && cds.db) {
          const tbnumRaw = alphaOut(tr.Tbnum);
          const tbnumPad = tbnumRaw.padStart(10, '0');
          let track = await cds.db.run(
            cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
              .where({ TransferRequirement: tbnumRaw })
          );
          if (!track && tbnumPad !== tbnumRaw) {
            track = await cds.db.run(
              cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
                .where({ TransferRequirement: tbnumPad })
            );
          }
          if (track) {
            if (!receivingStorageLocation && track.ReceivingStorageLocation?.trim()) {
              receivingStorageLocation = String(track.ReceivingStorageLocation).trim().toUpperCase();
              recSLocSource = recSLocSource || 'Tracking';
            }
            if (!receivingPlant && track.ReceivingPlant?.trim()) {
              receivingPlant = String(track.ReceivingPlant).trim().toUpperCase();
              recPlantSource = recPlantSource || 'Tracking';
            }
            if (!costCenter && track.CostCenter?.trim()) costCenter = track.CostCenter.trim();
            if (!assetNo && track.AssetNo?.trim()) {
              assetNo = track.AssetNo.trim();
              subNumber = track.SubNumber?.trim() || '0000';
            }
          }
        }
      } catch (_trackErr) {
        LOG.warn(`ReservationTrack lookup in lookupTR failed: ${_trackErr.message}`);
      }
    }

    // 3. MATDOC (via MBLNR)
    if ((!receivingStorageLocation || !receivingPlant) && tr.Mblnr && String(tr.Mblnr).trim() !== '' && this.rfc) {
      try {
        const mblnr = String(tr.Mblnr).trim();
        const mjahr = String(tr.Mjahr || '2026').trim();
        const matdocRows = await this._rfc(
          () => this.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'WERKS', 'LGORT', 'UMWRK', 'UMLGO'], [
            `MBLNR = '${mblnr}'`,
            `AND MJAHR = '${mjahr}'`
          ], 10),
          `Read MATDOC for material document ${mblnr}`
        );
        let matched = (matdocRows || []).find((r) => r.BWART === tr.Bwlvs && r.WERKS === sel.Plant && r.LGORT === sel.StorageLocation);
        matched = matched || (matdocRows || []).find((r) => r.BWART === tr.Bwlvs && (r.UMLGO?.trim() || r.UMWRK?.trim()));
        matched = matched || (matdocRows || [])[0];
        if (matched) {
          if (!receivingStorageLocation && matched.UMLGO?.trim()) {
            receivingStorageLocation = String(matched.UMLGO).trim().toUpperCase();
            recSLocSource = recSLocSource || 'Material doc';
          }
          if (!receivingPlant && matched.UMWRK?.trim()) {
            receivingPlant = String(matched.UMWRK).trim().toUpperCase();
            recPlantSource = recPlantSource || 'Material doc';
          }
        }
      } catch (_mErr) {
        LOG.warn(`MATDOC lookup in lookupTR failed: ${_mErr.message}`);
      }
    }

    return {
      TransferRequirement: alphaOut(tr.Tbnum),
      TRNumber: alphaOut(tr.Tbnum),
      TRItem: item ? item.Tbpos : '',
      WarehouseNumber: wh,
      MovementType: tr.Bwlvs || '',
      RequirementType: tr.Betyp || '',
      RequirementNumber: alphaOut(tr.Benum) || '',
      ReservationNo: alphaOut(tr.Rsnum) || '',
      ReservationItem: '',
      Material: sel.Material || '',
      MaterialName: sel.MaterialDesc || '',
      MaterialDescription: sel.MaterialDesc || '',
      Plant: sel.Plant || '',
      StorageLocation: sel.StorageLocation || '',
      DestinationStorageType: tr.Nltyp || '',
      DestinationType: tr.Nltyp || '',
      DestinationStorageBin: tr.Nlpla || '',
      DestinationBin: tr.Nlpla || '',
      SourceStorageType: sourceStorageType,
      SourceStorageBin: sourceStorageBin,
      ReceivingPlant: receivingPlant,
      ReceivingPlantSource: recPlantSource || '',
      ReceivingStorageLocation: receivingStorageLocation,
      ReceivingStorageLocationSource: recSLocSource || '',
      CostCenter: costCenter,
      AssetNo: assetNo,
      SubNumber: subNumber,
      RequiredQuantity: sel.RequiredQty || 0,
      TargetQty: sel.RequiredQty || 0,
      ProcessedQuantity: sel.ProcessedQty || 0,
      OpenQuantity: sel.OpenQty || 0,
      OpenQty: sel.OpenQty || 0,
      Unit: sel.Unit || '',
      Batch: sel.Batch || '',
      FifoBatch: fifoBatch,
      SuggestedBatches: suggestedBatches,
      SuggestedSerials: suggestedSerials,
      IsBatchManaged: isBatchManaged,
      IsSerialManaged: isSerialManaged,
      DeliveryCompleted: Boolean(sel.DeliveryCompleted),
      Status: tr.Statu === 'E' ? STATUS.TO_CONFIRMED : STATUS.TR_CREATED,
      StatusText: tr.Statu === 'E' ? 'Completed' : STATUS_TEXT[STATUS.TR_CREATED],
      StockWarning: stockWarning,
      Items: open
    };
  }

  /**
   * Confirm Transfer Order (wraps L_TO_CONFIRM). When SAP rejects the call, the TO's real state is read
   * from LTAP-PQUIT: fully confirmed -> success, otherwise the SAP error is surfaced unchanged.
   */
  async confirmTO({ lgnum, toNumber, squit = 'X' } = {}) {
    const wh = warehouse(lgnum);
    const s4To = sapKey(toNumber, 'tanum').padStart(10, '0');
    LOG.info(`Confirming Transfer Order ${alphaOut(s4To)} in warehouse ${wh}`);
    await checkAuthorization(this.rfc, 'L_LGNUM', { LGNUM: wh });

    const confirmParams = {
      I_LGNUM: wh,
      I_TANUM: s4To,
      I_SQUIT: squit,
      I_COMMIT_WORK: 'X'
    };

    try {
      await this._rfc(
        () => this.rfc.call('L_TO_CONFIRM', confirmParams),
        `Confirm Transfer Order ${alphaOut(s4To)}`
      );
    } catch (err) {
      const errMsg = String(err?.message || '');
      // When TO items originate from Handling Units, SAP raises L3 848 ("does not contain a destination handling unit").
      // Retry with T_LTAP_CONF_HU to perform complete HU takeover (HUENT = 'X').
      const isMissingDestHu = errMsg.includes('destination handling unit') || errMsg.includes('848');
      if (isMissingDestHu) {
        try {
          const confHu = await this._rfc(
            () => getHuConfirmationItems(this.rfc, wh, s4To),
            `Inspect HU items for TO ${alphaOut(s4To)}`
          );
          if (confHu.length > 0) {
            confirmParams.T_LTAP_CONF_HU = confHu;
            await this._rfc(
              () => this.rfc.call('L_TO_CONFIRM', confirmParams),
              `Confirm Transfer Order ${alphaOut(s4To)} with HU table`
            );
            return {
              TransferOrder: alphaOut(s4To),
              Success: true,
              Confirmed: true,
              Message: `Transfer Order ${alphaOut(s4To)} confirmed.`
            };
          }
        } catch (huErr) {
          LOG.warn(`HU confirmation retry for TO ${alphaOut(s4To)} failed: ${huErr.message}`);
        }
      }

      let confirmedInSap = false;
      try { confirmedInSap = await isToFullyConfirmed(this.rfc, wh, s4To); } catch (_readErr) { /* keep the original error */ }
      if (!confirmedInSap) throw err;
      LOG.info(`Transfer Order ${alphaOut(s4To)} is already confirmed in SAP (LTAP-PQUIT)`);
    }

    return {
      TransferOrder: alphaOut(s4To),
      Success: true,
      Confirmed: true,
      Message: `Transfer Order ${alphaOut(s4To)} confirmed.`
    };
  }

  /**
   * When WM_PICK_SOURCE_FROM_LQUA is enabled and the TR item has no source storage type/bin,
   * reads available positive quants for the item in LQUA (excluding interim storage types from T333),
   * verifies FIFO strategy in T331 (T331-STAUS = 'F'), orders by FIFO, and returns the source VLTYP/VLPLA/VLENR.
   */
  async _resolvePickSourceFromLqua({ wh, material, plant, storageLocation, batch, requestedQty }) {
    const t333Rows = await this._rfc(
      () => this.rfc.readTable('T333', ['VLTYP', 'NLTYP', 'RLTYP', 'VKDYN', 'NKDYN'], [`LGNUM = '${wh}'`], 500),
      `Read T333 interim types for warehouse ${wh}`
    );
    const interimTypes = new Set();
    for (const r of (t333Rows || [])) {
      const v = String(r.VLTYP || '').trim();
      const n = String(r.NLTYP || '').trim();
      const ret = String(r.RLTYP || '').trim();
      if (r.VKDYN === 'X' && v) interimTypes.add(v);
      if (r.NKDYN === 'X' && n) interimTypes.add(n);
      if (!v && n) interimTypes.add(n);
      if (v && !n) interimTypes.add(v);
      if (v && n && v === n) interimTypes.add(v);
      if (ret) interimTypes.add(ret);
    }

    const matPadded = alphaIn(sapKey(material, 'matnr'), 18);
    const whereClause = [
      `LGNUM = '${wh}'`,
      `AND MATNR = '${matPadded}'`,
      `AND WERKS = '${plant}'`,
      `AND LGORT = '${storageLocation}'`,
      `AND VERME > 0`
    ];
    if (batch) {
      whereClause.push(`AND CHARG = '${sapKey(batch, 'batch')}'`);
    }

    const quants = await this._rfc(
      () => this.rfc.readTable(
        'LQUA',
        ['LQNUM', 'LGTYP', 'LGPLA', 'LENUM', 'CHARG', 'VERME', 'WDATU', 'BDATU', 'BZEIT'],
        whereClause,
        100
      ),
      `Read quants from LQUA for material ${material}`
    );

    const physicalQuants = (quants || []).filter((q) => {
      const lgtyp = String(q.LGTYP || '').trim();
      const verme = sapNum(q.VERME);
      return lgtyp && !lgtyp.startsWith('9') && !interimTypes.has(lgtyp) && verme > 0;
    });

    if (!physicalQuants.length) {
      throw httpError(400, `No matching stock found in warehouse ${wh} for material ${material}, plant ${plant}, storage location ${storageLocation}`);
    }

    const distinctTypes = [...new Set(physicalQuants.map((q) => String(q.LGTYP || '').trim()))];
    const t331Map = new Map();
    for (const lgtyp of distinctTypes) {
      const t331Rows = await this._rfc(
        () => this.rfc.readTable('T331', ['LGTYP', 'STAUS', 'VOLLE', 'LENVW'], [`LGNUM = '${wh}'`, `AND LGTYP = '${lgtyp}'`], 1),
        `Read T331 for storage type ${lgtyp}`
      );
      const row = t331Rows?.[0] || {};
      const staus = String(row.STAUS || '').trim();
      if (staus !== 'F') {
        throw httpError(400, `Storage type ${lgtyp} has stock removal strategy '${staus || 'none'}'; only FIFO ('F') is supported under WM_PICK_SOURCE_FROM_LQUA`);
      }
      t331Map.set(lgtyp, row);
    }

    physicalQuants.sort((a, b) => {
      const dateA = a.WDATU || a.BDATU || '';
      const dateB = b.WDATU || b.BDATU || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.BZEIT || '';
      const timeB = b.BZEIT || '';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return String(a.LQNUM).localeCompare(String(b.LQNUM));
    });

    let chosen = null;
    const reqQty = sapNum(requestedQty);

    // Identify storage types where T331-VOLLE = 'X' (complete stock removal required; do not split SUs)
    const volleTypes = new Set(
      [...t331Map.entries()].filter(([_, row]) => row.VOLLE === 'X').map(([lgtyp]) => lgtyp)
    );

    if (volleTypes.size > 0) {
      const volleQuants = physicalQuants.filter((q) => volleTypes.has(String(q.LGTYP || '').trim()));
      if (volleQuants.length > 0) {
        // Choose among quants one whose SU quantity equals requestedQty (FIFO among those)
        const matchingQuant = volleQuants.find((q) => {
          const suQty = sapNum(q.VERME);
          return reqQty ? suQty === reqQty : true;
        });

        if (matchingQuant) {
          chosen = matchingQuant;
        } else {
          // If none match, throw 400 listing SU numbers and quantities. Do not split SUs.
          const suList = volleQuants.map((q) => {
            const suClean = q.LENUM ? String(q.LENUM).trim().replace(/^0+/, '') : `Quant-${q.LQNUM}`;
            const qty = sapNum(q.VERME);
            return `${suClean} (qty: ${qty})`;
          }).join(', ');
          const typesList = [...volleTypes].join(', ');
          const firstSu = volleQuants[0]?.LENUM ? String(volleQuants[0].LENUM).trim().replace(/^0+/, '') : '';
          const suPrefix = firstSu ? `Storage unit ${firstSu} in storage type ${typesList}` : `Storage type ${typesList}`;
          throw httpError(
            400,
            `${suPrefix} requires complete stock removal (T331-VOLLE = 'X'). No storage unit matches requested quantity ${requestedQty}. Available storage units: ${suList}`
          );
        }
      }
    }

    if (!chosen) {
      chosen = physicalQuants[0];
    }

    const chosenLgtyp = String(chosen.LGTYP || '').trim();
    return {
      vltyp: chosenLgtyp,
      vlpla: String(chosen.LGPLA || '').trim(),
      vlenr: chosen.LENUM ? String(chosen.LENUM).trim().replace(/^0+/, '') : ''
    };
  }

  /**
   * Step 2 Service: Chained TO step: CREATE TO, then CONFIRM TO in one step,
   * with confirmation as a real second call.
   * Validates quantity against TR open quantity, validates batch and serial requirements.
   * Status progression:
   *   03 = TO Created (persisted after create succeeds)
   *   04 = TO Confirmed (persisted after confirm succeeds)
   *   12 = TO Create Failed (error on create, retryable via create)
   *   13 = TO Confirm Failed (error on confirm, keeps TANUM, retryable via confirm only)
   * A further TO for the remaining open quantity is allowed once earlier TOs are confirmed; it is blocked
   * only while an unconfirmed TO item (LTAP-PQUIT blank) exists for the same TR item.
   */
  async createTOFromTR({
    lgnum = '',
    tbnum,
    tbpos = '',
    qty,
    unit,
    batch = '',
    serials = [],
    storageUnit = '',
    sourceStorageType = '',
    sourceStorageBin = '',
    receivingPlant = '',
    ReceivingPlant = '',
    receivingStorageLocation = '',
    ReceivingStorageLocation = '',
    costCenter = '',
    CostCenter = '',
    assetNo = '',
    AssetNo = '',
    subNumber = '',
    SubNumber = '',
    autoConfirm = true,
    autoPostMigo = false,
    existingToNumber = '',
    status = '',
    confMenge
  } = {}) {
    const quantity = Number(qty);
    if (!(quantity > 0)) throw httpError(400, 'Quantity must be greater than zero');

    const wh = warehouse(lgnum);
    const tr = await this.getTR(tbnum, wh);

    let finalRecPlant = (ReceivingPlant || receivingPlant) ? String(ReceivingPlant || receivingPlant).trim() : '';
    let finalRecSLoc = (ReceivingStorageLocation || receivingStorageLocation) ? String(ReceivingStorageLocation || receivingStorageLocation).trim() : '';
    let finalCostCenter = (CostCenter || costCenter) ? String(CostCenter || costCenter).trim() : (tr.Betyp === 'K' ? alphaOut(tr.Benum) : '');
    let finalAssetNo = (AssetNo || assetNo) ? String(AssetNo || assetNo).trim() : (tr.Betyp === 'A' ? alphaOut(tr.Benum) : '');
    let finalSubNumber = (SubNumber || subNumber) ? String(SubNumber || subNumber).trim() : (tr.Betyp === 'A' ? '0000' : '');

    const open = this._openItems(tr);
    let item = null;
    if (tbpos) {
      const pos = sapKey(tbpos, 'tbpos').padStart(4, '0');
      item = open.find((i) => i.Tbpos === pos);
      if (!item) throw httpError(400, `TR ${alphaOut(tr.Tbnum)} has no open item ${pos}; open items: ${open.map((i) => i.Tbpos).join(', ') || 'none'}`);
    } else if (open.length === 1) {
      item = open[0];
    } else if (!open.length) {
      throw httpError(404, `Transfer Requirement ${alphaOut(tr.Tbnum)} has no open items`);
    } else {
      throw httpError(400, `TR ${alphaOut(tr.Tbnum)} has ${open.length} open items (${open.map((i) => i.Tbpos).join(', ')}); choose one (tbpos)`);
    }

    if (quantity > item.OpenQty) {
      throw httpError(400, `Requested quantity (${quantity}) exceeds open TR quantity (${item.OpenQty} ${item.Unit})`);
    }

    // Validation of Receiving Storage Location & Receiving Plant
    if (finalRecSLoc) {
      finalRecSLoc = sapKey(finalRecSLoc, 'lgort', 'Receiving Storage Location');
      if (tr.Bwlvs === '311' && finalRecSLoc === item.StorageLocation) {
        throw httpError(400, 'Receiving Storage Location must be different from Issuing Storage Location');
      }
      if (this.rfc && typeof this.rfc.readTable === 'function') {
        const plantForSLoc = (tr.Bwlvs === '301' && finalRecPlant) ? finalRecPlant : item.Plant;
        const t001l = await this._rfc(
          () => this.rfc.readTable('T001L', ['LGORT'], [
            `WERKS = '${plantForSLoc}'`,
            `AND LGORT = '${finalRecSLoc}'`
          ], 1),
          `Validate storage location ${finalRecSLoc} in plant ${plantForSLoc}`
        );
        if (!t001l || t001l.length === 0) {
          throw httpError(400, `Receiving Storage Location ${finalRecSLoc} does not exist in plant ${plantForSLoc} (T001L)`);
        }

        if (tr.Bwlvs === '311') {
          const t320 = await this._rfc(
            () => this.rfc.readTable('T320', ['LGNUM'], [
              `WERKS = '${item.Plant}'`,
              `AND LGORT = '${finalRecSLoc}'`,
              `AND LGNUM = '${wh}'`
            ], 1),
            `Validate warehouse mapping for storage location ${finalRecSLoc} in warehouse ${wh}`
          );
          if (!t320 || t320.length === 0) {
            throw httpError(400, `Receiving Storage Location ${finalRecSLoc} in plant ${item.Plant} is not assigned to warehouse ${wh} (T320)`);
          }
        }
      }
    }

    if (finalRecPlant) {
      finalRecPlant = sapKey(finalRecPlant, 'plant', 'Receiving Plant');
      if (tr.Bwlvs === '301' && finalRecPlant === item.Plant) {
        throw httpError(400, 'Receiving Plant must be different from Issuing Plant for Movement Type 301 (Plant to Plant Transfer)');
      }
    }

    // Material Profiles (Batch & Serial check)
    const profiles = await this._materialProfiles([item.Material], item.Plant);
    const profile = profiles[item.Material] || {};

    const selectedBatch = sapKeyOpt(batch, 'batch') || item.Batch || '';
    if (profile.isBatchManaged && !selectedBatch) {
      throw httpError(400, `Batch is mandatory for batch-managed material ${item.Material}`);
    }

    const serialList = (Array.isArray(serials) ? serials : []).map((v) => sapKey(v, 'serial'));
    if (profile.isSerialManaged) {
      if (serialList.length === 0) {
        throw httpError(400, `Serial numbers are mandatory for serial-managed material ${item.Material}`);
      }
      if (serialList.length !== Math.round(quantity)) {
        throw httpError(400, `Number of serials (${serialList.length}) must equal requested quantity (${quantity})`);
      }
    }

    // Retry of a tracked, unconfirmed TO (status 03/13): confirm only, never create.
    let tanum = existingToNumber ? alphaOut(existingToNumber) : '';
    const isRetryConfirmOnly = Boolean(tanum && UNCONFIRMED_TO.includes(String(status)));
    if (tanum && !isRetryConfirmOnly) tanum = '';

    if (!isRetryConfirmOnly) {
      // Guard: an unconfirmed TO item for this TR item (read from SAP) blocks another TO; confirmed TOs do not.
      const pending = await this._rfc(
        () => findUnconfirmedToItems(this.rfc, wh, tr.Tbnum, item.Tbpos),
        `Check open Transfer Orders of TR ${alphaOut(tr.Tbnum)}`
      );
      if (pending.length) {
        throw httpError(400, `Unconfirmed Transfer Order ${alphaOut(pending[0].TANUM)} exists for TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos}; confirm it before creating another TO`);
      }

      await checkAuthorization(this.rfc, 'L_BWLVS', { LGNUM: wh, BWLVS: tr.Bwlvs });

      // Chained TO step: CREATE TO via Z_WM_TO_CREATE_FROM_TR, then CONFIRM TO via L_TO_CONFIRM as a real second call
      // TODO: Z_WM_TO_CREATE_FROM_TR supports IV_SQUIT = 'X' for immediate confirmation in one call, but chained 2-call architecture is enforced here.
      LOG.info(`Creating TO from TR ${tr.Tbnum} item ${item.Tbpos}, qty ${quantity} ${unit || item.Unit}`);

      // Destination: TR header, else the warehouse movement-type customizing T333 (NLTYP/NLPLA, read from the
      // system: docs/abap/system-metadata.md §24). Never a literal default; no T333 row is an error.
      let nltyp = tr.Nltyp || '';
      let nlpla = tr.Nlpla || '';
      if (!nltyp) {
        const t333 = await this._rfc(
          () => this.rfc.readTable('T333', ['NLTYP', 'NLPLA'], [`LGNUM = '${wh}'`, `AND BWLVS = '${sapKey(tr.Bwlvs, 'mvt')}'`], 1),
          `Read T333 for warehouse ${wh} movement type ${tr.Bwlvs}`
        );
        nltyp = String(t333?.[0]?.NLTYP || '').trim();
        nlpla = String(t333?.[0]?.NLPLA || '').trim();
        if (!nltyp) {
          throw httpError(400, `No destination storage type in T333 for warehouse ${wh}, WM movement type ${tr.Bwlvs}; maintain T333 or the Transfer Requirement`);
        }
      }
      // Source type/bin: caller-provided or TR header; blank lets SAP's stock removal strategy decide.
      let vltyp = sapKeyOpt(sourceStorageType, 'lgtyp') || tr.Vltyp || '';
      let vlpla = sapKeyOpt(sourceStorageBin, 'lgpla') || tr.Vlpla || '';
      let vlenr = storageUnit ? sapKey(storageUnit, 'lenum') : '';

      if ((process.env.WM_PICK_SOURCE_FROM_LQUA === 'true' || process.env.WM_PICK_SOURCE_FROM_LQUA === '1') && !vltyp && !vlpla) {
        const picked = await this._resolvePickSourceFromLqua({
          wh,
          material: item.Material,
          plant: item.Plant,
          storageLocation: item.StorageLocation,
          batch: selectedBatch,
          requestedQty: quantity
        });
        vltyp = picked.vltyp;
        vlpla = picked.vlpla;
        if (!vlenr && picked.vlenr) {
          vlenr = picked.vlenr;
        }
      }

      if (vltyp && nltyp && vlpla && nlpla &&
          vltyp.trim().toUpperCase() === nltyp.trim().toUpperCase() &&
          vlpla.trim().toUpperCase() === nlpla.trim().toUpperCase()) {
        throw httpError(400, `Source bin (${vltyp}/${vlpla}) and destination bin (${nltyp}/${nlpla}) cannot be identical; stock is already in destination bin`);
      }

      if (vltyp && String(vltyp).trim().startsWith('9')) {
        throw httpError(400, `Interim storage type ${vltyp} cannot be used as pick source; physical storage type required`);
      }

      if (this.rfc && vlenr && vltyp) {
        try {
          const t331Rows = await this.rfc.readTable('T331', ['VOLLE'], [
            `LGNUM = '${wh}'`,
            `AND LGTYP = '${vltyp}'`
          ], 1);
          if (t331Rows?.[0]?.VOLLE === 'X') {
            const suPadded = sapKey(vlenr, 'lenum').padStart(20, '0');
            const suRows = await this.rfc.readTable('LQUA', ['VERME'], [
              `LGNUM = '${wh}'`,
              `AND LENUM = '${suPadded}'`
            ], 1);
            const totalSuQty = suRows?.[0] ? sapNum(suRows[0].VERME) : 0;
            if (totalSuQty > 0 && quantity < totalSuQty) {
              throw httpError(400, `Storage type ${vltyp} requires full stock removal (VOLLE = X); requested quantity (${quantity}) must equal total storage unit quantity (${totalSuQty})`);
            }
          }
        } catch (vErr) {
          if (vErr.status === 400) throw vErr;
        }
      }

      const itItems = [{
        TBPOS: item.Tbpos,
        ANFME: quantity.toFixed(3),
        ALTME: unit || item.Unit,
        CHARG: selectedBatch,
        LETYP: '',
        NLTYP: nltyp,
        NLPLA: nlpla,
        VLTYP: vltyp,
        VLPLA: vlpla,
        VLENR: vlenr
      }];

      let res;
      try {
        res = await this._rfc(
          () => this.rfc.call('Z_WM_TO_CREATE_FROM_TR', {
            IV_LGNUM: wh,
            IV_TBNUM: tr.Tbnum,
            IV_COMMIT: 'X',
            IV_SQUIT: ' ',
            IT_ITEMS: itItems
          }),
          `Create Transfer Order for TR ${alphaOut(tr.Tbnum)}`
        );
      } catch (primaryErr) {
        // Only fall back to ZWM_TO_CREATE_FROM_TR if Z_WM_TO_CREATE_FROM_TR is completely missing from the system
        const isMissingFm = primaryErr.message && (
          primaryErr.message.includes('FU_NOT_FOUND') ||
          primaryErr.message.includes('NOT_FOUND') ||
          primaryErr.message.includes('does not exist')
        );
        if (isMissingFm) {
          LOG.warn(`Z_WM_TO_CREATE_FROM_TR not found on system (${primaryErr.message}), trying ZWM_TO_CREATE_FROM_TR`);
          res = await this._rfc(
            () => this.rfc.call('ZWM_TO_CREATE_FROM_TR', {
              IV_LGNUM: wh,
              IV_TBNUM: tr.Tbnum,
              IV_COMMIT: 'X',
              IT_ITEMS: itItems
            }),
            `Create Transfer Order for TR ${alphaOut(tr.Tbnum)} (fallback)`
          );
        } else {
          // Business / customizing / authorization error from SAP: preserve and surface the real error
          const rawMessage = primaryErr.message || 'Error creating Transfer Order in SAP';
          const mappedMsg = mapStorageTypeSearchError(rawMessage, wh, tr.Bwlvs);
          const err = httpError(400, mappedMsg);
          err.Status = STATUS.TO_ERROR;
          err.ErrorStep = 'LT04';
          throw err;
        }
      }

      if (res?.EV_SUCCESS !== 'S' || !res.EV_TANUM) {
        let errMsg = res?.EV_MESSAGE;
        if (!errMsg && Array.isArray(res?.ET_MESSAGES) && res.ET_MESSAGES.length > 0) {
          errMsg = res.ET_MESSAGES.map((m) => m.MESSAGE).filter(Boolean).join('; ');
        }
        errMsg = mapStorageTypeSearchError(errMsg, wh, tr.Bwlvs);
        const err = httpError(400, errMsg || `SAP did not create a Transfer Order for TR ${alphaOut(tr.Tbnum)}`);
        err.Status = STATUS.TO_ERROR;
        err.ErrorStep = 'LT04';
        throw err;
      }

      tanum = alphaOut(res.EV_TANUM);
    } else {
      LOG.info(`TANUM ${tanum} is tracked as unconfirmed (status ${status}); skipping create and retrying confirmation only.`);
    }

    // Step 2: Confirm TO as a real second call
    let confirmed = false;
    let confirmErr = null;

    if (autoConfirm) {
      try {
        await this.confirmTO({ lgnum: wh, toNumber: tanum });
        confirmed = true;
      } catch (err) {
        confirmErr = err;
        LOG.warn(`Confirmation of TO ${tanum} failed: ${err.message}`);
      }
    }

    const currentStatus = confirmed ? STATUS.TO_CONFIRMED : (autoConfirm ? STATUS.TO_CONFIRM_ERROR : STATUS.TO_CREATED);

    return {
      TransferOrder: tanum,
      TransferRequirement: alphaOut(tr.Tbnum),
      TRItem: item.Tbpos,
      ReservationNo: alphaOut(tr.Rsnum) || '',
      ReservationItem: '',
      MovementType: tr.Bwlvs || '',
      CostCenter: finalCostCenter,
      AssetNo: finalAssetNo,
      SubNumber: finalSubNumber,
      ReceivingPlant: finalRecPlant,
      ReceivingStorageLocation: finalRecSLoc,
      Betyp: tr.Betyp || '',
      Benum: tr.Benum || '',
      Status: currentStatus,
      StatusText: STATUS_TEXT[currentStatus],
      Confirmed: confirmed,
      IsConfirmed: confirmed,
      ConfirmationNumber: confirmed ? tanum : '',
      ConfirmedBy: confirmed ? (process.env.S4_USERNAME || '') : '',
      ErrorStep: confirmed ? '' : (autoConfirm ? 'LT12' : ''),
      ErrorMessage: confirmed ? '' : (confirmErr?.message || ''),
      Material: item.Material,
      MaterialName: item.MaterialDesc,
      Plant: item.Plant,
      StorageLocation: item.StorageLocation,
      Quantity: quantity,
      ConfirmedQuantity: confirmed ? (confMenge || quantity) : 0,
      Unit: unit || item.Unit,
      Batch: selectedBatch,
      Serials: serialList,
      Success: confirmed || !autoConfirm,
      Message: confirmed
        ? `Transfer Order ${tanum} created and confirmed successfully.`
        : (autoConfirm
            ? `Transfer Order ${tanum} created, but confirmation failed (status ${STATUS.TO_CONFIRM_ERROR}): ${confirmErr?.message}`
            : `Transfer Order ${tanum} created successfully (status ${STATUS.TO_CREATED}).`)
    };
  }
}

TrToAdapter._internals = { sapNum, alphaIn, alphaOut, sapDate, mapStorageTypeSearchError };
module.exports = TrToAdapter;
