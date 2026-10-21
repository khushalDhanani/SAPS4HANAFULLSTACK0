'use strict';

const LOG = require('../logger')('tr-to-adapter');
const { RfcClient } = require('../RfcClient');
const { sapKey, sapKeyOpt, httpError } = require('../sapKey');
const { resolveWarehouse } = require('./warehouseResolver');
const { STATUS, STATUS_TEXT, UNCONFIRMED_TO } = require('../../../common/wmStatus');
const { isMismatchOverrideEnabled } = require('../../../common/wmMismatchOverrideGuard');
const { isToFullyConfirmed, findUnconfirmedToItems, getHuConfirmationItems } = require('./toState');
const { checkAuthorization } = require('./authCheck');
const plantScope = require('../../../wm/handling-unit/plantScope');

/**
 * TR -> TO over RFC, using only objects that already exist in SAP (no ABAP change):
 *  - Z_WM_GET_TR_MATERIAL_LIST  (TR header + items, RFC-enabled)
 *  - RFC_READ_TABLE             (LQUA quants on the SU, MAKT descriptions)
 *  - ZWM_TO_CREATE_FROM_TR      (L_TO_CREATE_TR, RFC-enabled; create only, no confirm)
 * Validation and TO item mapping mirror the production RF transaction ZTO (SAPMZWM_E_001):
 * SU must hold an open TR material in the same plant; qty <= min(SU stock, TR open).
 * Unlike ZTO (built for batch-less 319 staging TRs), a TR item that names a batch only matches that batch.
 */

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
    this._toCreateInFlight = new Set();
  }

  /**
   * Tracking row of a TR. TR numbers are unique per warehouse only (the same TBNUM exists in W01, W10 and W12 on
   * this system), so the warehouse is part of the key; without it nothing is returned rather than another warehouse's row.
   */
  async _findTrackedReservationForTR(tbnum, wh) {
    const cds = require('@sap/cds');
    if (!cds?.db) return null;
    const warehouse = String(wh || '').trim().toUpperCase();
    if (!warehouse) return null;
    const raw = alphaOut(tbnum);
    try {
      const read = (value) => cds.db.run(
        cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
          .where({ TransferRequirement: value, WarehouseNumber: warehouse })
      );
      return (await read(raw)) || (raw.padStart(10, '0') !== raw ? await read(raw.padStart(10, '0')) : null);
    } catch (_dbErr) {
      return null;
    }
  }

  /**
   * Detects whether a TR was corrupted by SAP indicator conflict (e.g. XFELD_WRONG on 261 staging TR):
   * closed in SAP (STATU = 'E') with 0 Transfer Orders created, while its tracked reservation is still open in SAP.
   */
  async _isCorruptedStagingTR(tr, wh) {
    if (!tr || tr.Statu !== 'E') return null;
    if (!this.rfc || !this.rfc.readTable) return null;

    // 1. Check if any TO was ever created for this TR in SAP
    try {
      const s4Tr = sapKey(tr.Tbnum, 'tbnum').padStart(10, '0');
      const ltakRows = await this._rfc(
        () => this.rfc.readTable('LTAK', ['TANUM', 'KQUIT'], [
          `LGNUM = '${wh}'`,
          `AND TBNUM = '${s4Tr}'`
        ], 1),
        `Check if TO exists in SAP for TR ${alphaOut(s4Tr)}`
      );
      if (ltakRows && ltakRows.length > 0) {
        return null;
      }
    } catch (_ltakErr) {
      return null;
    }

    // 2. Check if this TR belongs to an open tracked reservation (from CDS DB or directly from SAP RESB/RKPF)
    try {
      let track = await this._findTrackedReservationForTR(tr.Tbnum, wh || tr.Lgnum);
      const rawRs = tr.Rsnum && String(tr.Rsnum).trim() !== '' && String(tr.Rsnum).trim() !== '0000000000'
        ? alphaOut(tr.Rsnum)
        : (track?.ReservationNo ? alphaOut(track.ReservationNo) : '');

      if (!track && rawRs) {
        const cds = require('@sap/cds');
        if (cds?.db) {
          try {
            const sPad = rawRs.padStart(10, '0');
            track = await cds.db.run(
              cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
                .where({ ReservationNo: rawRs })
            ) || await cds.db.run(
              cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
                .where({ ReservationNo: sPad })
            );
          } catch (_dbErr) { /* ignore db error */ }
        }
      }

      // If still no track, fetch reservation directly from SAP transparent tables RESB & RKPF
      if (!track && rawRs) {
        const s4Rsnum = rawRs.padStart(10, '0');
        const resbRows = await this._rfc(
          () => this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'KZEAR', 'AUFNR', 'BWART', 'MEINS'], [
            `RSNUM = '${s4Rsnum}'`
          ], 5),
          `Read RESB for untracked reservation ${rawRs}`
        );
        let directResb = resbRows?.[0];
        if (directResb) {
          let rkpfMvt = '';
          try {
            const rkpfRows = await this._rfc(
              () => this.rfc.readTable('RKPF', ['RSNUM', 'BWART', 'AUFNR', 'KOSTL', 'ANLN1', 'UMWRK', 'UMLGO'], [
                `RSNUM = '${s4Rsnum}'`
              ], 1),
              `Read RKPF for reservation ${rawRs}`
            );
            rkpfMvt = rkpfRows?.[0]?.BWART || '';
          } catch (_rkpfErr) { /* tolerate */ }

          track = {
            ReservationNo: rawRs,
            ReservationItem: alphaOut(directResb.RSPOS || '1'),
            Material: alphaOut(directResb.MATNR),
            Plant: directResb.WERKS,
            StorageLocation: directResb.LGORT,
            Quantity: sapNum(directResb.BDMNG),
            Unit: directResb.MEINS || 'NOS',
            MovementType: directResb.BWART || rkpfMvt || '261',
            OrderID: directResb.AUFNR ? alphaOut(directResb.AUFNR) : '',
            Status_code: '02'
          };

          if (String(directResb.KZEAR || '').trim() !== 'X' && (sapNum(directResb.BDMNG) - sapNum(directResb.ENMNG) > 0)) {
            return track;
          }
          return null;
        }
      }

      if (!track) return null;

      // If already marked completed in CDS, not a corrupted open TR
      if (track.Status_code === STATUS.GI_POSTED || track.Status_code === '05' || track.MaterialDocument) {
        return null;
      }

      // 3. Verify in SAP transparent table RESB that reservation has unwithdrawn open quantity
      const s4Rsnum = sapKey(track.ReservationNo, 'rsnum').padStart(10, '0');
      const s4Rspos = sapKey(track.ReservationItem || '1', 'rspos').padStart(4, '0');
      const resbRows = await this._rfc(
        () => this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'BDMNG', 'ENMNG', 'KZEAR'], [
          `RSNUM = '${s4Rsnum}'`,
          `AND RSPOS = '${s4Rspos}'`
        ], 1),
        `Check RESB for reservation ${alphaOut(s4Rsnum)}`
      );
      const resb = resbRows?.[0];
      if (resb && String(resb.KZEAR || '').trim() !== 'X' && (sapNum(resb.BDMNG) - sapNum(resb.ENMNG) > 0)) {
        return track;
      }
    } catch (_resErr) {
      LOG.warn(`_isCorruptedStagingTR check error: ${_resErr.message}`);
    }

    return null;
  }

  /**
   * Recovers a corrupted staging TR by adopting an existing open staging TR or creating a clean one in SAP,
   * updating ReservationTrack, and returning the refreshed open TR header.
   */
  async _recoverCorruptedStagingTR(tr, track, wh) {
    const cds = require('@sap/cds');
    const s4Mat = alphaIn(sapKey(track.Material, 'matnr'), 18);
    const s4Werks = sapKey(track.Plant, 'plant');
    const s4Lgort = sapKey(track.StorageLocation, 'lgort');
    const s4Menga = Number(track.Quantity);
    const s4Altme = String(track.Unit || 'NOS').trim().toUpperCase();

    let freshTbnum = '';

    // First check if a valid open staging TR already exists in SAP LTBK/LTBP
    try {
      const ltbkRows = await this._rfc(
        () => this.rfc.readTable('LTBK', ['TBNUM', 'STATU'], [
          `LGNUM = '${wh}'`,
          "AND BWLVS = '311'",
          "AND STATU = ''"
        ], 20),
        `Find open staging TRs in warehouse ${wh}`
      );
      for (const r of (ltbkRows || [])) {
        const trCand = await this.getTR(r.TBNUM, wh);
        const openItems = this._openItems(trCand);
        const match = openItems.find((i) =>
          (!trCand.Rsnum || trCand.Rsnum === '0000000000' || alphaOut(trCand.Rsnum) === alphaOut(track.ReservationNo)) &&
          alphaOut(i.Material) === alphaOut(track.Material) &&
          i.Plant === track.Plant &&
          i.StorageLocation === track.StorageLocation &&
          Number(i.OpenQty) >= s4Menga
        );
        if (match) {
          freshTbnum = trCand.Tbnum;
          break;
        }
      }
    } catch (_candErr) {
      LOG.warn(`Error scanning for existing staging TR: ${_candErr.message}`);
    }

    // If none found, create a clean staging TR in SAP
    if (!freshTbnum) {
      try {
        const resZ = await this._rfc(
          () => this.rfc.call('Z_WM_TR_CREATE', {
            IV_LGNUM: wh,
            IV_BWLVS: '311',
            IV_MATNR: s4Mat,
            IV_WERKS: s4Werks,
            IV_LGORT: s4Lgort,
            IV_MENGA: s4Menga,
            IV_ALTME: s4Altme,
            IV_RSNUM: '',
            IV_RSPOS: '',
            IV_COMMIT: 'X'
          }),
          `Create replacement staging TR for reservation ${track.ReservationNo}`
        );
        const raw = resZ?.EV_TBNUM || resZ?.E_TBNUM;
        if (raw && raw !== '0000000000') {
          freshTbnum = alphaOut(raw);
        }
      } catch (_crErr) {
        LOG.error(`Failed creating replacement staging TR: ${_crErr.message}`);
      }
    }

    if (!freshTbnum) return null;

    // Update or insert CDS tracking persistence
    if (cds?.db && track.ReservationNo) {
      try {
        const sClean = alphaOut(track.ReservationNo);
        const sPad = sClean.padStart(10, '0');
        const sItem = sapKey(track.ReservationItem || '1', 'rspos').padStart(4, '0');
        const newTrPadded = freshTbnum.padStart(10, '0');
        const existing = await cds.db.run(
          cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
            .where({ ReservationNo: sPad, ReservationItem: sItem })
        ) || await cds.db.run(
          cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack')
            .where({ ReservationNo: sClean, ReservationItem: alphaOut(sItem) })
        );
        if (existing) {
          await cds.db.run(
            cds.ql.UPDATE('saps4hana.wm.ReservationTrack')
              .set({ TransferRequirement: newTrPadded, Status_code: STATUS.TR_CREATED, ProcessStatus: 'TR_CREATED' })
              .where({ ReservationNo: sPad, ReservationItem: sItem })
          ) || await cds.db.run(
            cds.ql.UPDATE('saps4hana.wm.ReservationTrack')
              .set({ TransferRequirement: newTrPadded, Status_code: STATUS.TR_CREATED, ProcessStatus: 'TR_CREATED' })
              .where({ ReservationNo: sClean, ReservationItem: alphaOut(sItem) })
          );
        } else {
          await cds.db.run(
            cds.ql.INSERT.into('saps4hana.wm.ReservationTrack').entries({
              ReservationNo: sPad,
              ReservationItem: sItem,
              MovementType: track.MovementType || '261',
              WarehouseNumber: wh,
              Plant: track.Plant,
              StorageLocation: track.StorageLocation,
              Material: track.Material,
              Quantity: track.Quantity,
              Unit: track.Unit || 'NOS',
              OrderID: track.OrderID || '',
              TransferRequirement: newTrPadded,
              Status_code: STATUS.TR_CREATED,
              ProcessStatus: 'TR_CREATED'
            })
          );
        }
      } catch (_updErr) {
        LOG.warn(`Failed updating ReservationTrack with replacement TR: ${_updErr.message}`);
      }
    }

    const newTr = await this.getTR(freshTbnum, wh);
    if (newTr) {
      newTr._recoveredFrom = alphaOut(tr.Tbnum);
      newTr._recoveredTrack = track;
    }
    return newTr;
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
      out[m] = rows?.[0]?.MAKTX || '';
    }
    return out;
  }

  /**
   * Warehouses the user may list without naming one: derived from the authenticated Plant attribute via T320
   * (Admin without a plant restriction: every warehouse in T320). Never a configured default. Cached 5 min per plant.
   */
  async _userWarehouses(user) {
    const plants = plantScope(user); // null = Admin (unrestricted)
    if (plants && plants.length === 0) {
      throw httpError(403, 'No warehouse can be derived: your user has no Plant attribute; select a warehouse or ask for the Plant assignment');
    }
    const now = Date.now();
    this._t320Cache = this._t320Cache || new Map();
    const readWarehouses = async (plant) => {
      const key = plant || '*';
      const hit = this._t320Cache.get(key);
      if (hit && hit.expiresAt > now) return hit.warehouses;
      const rows = await this._rfc(
        () => this.rfc.readTable('T320', ['WERKS', 'LGNUM'], plant ? [`WERKS = '${sapKey(plant, 'plant')}'`] : []),
        `Read warehouses of plant ${plant || '(all)'} (T320)`
      );
      const warehouses = Array.from(new Set((rows || []).map((r) => String(r.LGNUM || '').trim()).filter(Boolean)));
      this._t320Cache.set(key, { warehouses, expiresAt: now + 5 * 60 * 1000 });
      return warehouses;
    };
    const all = new Set();
    for (const plant of plants || ['']) for (const wh of await readWarehouses(plant)) all.add(wh);
    if (!all.size) {
      throw httpError(400, `No warehouse is assigned in SAP (T320) to plant ${plants ? plants.join(', ') : '(any)'}`);
    }
    return Array.from(all).sort();
  }

  async getOpenTRs(lgnum = '', mvt = '', user) {
    const warehouses = lgnum
      ? [await resolveWarehouse(this.rfc, { warehouseNumber: lgnum })]
      : await this._userWarehouses(user);
    const sMvt = sapKeyOpt(mvt, 'mvt');

    const rows = [];
    for (const wh of warehouses) {
      const where = [`LGNUM = '${wh}'`, "AND STATU <> 'E'"];
      if (sMvt) where.push(`AND BWLVS = '${sMvt}'`);
      rows.push(...await this._rfc(
        () => this.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU', 'BDATU'], where),
        `Read open TR list for warehouse ${wh}`
      ));
    }

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
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber: lgnum, trNumber: tbnum });
    const tr = sapKey(tbnum, 'tbnum').padStart(10, '0');
    this._lastTr = tr;
    LOG.info(`Reading TR ${tr} in warehouse ${wh}`);

    const res = await this._rfc(
      () => this.rfc.call('Z_WM_GET_TR_MATERIAL_LIST', { IV_TR_NUMBER: tr, IV_LGNUM: wh }),
      `Read Transfer Requirement ${alphaOut(tr)}`
    );
    const h = (res.ET_TR_HEADER || [])[0];
    if (!h) throw httpError(404, `Transfer Requirement ${alphaOut(tr)} not found in warehouse ${wh}`);
    if (wh && h.LGNUM && h.LGNUM !== wh) {
      throw httpError(400, `Transfer Requirement ${alphaOut(tr)} belongs to warehouse ${h.LGNUM}, not ${wh}`);
    }

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
   * Reads and verifies a Transfer Order directly from SAP tables LTAK (header) and LTAP (items).
   * Ensures the document actually exists and is persisted in SAP.
   */
  async getTransferOrder(tanum, lgnum) {
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber: lgnum, toNumber: tanum });
    const to = sapKey(tanum, 'tanum').padStart(10, '0');
    LOG.info(`Reading Transfer Order ${to} in warehouse ${wh}`);

    if (!this.rfc) return null;

    let heads = [];
    try {
      heads = await this._rfc(
        () => this.rfc.readTable(
          'LTAK',
          ['LGNUM', 'TANUM', 'TBNUM', 'BWLVS', 'KQUIT', 'BDATU'],
          [`LGNUM = '${wh}'`, `AND TANUM = '${to}'`],
          1
        ),
        `Read Transfer Order Header ${alphaOut(to)}`
      );
    } catch (hErr) {
      LOG.warn(`Failed reading LTAK for TO ${to}: ${hErr.message}`);
      return null;
    }

    const h = heads?.[0];
    if (!h) return null;

    let items = [];
    try {
      items = await this._rfc(
        () => this.rfc.readTable(
          'LTAP',
          ['LGNUM', 'TANUM', 'TAPOS', 'TBPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'NSOLA', 'VSOLA', 'ALTME', 'VLENR', 'PQUIT'],
          [`LGNUM = '${wh}'`, `AND TANUM = '${to}'`]
        ),
        `Read Transfer Order Items for ${alphaOut(to)}`
      );
    } catch (iErr) {
      LOG.warn(`Failed reading LTAP for TO ${to}: ${iErr.message}`);
    }

    return {
      Lgnum: h.LGNUM,
      Tanum: alphaOut(h.TANUM),
      TanumRaw: h.TANUM,
      Tbnum: alphaOut(h.TBNUM),
      TbnumRaw: h.TBNUM,
      Bwlvs: h.BWLVS,
      Kquit: h.KQUIT === 'X',
      Bdatu: h.BDATU,
      Items: (items || []).map((i) => ({
        Lgnum: i.LGNUM,
        Tanum: alphaOut(i.TANUM),
        Tapos: i.TAPOS,
        Tbpos: i.TBPOS,
        Material: alphaOut(i.MATNR),
        Plant: i.WERKS,
        StorageLocation: i.LGORT,
        Batch: i.CHARG,
        TargetQty: sapNum(i.NSOLA || i.VSOLA),
        Unit: i.ALTME,
        StorageUnit: alphaOut(i.VLENR),
        Pquit: i.PQUIT === 'X'
      }))
    };
  }

  /**
   * Reservation -> its open TR(s) via LTBK-RSNUM (field use proven by getOpenTRs). No TR means the backend
   * did not create one: status 11 (TR error), to be fixed in SAP, not by the operator.
   */
  async getTRByReservation(rsnum, lgnum) {
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber: lgnum, reservationNumber: rsnum });
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
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber: lgnum, trNumber: tbnum });
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
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber: lgnum, trNumber: tbnum });
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
  async createTO(params = {}) {
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber: params.lgnum, trNumber: params.tbnum });
    const tr = sapKey(params.tbnum, 'tbnum');
    const key = `${wh}:${tr}`;
    if (this._toCreateInFlight.has(key)) {
      throw httpError(409, `Transfer Order creation is already in progress for TR ${alphaOut(tr)} in warehouse ${wh}`);
    }

    this._toCreateInFlight.add(key);
    try {
      return await this._createTO(params);
    } finally {
      this._toCreateInFlight.delete(key);
    }
  }

  async _createTO({ lgnum, tbnum, lenum, qty } = {}) {
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

    // A retry after a lost response must not create another TO while SAP still has
    // an unconfirmed TO for this exact TR item. Confirmed TOs do not block a new pick.
    const pending = await this._rfc(
      () => findUnconfirmedToItems(this.rfc, wh, tr.Tbnum, item.Tbpos),
      `Check open Transfer Orders of TR ${alphaOut(tr.Tbnum)}`
    );
    if (pending.length) {
      throw httpError(409, `Unconfirmed Transfer Order ${alphaOut(pending[0].TANUM)} exists for TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos}; confirm it before creating another TO`);
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

    const tanum = alphaOut(res.EV_TANUM);
    const verified = await this.getTransferOrder(tanum, wh);
    const verifiedItem = verified?.Items.find((toItem) =>
      toItem.Tbpos === item.Tbpos &&
      toItem.Material === item.Material &&
      toItem.StorageUnit === alphaOut(su)
    );
    const expectedTr = sapKey(tr.Tbnum, 'tbnum');
    const actualTr = verified?.TbnumRaw ? sapKey(verified.TbnumRaw, 'tbnum') : '';
    if (!verified || verified.Lgnum !== wh || actualTr !== expectedTr || !verifiedItem) {
      const err = httpError(502, `Transfer Order ${tanum} was returned by SAP but read-back did not confirm the expected warehouse, TR, item, material, and Storage Unit`);
      err.Status = STATUS.TO_ERROR;
      err.ErrorStep = 'LT04';
      throw err;
    }

    return {
      TransferOrder: tanum,
      Success: true,
      Message: res.EV_MESSAGE || `Transfer Order ${tanum} created and verified in SAP.`,
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
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber, plant, storageLocation });
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
  async getAvailableSerials(material, _plant = '', _storageLocation = '', _batch = '') {
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
  async lookupTR(tbnum, lgnum = '', docType = '', tbpos = '', user = null) {
    const type = String(docType || '').trim().toUpperCase();
    if (type !== 'TR' && type !== 'RES') throw httpError(400, 'Select whether the scanned number is a Transfer Requirement (TR) or a Reservation (RES)');

    let wh = lgnum ? sapKey(lgnum, 'lgnum') : '';

    if (!wh && type === 'TR') {
      const s4Tr = sapKey(tbnum, 'tbnum').padStart(10, '0');
      const ltbkRows = await this._rfc(
        () => this.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'STATU', 'BDATU'], [`TBNUM = '${s4Tr}'`]),
        `Find TR ${alphaOut(s4Tr)} across warehouses`
      );

      if (!ltbkRows || !ltbkRows.length) {
        throw httpError(404, 'TR not found in any warehouse');
      }

      const foundLgnums = Array.from(new Set(ltbkRows.map((r) => r.LGNUM).filter(Boolean)));
      if (!foundLgnums.length) {
        throw httpError(404, 'TR not found in any warehouse');
      }

      // Read T320 filtered by the LGNUM values found in LTBK (requirement 3)
      const t320Where = foundLgnums.map((lg) => `LGNUM = '${sapKey(lg, 'lgnum')}'`);
      const t320Options = t320Where.map((clause, idx) => (idx === 0 ? clause : `OR ${clause}`));
      const t320Rows = await this._rfc(
        () => this.rfc.readTable('T320', ['LGNUM', 'WERKS'], t320Options),
        `Read T320 for warehouses ${foundLgnums.join(', ')}`
      );

      // Read LTBP items to discover plant per warehouse item
      const ltbpRows = await this._rfc(
        () => this.rfc.readTable('LTBP', ['LGNUM', 'TBNUM', 'WERKS'], [`TBNUM = '${s4Tr}'`]),
        `Read LTBP for TR ${alphaOut(s4Tr)}`
      );

      // Map plants per warehouse from T320 and LTBP
      const whPlants = new Map();
      foundLgnums.forEach((lg) => whPlants.set(lg, new Set()));
      (t320Rows || []).forEach((row) => {
        if (row.LGNUM && row.WERKS && whPlants.has(row.LGNUM)) {
          whPlants.get(row.LGNUM).add(row.WERKS);
        }
      });
      (ltbpRows || []).forEach((row) => {
        if (row.LGNUM && row.WERKS && whPlants.has(row.LGNUM)) {
          whPlants.get(row.LGNUM).add(row.WERKS);
        }
      });

      // Authorization filtering with plantScope (fail closed: requirement 2)
      // null = Admin (all allowed)
      // [] = no plants allowed (deny all)
      // ['1120', ...] = only those plants
      const allowedPlants = plantScope(user);

      const isWhAuthorized = (lg) => {
        if (allowedPlants === null) return true; // explicit Admin
        if (!Array.isArray(allowedPlants) || allowedPlants.length === 0) return false; // fail closed
        const plants = whPlants.get(lg);
        if (!plants || plants.size === 0) return false;
        for (const p of plants) {
          if (allowedPlants.includes(p)) return true;
        }
        return false;
      };

      const authRows = ltbkRows.filter((r) => isWhAuthorized(r.LGNUM));
      if (!authRows.length) {
        // Requirement 5: Return 404 "TR not found in any warehouse" instead of 403
        throw httpError(404, 'TR not found in any warehouse');
      }

      const candidates = authRows.map((r) => {
        const itemRow = (ltbpRows || []).find((i) => i.LGNUM === r.LGNUM);
        const t320Row = (t320Rows || []).find((t) => t.LGNUM === r.LGNUM);
        const plant = (itemRow && itemRow.WERKS) || (t320Row && t320Row.WERKS) || '';
        const createdDate = r.BDATU ? `${r.BDATU.slice(0, 4)}-${r.BDATU.slice(4, 6)}-${r.BDATU.slice(6, 8)}` : '';
        const cand = {
          lgnum: r.LGNUM,
          plant,
          movementType: r.BWLVS || '',
          statusCode: r.STATU || '',
          status: r.STATU === 'E' ? 'Completed' : 'Open',
          createdDate
        };
        return Object.assign({
          code: r.LGNUM,
          target: plant,
          message: JSON.stringify(cand),
          innererror: cand
        }, cand);
      });

      // Requirement 6 & Point 2:
      // Only open TRs count for auto-pick. If no open TR is in the user's scope,
      // return 404 "TR not found in any warehouse" rather than a 400 that reveals completed TR existence.
      const openCandidates = candidates.filter((c) => c.statusCode !== 'E');

      if (openCandidates.length === 1) {
        wh = openCandidates[0].lgnum;
      } else if (openCandidates.length > 1) {
        const err = httpError(409, 'TR exists in multiple warehouses');
        err.details = candidates;
        throw err;
      } else {
        // openCandidates.length === 0: no open TR in scope
        throw httpError(404, 'TR not found in any warehouse');
      }
    }

    if (!wh) {
      wh = await resolveWarehouse(this.rfc, {
        warehouseNumber: lgnum,
        trNumber: type === 'TR' ? tbnum : '',
        reservationNumber: type === 'RES' ? tbnum : ''
      });
    }

    let tr = type === 'RES' ? await this.getTRByReservation(tbnum, wh) : await this.getTR(tbnum, wh);

    if (wh && tr.Lgnum && tr.Lgnum !== wh) {
      throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} belongs to warehouse ${tr.Lgnum}, not ${wh}`);
    }
    if (tr.Statu === 'E') {
      const isCorrupted = await this._isCorruptedStagingTR(tr, wh);
      if (isCorrupted) {
        LOG.warn(`[lookupTR] TR ${alphaOut(tr.Tbnum)} has STATU = 'E' with NO Transfer Order in SAP, but Reservation ${alphaOut(isCorrupted.ReservationNo)} is open; auto-recovering to active staging TR...`);
        const recoveredTr = await this._recoverCorruptedStagingTR(tr, isCorrupted, wh);
        if (recoveredTr) {
          tr = recoveredTr;
        } else {
          throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} is already completed (STATU = E)`);
        }
      } else {
        throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} is already completed (STATU = E)`);
      }
    }

    const open = this._openItems(tr);
    if (!open.length) throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} has no open items (already completed)`);
    let item = null;
    if (tbpos) {
      const pos = sapKey(tbpos, 'tbpos').padStart(4, '0');
      item = open.find((i) => i.Tbpos === pos);
      if (!item) throw httpError(400, `TR ${alphaOut(tr.Tbnum)} has no open item ${pos}; open items: ${open.map((i) => i.Tbpos).join(', ')}`);
    } else if (open.length === 1) {
      item = open[0];
    }

    if (item) {
      if (!item.Material || !String(item.Material).trim()) {
        throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has missing or invalid material`);
      }
      if (!item.Plant || !String(item.Plant).trim()) {
        throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has missing plant`);
      }
      if (!item.StorageLocation || !String(item.StorageLocation).trim()) {
        throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has missing storage location`);
      }
      if (!(item.RequiredQty > 0)) {
        throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has invalid required quantity (${item.RequiredQty})`);
      }
      if (!(item.OpenQty > 0)) {
        throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has no open quantity (already completed)`);
      }
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
              ['LGTYP', 'LGORT', 'VERME'],
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
          const otherSlocs = [...new Set(
            (lquaOther || [])
              .filter((q) => !String(q.LGTYP || '').trim().startsWith('9'))
              .map((r) => String(r.LGORT || '').trim())
              .filter((s) => Boolean(s) && s !== sel.StorageLocation)
          )];
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
    let orderId = tr.Betyp === 'F' ? alphaOut(tr.Benum) : '';
    let backflush = false;

    let reservationMovementType = '';
    let trackedReservation = null;

    if (tr._recoveredTrack) {
      trackedReservation = tr._recoveredTrack;
      if (!reservationMovementType && tr._recoveredTrack.MovementType?.trim()) {
        reservationMovementType = tr._recoveredTrack.MovementType.trim();
      }
      if (!orderId && tr._recoveredTrack.OrderID?.trim()) {
        orderId = tr._recoveredTrack.OrderID.trim();
      }
      if (!receivingStorageLocation && tr._recoveredTrack.ReceivingStorageLocation?.trim()) {
        receivingStorageLocation = String(tr._recoveredTrack.ReceivingStorageLocation).trim().toUpperCase();
        recSLocSource = 'Tracking';
      }
      if (!receivingPlant && tr._recoveredTrack.ReceivingPlant?.trim()) {
        receivingPlant = String(tr._recoveredTrack.ReceivingPlant).trim().toUpperCase();
        recPlantSource = 'Tracking';
      }
      if (!costCenter && tr._recoveredTrack.CostCenter?.trim()) costCenter = tr._recoveredTrack.CostCenter.trim();
      if (!assetNo && tr._recoveredTrack.AssetNo?.trim()) {
        assetNo = tr._recoveredTrack.AssetNo.trim();
        subNumber = tr._recoveredTrack.SubNumber?.trim() || '0000';
      }
    }

    // 1. RESB (via RSNUM/RSPOS)
    if (tr.Rsnum && String(tr.Rsnum).trim() !== '' && String(tr.Rsnum).trim() !== '0000000000' && this.rfc) {
      try {
        const rsnumPadded = sapKey(tr.Rsnum, 'rsnum').padStart(10, '0');
        const resbRows = await this._rfc(
          () => this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'BWART', 'UMWRK', 'UMLGO', 'CHARG', 'AUFNR', 'RGEKZ'], [`RSNUM = '${rsnumPadded}'`], 10),
          `Read RESB for reservation ${alphaOut(rsnumPadded)}`
        );
        let matched = null;
        if (item?.Rspos && item.Rspos !== '0000') {
          matched = (resbRows || []).find((r) => r.RSPOS === item.Rspos);
        }
        matched = matched || (resbRows || [])[0];
        if (matched) {
          if (matched.BWART?.trim()) {
            reservationMovementType = matched.BWART.trim();
          }
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
          if (!orderId && matched.AUFNR?.trim()) {
            orderId = alphaOut(matched.AUFNR.trim());
          }
          if (matched.RGEKZ?.trim()) {
            backflush = true;
          }
        }
        if (!costCenter || !assetNo || !orderId) {
          const rkpfRows = await this._rfc(
            () => this.rfc.readTable('RKPF', ['KOSTL', 'ANLN1', 'ANLN2', 'AUFNR'], [`RSNUM = '${rsnumPadded}'`], 1),
            `Read RKPF for reservation ${alphaOut(rsnumPadded)}`
          );
          if (rkpfRows?.[0]) {
            if (!costCenter && rkpfRows[0].KOSTL?.trim()) costCenter = rkpfRows[0].KOSTL.trim();
            if (!assetNo && rkpfRows[0].ANLN1?.trim()) {
              assetNo = rkpfRows[0].ANLN1.trim();
              subNumber = rkpfRows[0].ANLN2?.trim() || '0000';
            }
            if (!orderId && rkpfRows[0].AUFNR?.trim()) {
              orderId = alphaOut(rkpfRows[0].AUFNR.trim());
            }
          }
        }
      } catch (_rErr) {
        LOG.warn(`Reservation lookup in lookupTR failed: ${_rErr.message}`);
      }
    }

    // 2. Tracking table (ReservationTrack by TBNUM)
    if (!receivingStorageLocation || !receivingPlant || !orderId) {
      try {
        const track = await this._findTrackedReservationForTR(tr.Tbnum, wh || tr.Lgnum);
        if (track) {
          trackedReservation = track;
          if (!reservationMovementType && track.MovementType?.trim()) {
            reservationMovementType = track.MovementType.trim();
          }
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
          if (!orderId && track.OrderID?.trim()) orderId = track.OrderID.trim();
        }
      } catch (_trackErr) {
        LOG.warn(`ReservationTrack lookup in lookupTR failed: ${_trackErr.message}`);
      }
    }

    // 3. MATDOC (via MBLNR)
    if ((!receivingStorageLocation || !receivingPlant) && tr.Mblnr && String(tr.Mblnr).trim() !== '' && String(tr.Mjahr || '').trim() !== '' && this.rfc) {
      try {
        const mblnr = String(tr.Mblnr).trim();
        const mjahr = String(tr.Mjahr).trim(); // from the TR header; never a guessed year
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

    // Shipping-managed storage location (T001L sales area maintained): SAP posts the goods issue through an outbound
    // delivery (L9 514) that must be picked in WM and, for serialized material, carry serial numbers before PGI.
    let shippingManaged = false;
    if (item && this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const t001l = await this.rfc.readTable('T001L', ['WERKS', 'LGORT', 'VKORG'], [`WERKS = '${sapKey(sel.Plant, 'plant')}'`, `AND LGORT = '${sapKey(sel.StorageLocation, 'lgort')}'`], 1);
        shippingManaged = Boolean(String(t001l?.[0]?.VKORG || '').trim());
      } catch (e) {
        LOG.warn(`T001L shipping-managed check failed for ${sel.Plant}/${sel.StorageLocation}: ${e.message}`);
      }
    }

    let warning = '';
    if (shippingManaged) {
      warning = `Storage location ${sel.StorageLocation} in plant ${sel.Plant} is shipping-managed (T001L sales area): the goods issue is posted through an outbound delivery; the app picks it (WM TO), assigns the scanned serial numbers and posts goods issue, each step read back from SAP`;
    }
    const trRsnumClean = String(tr.Rsnum || '').replace(/^0+/, '');
    const trRsposClean = String(item?.Rspos || '').replace(/^0+/, '');
    const trackRsnumClean = String(trackedReservation?.ReservationNo || '').replace(/^0+/, '');
    const trackRsposClean = String(trackedReservation?.ReservationItem || '').replace(/^0+/, '');

    const trackedMismatch = Boolean(
      trackedReservation && reservationMovementType && tr.Bwlvs && reservationMovementType !== tr.Bwlvs &&
      alphaOut(trackedReservation.TransferRequirement) === alphaOut(tr.Tbnum) &&
      (!trRsnumClean || (trRsnumClean === trackRsnumClean && (!trRsposClean || trRsposClean === trackRsposClean))) &&
      String(trackedReservation.MovementType || '').trim() === reservationMovementType
    );
    const allowMismatchedTR = isMismatchOverrideEnabled() || trackedMismatch;
    if (reservationMovementType && tr.Bwlvs && reservationMovementType !== tr.Bwlvs) {
      const mm = `TR movement ${tr.Bwlvs} does not match reservation movement ${reservationMovementType}`;
      warning = warning ? `${warning}; ${mm}` : mm;
    }
    if (tr._recoveredFrom) {
      const recMsg = `Corrupted TR ${alphaOut(tr._recoveredFrom)} (closed without TO) auto-recovered to active staging TR ${alphaOut(tr.Tbnum)}`;
      warning = warning ? `${recMsg}; ${warning}` : recMsg;
    }

    return {
      TransferRequirement: alphaOut(tr.Tbnum),
      TRNumber: alphaOut(tr.Tbnum),
      TRItem: item ? item.Tbpos : '',
      WarehouseNumber: wh,
      ShippingManaged: shippingManaged,
      MovementType: tr.Bwlvs || '',
      // TR created by an already posted IM document (header MBLNR): the goods movement is done, the TO only moves stock to the interim bin.
      MaterialDocument: tr.Mblnr && String(tr.Mblnr).trim() ? alphaOut(tr.Mblnr) : '',
      MaterialDocYear: String(tr.Mjahr || '').trim(),
      GoodsMovementPosted: Boolean(tr.Mblnr && String(tr.Mblnr).trim()),
      RequirementType: tr.Betyp || '',
      RequirementNumber: alphaOut(tr.Benum) || '',
      ReservationNo: (tr.Rsnum && tr.Rsnum !== '0000000000') ? alphaOut(tr.Rsnum) : (trackedReservation ? alphaOut(trackedReservation.ReservationNo) : ''),
      ReservationItem: (tr.Rsnum && tr.Rsnum !== '0000000000' && item?.Rspos && item.Rspos !== '0000') ? alphaOut(item.Rspos) : (trackedReservation ? alphaOut(trackedReservation.ReservationItem) : (item?.Rspos ? alphaOut(item.Rspos) : '')),
      ReservationMovementType: reservationMovementType,
      AllowMismatchedTR: allowMismatchedTR,
      Warning: warning || (stockWarning ? `Stock deficit: ${stockWarning}` : ''),
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
      OrderID: orderId,
      Backflush: backflush,
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
    const wh = await resolveWarehouse(this.rfc, { warehouseNumber: lgnum, toNumber });
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
    warehouseNumber = '',
    WarehouseNumber = '',
    tbnum,
    trNumber,
    TRNumber,
    tbpos = '',
    trItem = '',
    TRItem = '',
    qty,
    unit,
    material = '',
    Material = '',
    plant = '',
    Plant = '',
    storageLocation = '',
    StorageLocation = '',
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
    orderId = '',
    OrderId = '',
    OrderID = '',
    autoConfirm = false,
    autoPostMigo: _autoPostMigo = false,
    existingToNumber = '',
    status = '',
    confMenge,
    reservationMovementType = '',
    ReservationMovementType = '',
    reservationNo = '',
    ReservationNo = '',
    _reservationNo = '',
    _ReservationNo = '',
    reservationItem = '',
    ReservationItem = '',
    _reservationItem = '',
    _ReservationItem = '',
    trackedReservation = null
  } = {}) {
    // Step 1: TR reference resolution
    const effTbnum = tbnum || trNumber || TRNumber;
    if (!effTbnum) throw httpError(400, 'Transfer Requirement number (tbnum/trNumber) is required');

    const effWh = lgnum || warehouseNumber || WarehouseNumber || '';
    const wh = await resolveWarehouse(this.rfc, {
      warehouseNumber: effWh,
      trNumber: effTbnum,
      plant: plant || Plant,
      storageLocation: storageLocation || StorageLocation
    });

    // Step 2: Validate TR in SAP
    let tr = await this.getTR(effTbnum, wh);

    if (wh && tr.Lgnum && tr.Lgnum !== wh) {
      throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} belongs to warehouse ${tr.Lgnum}, not ${wh}`);
    }
    if (tr.Statu === 'E') {
      const isCorrupted = await this._isCorruptedStagingTR(tr, wh);
      if (isCorrupted) {
        LOG.warn(`[createTOFromTR] TR ${alphaOut(tr.Tbnum)} has STATU = 'E' with NO Transfer Order in SAP, but Reservation ${alphaOut(isCorrupted.ReservationNo)} is open; auto-recovering to active staging TR...`);
        const recoveredTr = await this._recoverCorruptedStagingTR(tr, isCorrupted, wh);
        if (recoveredTr) {
          tr = recoveredTr;
          if (trackedReservation) {
            trackedReservation.TransferRequirement = tr.Tbnum;
          }
        } else {
          throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} is already completed (STATU = E)`);
        }
      } else {
        throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} is already completed (STATU = E)`);
      }
    }

    let effResMvt = (ReservationMovementType || reservationMovementType || '').trim();
    if (!effResMvt && tr.Rsnum && String(tr.Rsnum).trim() !== '' && String(tr.Rsnum).trim() !== '0000000000' && this.rfc && !this.rfc.readTable?.mock) {
      try {
        const rsnumPadded = sapKey(tr.Rsnum, 'rsnum').padStart(10, '0');
        const resbRows = await this._rfc(
          () => this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'BWART'], [`RSNUM = '${rsnumPadded}'`], 1),
          `Read RESB for reservation ${alphaOut(rsnumPadded)}`
        );
        if (resbRows?.[0]?.BWART?.trim()) {
          effResMvt = resbRows[0].BWART.trim();
        }
      } catch (_) {}
    }

    const allowConfiguredMismatch = isMismatchOverrideEnabled();

    let finalRecPlant = (ReceivingPlant || receivingPlant) ? String(ReceivingPlant || receivingPlant).trim() : '';
    let finalRecSLoc = (ReceivingStorageLocation || receivingStorageLocation) ? String(ReceivingStorageLocation || receivingStorageLocation).trim() : '';
    let finalCostCenter = (CostCenter || costCenter) ? String(CostCenter || costCenter).trim() : (tr.Betyp === 'K' ? alphaOut(tr.Benum) : '');
    let finalAssetNo = (AssetNo || assetNo) ? String(AssetNo || assetNo).trim() : (tr.Betyp === 'A' ? alphaOut(tr.Benum) : '');
    let finalSubNumber = (SubNumber || subNumber) ? String(SubNumber || subNumber).trim() : (tr.Betyp === 'A' ? '0000' : '');
    let finalOrderId = (OrderID || OrderId || orderId) ? String(OrderID || OrderId || orderId).trim() : (tr.Betyp === 'F' ? alphaOut(tr.Benum) : '');

    const effTbpos = tbpos || trItem || TRItem || '';
    const open = this._openItems(tr);
    let item = null;
    if (effTbpos) {
      const pos = sapKey(effTbpos, 'tbpos').padStart(4, '0');
      item = open.find((i) => i.Tbpos === pos);
      if (!item) throw httpError(400, `TR ${alphaOut(tr.Tbnum)} has no open item ${pos}; open items: ${open.map((i) => i.Tbpos).join(', ') || 'none'}`);
    } else if (open.length === 1) {
      item = open[0];
    } else if (!open.length) {
      throw httpError(400, `Transfer Requirement ${alphaOut(tr.Tbnum)} has no open items (already completed)`);
    } else {
      throw httpError(400, `TR ${alphaOut(tr.Tbnum)} has ${open.length} open items (${open.map((i) => i.Tbpos).join(', ')}); choose one (tbpos)`);
    }

    const quantity = (qty !== undefined && qty !== null && qty !== '') ? Number(qty) : item.OpenQty;
    if (!(quantity > 0)) throw httpError(400, 'Quantity must be greater than zero');

    if (!item.Material || !String(item.Material).trim()) {
      throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has missing or invalid material`);
    }
    const reqMat = alphaOut(Material || material || '');
    if (reqMat && alphaOut(item.Material) !== reqMat) {
      throw httpError(400, `Material mismatch: requested ${reqMat}, but TR item has ${alphaOut(item.Material)}`);
    }

    if (!item.Plant || !String(item.Plant).trim()) {
      throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has missing plant`);
    }
    const reqPlant = String(Plant || plant || '').trim().toUpperCase();
    if (reqPlant && String(item.Plant).trim().toUpperCase() !== reqPlant) {
      throw httpError(400, `Plant mismatch: requested ${reqPlant}, but TR item has ${item.Plant}`);
    }

    if (!item.StorageLocation || !String(item.StorageLocation).trim()) {
      throw httpError(400, `TR ${alphaOut(tr.Tbnum)} item ${item.Tbpos} has missing storage location`);
    }
    const reqSLoc = String(StorageLocation || storageLocation || '').trim().toUpperCase();
    if (reqSLoc && String(item.StorageLocation).trim().toUpperCase() !== reqSLoc) {
      throw httpError(400, `Storage location mismatch: requested ${reqSLoc}, but TR item has ${item.StorageLocation}`);
    }

    if (!trackedReservation && tr._recoveredTrack) {
      trackedReservation = {
        TransferRequirement: tr.Tbnum,
        ReservationNo: tr._recoveredTrack.ReservationNo,
        ReservationItem: tr._recoveredTrack.ReservationItem,
        MovementType: tr._recoveredTrack.MovementType,
        OrderID: tr._recoveredTrack.OrderID
      };
      if (!effResMvt && tr._recoveredTrack.MovementType) {
        effResMvt = tr._recoveredTrack.MovementType;
      }
      if (!finalOrderId && tr._recoveredTrack.OrderID) {
        finalOrderId = tr._recoveredTrack.OrderID;
      }
    }

    if (!trackedReservation) {
      try {
        const track = await this._findTrackedReservationForTR(tr.Tbnum, wh || tr.Lgnum);
        if (track) {
          trackedReservation = {
            TransferRequirement: track.TransferRequirement,
            ReservationNo: track.ReservationNo,
            ReservationItem: track.ReservationItem,
            MovementType: track.MovementType,
            OrderID: track.OrderID
          };
          if (!finalOrderId && track.OrderID?.trim()) {
            finalOrderId = track.OrderID.trim();
          }
        }
      } catch (_) {}
    }

    const trRsnumClean = String(tr.Rsnum || '').replace(/^0+/, '');
    const trRsposClean = String(item.Rspos || '').replace(/^0+/, '');
    const trackRsnumClean = String(trackedReservation?.ReservationNo || '').replace(/^0+/, '');
    const trackRsposClean = String(trackedReservation?.ReservationItem || '').replace(/^0+/, '');

    const linkedTrackedMismatch = Boolean(
      effResMvt && tr.Bwlvs && effResMvt !== tr.Bwlvs && trackedReservation &&
      (
        alphaOut(trackedReservation.TransferRequirement) === alphaOut(tr.Tbnum) ||
        (tr._recoveredFrom && alphaOut(trackedReservation.TransferRequirement) === alphaOut(tr._recoveredFrom)) ||
        (Boolean(ReservationNo || reservationNo || _ReservationNo || _reservationNo) && alphaOut(trackedReservation.ReservationNo) === alphaOut(ReservationNo || reservationNo || _ReservationNo || _reservationNo))
      ) &&
      (!trRsnumClean || (trRsnumClean === trackRsnumClean && (!trRsposClean || trRsposClean === trackRsposClean))) &&
      String(trackedReservation.MovementType || '').trim() === effResMvt
    );
    if (effResMvt && tr.Bwlvs && effResMvt !== tr.Bwlvs && !allowConfiguredMismatch && !linkedTrackedMismatch) {
      throw httpError(400, `TR movement ${tr.Bwlvs} does not match reservation movement ${effResMvt}`);
    }

    if (quantity > item.OpenQty) {
      throw httpError(400, `Requested quantity (${quantity}) exceeds open TR quantity (${item.OpenQty} ${item.Unit})`);
    }

    // Validation of Receiving Storage Location & Receiving Plant
    // Receiving plant / storage location only matter for the IM posting that follows the TO. A TR that SAP created from an
    // already posted material document (header MBLNR) needs no posting: SAP's own document (e.g. 4900047610: 301 inside
    // plant 1130, HS01 -> MT01) is not re-validated or re-posted here.
    const goodsMovementPosted = Boolean(tr.Mblnr && String(tr.Mblnr).trim());
    if (finalRecSLoc && !goodsMovementPosted) {
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
              `AND LGORT = '${finalRecSLoc}'`
            ], 1),
            `Validate warehouse mapping for storage location ${finalRecSLoc}`
          );
          if (t320 && t320.length > 0) {
            const recWh = String(t320[0]?.LGNUM || '').trim();
            if (recWh && wh && recWh !== wh) {
              throw httpError(400, `Receiving Storage Location ${finalRecSLoc} in plant ${item.Plant} belongs to warehouse ${recWh}, not ${wh} (cross-warehouse transfer not supported in 311)`);
            }
          }
        }
      }
    }

    if (finalRecPlant && !goodsMovementPosted) {
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

    let verifiedTO = null;

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

      // Step 3: Create TO via Z_WM_TO_CREATE_FROM_TR
      LOG.info(`Creating TO from TR ${tr.Tbnum} item ${item.Tbpos}, qty ${quantity} ${unit || item.Unit}`);

      // Destination: TR header, else the warehouse movement-type customizing T333 (NLTYP/NLPLA, read from the
      // system: docs/abap/system-metadata.md §24). Never a literal default; no T333 row is an error.
      let nltyp = tr.Nltyp || '';
      let nlpla = tr.Nlpla || (tr.Betyp === 'F' && (finalOrderId || tr.Benum) ? alphaOut(finalOrderId || tr.Benum) : '');
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

      // Step 4: Receive TO number
      tanum = alphaOut(res.EV_TANUM);

      // Step 5: Verify TO directly from SAP (LTAK/LTAP) to guarantee persistence
      verifiedTO = await this.getTransferOrder(tanum, wh);
      if (!verifiedTO) {
        const err = httpError(500, `Transfer Order ${tanum} was created by SAP FM but cannot be verified in SAP LTAK (persistence check failed)`);
        err.Status = STATUS.TO_ERROR;
        err.ErrorStep = 'LT04';
        throw err;
      }
      if (verifiedTO.TbnumRaw && tr.Tbnum && sapKey(verifiedTO.TbnumRaw, 'tbnum') !== sapKey(tr.Tbnum, 'tbnum')) {
        const err = httpError(500, `Transfer Order ${tanum} verification failed: references TR ${verifiedTO.Tbnum}, expected TR ${alphaOut(tr.Tbnum)}`);
        err.Status = STATUS.TO_ERROR;
        err.ErrorStep = 'LT04';
        throw err;
      }
    } else {
      LOG.info(`TANUM ${tanum} is tracked as unconfirmed (status ${status}); skipping create and retrying confirmation only.`);
      verifiedTO = await this.getTransferOrder(tanum, wh);
      if (!verifiedTO) {
        const err = httpError(500, `Transfer Order ${tanum} cannot be verified in SAP LTAK`);
        err.Status = STATUS.TO_ERROR;
        err.ErrorStep = 'LT04';
        throw err;
      }
    }

    // Optional confirmation step if explicitly requested
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
    const toItem = verifiedTO?.Items?.[0]?.Tapos
      ? String(verifiedTO.Items[0].Tapos).padStart(4, '0')
      : (item?.Tbpos ? String(item.Tbpos).padStart(4, '0') : '0001');

    const effFinalResNo = (tr.Rsnum && String(tr.Rsnum).trim() !== '' && String(tr.Rsnum).trim() !== '0000000000')
      ? alphaOut(tr.Rsnum)
      : (trackedReservation?.ReservationNo
          ? alphaOut(trackedReservation.ReservationNo)
          : (ReservationNo || reservationNo || _ReservationNo || _reservationNo
              ? alphaOut(ReservationNo || reservationNo || _ReservationNo || _reservationNo)
              : ''));
    const effFinalResItem = item.Rspos && item.Rspos !== '0000'
      ? alphaOut(item.Rspos)
      : (trackedReservation?.ReservationItem
          ? alphaOut(trackedReservation.ReservationItem)
          : (ReservationItem || reservationItem || _ReservationItem || _reservationItem
              ? alphaOut(ReservationItem || reservationItem || _ReservationItem || _reservationItem)
              : '1'));

    // Step 6: Return TO (Standardized transactional response)
    if (autoConfirm && !confirmed) {
      const errMsg = confirmErr?.message || `Confirmation failed for Transfer Order ${tanum}`;
      return {
        success: false,
        stage: 'TO_CONFIRMATION',
        toNumber: tanum,
        error: errMsg,
        confirmed: false,
        trNumber: alphaOut(tr.Tbnum),
        toItem: toItem,

        TransferOrder: tanum,
        TransferRequirement: alphaOut(tr.Tbnum),
        TRItem: item.Tbpos,
        ReservationNo: effFinalResNo,
        ReservationItem: effFinalResItem,
        ReservationMovementType: effResMvt,
        MovementType: tr.Bwlvs || '',
        // TR created by an already posted IM document (header MBLNR): the goods movement is done, the TO only moves stock to the interim bin.
        MaterialDocument: tr.Mblnr && String(tr.Mblnr).trim() ? alphaOut(tr.Mblnr) : '',
        MaterialDocYear: String(tr.Mjahr || '').trim(),
        GoodsMovementPosted: Boolean(tr.Mblnr && String(tr.Mblnr).trim()),
        CostCenter: finalCostCenter,
        AssetNo: finalAssetNo,
        SubNumber: finalSubNumber,
        ReceivingPlant: finalRecPlant,
        ReceivingStorageLocation: finalRecSLoc,
        Betyp: tr.Betyp || '',
        Benum: tr.Benum || '',
        Status: currentStatus,
        StatusText: STATUS_TEXT[currentStatus],
        Confirmed: false,
        IsConfirmed: false,
        ConfirmationNumber: '',
        ConfirmedBy: '',
        ErrorStep: 'LT12',
        ErrorMessage: errMsg,
        Material: item.Material,
        MaterialName: item.MaterialDesc,
        Plant: item.Plant,
        StorageLocation: item.StorageLocation,
        Quantity: quantity,
        ConfirmedQuantity: 0,
        Unit: unit || item.Unit,
        Batch: selectedBatch,
        Serials: serialList,
        Success: false,
        Message: `Transfer Order ${tanum} created, but confirmation failed (status ${STATUS.TO_CONFIRM_ERROR}): ${errMsg}`
      };
    }

    return {
      success: true,
      trNumber: alphaOut(tr.Tbnum),
      toNumber: tanum,
      toItem: toItem,
      confirmed: Boolean(confirmed),

      TransferOrder: tanum,
      TransferRequirement: alphaOut(tr.Tbnum),
      TRItem: item.Tbpos,
      ReservationNo: effFinalResNo,
      ReservationItem: effFinalResItem,
      ReservationMovementType: effResMvt,
      MovementType: tr.Bwlvs || '',
      // TR created by an already posted IM document (header MBLNR): the goods movement is done, the TO only moves stock to the interim bin.
      MaterialDocument: tr.Mblnr && String(tr.Mblnr).trim() ? alphaOut(tr.Mblnr) : '',
      MaterialDocYear: String(tr.Mjahr || '').trim(),
      GoodsMovementPosted: Boolean(tr.Mblnr && String(tr.Mblnr).trim()),
      CostCenter: finalCostCenter,
      AssetNo: finalAssetNo,
      SubNumber: finalSubNumber,
      OrderID: finalOrderId,
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
      ErrorStep: '',
      ErrorMessage: '',
      Material: item.Material,
      MaterialName: item.MaterialDesc,
      Plant: item.Plant,
      StorageLocation: item.StorageLocation,
      Quantity: quantity,
      ConfirmedQuantity: confirmed ? (confMenge || quantity) : 0,
      Unit: unit || item.Unit,
      Batch: selectedBatch,
      Serials: serialList,
      Success: true,
      Message: confirmed
        ? `Transfer Order ${tanum} created and confirmed successfully.`
        : `Transfer Order ${tanum} created successfully (status ${STATUS.TO_CREATED}).`
    };
  }

}

TrToAdapter._internals = { sapNum, alphaIn, alphaOut, sapDate, mapStorageTypeSearchError };
module.exports = TrToAdapter;
