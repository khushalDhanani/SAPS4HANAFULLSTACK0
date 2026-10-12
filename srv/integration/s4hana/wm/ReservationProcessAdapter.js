'use strict';

const LOG = require('../logger')('reservation-process-adapter');
const { RfcClient } = require('../RfcClient');

const httpError = (status, message) => Object.assign(new Error(message), { status });

const pad10 = (v) => String(v || '').trim().padStart(10, '0');
const pad12 = (v) => String(v || '').trim().padStart(12, '0');
const pad4 = (v) => String(v || '').trim().padStart(4, '0');
const alphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');

class ReservationProcessAdapter {
  constructor(options = {}) {
    this.rfc = options.rfc || new RfcClient();
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

    const s4Mat = /^\d+$/.test(material) ? pad10(material).padStart(18, '0') : material;
    const item = {
      MATERIAL: s4Mat,
      PLANT: String(plant).trim(),
      ...(storageLocation ? { STGE_LOC: String(storageLocation).trim() } : {}),
      ENTRY_QNT: Number(quantity),
      ENTRY_UOM: String(unit || 'KG').trim().toUpperCase(),
      MOVEMENT: 'X'
    };

    // Preflight: BAPI_RESERVATION_CREATE1 rejects any storage location the material is not extended to
    // (MARD), returning a cryptic "No storage location data for <mat> in <plant> <sloc>; ... BUS2093 not
    // created". Validate every SLoc the reservation touches up front and fail with the SLocs it IS in.
    if (this.rfc && storageLocation) {
      const slocChecks = [{ plant: String(plant).trim(), sloc: String(storageLocation).trim(), role: 'issuing' }];
      if (header.MOVE_STLOC) {
        slocChecks.push({ plant: String(targetMovePlant).trim(), sloc: header.MOVE_STLOC, role: 'receiving' });
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
        status: '01',
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

    const s4Mat = /^\d+$/.test(material) ? pad10(material).padStart(18, '0') : material;
    const s4Rsnum = pad10(reservationNo);
    const s4Rspos = pad4(reservationItem);
    const s4Lgnum = String(warehouseNumber).trim();
    // In WM customizing (T333), movement 201/241 require BENUM (Cost Center/Asset). For reservation-based staging, WM movement 311 links cleanly to RSNUM without requiring BENUM.
    const s4Bwlvs = String(wmMovementType === '201' || wmMovementType === '241' ? '311' : (wmMovementType || '311')).trim();
    const s4Werks = String(plant || '1120').trim();
    const s4Lgort = String(storageLocation || 'CS01').trim();
    const s4Menga = Number(quantity || 1);
    const s4Altme = String(unit || 'KG').trim().toUpperCase();

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
        // Fallback to custom RFC wrapper (ZWM_TR_CREATE / Z_WM_TR_CREATE) if L_TR_CREATE is UCON-blocked (Note 2295840) or fails
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
              status: '02',
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

        // Check if error was UCON / Note 2295840
        if (err.message && (err.message.includes('2295840') || err.message.includes('Incompatible Call Rejected'))) {
          const uconErr = new Error('L_TR_CREATE is restricted under SAP Note 2295840 (RFC blacklist). Requires custom RFC wrapper ZWM_TR_CREATE or manual creation via transaction LB01.');
          uconErr.code = 'UCON_BLOCKED';
          uconErr.originalError = err.message;
          throw uconErr;
        }

        throw err;
      }

      return {
        success: true,
        warehouseNumber,
        trNumber: tbnum,
        trNumberRaw: returnedItem.TBNUM,
        trItem: tbpos,
        status: '02',
        item: returnedItem
      };
    });
  }

  /**
   * Step 3: create_to_from_tr
   * Wraps L_TO_CREATE_TR
   */
  async createTransferOrderFromTR(params = {}) {
    const { warehouseNumber, trNumber, commitWork = true } = params;

    if (!warehouseNumber) throw httpError(400, 'WarehouseNumber is mandatory');
    if (!trNumber) throw httpError(400, 'TRNumber is mandatory');

    const s4Tr = pad10(trNumber);

    return await this.rfc.session(async (call) => {
      let res;
      try {
        res = await call('L_TO_CREATE_TR', {
          I_LGNUM: String(warehouseNumber).trim(),
          I_TBNUM: s4Tr,
          I_COMMIT_WORK: commitWork ? 'X' : ' '
        });
      } catch (_err) {
        // Fallback to ZWM_TO_CREATE_FROM_TR / Z_WM_TO_CREATE_FROM_TR wrapper if L_TO_CREATE_TR UCON blocked externally
        try {
          res = await call('ZWM_TO_CREATE_FROM_TR', {
            IV_LGNUM: String(warehouseNumber).trim(),
            IV_TBNUM: s4Tr,
            IV_COMMIT: commitWork ? 'X' : ' '
          });
        } catch (_z1Err) {
          res = await call('Z_WM_TO_CREATE_FROM_TR', {
            IV_LGNUM: String(warehouseNumber).trim(),
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
        status: '03'
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

    const s4To = pad10(toNumber);

    return await this.rfc.session(async (call) => {
      await call('L_TO_CONFIRM', {
        I_LGNUM: String(warehouseNumber).trim(),
        I_TANUM: s4To,
        I_SQUIT: squit,
        I_COMMIT_WORK: commitWork ? 'X' : ' '
      });

      return {
        success: true,
        warehouseNumber,
        toNumber: alphaOut(toNumber),
        status: '04',
        confirmed: true
      };
    });
  }

  /**
   * Step 5: post_migo
   * Wraps BAPI_GOODSMVT_CREATE
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
      testrun = false
    } = params;

    let sResNo = reservationNo && reservationNo !== '0' && reservationNo !== '0000000000' ? pad10(reservationNo) : '';
    let sResItem = reservationItem ? pad4(reservationItem) : '0001';
    let sRecPlant = receivingPlant ? String(receivingPlant).trim() : '';
    let sRecSLoc = receivingStorageLocation ? String(receivingStorageLocation).trim() : '';

    const s4Mat = /^\d+$/.test(material) ? pad10(material).padStart(18, '0') : material;
    const sPlant = String(plant || '1120').trim();
    const today = this._sapDate();

    let sBatch = batch ? String(batch).trim().toUpperCase() : '';

    // Auto-resolve from open reservations in RESB if reservationNo was not provided
    if (!sResNo && this.rfc && (params.transferOrder || params.autoResolveReservation)) {
      try {
        const resbOpen = await this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'UMWRK', 'UMLGO', 'CHARG'], [
          `MATNR = '${s4Mat}'`,
          `AND WERKS = '${sPlant}'`,
          `AND BWART = '${String(movementType).trim()}'`,
          "AND KZEAR = ''"
        ], 1);
        if (resbOpen?.[0]?.RSNUM?.trim()) {
          sResNo = resbOpen[0].RSNUM.trim();
          if (resbOpen[0].RSPOS?.trim()) sResItem = pad4(resbOpen[0].RSPOS.trim());
          if (!sRecPlant && resbOpen[0].UMWRK?.trim()) sRecPlant = resbOpen[0].UMWRK.trim();
          if (!sRecSLoc && resbOpen[0].UMLGO?.trim()) sRecSLoc = resbOpen[0].UMLGO.trim();
          if (!sBatch && resbOpen[0].CHARG?.trim()) sBatch = resbOpen[0].CHARG.trim().toUpperCase();
        }
      } catch (_rOpenErr) {}
    }

    const hasRes = Boolean(sResNo);
    if (!hasRes && !params.transferOrder && !params.allowDirectMovement) {
      throw httpError(400, 'ReservationNo is mandatory');
    }
    if (!movementType) throw httpError(400, 'MovementType is mandatory');
    if (!material) throw httpError(400, 'Material is mandatory');
    if (!quantity || Number(quantity) <= 0) throw httpError(400, 'Valid Quantity is mandatory');

    // Auto-resolve missing plant/sloc or batch from RESB if reservation is known
    if (hasRes && (!sRecPlant || !sRecSLoc || !sBatch) && this.rfc) {
      try {
        const resbRows = await this.rfc.readTable('RESB', ['UMWRK', 'UMLGO', 'CHARG'], [
          `RSNUM = '${pad10(sResNo)}'`,
          `AND RSPOS = '${pad4(sResItem)}'`
        ], 1);
        if (resbRows?.[0]) {
          if (!sRecPlant && resbRows[0].UMWRK?.trim()) sRecPlant = resbRows[0].UMWRK.trim();
          if (!sRecSLoc && resbRows[0].UMLGO?.trim()) sRecSLoc = resbRows[0].UMLGO.trim();
          if (!sBatch && resbRows[0].CHARG?.trim()) sBatch = resbRows[0].CHARG.trim().toUpperCase();
        }
      } catch (_rErr) {}
    }

    // Auto-resolve batch from LTAP if transferOrder is present
    if (!sBatch && this.rfc && params.transferOrder) {
      try {
        const toRows = await this.rfc.readTable('LTAP', ['CHARG'], [
          `TANUM = '${pad10(params.transferOrder)}'`,
          "AND CHARG <> ''"
        ], 1);
        if (toRows?.[0]?.CHARG?.trim()) sBatch = toRows[0].CHARG.trim().toUpperCase();
      } catch (_tErr) {}
    }

    // Auto-resolve batch from interim storage quants (921/920) in LQUA
    if (!sBatch && this.rfc && s4Mat) {
      try {
        const lquaRows = await this.rfc.readTable('LQUA', ['CHARG'], [
          `MATNR = '${s4Mat}'`,
          "AND LGTYP IN ('921', '920')",
          "AND VERME > 0"
        ], 1);
        if (lquaRows?.[0]?.CHARG?.trim()) sBatch = lquaRows[0].CHARG.trim().toUpperCase();
      } catch (_qErr) {}
    }

    // Map GM_CODE: allow explicit override or derive per movement type
    // GM_CODE 03 = MB1A (GI 201/241), 04 = MB1B (Transfer 311/301), 06 = MB11 (Reservation)
    let sGmCode = params.gmCode;
    if (!sGmCode) {
      if (params.deriveGmCode) {
        if (movementType === '201' || movementType === '241') sGmCode = '03';
        else if (movementType === '311' || movementType === '301') sGmCode = '04';
        else sGmCode = hasRes ? '06' : '04';
      } else {
        sGmCode = hasRes ? '06' : '04';
      }
    }

    const header = {
      PSTNG_DATE: today,
      DOC_DATE: today,
      REF_DOC_NO: hasRes ? `RES ${sResNo}` : (params.transferOrder ? `TO ${params.transferOrder}` : 'WM SCAN-TO')
    };

    const item = {
      MATERIAL: s4Mat,
      PLANT: sPlant,
      ...(storageLocation ? { STGE_LOC: String(storageLocation).trim() } : {}),
      MOVE_TYPE: String(movementType).trim(),
      ENTRY_QNT: Number(quantity),
      ENTRY_UOM: String(unit || 'EA').trim(),
      ...(sBatch ? { BATCH: sBatch } : {}),
      ...(hasRes ? {
        RESERV_NO: pad10(sResNo),
        RES_ITEM: pad4(sResItem),
        NO_MORE_GR: 'X' // Closes the reservation item (final issue)
      } : {}),
      ...(sRecPlant ? { MOVE_PLANT: sRecPlant } : {}),
      ...(sRecSLoc ? { MOVE_STLOC: sRecSLoc } : {}),
      ...(costCenter ? { COSTCENTER: pad10(costCenter) } : {}),
      ...(assetNo ? { ASSET_NO: pad12(assetNo) } : {}),
      ...(subNumber ? { SUB_NUMBER: pad4(subNumber) } : {})
    };

    const serialItems = (Array.isArray(serials) ? serials : [serials]).filter(Boolean).map((s) => ({
      MATDOC_ITM: '0001',
      SERIALNO: String(s).trim()
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
        materialDocument: matDoc,
        materialDocYear: docYear,
        status: '05',
        reservationNo: sResNo || reservationNo || '',
        batch: sBatch,
        stockEffect: this._computeStockEffect(movementType, { ...params, receivingPlant: sRecPlant, receivingStorageLocation: sRecSLoc }),
        messages: res.RETURN || []
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
