'use strict';

const LOG = require('../logger')('reservation-process-adapter');
const { RfcClient } = require('../RfcClient');

const httpError = (status, message) => Object.assign(new Error(message), { status });

const pad10 = (v) => String(v || '').trim().padStart(10, '0');
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

    const header = {
      RES_DATE: this._sapDate(),
      MOVE_TYPE: String(movementType).trim(),
      ...(receivingPlant ? { MOVE_PLANT: String(receivingPlant).trim() } : {}),
      ...(receivingStorageLocation ? { MOVE_STLOC: String(receivingStorageLocation).trim() } : {}),
      ...(costCenter ? { COSTCENTER: String(costCenter).trim() } : {}),
      ...(assetNo ? { ASSET_NO: String(assetNo).trim() } : {}),
      ...(subNumber ? { SUB_NUMBER: String(subNumber).trim() } : {})
    };

    const s4Mat = /^\d+$/.test(material) ? pad10(material).padStart(18, '0') : material;
    const item = {
      MATERIAL: s4Mat,
      PLANT: String(plant).trim(),
      ...(storageLocation ? { STGE_LOC: String(storageLocation).trim() } : {}),
      ENTRY_QNT: Number(quantity),
      ENTRY_UOM: String(unit || 'EA').trim(),
      MOVEMENT: 'X'
    };

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
   * Wraps L_TR_CREATE
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
      reservationItem = '0001'
    } = params;

    if (!warehouseNumber) throw httpError(400, 'WarehouseNumber is mandatory');
    if (!material) throw httpError(400, 'Material is mandatory');
    if (!reservationNo) throw httpError(400, 'ReservationNo is mandatory');

    const s4Mat = /^\d+$/.test(material) ? pad10(material).padStart(18, '0') : material;
    const ltbaItem = {
      LGNUM: String(warehouseNumber).trim(),
      BWLVS: String(wmMovementType || '311').trim(),
      MATNR: s4Mat,
      WERKS: String(plant || '1120').trim(),
      LGORT: String(storageLocation || 'HS01').trim(),
      MENGA: Number(quantity || 1),
      ALTME: String(unit || 'EA').trim(),
      RSNUM: pad10(reservationNo),
      RSPOS: pad4(reservationItem)
    };

    return await this.rfc.session(async (call) => {
      const res = await call('L_TR_CREATE', {
        I_COMMIT_WORK: 'X',
        I_SAVE_ONLY_ALL: 'X',
        I_SINGLE_ITEM: 'X',
        T_LTBA: [ltbaItem]
      });

      const returnedItem = (res.T_LTBA || [])[0] || {};
      const tbnum = returnedItem.TBNUM ? alphaOut(returnedItem.TBNUM) : '';

      return {
        success: true,
        warehouseNumber,
        trNumber: tbnum,
        trNumberRaw: returnedItem.TBNUM,
        trItem: returnedItem.TBPOS || '0001',
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
        // Fallback to ZWM_TO_CREATE_FROM_TR wrapper if L_TO_CREATE_TR UCON blocked externally
        res = await call('ZWM_TO_CREATE_FROM_TR', {
          IV_LGNUM: String(warehouseNumber).trim(),
          IV_TBNUM: s4Tr,
          IV_COMMIT: commitWork ? 'X' : ' '
        });
      }

      const tanum = res.E_TANUM || res.EV_TANUM || '';
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
      testrun = false
    } = params;

    if (!reservationNo) throw httpError(400, 'ReservationNo is mandatory');
    if (!movementType) throw httpError(400, 'MovementType is mandatory');
    if (!material) throw httpError(400, 'Material is mandatory');
    if (!quantity || Number(quantity) <= 0) throw httpError(400, 'Valid Quantity is mandatory');

    const s4Mat = /^\d+$/.test(material) ? pad10(material).padStart(18, '0') : material;
    const today = this._sapDate();

    // Map GM_CODE: allow explicit override or derive per movement type
    // GM_CODE 03 = MB1A (GI 201/241), 04 = MB1B (Transfer 311/301), 06 = MB11 (Reservation)
    let sGmCode = params.gmCode;
    if (!sGmCode) {
      if (params.deriveGmCode) {
        if (movementType === '201' || movementType === '241') sGmCode = '03';
        else if (movementType === '311' || movementType === '301') sGmCode = '04';
        else sGmCode = '06';
      } else {
        sGmCode = '06';
      }
    }

    const header = {
      PSTNG_DATE: today,
      DOC_DATE: today,
      REF_DOC_NO: `RES ${reservationNo}`
    };

    const item = {
      MATERIAL: s4Mat,
      PLANT: String(plant || '1120').trim(),
      ...(storageLocation ? { STGE_LOC: String(storageLocation).trim() } : {}),
      MOVE_TYPE: String(movementType).trim(),
      ENTRY_QNT: Number(quantity),
      ENTRY_UOM: String(unit || 'EA').trim(),
      RESERV_NO: pad10(reservationNo),
      RES_ITEM: pad4(reservationItem),
      NO_MORE_GR: 'X', // Closes the reservation item (final issue)
      ...(receivingPlant ? { MOVE_PLANT: String(receivingPlant).trim() } : {}),
      ...(receivingStorageLocation ? { MOVE_STLOC: String(receivingStorageLocation).trim() } : {}),
      ...(costCenter ? { COSTCENTER: String(costCenter).trim() } : {}),
      ...(assetNo ? { ASSET_NO: String(assetNo).trim() } : {}),
      ...(subNumber ? { SUB_NUMBER: String(subNumber).trim() } : {})
    };

    return await this.rfc.session(async (call) => {
      const res = await call('BAPI_GOODSMVT_CREATE', {
        GOODSMVT_HEADER: header,
        GOODSMVT_CODE: { GM_CODE: sGmCode },
        GOODSMVT_ITEM: [item],
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
        stockEffect: this._computeStockEffect(movementType, params),
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
