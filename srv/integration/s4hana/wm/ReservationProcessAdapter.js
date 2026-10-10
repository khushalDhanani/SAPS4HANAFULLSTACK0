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
      ...(receivingPlant ? { MOVE_PLANT: String(receivingPlant).trim() } : {}),
      ...(receivingStorageLocation ? { MOVE_STLOC: String(receivingStorageLocation).trim() } : {}),
      ...(costCenter ? { COSTCENTER: String(costCenter).trim() } : {}),
      ...(assetNo ? { ASSET_NO: String(assetNo).trim() } : {}),
      ...(subNumber ? { SUB_NUMBER: String(subNumber).trim() } : {})
    };

    return await this.rfc.session(async (call) => {
      const res = await call('BAPI_GOODSMVT_CREATE', {
        GOODSMVT_HEADER: header,
        GOODSMVT_CODE: { GM_CODE: '06' },
        GOODSMVT_ITEM: [item],
        ...(testrun ? { TESTRUN: 'X' } : {})
      });

      const errors = (res.RETURN || []).filter((r) => r.TYPE === 'E' || r.TYPE === 'A');
      if (errors.length) {
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
        messages: res.RETURN || []
      };
    });
  }
}

module.exports = ReservationProcessAdapter;
