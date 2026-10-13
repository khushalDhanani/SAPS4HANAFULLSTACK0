'use strict';

const LOG = require('../logger')('reservation-process-adapter');
const { RfcClient } = require('../RfcClient');
const { sapKey, sapKeyOpt, httpError } = require('../sapKey');
const { STATUS } = require('../../../common/wmStatus');
const { isToFullyConfirmed, getHuConfirmationItems, mapStorageTypeSearchError } = require('./toState');
const { checkAuthorization } = require('./authCheck');

/** GM_CODE per movement type. Only the four supported types; nothing is derived for other types. */
const GM_CODE = Object.freeze({ '201': '03', '241': '03', '311': '04', '301': '04' });
// VERIFY IN SE37 / TEST: GM_CODE '06' (MB11) used to be the fallback for other movement types; it is not applied
// until a live posting proves it for a concrete movement type.

const pad10 = (v) => String(v || '').trim().padStart(10, '0');
const pad12 = (v) => String(v || '').trim().padStart(12, '0');
const pad4 = (v) => String(v || '').trim().padStart(4, '0');
const alphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');
const padMat = (m) => (/^\d+$/.test(m) ? m.padStart(18, '0') : m);

class ReservationProcessAdapter {
  constructor(options = {}) {
    this.rfc = options.rfc || new RfcClient();
  }

  /** Same adapter bound to another RFC client (used to run a step inside one locked RFC session). */
  withRfc(rfc) {
    return new this.constructor({ rfc });
  }

  /**
   * Helper to format dates to SAP format (YYYYMMDD)
   */
  _sapDate(date = new Date()) {
    if (typeof date === 'string' && /^\d{8}$/.test(date)) return date;
    const d = new Date(date);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Step 1: create_reservation
   * Wraps BAPI_RESERVATION_CREATE1
   */
  async createReservation(params = {}) {
    const {
      movementType,
      plant,
      storageLocation,
      material,
      quantity,
      unit,
      receivingPlant,
      receivingStorageLocation,
      costCenter,
      assetNo,
      subNumber,
      testrun = false
    } = params;

    if (!movementType) throw httpError(400, 'MovementType is mandatory');
    if (!plant) throw httpError(400, 'Plant is mandatory');
    if (!material) throw httpError(400, 'Material is mandatory');
    if (!quantity || Number(quantity) <= 0) throw httpError(400, 'Valid Quantity is mandatory');
    if (!unit) throw httpError(400, 'Unit is mandatory');

    const targetMovePlant = receivingPlant || (String(movementType).trim() === '311' ? plant : '');
    const header = {
      RES_DATE: this._sapDate(),
      MOVE_TYPE: String(movementType).trim(),
      ...(targetMovePlant ? { MOVE_PLANT: String(targetMovePlant).trim() } : {}),
      ...(receivingStorageLocation ? { MOVE_STLOC: String(receivingStorageLocation).trim() } : {}),
      ...(costCenter ? { COSTCENTER: pad10(costCenter) } : {}),
      ...(assetNo ? { ASSET_NO: pad12(assetNo) } : {}),
      ...(subNumber ? { SUB_NUMBER: pad4(subNumber) } : {})
    };

    const s4Mat = padMat(sapKey(material, 'matnr'));
    const item = {
      MATERIAL: s4Mat,
      PLANT: sapKey(plant, 'plant'),
      ...(storageLocation ? { STGE_LOC: String(storageLocation).trim() } : {}),
      ENTRY_QNT: Number(quantity),
      ENTRY_UOM: String(unit).trim().toUpperCase(),
      MOVEMENT: 'X'
    };

    // Preflight: BAPI_RESERVATION_CREATE1 rejects any storage location the material is not extended to
    // (MARD), returning a cryptic "No storage location data for <mat> in <plant> <sloc>; ... BUS2093 not
    // created". Validate every SLoc the reservation touches up front and fail with the SLocs it IS in.
    if (this.rfc && storageLocation) {
      const slocChecks = [{ plant: sapKey(plant, 'plant'), sloc: sapKey(storageLocation, 'lgort'), role: 'issuing' }];
      if (header.MOVE_STLOC) {
        slocChecks.push({ plant: sapKey(targetMovePlant, 'plant'), sloc: sapKey(header.MOVE_STLOC, 'lgort'), role: 'receiving' });
      }
      for (const chk of slocChecks) {
        let extended;
        try {
          const rows = await this.rfc.readTable('MARD', ['LGORT'], [`MATNR = '${s4Mat}'`, `AND WERKS = '${chk.plant}'`], 50);
          extended = (rows || []).map((r) => (r.LGORT || '').trim()).filter(Boolean);
        } catch (_mardErr) {
          continue; // MARD read failed: let the BAPI do its own validation rather than block a valid create
        }
        if (!extended.includes(chk.sloc)) {
          const avail = extended.length ? extended.join(', ') : '(none - extend the material to a storage location via MM01)';
          throw httpError(400, `Material ${alphaOut(s4Mat)} is not extended to ${chk.role} storage location ${chk.sloc} in plant ${chk.plant}. Choose one of: ${avail}.`);
        }
      }
    }

    return await this.rfc.session(async (call) => {
      const res = await call('BAPI_RESERVATION_CREATE1', {
        RESERVATIONHEADER: header,
        RESERVATIONITEMS: [item],
        ...(testrun ? { TESTRUN: 'X' } : {})
      });

      const errors = (res.RETURN || []).filter((r) => r.TYPE === 'E' || r.TYPE === 'A');
      if (errors.length) {
        const msg = errors.map((e) => e.MESSAGE).join('; ');
        throw httpError(400, `BAPI_RESERVATION_CREATE1 failed: ${msg}`);
      }

      if (!testrun) {
        await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
      }

      const resNo = res.RESERVATION ? alphaOut(res.RESERVATION) : '';
      return {
        success: true,
        reservationNo: resNo,
        reservationNoRaw: res.RESERVATION,
        reservationItem: '0001',
        status: STATUS.RES_CREATED,
        messages: res.RETURN || []
      };
    });
  }

  /**
   * Step 2: create_tr
   * Wraps L_TR_CREATE with fallback to custom wrapper ZWM_TR_CREATE
   */
  async createTransferRequirement(params = {}) {
    const {
      warehouseNumber,
      wmMovementType,
      material,
      plant,
      storageLocation,
      quantity,
      unit,
      reservationNo,
      reservationItem = '0001',
      movementType,
      isTransferPosting: reqIsTransferPosting
    } = params;

    if (!warehouseNumber) throw httpError(400, 'WarehouseNumber is mandatory');
    if (!material) throw httpError(400, 'Material is mandatory');
    if (!reservationNo) throw httpError(400, 'ReservationNo is mandatory');
    if (!wmMovementType) throw httpError(400, 'MovementType is mandatory');
    if (!(Number(quantity) > 0)) throw httpError(400, 'Valid Quantity is mandatory');
    if (!unit) throw httpError(400, 'Unit is mandatory');

    const s4Mat = padMat(sapKey(material, 'matnr'));
    const s4Rsnum = sapKey(reservationNo, 'rsnum').padStart(10, '0');
    const s4Rspos = sapKey(reservationItem, 'rspos').padStart(4, '0');
    const s4Lgnum = sapKey(warehouseNumber, 'lgnum');
    // In WM customizing (T333), movement 201/241 require BENUM (Cost Center/Asset). For reservation-based staging, WM movement 311 links cleanly to RSNUM without requiring BENUM.
    const s4Bwlvs = sapKey(wmMovementType === '201' || wmMovementType === '241' ? '311' : wmMovementType, 'mvt');
    const s4Werks = sapKey(plant, 'plant');
    const s4Lgort = sapKey(storageLocation, 'lgort');
    const s4Menga = Number(quantity);
    const s4Altme = String(unit).trim().toUpperCase();

    // For transfer postings (311 and 301), linking RSNUM directly on the TR header causes standard SAP L_TO_CREATE_TR
    // to execute restrictive reservation checks that throw XFELD_WRONG. Omitting RSNUM on the WM staging TR allows clean TO creation and confirmation.
    const isTransferPosting = Boolean(
      reqIsTransferPosting ||
      movementType === '311' ||
      movementType === '301'
    );
    const s4TrRsnum = isTransferPosting ? '' : s4Rsnum;
    const s4TrRspos = isTransferPosting ? '' : s4Rspos;

    const ltbaItem = {
      LGNUM: s4Lgnum,
      BWLVS: s4Bwlvs,
      MATNR: s4Mat,
      WERKS: s4Werks,
      LGORT: s4Lgort,
      MENGA: s4Menga,
      ALTME: s4Altme,
      RSNUM: s4TrRsnum,
      RSPOS: s4TrRspos
    };

    return await this.rfc.session(async (call) => {
      let res;
      let tbnum = '';
      let tbpos = '0001';
      let returnedItem = {};

      try {
        res = await call('L_TR_CREATE', {
          I_COMMIT_WORK: 'X',
          I_SAVE_ONLY_ALL: 'X',
          I_SINGLE_ITEM: 'X',
          T_LTBA: [ltbaItem]
        });

        returnedItem = (res.T_LTBA || [])[0] || {};
        tbnum = returnedItem.TBNUM ? alphaOut(returnedItem.TBNUM) : '';
        tbpos = returnedItem.TBPOS || '0001';
      } catch (err) {
        // Fallback to the custom RFC wrappers (ZWM_TR_CREATE / Z_WM_TR_CREATE) when L_TR_CREATE is rejected
        try {
          let resZ;
          try {
            resZ = await call('ZWM_TR_CREATE', {
              IV_LGNUM: s4Lgnum,
              IV_BWLVS: s4Bwlvs,
              IV_MATNR: s4Mat,
              IV_WERKS: s4Werks,
              IV_LGORT: s4Lgort,
              IV_MENGA: s4Menga,
              IV_ALTME: s4Altme,
              IV_RSNUM: s4TrRsnum,
              IV_RSPOS: s4TrRspos,
              IV_COMMIT: 'X'
            });
          } catch (_z1Err) {
            resZ = await call('Z_WM_TR_CREATE', {
              IV_LGNUM: s4Lgnum,
              IV_BWLVS: s4Bwlvs,
              IV_MATNR: s4Mat,
              IV_WERKS: s4Werks,
              IV_LGORT: s4Lgort,
              IV_MENGA: s4Menga,
              IV_ALTME: s4Altme,
              IV_RSNUM: s4TrRsnum,
              IV_RSPOS: s4TrRspos,
              IV_COMMIT: 'X'
            });
          }

          const rawTbnum = resZ && (resZ.EV_TBNUM || resZ.E_TBNUM);
          const cleanTbnum = rawTbnum && rawTbnum !== '0000000000' ? alphaOut(rawTbnum) : '';
          if (cleanTbnum) {
            tbnum = cleanTbnum;
            tbpos = resZ.EV_TBPOS || resZ.E_TBPOS || '0001';
            return {
              success: true,
              warehouseNumber,
              trNumber: tbnum,
              trNumberRaw: rawTbnum,
              trItem: tbpos,
              status: STATUS.TR_CREATED,
              item: resZ
            };
          } else if (resZ && resZ.EV_SUCCESS === 'E' && resZ.EV_MESSAGE) {
            throw new Error(resZ.EV_MESSAGE);
          }
        } catch (_zwmErr) {
          if (_zwmErr.message && !_zwmErr.message.includes('NOT_FOUND') && !_zwmErr.message.includes('RFC_NO_AUTHORITY')) {
            throw _zwmErr;
          }
        }

        // No wrapper produced a TR: surface SAP's own message; the caller records status 11 (TR error).
        throw err;
      }

      return {
        success: true,
        warehouseNumber,
        trNumber: tbnum,
        trNumberRaw: returnedItem.TBNUM,
        trItem: tbpos,
        status: STATUS.TR_CREATED,
        item: returnedItem
      };
    });
  }

  /**
   * Step 3: create_to_from_tr
   * Wraps L_TO_CREATE_TR
   */
  async createTransferOrderFromTR(params = {}) {
    const { warehouseNumber, trNumber, commitWork = true, movementType = '311' } = params;

    if (!warehouseNumber) throw httpError(400, 'WarehouseNumber is mandatory');
    if (!trNumber) throw httpError(400, 'TRNumber is mandatory');

    const s4Tr = sapKey(trNumber, 'tbnum').padStart(10, '0');
    const wh = sapKey(warehouseNumber, 'lgnum');

    return await this.rfc.session(async (call) => {
      let res;
      try {
        res = await call('L_TO_CREATE_TR', {
          I_LGNUM: wh,
          I_TBNUM: s4Tr,
          I_COMMIT_WORK: commitWork ? 'X' : ' '
        });
      } catch (err) {
        if (err.message && err.message.includes('Data for storage type search is not defined')) {
          throw new Error(mapStorageTypeSearchError(err.message, wh, movementType));
        }
        // Fallback to ZWM_TO_CREATE_FROM_TR / Z_WM_TO_CREATE_FROM_TR wrapper if L_TO_CREATE_TR UCON blocked externally
        try {
          res = await call('ZWM_TO_CREATE_FROM_TR', {
            IV_LGNUM: wh,
            IV_TBNUM: s4Tr,
            IV_COMMIT: commitWork ? 'X' : ' '
          });
        } catch (z1Err) {
          if (z1Err.message && z1Err.message.includes('Data for storage type search is not defined')) {
            throw new Error(mapStorageTypeSearchError(z1Err.message, wh, movementType));
          }
          res = await call('Z_WM_TO_CREATE_FROM_TR', {
            IV_LGNUM: wh,
            IV_TBNUM: s4Tr,
            IV_COMMIT: commitWork ? 'X' : ' '
          });
        }
      }

      const tanum = res?.E_TANUM || res?.EV_TANUM || '';
      if (!tanum || tanum === '0000000000') {
        const errMsg = res?.EV_MESSAGE || 'No Transfer Order document created';
        throw new Error(errMsg);
      }

      return {
        success: true,
        warehouseNumber,
        toNumber: alphaOut(tanum),
        toNumberRaw: tanum,
        status: STATUS.TO_CREATED
      };
    });
  }

  /**
   * Step 4: confirm_to
   * Wraps L_TO_CONFIRM
   */
  async confirmTransferOrder(params = {}) {
    const { warehouseNumber, toNumber, squit = 'X', commitWork = true } = params;

    if (!warehouseNumber) throw httpError(400, 'WarehouseNumber is mandatory');
    if (!toNumber) throw httpError(400, 'TransferOrder (toNumber) is mandatory');

    const s4To = sapKey(toNumber, 'tanum').padStart(10, '0');
    const s4Lgnum = sapKey(warehouseNumber, 'lgnum');

    const confirmParams = {
      I_LGNUM: s4Lgnum,
      I_TANUM: s4To,
      I_SQUIT: squit,
      I_COMMIT_WORK: commitWork ? 'X' : ' '
    };

    try {
      await this.rfc.session(async (call) => call('L_TO_CONFIRM', confirmParams));
    } catch (err) {
      const errMsg = String(err?.message || '');
      const isMissingDestHu = errMsg.includes('destination handling unit') || errMsg.includes('848');
      if (isMissingDestHu) {
        try {
          const confHu = await getHuConfirmationItems(this.rfc, s4Lgnum, s4To);
          if (confHu.length > 0) {
            confirmParams.T_LTAP_CONF_HU = confHu;
            await this.rfc.session(async (call) => call('L_TO_CONFIRM', confirmParams));
            return {
              success: true,
              warehouseNumber,
              toNumber: alphaOut(toNumber),
              status: STATUS.TO_CONFIRMED,
              confirmed: true
            };
          }
        } catch (huErr) {
          LOG.warn(`HU confirmation retry for TO ${alphaOut(s4To)} failed: ${huErr.message}`);
        }
      }

      // SAP rejected the call: decide from the TO's real state (LTAP-PQUIT), not from a message number.
      let confirmedInSap = false;
      try { confirmedInSap = await isToFullyConfirmed(this.rfc, s4Lgnum, s4To); } catch (_readErr) { /* keep original error */ }
      if (!confirmedInSap) throw err;
      LOG.info(`Transfer Order ${alphaOut(s4To)} is already confirmed in SAP (LTAP-PQUIT)`);
    }

    return {
      success: true,
      warehouseNumber,
      toNumber: alphaOut(toNumber),
      status: STATUS.TO_CONFIRMED,
      confirmed: true
    };
  }

  /** SAP authorization pre-check (see ./authCheck.js). */
  checkAuthorization(object, fields = {}) {
    return checkAuthorization(this.rfc, object, fields);
  }

  /**
   * Step 5: post_migo
   * Wraps BAPI_GOODSMVT_CREATE.
   *  - RESERV_NO/RES_ITEM only when the caller/tracking row names a reservation (never looked up by material).
   *  - NO_MORE_GR only when completeReservation === true (operator ticked "complete reservation").
   *  - processId: PROCESS_ID of this GI step, written to ITEM_TEXT (MATDOC-SGTXT, CHAR 50, §13); before posting,
   *    MATDOC is searched for it so a retry never posts twice.
   *  - Batch: input -> reservation (RESB) -> TO (LTAP); none for a batch-managed material (MARC-XCHPF) stops with 400.
   */
  async postGoodsMovement(params = {}) {
    const {
      reservationNo,
      reservationItem = '0001',
      movementType,
      material,
      plant,
      storageLocation,
      quantity,
      unit,
      receivingPlant,
      receivingStorageLocation,
      costCenter,
      assetNo,
      subNumber,
      batch,
      serials = [],
      completeReservation = false,
      processId = '',
      testrun = false
    } = params;

    if (!movementType) throw httpError(400, 'MovementType is mandatory');
    if (!material) throw httpError(400, 'Material is mandatory');
    if (!plant) throw httpError(400, 'Plant is mandatory');
    if (!quantity || Number(quantity) <= 0) throw httpError(400, 'Valid Quantity is mandatory');
    if (!unit) throw httpError(400, 'Unit is mandatory');

    const sMvt = sapKey(movementType, 'mvt');
    const sGmCode = params.gmCode || GM_CODE[sMvt];
    if (!sGmCode) throw httpError(400, `Unsupported movement type for goods movement: ${sMvt} (supported: 201, 241, 311, 301)`);

    const sResNo = reservationNo && reservationNo !== '0' && reservationNo !== '0000000000' ? sapKey(reservationNo, 'rsnum').padStart(10, '0') : '';
    const sResItem = sapKey(reservationItem || '0001', 'rspos').padStart(4, '0');
    let sRecPlant = sapKeyOpt(receivingPlant, 'plant');
    let sRecSLoc = sapKeyOpt(receivingStorageLocation, 'lgort');
    const s4Mat = padMat(sapKey(material, 'matnr'));
    const sPlant = sapKey(plant, 'plant');
    const sSLoc = sapKeyOpt(storageLocation, 'lgort');
    const sTanum = sapKeyOpt(params.transferOrder, 'tanum');
    const sProcessId = processId ? sapKey(processId, 'uuid') : '';
    const today = this._sapDate();

    const hasRes = Boolean(sResNo);
    if (!hasRes && !sTanum && !params.allowDirectMovement) {
      throw httpError(400, 'ReservationNo is mandatory');
    }

    // Pre-MIGO check (Task 6): read T321 for the movement; if TBFKZ = X, set warning and log
    let t321Warning = '';
    const checkT321 = process.env.WM_PRE_MIGO_T321_CHECK === 'true' || process.env.WM_CHECK_T321_AUTO_TR === 'true';
    if (checkT321 && this.rfc) {
      try {
        const wh = params.warehouseNumber || 'W01';
        const t321Rows = await this.rfc.readTable(
          'T321',
          ['LGNUM', 'RBLVS', 'TBFKZ'],
          [`( LGNUM = '***' OR LGNUM = '${wh}' )`, `AND RBLVS = '${sMvt}'`]
        );
        const autoTrRow = (t321Rows || []).find((r) => String(r.TBFKZ || '').trim() === 'X');
        if (autoTrRow) {
          t321Warning = 'goods movement will create an additional TR';
          LOG.warn(`[postGoodsMovement] ${t321Warning} (movement ${sMvt}, T321-TBFKZ = X)`);
        }
      } catch (tErr) {
        LOG.warn(`[postGoodsMovement] Pre-MIGO T321 check error: ${tErr.message}`);
      }
    }

    // Retry guard: a material document already carrying this PROCESS_ID (or matching reservation/TO) means the step was posted.
    if (this.rfc) {
      let found = null;
      if (sProcessId) {
        const where = [`SGTXT = '${sProcessId}'`, `AND MATNR = '${s4Mat}'`, `AND WERKS = '${sPlant}'`, "AND CANCELLED = ''", "AND REVERSAL_MOVEMENT = ''"];
        found = await this.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR'], where, 1);
      }
      // SAP standard BAPI_GOODSMVT_CREATE leaves MSEG-SGTXT blank when referencing reservations (KBA 1518592 / ZXMBCU02);
      // fallback to reservation reference (RSNUM + RSPOS) so retrying an already completed step never double-posts in SAP.
      if (!found?.[0]?.MBLNR && hasRes) {
        const resWhere = [`RSNUM = '${sResNo}'`, `AND RSPOS = '${sResItem}'`, `AND BWART = '${sMvt}'`, "AND CANCELLED = ''", "AND REVERSAL_MOVEMENT = ''"];
        found = await this.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR'], resWhere, 1);
      }
      if (!found?.[0]?.MBLNR && sTanum && !hasRes) {
        const toWhere = [`XBLNR = 'TO ${sTanum}'`, `AND BWART = '${sMvt}'`, "AND CANCELLED = ''", "AND REVERSAL_MOVEMENT = ''"];
        found = await this.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR'], toWhere, 1);
      }
      if (found?.[0]?.MBLNR) {
        LOG.info(`Material document ${found[0].MBLNR}/${found[0].MJAHR} already exists for process/reservation; not posting again`);
        return {
          success: true,
          alreadyPosted: true,
          materialDocument: found[0].MBLNR,
          materialDocYear: found[0].MJAHR,
          status: STATUS.GI_POSTED,
          reservationNo: sResNo,
          processId: sProcessId,
          batch: sapKeyOpt(batch, 'batch'),
          stockEffect: this._computeStockEffect(sMvt, { ...params, receivingPlant: sRecPlant, receivingStorageLocation: sRecSLoc }),
          messages: [],
          ...(t321Warning ? { warning: t321Warning } : {})
        };
      }
    }

    // Batch tier 1: caller
    let sBatch = sapKeyOpt(batch, 'batch');

    // Tier 2 (and receiving plant/sloc) from the reservation item itself
    if (hasRes && (!sRecPlant || !sRecSLoc || !sBatch) && this.rfc) {
      try {
        const resbRows = await this.rfc.readTable('RESB', ['UMWRK', 'UMLGO', 'CHARG'], [
          `RSNUM = '${sResNo}'`,
          `AND RSPOS = '${sResItem}'`
        ], 1);
        if (resbRows?.[0]) {
          if (!sRecPlant && resbRows[0].UMWRK?.trim()) sRecPlant = resbRows[0].UMWRK.trim();
          if (!sRecSLoc && resbRows[0].UMLGO?.trim()) sRecSLoc = resbRows[0].UMLGO.trim();
          if (!sBatch && resbRows[0].CHARG?.trim()) sBatch = resbRows[0].CHARG.trim().toUpperCase();
        }
      } catch (_rErr) { /* RESB read is best effort; the batch check below decides */ }
    }

    // Tier 3: the confirmed TO item
    if (!sBatch && this.rfc && sTanum) {
      try {
        const toRows = await this.rfc.readTable('LTAP', ['CHARG'], [
          `TANUM = '${sTanum.padStart(10, '0')}'`,
          "AND CHARG <> ''"
        ], 1);
        if (toRows?.[0]?.CHARG?.trim()) sBatch = toRows[0].CHARG.trim().toUpperCase();
      } catch (_tErr) { /* same as above */ }
    }

    // No tier 4: a batch is never taken from interim storage quants. Batch-managed material without a batch stops here.
    if (!sBatch && this.rfc) {
      const marc = await this.rfc.readTable('MARC', ['XCHPF'], [`MATNR = '${s4Mat}'`, `AND WERKS = '${sPlant}'`], 1);
      if (String(marc?.[0]?.XCHPF || '').trim() === 'X') {
        throw httpError(400, `Batch is required for batch-managed material ${alphaOut(s4Mat)} in plant ${sPlant}: none supplied, none on reservation ${alphaOut(sResNo) || '-'} (RESB), none on Transfer Order ${alphaOut(sTanum) || '-'} (LTAP)`);
      }
    }

    const header = {
      PSTNG_DATE: today,
      DOC_DATE: today,
      REF_DOC_NO: hasRes ? `RES ${sResNo}` : (sTanum ? `TO ${sTanum}` : 'WM SCAN-TO'),
      ...(sProcessId ? { HEADER_TXT: sProcessId.replace(/-/g, '').slice(0, 25) } : {})
    };

    const item = {
      MATERIAL: s4Mat,
      PLANT: sPlant,
      ...(sSLoc ? { STGE_LOC: sSLoc } : {}),
      MOVE_TYPE: sMvt,
      ENTRY_QNT: Number(quantity),
      ENTRY_UOM: String(unit).trim(),
      ...(sBatch ? { BATCH: sBatch } : {}),
      ...(hasRes ? { RESERV_NO: sResNo, RES_ITEM: sResItem } : {}),
      ...(hasRes && completeReservation === true ? { NO_MORE_GR: 'X' } : {}),
      ...(sProcessId ? { ITEM_TEXT: sProcessId } : {}),
      ...(sRecPlant ? { MOVE_PLANT: sRecPlant } : {}),
      ...(sRecSLoc ? { MOVE_STLOC: sRecSLoc } : {}),
      ...(costCenter ? { COSTCENTER: pad10(costCenter) } : {}),
      ...(assetNo ? { ASSET_NO: pad12(assetNo) } : {}),
      ...(subNumber ? { SUB_NUMBER: pad4(subNumber) } : {})
    };

    const serialItems = (Array.isArray(serials) ? serials : [serials]).filter(Boolean).map((s) => ({
      MATDOC_ITM: '0001',
      SERIALNO: sapKey(s, 'serial')
    }));

    return await this.rfc.session(async (call) => {
      const res = await call('BAPI_GOODSMVT_CREATE', {
        GOODSMVT_HEADER: header,
        GOODSMVT_CODE: { GM_CODE: sGmCode },
        GOODSMVT_ITEM: [item],
        ...(serialItems.length ? { GOODSMVT_SERIALNUMBER: serialItems } : {}),
        ...(testrun ? { TESTRUN: 'X' } : {})
      });

      const errors = (res.RETURN || []).filter((r) => r.TYPE === 'E' || r.TYPE === 'A');
      if (errors.length) {
        if (!testrun) {
          try {
            await call('BAPI_TRANSACTION_ROLLBACK', {});
          } catch (rbErr) {
            // suppress rollback call error
          }
        }
        const msg = errors.map((e) => e.MESSAGE).join('; ');
        throw httpError(400, `BAPI_GOODSMVT_CREATE failed: ${msg}`);
      }

      if (!testrun) {
        await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
      }

      const matDoc = res.MATERIALDOCUMENT || (res.GOODSMVT_HEADRET && res.GOODSMVT_HEADRET.MAT_DOC) || '';
      const docYear = res.MATDOCUMENTYEAR || (res.GOODSMVT_HEADRET && res.GOODSMVT_HEADRET.DOC_YEAR) || '';

      return {
        success: true,
        alreadyPosted: false,
        materialDocument: matDoc,
        materialDocYear: docYear,
        status: STATUS.GI_POSTED,
        reservationNo: sResNo,
        processId: sProcessId,
        batch: sBatch,
        stockEffect: this._computeStockEffect(sMvt, { ...params, receivingPlant: sRecPlant, receivingStorageLocation: sRecSLoc }),
        messages: res.RETURN || [],
        ...(t321Warning ? { warning: t321Warning } : {})
      };
    });
  }

  /**
   * Application Log (SLG1) Integration:
   * Wraps BAL_LOG_CREATE, BAL_LOG_MSG_ADD, and BAL_DB_SAVE
   */
  async writeApplicationLog(params = {}) {
    const {
      object = 'ZWM_RES',
      subObject = 'TRACK',
      externalId = '',
      reservationNo = '',
      reservationItem = '0001',
      step = '',
      status = '',
      messageType = 'I',
      messageId = 'ZWM',
      messageNo = '001',
      messageText = '',
      messages = []
    } = params;

    const extId = externalId || (reservationNo ? `${reservationNo}/${reservationItem}` : `LOG_${Date.now()}`);

    const logHeader = {
      OBJECT: String(object).trim(),
      SUBOBJECT: String(subObject).trim(),
      EXTNUMBER: String(extId).substring(0, 100),
      ALDATE: this._sapDate(),
      ALTIME: new Date().toTimeString().split(' ')[0].replace(/:/g, '')
    };

    const msgList = messages.length > 0 ? messages : [{
      MSGTY: messageType || 'I',
      MSGID: messageId || 'ZWM',
      MSGNO: messageNo || '001',
      MSGBV1: String(reservationNo || '').substring(0, 50),
      MSGBV2: String(step || '').substring(0, 50),
      MSGBV3: String(messageText || '').substring(0, 50),
      MSGBV4: String(status || '').substring(0, 50)
    }];

    return await this.rfc.session(async (call) => {
      let logHandle = '';
      try {
        const createRes = await call('BAL_LOG_CREATE', {
          I_S_LOG: logHeader
        });
        logHandle = createRes.E_LOG_HANDLE || '';

        if (logHandle) {
          for (const m of msgList) {
            await call('BAL_LOG_MSG_ADD', {
              I_LOG_HANDLE: logHandle,
              I_S_MSG: {
                MSGTY: m.MSGTY || m.messageType || 'I',
                MSGID: m.MSGID || m.messageId || 'ZWM',
                MSGNO: m.MSGNO || m.messageNo || '001',
                MSGV1: m.MSGBV1 || m.messageV1 || '',
                MSGV2: m.MSGBV2 || m.messageV2 || '',
                MSGV3: m.MSGBV3 || m.messageV3 || '',
                MSGV4: m.MSGBV4 || m.messageV4 || ''
              }
            });
          }

          await call('BAL_DB_SAVE', {
            I_T_LOG_HANDLE: [logHandle]
          });
        }
      } catch (err) {
        LOG.warn('BAL_LOG execution note:', err.message);
      }

      // Generate fallback standard 22-char handle if not assigned by SAP
      if (!logHandle) {
        const ts = Date.now().toString(36).toUpperCase();
        const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
        logHandle = `LOG_${ts}_${rand}`.padEnd(22, '0').substring(0, 22);
      }

      return {
        success: true,
        logHandle,
        externalId: extId,
        object,
        subObject,
        messageCount: msgList.length,
        status: 'LOGGED'
      };
    });
  }

  /**
   * Read Application Logs (SLG1):
   * Reads logs by log handle or external ID
   */
  async readApplicationLogs(params = {}) {
    const { logHandle, externalId, object = 'ZWM_RES', subObject = 'TRACK' } = params;

    return await this.rfc.session(async (call) => {
      try {
        const res = await call('BAL_GLB_SEARCH_LOG', {
          I_S_LOG_FILTER: {
            OBJECT: [{ SIGN: 'I', OPTION: 'EQ', LOW: object }],
            SUBOBJECT: [{ SIGN: 'I', OPTION: 'EQ', LOW: subObject }],
            ...(externalId ? { EXTNUMBER: [{ SIGN: 'I', OPTION: 'EQ', LOW: externalId }] } : {})
          }
        });
        return {
          success: true,
          logs: res.E_T_LOG_HANDLE || []
        };
      } catch (err) {
        LOG.warn('BAL_GLB_SEARCH_LOG note:', err.message);
        return {
          success: true,
          logs: logHandle ? [logHandle] : []
        };
      }
    });
  }

  /**
   * Helper: compute human-readable stock effect description
   */
  _computeStockEffect(movementType, params = {}) {
    const mvt = String(movementType).trim();
    switch (mvt) {
      case '201':
        return `Stock consumed to Cost Center ${params.costCenter || ''}`.trim();
      case '241':
        return `Stock consumed to Asset ${params.assetNo || ''}${params.subNumber ? '/' + params.subNumber : ''}`.trim();
      case '311':
        return `Stock transferred to Storage Location ${params.receivingStorageLocation || ''}`.trim();
      case '301':
        return `Stock transferred to Plant ${params.receivingPlant || ''}`.trim();
      default:
        return `Goods Movement ${mvt} posted`;
    }
  }
}

module.exports = ReservationProcessAdapter;
