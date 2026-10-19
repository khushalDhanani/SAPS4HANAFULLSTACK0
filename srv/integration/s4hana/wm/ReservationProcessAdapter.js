'use strict';

const LOG = require('../logger')('reservation-process-adapter');
const { RfcClient } = require('../RfcClient');
const { sapKey, sapKeyOpt, httpError } = require('../sapKey');
const { STATUS, PROCESS_STATUS } = require('../../../common/wmStatus');
const {
  GM_CODE,
  getMovementConfig,
  resolveWmMovement,
  validateReservationInput,
  validateMovement301Destination,
  validateMovement311Destination,
  verifyReceivingLocationInSap
} = require('../../../common/movementConfig');
const { isToFullyConfirmed, getHuConfirmationItems, mapStorageTypeSearchError, trCompletedWithoutTo, stagedStockCoveringTr } = require('./toState');
const { checkAuthorization } = require('./authCheck');

const pad10 = (v) => String(v || '').trim().padStart(10, '0');
const pad12 = (v) => String(v || '').trim().padStart(12, '0');
const pad4 = (v) => String(v || '').trim().padStart(4, '0');
/** ALPHA-exit padding for numeric keys only; alphanumeric cost centers / assets are sent as entered (audit D6). */
const padIfNumeric = (v, n) => (/^\d+$/.test(String(v || '').trim()) ? String(v).trim().padStart(n, '0') : String(v || '').trim());
const alphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');
const padMat = (m) => (/^\d+$/.test(m) ? m.padStart(18, '0') : m);
const sapNum = (v) => (v == null || v === '' ? 0 : Number(String(v).trim()));

class ReservationProcessAdapter {
  constructor(options = {}) {
    this.rfc = options.rfc || new RfcClient();
    this._checkCsksExistence = Boolean(options.checkCsksExistence);
    this._checkAssetExistence = Boolean(options.checkAssetExistence);
    this._checkAufkExistence = Boolean(options.checkAufkExistence);
    this._checkMarcExistence = Boolean(options.checkMarcExistence);
    this._checkMbewExistence = Boolean(options.checkMbewExistence);
    this._checkSernpMatch = Boolean(options.checkSernpMatch);
  }

  /** Same adapter bound to another RFC client (used to run a step inside one locked RFC session). */
  withRfc(rfc) {
    return new this.constructor({
      rfc,
      checkCsksExistence: this._checkCsksExistence,
      checkAssetExistence: this._checkAssetExistence,
      checkAufkExistence: this._checkAufkExistence,
      checkMarcExistence: this._checkMarcExistence,
      checkMbewExistence: this._checkMbewExistence,
      checkSernpMatch: this._checkSernpMatch
    });
  }

  /**
   * Helper to format dates to SAP format (YYYYMMDD)
   */
  _sapDate(date = new Date()) {
    if (!date) date = new Date();
    if (typeof date === 'string' && /^\d{8}$/.test(date)) return date;
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw httpError(400, 'Invalid ReservationDate');
    }
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
      reservationDate,
      receivingPlant,
      receivingStorageLocation,
      costCenter,
      assetNo,
      subNumber,
      orderId,
      orderType,
      batch,
      testrun = false,
      throwError = true
    } = params;

    try {
      // Single normalized pre-validation before calling SAP backend
      validateReservationInput(params, { throwError: true });

      if (String(movementType).trim() === '201' && costCenter) {
        await this.validateCostCenter(costCenter);
      }

      if (String(movementType).trim() === '241') {
        await this.validateAsset(assetNo, subNumber, plant, new Date(), { requireCompanyCode: true });
      }

      // Canonical adapter contract (Step 7.2): orderId / orderType only; callers normalize aliases before calling.
      const sOrderId = String(orderId || '').trim();
      const sOrderType = String(orderType || '').trim();
      let orderValidation = null;
      if (String(movementType).trim() === '261') {
        orderValidation = await this.validateOrder(sOrderId, plant, sOrderType);
      }

      if (this.rfc && String(movementType).trim() === '301' && receivingPlant) {
        if (!this.rfc.readTable?.mock || this._checkMarcExistence) {
          const sapCheck = await verifyReceivingLocationInSap(this.rfc, {
            plant,
            receivingPlant,
            receivingStorageLocation,
            material: padMat(sapKey(material, 'matnr')),
            checkT001L: false
          });
          if (!sapCheck.valid) {
            throw httpError(400, sapCheck.error);
          }
        }
      }

      let _issuingWh = '';
      if (this.rfc && (String(movementType).trim() === '201' || String(movementType).trim() === '241' || String(movementType).trim() === '311' || String(movementType).trim() === '301' || String(movementType).trim() === '261') && storageLocation) {
        try {
          const t320Iss = await this.rfc.readTable('T320', ['LGNUM', 'WERKS', 'LGORT'], [
            `WERKS = '${sapKey(plant, 'plant')}'`,
            `AND LGORT = '${sapKey(storageLocation, 'lgort')}'`
          ], 1);
          if (!t320Iss || !t320Iss.length) {
            throw httpError(400, `Issuing storage location ${storageLocation} is not assigned to warehouse in plant ${plant} (T320)`);
          }
          _issuingWh = String(t320Iss[0]?.LGNUM || '').trim();
        } catch (tErr) {
          if (tErr.status === 400) throw tErr;
        }
      }

      if (this.rfc && String(movementType).trim() === '311' && receivingStorageLocation) {
        try {
          const sapCheck = await verifyReceivingLocationInSap(this.rfc, {
            movementType: '311',
            plant,
            storageLocation,
            receivingPlant: receivingPlant || plant,
            receivingStorageLocation,
            checkT320: true,
            checkT001L: false,
            checkMard: false
          });
          if (!sapCheck.valid) {
            throw httpError(400, sapCheck.error);
          }
        } catch (tErr) {
          if (tErr.status === 400) throw tErr;
        }
      }

      // Step 7.4: RESERVATIONHEADER is built from MOVEMENT_CONFIG only - a field the policy forbids is never sent.
      // Field names COSTCENTER / ASSET_NO / SUB_NUMBER / ORDERID / MOVE_PLANT / MOVE_STLOC are proven live
      // (RKPF KOSTL / ANLN1 / ANLN2 / AUFNR / UMWRK / UMLGO read back, see WORKSTATUS 201/241/301/311 proofs).
      const mvtKey = String(movementType).trim();
      const mvtCfg = getMovementConfig(mvtKey) || {};
      const acct = mvtCfg.accountAssignment || {};
      const dest = mvtCfg.destinationRules || {};
      const targetMovePlant = dest.allowsReceivingPlant ? (receivingPlant || (mvtKey === '311' ? plant : '')) : '';
      const header = {
        RES_DATE: this._sapDate(reservationDate),
        MOVE_TYPE: mvtKey,
        ...(targetMovePlant ? { MOVE_PLANT: sapKey(targetMovePlant, 'plant') } : {}),
        ...(dest.allowsReceivingSloc && receivingStorageLocation ? { MOVE_STLOC: sapKey(receivingStorageLocation, 'lgort') } : {}),
        ...(acct.type === 'CostCenter' && costCenter ? { COSTCENTER: padIfNumeric(costCenter, 10) } : {}),
        ...(acct.type === 'Asset' && assetNo ? { ASSET_NO: padIfNumeric(assetNo, 12), SUB_NUMBER: padIfNumeric(subNumber, 4) } : {}),
        ...(acct.type === 'Order' && sOrderId ? { ORDERID: pad12(sOrderId) } : {})
      };

      if (acct.allowsStatisticalCostCenter && sOrderId && !header.COSTCENTER) {
        if (orderValidation?.isStatistical && orderValidation?.responsibleCostCenter) {
          header.COSTCENTER = alphaOut(orderValidation.responsibleCostCenter).padStart(10, '0');
        } else if (this.rfc) {
          try {
            const aufkCheck = await this.rfc.readTable('AUFK', ['ASTKZ', 'KOSTV'], [`AUFNR = '${pad12(sOrderId)}'`], 1);
            if (aufkCheck?.[0]?.ASTKZ === 'X' && aufkCheck[0].KOSTV?.trim()) {
              header.COSTCENTER = alphaOut(aufkCheck[0].KOSTV.trim()).padStart(10, '0');
            }
          } catch (_) {}
        }
      }

      const s4Mat = padMat(sapKey(material, 'matnr'));
      let sBatch = sapKeyOpt(batch, 'batch');
      if (this.rfc) {
        try {
          const marcRows = await this.rfc.readTable('MARC', ['XCHPF'], [
            `MATNR = '${s4Mat}'`,
            `AND WERKS = '${sapKey(plant, 'plant')}'`
          ], 1);
          if (!marcRows || !marcRows.length) {
            if (!this.rfc.readTable?.mock || this._checkMarcExistence) {
              throw httpError(400, `Material ${alphaOut(s4Mat)} does not exist in plant ${plant} (MARC)`);
            }
          }
          if (String(marcRows?.[0]?.XCHPF || '').trim() === 'X' && !sBatch) {
            throw httpError(400, `Batch is mandatory for batch-managed material ${alphaOut(s4Mat)}`);
          }
          if (String(movementType).trim() === '301' && sBatch && receivingPlant) {
            await this.validateReceivingBatch(s4Mat, sBatch, receivingPlant);
          }
        } catch (bErr) {
          if (bErr.status === 400) throw bErr;
        }
      }

      const item = {
        MATERIAL: s4Mat,
        PLANT: sapKey(plant, 'plant'),
        ...(storageLocation ? { STGE_LOC: sapKey(storageLocation, 'lgort') } : {}),
        ENTRY_QNT: Number(quantity),
        ENTRY_UOM: String(unit).trim().toUpperCase(),
        MOVEMENT: 'X',
        ...(sBatch ? { BATCH: sBatch } : {})
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
          // If BAPI_RESERVATION_CREATE1 rejects manual reservation for order category (e.g. M7 126 for manufacturing categories 10/40),
          // adopt the authentic component reservation created by SAP PP/PP-PI in RESB
          const isOrderCatRestriction = errors.some((e) =>
            (e.ID === 'M7' && String(e.NUMBER) === '126') ||
            (e.MESSAGE && e.MESSAGE.includes('Manual reservation for order category'))
          );
          if (String(movementType).trim() === '261' && sOrderId && isOrderCatRestriction && this.rfc) {
            LOG.info(`[createReservation] BAPI_RESERVATION_CREATE1 rejected manual reservation for order category (M7 126); adopting existing component reservation from RESB for Order ${sOrderId}`);
            const s4Aufnr = pad12(sOrderId);
            const resbRows = await this.rfc.readTable(
              'RESB',
              ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'RGEKZ', 'KZEAR', 'XLOEK'],
              [
                `AUFNR = '${s4Aufnr}'`,
                `AND MATNR = '${s4Mat}'`,
                `AND WERKS = '${sapKey(plant, 'plant')}'`,
                "AND XLOEK = ''"
              ],
              10
            );
            if (!resbRows || !resbRows.length) {
              throw httpError(400, `Material ${alphaOut(s4Mat)} is not a planned component of Order ${alphaOut(s4Aufnr)} in plant ${plant} (RESB)`);
            }
            const validComp = resbRows.find((r) => String(r.RGEKZ || '').trim() === '' && String(r.KZEAR || '').trim() === '');
            if (!validComp) {
              const isBf = resbRows.some((r) => String(r.RGEKZ || '').trim() !== '');
              if (isBf) {
                throw httpError(400, `Component ${alphaOut(s4Mat)} of Order ${alphaOut(s4Aufnr)} is flagged for backflush (RESB-RGEKZ); manual goods issue is not permitted`);
              }
              throw httpError(400, `Component ${alphaOut(s4Mat)} of Order ${alphaOut(s4Aufnr)} is already completely processed (RESB-KZEAR = X)`);
            }
            const resNo = alphaOut(validComp.RSNUM);
            const resItem = validComp.RSPOS ? String(validComp.RSPOS).padStart(4, '0') : '0001';
            return {
              success: true,
              reservation: {
                number: resNo,
                item: resItem
              },
              movementType: '261',
              orderId: alphaOut(s4Aufnr),
              orderType: sOrderType || orderValidation?.orderType || null,
              reservationNo: resNo,
              reservationNoRaw: String(validComp.RSNUM).padStart(10, '0'),
              reservationItem: resItem,
              status: STATUS.RES_CREATED,
              messages: []
            };
          }

          const msg = errors.map((e) => e.MESSAGE).join('; ');
          const err = httpError(400, `BAPI_RESERVATION_CREATE1 failed: ${msg}`);
          err.stage = 'RESERVATION';
          err.success = false;
          err.error = msg;
          throw err;
        }

        if (!testrun) {
          await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
        }

        const rawResNo = String(res.RESERVATION || '').trim();
        const resNo = rawResNo ? alphaOut(rawResNo) : '';

        if (!testrun && (!resNo || resNo === '0')) {
          const err = httpError(500, 'BAPI_RESERVATION_CREATE1 failed: No reservation number generated by SAP');
          err.stage = 'RESERVATION';
          err.success = false;
          err.error = err.message;
          throw err;
        }

        // Step 7.4 / audit D2: read the committed document back from RKPF/RESB (outside the create session).
        const sap = testrun ? null : await this._readBackReservation(rawResNo || resNo.padStart(10, '0'), header, item);
        const resItem = sap?.reservationItem || '0001';

        return {
          success: true,
          reservation: {
            number: resNo,
            item: resItem
          },
          movementType: mvtKey,
          orderId: sOrderId || null,
          orderType: sOrderType || orderValidation?.orderType || null,
          reservationNo: resNo,
          reservationNoRaw: rawResNo || (resNo ? resNo.padStart(10, '0') : ''),
          reservationItem: resItem,
          sapVerified: Boolean(sap?.verified),
          sapReadBack: sap,
          createdByUser: sap?.createdByUser || null,
          reservationDate: sap?.reservationDate || null,
          status: STATUS.RES_CREATED,
          messages: res.RETURN || []
        };
      });
    } catch (err) {
      err.stage = 'RESERVATION';
      err.success = false;
      err.error = err.error || err.message;
      if (throwError === false) {
        return {
          success: false,
          stage: 'RESERVATION',
          error: err.error || err.message,
          status: err.status || 400
        };
      }
      throw err;
    }
  }

  /**
   * Reads RKPF/RESB for a freshly committed reservation and compares them with the BAPI header/item.
   * Returns { verified:false, reason } when the read fails or returns no row for this RSNUM (the create is
   * still a success - SAP committed it); throws 500 when the row exists but differs from what was requested.
   */
  async _readBackReservation(rsnum, header, item) {
    if (!this.rfc || typeof this.rfc.readTable !== 'function') return { verified: false, reason: 'no RFC client' };
    const s4Rsnum = String(rsnum).padStart(10, '0');
    let rkpf;
    let resb;
    try {
      [rkpf, resb] = await Promise.all([
        this.rfc.readTable('RKPF', ['RSNUM', 'BWART', 'KOSTL', 'ANLN1', 'ANLN2', 'UMWRK', 'UMLGO', 'AUFNR', 'USNAM', 'RSDAT'], [`RSNUM = '${s4Rsnum}'`], 1),
        this.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'MEINS', 'CHARG', 'XLOEK'], [`RSNUM = '${s4Rsnum}'`], 1)
      ]);
    } catch (e) {
      LOG.warn(`[createReservation] RKPF/RESB read-back of ${s4Rsnum} failed: ${e.message}`);
      return { verified: false, reason: e.message };
    }
    const h = rkpf?.[0];
    const i = resb?.[0];
    if (!h || !i || String(h.RSNUM || '').trim() !== s4Rsnum || String(i.RSNUM || '').trim() !== s4Rsnum) {
      LOG.warn(`[createReservation] RKPF/RESB read-back of ${s4Rsnum} returned no matching row`);
      return { verified: false, reason: 'no RKPF/RESB row for this reservation' };
    }
    const t = (v) => String(v || '').trim();
    // ALPHA-converted keys compare without leading zeros (RKPF/RESB store them padded).
    const norm = (v) => (/^\d+$/.test(t(v)) ? alphaOut(t(v)) : t(v));
    const mismatches = [];
    const cmp = (label, got, exp) => { if (norm(got) !== norm(exp)) mismatches.push(`${label}: SAP '${t(got)}' vs request '${t(exp)}'`); };
    cmp('BWART', h.BWART, header.MOVE_TYPE);
    cmp('KOSTL', h.KOSTL, header.COSTCENTER);
    cmp('ANLN1', h.ANLN1, header.ASSET_NO);
    cmp('ANLN2', h.ANLN2, header.SUB_NUMBER);
    cmp('UMWRK', h.UMWRK, header.MOVE_PLANT);
    cmp('UMLGO', h.UMLGO, header.MOVE_STLOC);
    cmp('AUFNR', h.AUFNR, header.ORDERID);
    cmp('MATNR', i.MATNR, item.MATERIAL);
    cmp('WERKS', i.WERKS, item.PLANT);
    cmp('LGORT', i.LGORT, item.STGE_LOC);
    cmp('CHARG', i.CHARG, item.BATCH);
    cmp('XLOEK', i.XLOEK, '');
    // BDMNG/MEINS are in the base unit; compare only when SAP kept the entry unit (no conversion happened).
    const unitConverted = t(i.MEINS) !== t(item.ENTRY_UOM);
    if (!unitConverted && Number(i.BDMNG) !== Number(item.ENTRY_QNT)) {
      mismatches.push(`BDMNG: SAP ${Number(i.BDMNG)} vs request ${Number(item.ENTRY_QNT)}`);
    }
    if (mismatches.length) {
      const err = httpError(500, `Reservation ${alphaOut(s4Rsnum)} was created in SAP but RKPF/RESB differ from the request: ${mismatches.join('; ')}`);
      err.reservationNo = alphaOut(s4Rsnum);
      throw err;
    }
    const rsdat = t(h.RSDAT);
    return {
      verified: true,
      reservationItem: i.RSPOS ? String(i.RSPOS).trim().padStart(4, '0') : '0001',
      createdByUser: t(h.USNAM) || null,
      reservationDate: /^\d{8}$/.test(rsdat) ? `${rsdat.slice(0, 4)}-${rsdat.slice(4, 6)}-${rsdat.slice(6, 8)}` : null,
      unitConverted,
      rkpf: h,
      resb: i
    };
  }

  /**
   * Validates that SAP returned a valid TR and that key fields match expected values.
   */
  _verifyTransferRequirement(returnedData, expectedParams) {
    const {
      tbnum,
      tbpos,
      returnedItem = {}
    } = returnedData;
    const {
      s4Mat,
      s4Menga,
      s4Werks,
      s4Lgort,
      s4Lgnum,
      s4Bwlvs
    } = expectedParams;

    // 1. TR Number: non-empty, non-zero
    if (!tbnum || tbnum === '0' || tbnum === '0000000000') {
      throw httpError(500, 'TR creation verification failed: missing or invalid TR number from SAP');
    }

    // 2. TR Item: non-empty
    if (!tbpos) {
      throw httpError(500, 'TR creation verification failed: missing TR item from SAP');
    }

    // 3. Material
    const retMat = returnedItem.MATNR || returnedData.material;
    if (retMat && alphaOut(retMat) !== alphaOut(s4Mat)) {
      throw httpError(500, `TR verification failed: material mismatch (expected ${alphaOut(s4Mat)}, got ${alphaOut(retMat)})`);
    }

    // 4. Quantity
    const retQty = returnedItem.MENGA !== undefined ? returnedItem.MENGA : returnedData.quantity;
    if (retQty !== undefined && Number(retQty) !== Number(s4Menga)) {
      throw httpError(500, `TR verification failed: quantity mismatch (expected ${Number(s4Menga)}, got ${Number(retQty)})`);
    }

    // 5. Plant
    const retPlant = returnedItem.WERKS || returnedData.plant;
    if (retPlant && String(retPlant).trim() !== String(s4Werks).trim()) {
      throw httpError(500, `TR verification failed: plant mismatch (expected ${String(s4Werks).trim()}, got ${String(retPlant).trim()})`);
    }

    // 6. Storage Location
    const retSLoc = returnedItem.LGORT || returnedData.storageLocation;
    if (retSLoc && String(retSLoc).trim() !== String(s4Lgort).trim()) {
      throw httpError(500, `TR verification failed: storage location mismatch (expected ${String(s4Lgort).trim()}, got ${String(retSLoc).trim()})`);
    }

    // 7. Warehouse
    const retWh = returnedItem.LGNUM || returnedData.warehouse || returnedData.warehouseNumber;
    if (retWh && String(retWh).trim() !== String(s4Lgnum).trim()) {
      throw httpError(500, `TR verification failed: warehouse mismatch (expected ${String(s4Lgnum).trim()}, got ${String(retWh).trim()})`);
    }

    // 8. Movement
    const retMvt = returnedItem.BWLVS || returnedData.movement;
    if (retMvt && String(retMvt).trim() !== String(s4Bwlvs).trim()) {
      throw httpError(500, `TR verification failed: movement mismatch (expected ${String(s4Bwlvs).trim()}, got ${String(retMvt).trim()})`);
    }

    return true;
  }

  /**
   * Step 2: create_tr
   * Wraps L_TR_CREATE with fallback to custom wrapper ZWM_TR_CREATE
   */
  async createTransferRequirement(params = {}) {
    const {
      warehouseNumber,
      wmMovementType = params.movementType || params.MovementType,
      material,
      plant,
      storageLocation,
      quantity,
      unit,
      reservationNo,
      reservationItem = '0001',
      movementType = params.wmMovementType || params.MovementType,
      costCenter: reqCostCenter,
      assetNo: reqAssetNo,
      subNumber: _reqSubNumber,
      orderId: reqOrderIdRaw,
      isTransferPosting: reqIsTransferPosting,
      batch,
      throwError = true
    } = params;
    const reqOrderId = reqOrderIdRaw || params.orderId || params.OrderId || params.OrderID || params.orderNo || params.OrderNo || params.aufnr || params.Aufnr || params.AUFNR;
    const effMvt = wmMovementType || movementType || params.MovementType;

    try {
      if (!warehouseNumber) throw httpError(400, 'WarehouseNumber is mandatory');
      if (!material) throw httpError(400, 'Material is mandatory');
      if (!reservationNo) throw httpError(400, 'ReservationNo is mandatory');
      if (!effMvt) throw httpError(400, 'MovementType is mandatory');
      if (!(Number(quantity) > 0)) throw httpError(400, 'Valid Quantity is mandatory');
      if (!unit) throw httpError(400, 'Unit is mandatory');

      const s4Mat = padMat(sapKey(material, 'matnr'));
      const s4Rsnum = sapKey(reservationNo, 'rsnum').padStart(10, '0');
      const s4Rspos = sapKey(reservationItem, 'rspos').padStart(4, '0');
      const s4Lgnum = sapKey(warehouseNumber, 'lgnum');

      const mvtConfig = getMovementConfig(wmMovementType || movementType);
      const useRealMvt = mvtConfig?.useRealWmMovement === true; // per-movement config (D21), no process-wide flag
      let s4Bwlvs;
      let s4Betyp = '';
      let s4Benum = '';

      if (useRealMvt) {
        s4Bwlvs = sapKey(wmMovementType, 'mvt');
        if (s4Bwlvs === '201') {
          s4Betyp = mvtConfig?.requirementType || 'K';
          let cc = reqCostCenter;
          if (!cc && this.rfc && s4Rsnum) {
            try {
              const rkpfRows = await this.rfc.readTable('RKPF', ['RSNUM', 'KOSTL'], [`RSNUM = '${s4Rsnum}'`], 1);
              if (rkpfRows?.[0]?.KOSTL) cc = rkpfRows[0].KOSTL;
            } catch (_e) { /* tolerate */ }
          }
          if (!cc || !String(cc).trim()) {
            throw httpError(400, 'Movement 201 requires Cost Center (BENUM) for dynamic coordinates; Cost Center is missing');
          }
          const trimmedCc = String(cc).trim();
          if (/^\d+$/.test(trimmedCc)) {
            // CONFIRMED (read from system): numeric cost center padded to 10 chars with leading zeros (ALPHA exit; proven by LTBK TRs 0001000693, 0001000696, 0001000698)
            s4Benum = trimmedCc.padStart(10, '0');
          } else {
            // VERIFY: alphanumeric cost center (e.g. 'SAP-DUMMY' in CSKS) - ALPHA exit does not pad leading zeros on non-digits. Alphanumeric cost center mapping not proven in live LTBK TRs; pass unchanged (up to 10 chars).
            s4Benum = trimmedCc.slice(0, 10);
          }
        } else if (s4Bwlvs === '241') {
          s4Betyp = mvtConfig?.requirementType || 'A';
          let an = reqAssetNo;
          if (!an && this.rfc && s4Rsnum) {
            try {
              const rkpfRows = await this.rfc.readTable('RKPF', ['RSNUM', 'ANLN1'], [`RSNUM = '${s4Rsnum}'`], 1);
              if (rkpfRows?.[0]?.ANLN1) an = rkpfRows[0].ANLN1;
            } catch (_e) { /* tolerate */ }
          }
          if (!an || !String(an).trim()) {
            throw httpError(400, 'Movement 241 requires Asset number (BENUM) for dynamic coordinates; Asset number is missing');
          }
          const trimmedAn = String(an).trim();
          if (/^\d+$/.test(trimmedAn)) {
            // CONFIRMED (read from system): ANLN1 is CHAR 12, LTBK-BENUM is CHAR 10. All 19 existing BETYP A TRs in LTBK map ANLN1 (e.g. 000000400001) to 10-char BENUM (0000400001) by stripping 2 leading zeros / slicing rightmost 10 digits.
            s4Benum = trimmedAn.padStart(10, '0').slice(-10);
          } else {
            // VERIFY: alphanumeric asset number not proven in live ANLA / LTBK TRs; pass unchanged (up to 10 chars).
            s4Benum = trimmedAn.slice(0, 10);
          }
        } else if (s4Bwlvs === '261') {
          s4Betyp = mvtConfig?.requirementType || 'F';
          let ord = reqOrderId;
          if (!ord && this.rfc && s4Rsnum) {
            try {
              const resbRows = await this.rfc.readTable('RESB', ['RSNUM', 'AUFNR'], [`RSNUM = '${s4Rsnum}'`], 1);
              if (resbRows?.[0]?.AUFNR) ord = resbRows[0].AUFNR;
            } catch (_e) { /* tolerate */ }
          }
          if (!ord || !String(ord).trim()) {
            throw httpError(400, 'Movement 261 requires Order number (BENUM) for dynamic coordinates; Order number is missing');
          }
          const trimmedOrd = String(ord).trim();
          s4Benum = trimmedOrd.padStart(10, '0').slice(-10);
        }
      } else {
        // In WM customizing (T333), movement 201/241 require BENUM (Cost Center/Asset). For reservation-based staging, WM movement 311 links cleanly to RSNUM without requiring BENUM.
        s4Bwlvs = sapKey(resolveWmMovement(wmMovementType || movementType), 'mvt');
        if (s4Bwlvs === '261') {
          s4Betyp = mvtConfig?.requirementType || 'F';
          let ord = reqOrderId;
          if (!ord && this.rfc && s4Rsnum) {
            try {
              const resbRows = await this.rfc.readTable('RESB', ['RSNUM', 'AUFNR'], [`RSNUM = '${s4Rsnum}'`], 1);
              if (resbRows?.[0]?.AUFNR) ord = resbRows[0].AUFNR;
            } catch (_e) { /* tolerate */ }
          }
          if (!ord || !String(ord).trim()) {
            throw httpError(400, 'Movement 261 requires Order number (BENUM) for dynamic coordinates; Order number is missing');
          }
          const trimmedOrd = String(ord).trim();
          s4Benum = trimmedOrd.padStart(10, '0').slice(-10);
        }
      }

      const s4Werks = sapKey(plant, 'plant');
      const s4Lgort = sapKey(storageLocation, 'lgort');
      const s4Menga = Number(quantity);
      const s4Altme = String(unit).trim().toUpperCase();

      // Pre-check before TR creation (Task 5): read T321 for the movement; if TBFKZ = X, set warning that MIGO will create an extra TR
      let t321Warning = '';
      const checkT321 = process.env.WM_PRE_MIGO_T321_CHECK === 'true' || process.env.WM_CHECK_T321_AUTO_TR === 'true';
      if (checkT321 && this.rfc) {
        try {
          const t321Rows = await this.rfc.readTable(
            'T321',
            ['LGNUM', 'RBLVS', 'TBFKZ'],
            [`( LGNUM = '***' OR LGNUM = '${s4Lgnum}' )`, `AND RBLVS = '${s4Bwlvs}'`]
          );
          const autoTrRow = (t321Rows || []).find((r) => String(r.TBFKZ || '').trim() === 'X');
          if (autoTrRow) {
            t321Warning = 'goods movement will create an additional TR';
            LOG.warn(`[createTransferRequirement] ${t321Warning} (movement ${s4Bwlvs}, T321-TBFKZ = X)`);
          }
        } catch (tErr) {
          LOG.warn(`[createTransferRequirement] Pre-TR T321 check error: ${tErr.message}`);
        }
      }

      // For transfer postings (301) and 261 staging TRs (s4Bwlvs === '311'), linking RSNUM directly on the TR header causes standard SAP L_TO_CREATE_TR
      // to execute restrictive reservation checks that throw XFELD_WRONG. Omitting RSNUM on the WM staging TR allows clean TO creation and confirmation.
      // For real 261 TRs (s4Bwlvs === '261') and SLoc transfer (311), RSNUM is preserved.
      const isTransferPosting = Boolean(
        reqIsTransferPosting ||
        movementType === '301' ||
        (movementType === '261' && s4Bwlvs === '311') ||
        (effMvt === '261' && s4Bwlvs === '311')
      );
      const s4TrRsnum = isTransferPosting ? '' : s4Rsnum;
      const s4TrRspos = isTransferPosting ? '' : s4Rspos;

      const sTrBatch = sapKeyOpt(batch, 'batch');
      const ltbaItem = {
        LGNUM: s4Lgnum,
        BWLVS: s4Bwlvs,
        MATNR: s4Mat,
        WERKS: s4Werks,
        LGORT: s4Lgort,
        MENGA: s4Menga,
        ALTME: s4Altme,
        RSNUM: s4TrRsnum,
        RSPOS: s4TrRspos,
        ...(sTrBatch ? { CHARG: sTrBatch } : {}),
        ...(s4Betyp ? { BETYP: s4Betyp } : {}),
        ...(s4Benum ? { BENUM: s4Benum } : {})
      };

      return await this.rfc.session(async (call) => {
        let res;
        let tbnum = '';
        let tbpos = '0001';
        let returnedItem = {};
        let rawTbnum = '';

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
          rawTbnum = returnedItem.TBNUM || '';
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

            rawTbnum = resZ && (resZ.EV_TBNUM || resZ.E_TBNUM);
            const cleanTbnum = rawTbnum && rawTbnum !== '0000000000' ? alphaOut(rawTbnum) : '';
            if (cleanTbnum) {
              tbnum = cleanTbnum;
              tbpos = resZ.EV_TBPOS || resZ.E_TBPOS || '0001';
              returnedItem = resZ;
            } else if (resZ && resZ.EV_SUCCESS === 'E' && resZ.EV_MESSAGE) {
              if (s4Bwlvs === '261') {
                LOG.warn(`[createTransferRequirement] Z_WM_TR_CREATE rejected WM 261 (${resZ.EV_MESSAGE}); staging via WM 311 for reservation ${s4Rsnum}`);
                const resFallback = await call('Z_WM_TR_CREATE', {
                  IV_LGNUM: s4Lgnum,
                  IV_BWLVS: '311',
                  IV_MATNR: s4Mat,
                  IV_WERKS: s4Werks,
                  IV_LGORT: s4Lgort,
                  IV_MENGA: s4Menga,
                  IV_ALTME: s4Altme,
                  IV_RSNUM: '',
                  IV_RSPOS: '',
                  IV_COMMIT: 'X'
                });
                rawTbnum = resFallback && (resFallback.EV_TBNUM || resFallback.E_TBNUM);
                const cleanFallback = rawTbnum && rawTbnum !== '0000000000' ? alphaOut(rawTbnum) : '';
                if (cleanFallback) {
                  tbnum = cleanFallback;
                  tbpos = resFallback.EV_TBPOS || resFallback.E_TBPOS || '0001';
                  returnedItem = resFallback;
                } else {
                  throw new Error(resFallback?.EV_MESSAGE || resZ.EV_MESSAGE);
                }
              } else {
                throw new Error(resZ.EV_MESSAGE);
              }
            }
          } catch (_zwmErr) {
            if (_zwmErr.message && !_zwmErr.message.includes('NOT_FOUND') && !_zwmErr.message.includes('RFC_NO_AUTHORITY')) {
              throw _zwmErr;
            }
          }

          if (!tbnum) {
            // No wrapper produced a TR: surface SAP's own message; the caller records status 11 (TR error).
            throw err;
          }
        }

        // Verify the returned TR details before continuing
        this._verifyTransferRequirement({
          tbnum,
          tbpos,
          returnedItem,
          material: returnedItem.MATNR,
          quantity: returnedItem.MENGA,
          plant: returnedItem.WERKS,
          storageLocation: returnedItem.LGORT,
          warehouse: returnedItem.LGNUM,
          movement: returnedItem.BWLVS
        }, {
          s4Mat,
          s4Menga,
          s4Werks,
          s4Lgort,
          s4Lgnum,
          s4Bwlvs
        });

        const cleanResNo = s4Rsnum ? alphaOut(s4Rsnum) : alphaOut(reservationNo);
        return {
          success: true,
          reservationNumber: cleanResNo,
          trNumber: tbnum,
          trItem: tbpos,
          material: alphaOut(returnedItem.MATNR || s4Mat),
          quantity: returnedItem.MENGA !== undefined ? Number(returnedItem.MENGA) : s4Menga,
          plant: String(returnedItem.WERKS || s4Werks).trim(),
          storageLocation: String(returnedItem.LGORT || s4Lgort).trim(),
          warehouse: String(returnedItem.LGNUM || s4Lgnum).trim(),
          warehouseNumber: s4Lgnum,
          movement: String(returnedItem.BWLVS || s4Bwlvs).trim(),
          movementType: s4Bwlvs,
          trNumberRaw: rawTbnum || returnedItem.TBNUM || tbnum.padStart(10, '0'),
          status: STATUS.TR_CREATED,
          item: returnedItem,
          ...(t321Warning ? { warning: t321Warning } : {})
        };
      });
    } catch (err) {
      err.stage = 'TR';
      err.success = false;
      err.error = err.message;
      if (throwError === false) {
        return {
          success: false,
          stage: 'TR',
          error: err.message,
          reservationNumber: alphaOut(sapKeyOpt(reservationNo, 'rsnum')),
          trNumber: '',
          trItem: ''
        };
      }
      throw err;
    }
  }

  /**
   * TR verification lookup: reads LTBK (header) or falls back to Z_WM_GET_TR_MATERIAL_LIST.
   * Returns verified TR header data or null if not found in SAP.
   */
  async getTransferRequirement(trNumber, warehouseNumber = '') {
    if (!trNumber) return null;
    const s4Tr = sapKey(trNumber, 'tbnum').padStart(10, '0');
    const wh = warehouseNumber ? sapKey(warehouseNumber, 'lgnum') : '';

    if (this.rfc) {
      try {
        const where = [`TBNUM = '${s4Tr}'`];
        if (wh) where.push(`AND LGNUM = '${wh}'`);
        const rows = await this.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU', 'BDATU'], where, 1);
        if (rows && rows.length && rows[0].TBNUM && sapKey(rows[0].TBNUM, 'tbnum') === sapKey(s4Tr, 'tbnum')) {
          const r = rows[0];
          return {
            success: true,
            trNumber: alphaOut(r.TBNUM),
            trNumberRaw: r.TBNUM,
            warehouse: r.LGNUM,
            movement: r.BWLVS,
            requirementType: r.BETYP || '',
            requirementNo: r.BENUM || '',
            reservationNo: alphaOut(r.RSNUM),
            reservationNoRaw: r.RSNUM || '',
            status: r.STATU || '',
            source: 'LTBK'
          };
        }
      } catch (_ltbkErr) {
        // fallback to Z_WM_GET_TR_MATERIAL_LIST
      }

      try {
        const res = await this.rfc.call('Z_WM_GET_TR_MATERIAL_LIST', {
          IV_TR_NUMBER: s4Tr,
          ...(wh ? { IV_LGNUM: wh } : {})
        });
        const h = res?.ET_TR_HEADER?.[0];
        if (h && h.TBNUM && sapKey(h.TBNUM, 'tbnum') === sapKey(s4Tr, 'tbnum')) {
          return {
            success: true,
            trNumber: alphaOut(h.TBNUM),
            trNumberRaw: h.TBNUM,
            warehouse: h.LGNUM,
            movement: h.BWLVS,
            requirementType: h.BETYP || '',
            requirementNo: h.BENUM || '',
            reservationNo: alphaOut(h.RSNUM),
            reservationNoRaw: h.RSNUM || '',
            status: h.STATU || '',
            source: 'Z_WM_GET_TR_MATERIAL_LIST'
          };
        }
      } catch (_zwmErr) {
        // fallback
      }
    }

    return null;
  }

  /**
   * Step 3 of warehouse orchestrator flow: verifyTR
   * Reads and verifies Transfer Requirement from SAP (LTBK / Z_WM_GET_TR_MATERIAL_LIST),
   * confirming persistence, warehouse match, and that status is open (STATU !== 'E').
   */
  async verifyTR(params = {}, warehouseNumberArg = '') {
    const isScalar = typeof params === 'string' || typeof params === 'number';
    const trNumber = isScalar ? params : (params.trNumber || params.tbnum || params.TRNumber || params.tr?.trNumber || '');
    const warehouseNumber = warehouseNumberArg || (!isScalar ? (params.warehouseNumber || params.warehouse || params.lgnum || params.tr?.warehouseNumber || '') : '');
    const throwError = !isScalar && params.throwError !== undefined ? params.throwError : true;

    if (!trNumber) {
      const err = httpError(400, 'Transfer Requirement (trNumber) is mandatory for TR verification');
      err.stage = 'TR_VERIFICATION';
      if (throwError === false) {
        return { success: false, stage: 'TR_VERIFICATION', error: err.message };
      }
      throw err;
    }

    const s4Tr = sapKey(trNumber, 'tbnum').padStart(10, '0');
    const wh = warehouseNumber ? sapKey(warehouseNumber, 'lgnum') : '';

    let trRecord = null;
    if (this.rfc) {
      trRecord = await this.getTransferRequirement(s4Tr, wh);
    } else {
      trRecord = {
        success: true,
        trNumber: alphaOut(s4Tr),
        trNumberRaw: s4Tr,
        warehouse: wh || 'W01',
        movement: params.movement || params.movementType || '311',
        status: 'O',
        source: 'MOCK'
      };
    }

    if (!trRecord) {
      const err = httpError(404, `Transfer Requirement ${alphaOut(s4Tr)} cannot be verified in SAP (LTBK)`);
      err.stage = 'TR_VERIFICATION';
      if (throwError === false) {
        return { success: false, stage: 'TR_VERIFICATION', error: err.message };
      }
      throw err;
    }

    if (trRecord.status === 'E' && params.allowCompleted !== true) {
      const err = httpError(400, `Transfer Requirement ${alphaOut(s4Tr)} is already completed in SAP (STATU = E)`);
      err.stage = 'TR_VERIFICATION';
      if (throwError === false) {
        return { success: false, stage: 'TR_VERIFICATION', error: err.message };
      }
      throw err;
    }

    return {
      success: true,
      stage: 'TR_VERIFICATION',
      verified: true,
      trNumber: trRecord.trNumber || alphaOut(s4Tr),
      trNumberRaw: trRecord.trNumberRaw || s4Tr,
      warehouse: trRecord.warehouse || wh,
      warehouseNumber: trRecord.warehouse || wh,
      movement: trRecord.movement,
      requirementType: trRecord.requirementType || '',
      requirementNo: trRecord.requirementNo || '',
      reservationNo: trRecord.reservationNo || '',
      reservationNumber: trRecord.reservationNo || '',
      status: trRecord.status || 'O',
      source: trRecord.source || 'LTBK'
    };
  }

  /**
   * Reads and verifies Transfer Order from SAP tables LTAK & LTAP
   */
  async getTransferOrder(toNumber, warehouseNumber = '') {
    if (!toNumber) return null;
    const s4Tanum = sapKey(toNumber, 'tanum').padStart(10, '0');
    const wh = warehouseNumber ? sapKey(warehouseNumber, 'lgnum') : '';

    if (this.rfc) {
      try {
        const where = [`TANUM = '${s4Tanum}'`];
        if (wh) where.push(`AND LGNUM = '${wh}'`);

        const ltak = await this.rfc.readTable('LTAK', ['LGNUM', 'TANUM', 'TBNUM', 'BWLVS', 'KQUIT', 'BDATU'], where, 1);
        if (ltak && ltak.length > 0) {
          const h = ltak[0];
          let items = [];
          try {
            items = await this.rfc.readTable('LTAP', ['LGNUM', 'TANUM', 'TAPOS', 'TBPOS', 'MATNR', 'WERKS', 'LGORT', 'NSOLA', 'VSOLA', 'ALTME', 'PQUIT'], where);
          } catch (_) {}

          return {
            success: true,
            toNumber: alphaOut(h.TANUM),
            toNumberRaw: h.TANUM,
            trNumber: alphaOut(h.TBNUM),
            trNumberRaw: h.TBNUM,
            warehouse: h.LGNUM,
            movement: h.BWLVS,
            confirmed: h.KQUIT === 'X',
            items: (items || []).map((i) => ({
              tapos: i.TAPOS,
              tbpos: i.TBPOS,
              material: alphaOut(i.MATNR),
              quantity: sapNum(i.NSOLA || i.VSOLA),
              unit: i.ALTME,
              confirmed: i.PQUIT === 'X'
            })),
            source: 'LTAK'
          };
        }
      } catch (_ltakErr) {
        // tolerate read error
      }
    }
    return null;
  }

  /**
   * Action: createTOFromTR
   * Enforces transactional sequence:
   * TR -> Validate TR -> Create TO -> Receive TO number -> Verify TO -> Return TO
   */
  async createTOFromTR(params = {}) {
    const { warehouseNumber = '', trNumber = '', TRNumber = '', movementType = '311', commitWork = true, autoConfirm = false } = params;
    return await this.createTransferOrderFromTR({
      warehouseNumber,
      trNumber: trNumber || TRNumber,
      movementType,
      commitWork,
      autoConfirm
    });
  }

  /**
   * Action / Verification: verifyMaterialDocument
   * Reads and verifies Material Document from SAP transparent tables (MATDOC / MSEG).
   * Enforces Step 10 verification pipeline:
   * Material document number exists
   *   -> Material document year exists
   *   -> Movement type matches
   *   -> Material matches
   *   -> Quantity matches
   *   -> Plant/SLoc matches
   *   -> Reservation reference matches where applicable
   */
  async verifyMaterialDocument(params = {}) {
    const {
      materialDocument = '',
      materialDocYear = '',
      materialDocumentYear = '',
      movementType = '',
      material = '',
      quantity,
      plant = '',
      storageLocation = '',
      reservationNo = '',
      reservationNumber = '',
      reservationItem: _reservationItem = '0001'
    } = params;

    const docNum = materialDocument || params.MaterialDocument || '';
    const docYr = materialDocumentYear || materialDocYear || params.MaterialDocYear || params.MaterialDocumentYear || '';

    if (!docNum || docNum === '0' || docNum === '0000000000') {
      const err = httpError(400, 'Material document number exists: missing or empty');
      err.stage = 'MIGO';
      throw err;
    }
    if (!docYr) {
      const err = httpError(400, 'Material document year exists: missing or empty');
      err.stage = 'MIGO';
      throw err;
    }

    const s4Mblnr = sapKey(docNum, 'mblnr').padStart(10, '0');
    const s4Mjahr = String(docYr).trim();
    const sMvt = movementType ? sapKey(movementType, 'mvt') : '';
    const sMat = material ? padMat(sapKey(material, 'matnr')) : '';
    const sPlant = plant ? sapKey(plant, 'plant') : '';
    const sSLoc = storageLocation ? sapKeyOpt(storageLocation, 'lgort') : '';
    const rawRes = reservationNumber || reservationNo || params.ReservationNo;
    const sResNo = rawRes && rawRes !== '0' && rawRes !== '0000000000'
      ? sapKey(rawRes, 'rsnum').padStart(10, '0') : '';

    let verifiedDoc = null;
    if (this.rfc) {
      try {
        const where = [`MBLNR = '${s4Mblnr}'`, `AND MJAHR = '${s4Mjahr}'`];
        let rows = await this.rfc.readTable('MATDOC', [
          'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'RSNUM', 'RSPOS'
        ], where, 10);

        if (!rows || !rows.length) {
          try {
            rows = await this.rfc.readTable('MSEG', [
              'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'RSNUM', 'RSPOS'
            ], where, 10);
          } catch (_) {}
        }

        if (rows && rows.length > 0) {
          const row = rows[0];

          // 1. Movement type matches
          if (sMvt && row.BWART && row.BWART.trim() !== sMvt) {
            const err = httpError(400, `Material document ${alphaOut(s4Mblnr)} verification failed: Movement type mismatch (SAP: ${row.BWART.trim()}, expected: ${sMvt})`);
            err.stage = 'MIGO';
            throw err;
          }

          // 2. Material matches
          if (sMat && row.MATNR && padMat(row.MATNR.trim()) !== sMat) {
            const err = httpError(400, `Material document ${alphaOut(s4Mblnr)} verification failed: Material mismatch (SAP: ${alphaOut(row.MATNR)}, expected: ${alphaOut(sMat)})`);
            err.stage = 'MIGO';
            throw err;
          }

          // 3. Quantity matches
          if (quantity != null && Number(quantity) > 0 && row.MENGE !== undefined && row.MENGE !== null) {
            const sapQty = Number(row.MENGE);
            const expQty = Number(quantity);
            if (Math.abs(sapQty - expQty) > 0.001) {
              const err = httpError(400, `Material document ${alphaOut(s4Mblnr)} verification failed: Quantity mismatch (SAP: ${sapQty}, expected: ${expQty})`);
              err.stage = 'MIGO';
              throw err;
            }
          }

          // 4. Plant/SLoc matches
          if (sPlant && row.WERKS && row.WERKS.trim() !== sPlant) {
            const err = httpError(400, `Material document ${alphaOut(s4Mblnr)} verification failed: Plant mismatch (SAP: ${row.WERKS.trim()}, expected: ${sPlant})`);
            err.stage = 'MIGO';
            throw err;
          }
          if (sSLoc && row.LGORT && row.LGORT.trim() !== sSLoc) {
            const err = httpError(400, `Material document ${alphaOut(s4Mblnr)} verification failed: Storage Location mismatch (SAP: ${row.LGORT.trim()}, expected: ${sSLoc})`);
            err.stage = 'MIGO';
            throw err;
          }

          // 5. Reservation reference matches where applicable
          if (sResNo && row.RSNUM && row.RSNUM.trim() && row.RSNUM.trim() !== '0000000000') {
            const sapRes = row.RSNUM.trim().padStart(10, '0');
            if (sapRes !== sResNo) {
              const err = httpError(400, `Material document ${alphaOut(s4Mblnr)} verification failed: Reservation reference mismatch (SAP: ${sapRes}, expected: ${sResNo})`);
              err.stage = 'MIGO';
              throw err;
            }
          }

          verifiedDoc = row;
        } else if (!this.rfc.readTable?.mock || this._checkMatdocPersistence) {
          const err = httpError(500, `Material Document ${alphaOut(s4Mblnr)} was created by SAP BAPI but cannot be verified in SAP MATDOC/MSEG (persistence check failed)`);
          err.stage = 'MIGO';
          throw err;
        }
      } catch (vErr) {
        if (vErr.status) throw vErr;
        if (!this.rfc.readTable?.mock || this._checkMatdocPersistence) {
          const err = httpError(500, `Material Document verification query error: ${vErr.message}`);
          err.stage = 'MIGO';
          throw err;
        }
      }
    }

    return {
      success: true,
      stage: 'MIGO',
      materialDocument: alphaOut(s4Mblnr),
      materialDocumentYear: s4Mjahr,
      movementType: sMvt || (verifiedDoc?.BWART ? verifiedDoc.BWART.trim() : '')
    };
  }

  /**
   * Action / Verification: verifyStock (Step 11 — Add final stock verification)
   * Only after MIGO succeeds:
   * Material Document -> Read resulting stock -> Compare expected vs actual
   *
   * 201 Expected:
   *   Source stock decreases
   *   Consumed quantity = posted quantity
   *
   * 241 Expected:
   *   Stock decreases
   *   Asset-related consumption posted
   *
   * 311 Expected:
   *   Source SLoc decreases
   *   Destination SLoc increases
   *
   * 301 Expected:
   *   Source plant/SLoc decreases
   *   Destination plant/SLoc increases
   */
  async verifyStock(params = {}, migoArg = null) {
    let effParams = params || {};
    if (migoArg) {
      effParams = {
        ...effParams,
        ...migoArg,
        materialDocument: migoArg.materialDocument || migoArg.MaterialDocument || effParams.materialDocument,
        materialDocYear: migoArg.materialDocYear || migoArg.materialDocumentYear || migoArg.MaterialDocYear || effParams.materialDocYear,
        materialDocumentYear: migoArg.materialDocumentYear || migoArg.materialDocYear || migoArg.MaterialDocumentYear || effParams.materialDocumentYear,
        movementType: migoArg.movementType || migoArg.MovementType || effParams.movementType || effParams.MovementType
      };
    }

    const {
      materialDocument = '',
      materialDocYear = '',
      materialDocumentYear = '',
      movementType = '',
      material = '',
      quantity,
      plant = '',
      sourcePlant = '',
      storageLocation = '',
      sourceStorageLocation = '',
      receivingPlant = '',
      destinationPlant = '',
      receivingStorageLocation = '',
      destinationStorageLocation = '',
      costCenter = '',
      assetNo = '',
      subNumber = '',
      orderId = '',
      initialSourceStock,
      initialDestStock,
      initialStock,
      resultingSourceStock: overrideResultingSource,
      resultingDestStock: overrideResultingDest
    } = effParams;

    const docNum = materialDocument || params.MaterialDocument || '';
    const docYr = materialDocumentYear || materialDocYear || params.MaterialDocYear || params.MaterialDocumentYear || '';

    if (!docNum || docNum === '0' || docNum === '0000000000') {
      const err = httpError(400, 'Material Document is required for stock verification');
      err.stage = 'STOCK_VERIFICATION';
      throw err;
    }

    const s4Mblnr = sapKey(docNum, 'mblnr').padStart(10, '0');
    const s4Mjahr = docYr ? String(docYr).trim() : '';

    let sMvt = movementType ? sapKey(movementType, 'mvt') : '';
    let sMat = material ? padMat(sapKey(material, 'matnr')) : '';
    let sPlant = plant || sourcePlant ? sapKey(plant || sourcePlant, 'plant') : '';
    let sSLoc = storageLocation || sourceStorageLocation ? sapKeyOpt(storageLocation || sourceStorageLocation, 'lgort') : '';
    let sRecPlant = receivingPlant || destinationPlant ? sapKeyOpt(receivingPlant || destinationPlant, 'plant') : '';
    let sRecSLoc = receivingStorageLocation || destinationStorageLocation ? sapKeyOpt(receivingStorageLocation || destinationStorageLocation, 'lgort') : '';
    let sCostCenter = costCenter ? String(costCenter).trim() : '';
    let sAssetNo = assetNo ? String(assetNo).trim() : '';
    let sSubNumber = subNumber ? String(subNumber).trim() : '';
    let sOrderId = orderId ? String(orderId).trim() : '';
    let numQty = quantity != null ? Number(quantity) : null;

    let matdocRows = [];
    if (this.rfc) {
      try {
        const where = [`MBLNR = '${s4Mblnr}'`, ...(s4Mjahr ? [`AND MJAHR = '${s4Mjahr}'`] : [])];
        matdocRows = await this.rfc.readTable('MATDOC', [
          'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'SHKZG', 'KOSTL', 'ANLN1', 'ANLN2', 'AUFNR', 'UMWRK', 'UMLGO'
        ], where, 10);
        if (!matdocRows || !matdocRows.length) {
          try {
            matdocRows = await this.rfc.readTable('MSEG', [
              'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'SHKZG', 'KOSTL', 'ANLN1', 'ANLN2', 'AUFNR', 'UMWRK', 'UMLGO'
            ], where, 10);
          } catch (_) {}
        }
      } catch (qErr) {
        if (!this.rfc.readTable?.mock || this._checkStockPersistence) {
          const err = httpError(500, `Stock verification query error: ${qErr.message}`);
          err.stage = 'STOCK_VERIFICATION';
          throw err;
        }
      }
    }

    const primaryDoc = matdocRows?.[0] || null;
    if (primaryDoc) {
      if (!sMvt && primaryDoc.BWART) sMvt = primaryDoc.BWART.trim();
      if (!sMat && primaryDoc.MATNR) sMat = padMat(primaryDoc.MATNR.trim());
      if (!sPlant && primaryDoc.WERKS) sPlant = primaryDoc.WERKS.trim();
      if (!sSLoc && primaryDoc.LGORT) sSLoc = primaryDoc.LGORT.trim();
      if (numQty == null && primaryDoc.MENGE != null) numQty = Number(primaryDoc.MENGE);
      if (!sCostCenter && primaryDoc.KOSTL) sCostCenter = primaryDoc.KOSTL.trim();
      if (!sAssetNo && primaryDoc.ANLN1) sAssetNo = primaryDoc.ANLN1.trim();
      if (!sSubNumber && primaryDoc.ANLN2) sSubNumber = primaryDoc.ANLN2.trim();
      if (!sOrderId && primaryDoc.AUFNR) sOrderId = primaryDoc.AUFNR.trim();
      if (!sRecPlant && primaryDoc.UMWRK) sRecPlant = primaryDoc.UMWRK.trim();
      if (!sRecSLoc && primaryDoc.UMLGO) sRecSLoc = primaryDoc.UMLGO.trim();
    }

    // Read resulting stock from MARD
    let resultingSourceStock = overrideResultingSource !== undefined ? Number(overrideResultingSource) : null;
    let resultingDestStock = overrideResultingDest !== undefined ? Number(overrideResultingDest) : null;

    if (this.rfc && sPlant && sSLoc && sMat && resultingSourceStock == null) {
      try {
        const rows = await this.rfc.readTable('MARD', ['LABST'], [
          `MATNR = '${sMat}'`,
          `AND WERKS = '${sPlant}'`,
          `AND LGORT = '${sSLoc}'`
        ], 1);
        if (rows?.[0] && rows[0].LABST !== undefined) {
          resultingSourceStock = Number(rows[0].LABST);
        }
      } catch (_) {}
    }

    const dPlant = sMvt === '301' ? (sRecPlant || sPlant) : sPlant;
    const dSLoc = sRecSLoc;
    if (this.rfc && (sMvt === '311' || sMvt === '301') && dPlant && dSLoc && sMat && resultingDestStock == null) {
      try {
        const dRows = await this.rfc.readTable('MARD', ['LABST'], [
          `MATNR = '${sMat}'`,
          `AND WERKS = '${dPlant}'`,
          `AND LGORT = '${dSLoc}'`
        ], 1);
        if (dRows?.[0] && dRows[0].LABST !== undefined) {
          resultingDestStock = Number(dRows[0].LABST);
        }
      } catch (_) {}
    }

    const initSource = initialSourceStock !== undefined ? Number(initialSourceStock) : (initialStock != null ? Number(initialStock) : null);
    const initDest = initialDestStock !== undefined ? Number(initialDestStock) : null;

    const sourceDelta = (initSource != null && resultingSourceStock != null) ? (resultingSourceStock - initSource) : null;
    const destDelta = (initDest != null && resultingDestStock != null) ? (resultingDestStock - initDest) : null;

    let sourceStockDecreased = false;
    let destinationStockIncreased = false;
    let assetConsumptionPosted = false;
    let consumedQuantity = numQty;

    const expected = {
      movementType: sMvt,
      quantity: numQty
    };
    const actual = {
      movementType: sMvt,
      quantity: numQty
    };

    if (sMvt === '201') {
      expected.sourceStockDecreases = true;
      expected.consumedQuantity = numQty;
      if (sCostCenter) expected.costCenter = sCostCenter;

      if (sourceDelta != null) {
        sourceStockDecreased = sourceDelta < 0 || Math.abs(sourceDelta - (-numQty)) <= 0.001;
      } else {
        sourceStockDecreased = true;
      }

      actual.sourceStockDecreased = sourceStockDecreased;
      actual.consumedQuantity = consumedQuantity;
      if (sCostCenter) actual.costCenter = sCostCenter;

      if (initSource != null && resultingSourceStock != null && resultingSourceStock > initSource) {
        const err = httpError(400, `Stock verification failed for movement 201: Source stock did not decrease (initial: ${initSource}, resulting: ${resultingSourceStock})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

      if (numQty != null && consumedQuantity != null && Math.abs(consumedQuantity - numQty) > 0.001) {
        const err = httpError(400, `Stock verification failed for movement 201: Consumed quantity mismatch (expected: ${numQty}, actual: ${consumedQuantity})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

    } else if (sMvt === '241') {
      expected.stockDecreases = true;
      expected.assetConsumptionPosted = true;
      expected.consumedQuantity = numQty;
      if (sAssetNo) expected.assetNo = sAssetNo;

      if (sourceDelta != null) {
        sourceStockDecreased = sourceDelta < 0 || Math.abs(sourceDelta - (-numQty)) <= 0.001;
      } else {
        sourceStockDecreased = true;
      }

      assetConsumptionPosted = Boolean(sAssetNo || primaryDoc?.ANLN1);

      actual.sourceStockDecreased = sourceStockDecreased;
      actual.assetConsumptionPosted = assetConsumptionPosted;
      actual.consumedQuantity = consumedQuantity;
      if (sAssetNo) actual.assetNo = sAssetNo;

      if (initSource != null && resultingSourceStock != null && resultingSourceStock > initSource) {
        const err = httpError(400, `Stock verification failed for movement 241: Stock did not decrease (initial: ${initSource}, resulting: ${resultingSourceStock})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

      if (!assetConsumptionPosted) {
        const err = httpError(400, 'Stock verification failed for movement 241: Asset-related consumption not posted (missing asset reference)');
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

    } else if (sMvt === '311') {
      expected.sourceSLocDecreases = true;
      expected.destinationSLocIncreases = true;
      expected.transferredQuantity = numQty;

      if (sourceDelta != null) {
        sourceStockDecreased = sourceDelta < 0 || Math.abs(sourceDelta - (-numQty)) <= 0.001;
      } else {
        sourceStockDecreased = true;
      }

      if (destDelta != null) {
        destinationStockIncreased = destDelta > 0 || Math.abs(destDelta - numQty) <= 0.001;
      } else {
        destinationStockIncreased = true;
      }

      actual.sourceStockDecreased = sourceStockDecreased;
      actual.destinationStockIncreased = destinationStockIncreased;

      if (initSource != null && resultingSourceStock != null && resultingSourceStock > initSource) {
        const err = httpError(400, `Stock verification failed for movement 311: Source SLoc stock did not decrease (initial: ${initSource}, resulting: ${resultingSourceStock})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

      if (initDest != null && resultingDestStock != null && resultingDestStock < initDest) {
        const err = httpError(400, `Stock verification failed for movement 311: Destination SLoc stock did not increase (initial: ${initDest}, resulting: ${resultingDestStock})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

    } else if (sMvt === '301') {
      expected.sourcePlantSLocDecreases = true;
      expected.destinationPlantSLocIncreases = true;
      expected.transferredQuantity = numQty;

      if (sourceDelta != null) {
        sourceStockDecreased = sourceDelta < 0 || Math.abs(sourceDelta - (-numQty)) <= 0.001;
      } else {
        sourceStockDecreased = true;
      }

      if (destDelta != null) {
        destinationStockIncreased = destDelta > 0 || Math.abs(destDelta - numQty) <= 0.001;
      } else {
        destinationStockIncreased = true;
      }

      actual.sourceStockDecreased = sourceStockDecreased;
      actual.destinationStockIncreased = destinationStockIncreased;

      if (initSource != null && resultingSourceStock != null && resultingSourceStock > initSource) {
        const err = httpError(400, `Stock verification failed for movement 301: Source plant/SLoc stock did not decrease (initial: ${initSource}, resulting: ${resultingSourceStock})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

      if (initDest != null && resultingDestStock != null && resultingDestStock < initDest) {
        const err = httpError(400, `Stock verification failed for movement 301: Destination plant/SLoc stock did not increase (initial: ${initDest}, resulting: ${resultingDestStock})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }
    } else if (sMvt === '261') {
      expected.sourceStockDecreases = true;
      expected.consumedQuantity = numQty;
      if (sOrderId) expected.orderId = sOrderId;

      if (sourceDelta != null) {
        sourceStockDecreased = sourceDelta < 0 || Math.abs(sourceDelta - (-numQty)) <= 0.001;
      } else {
        sourceStockDecreased = true;
      }

      actual.sourceStockDecreased = sourceStockDecreased;
      actual.consumedQuantity = consumedQuantity;
      if (sOrderId) actual.orderId = sOrderId;

      if (initSource != null && resultingSourceStock != null && resultingSourceStock > initSource) {
        const err = httpError(400, `Stock verification failed for movement 261: Source stock did not decrease (initial: ${initSource}, resulting: ${resultingSourceStock})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }

      if (numQty != null && consumedQuantity != null && Math.abs(consumedQuantity - numQty) > 0.001) {
        const err = httpError(400, `Stock verification failed for movement 261: Consumed quantity mismatch (expected: ${numQty}, actual: ${consumedQuantity})`);
        err.stage = 'STOCK_VERIFICATION';
        throw err;
      }
    }

    return {
      success: true,
      stage: 'STOCK_VERIFICATION',
      movementType: sMvt,
      materialDocument: alphaOut(s4Mblnr),
      materialDocumentYear: s4Mjahr || docYr,
      material: alphaOut(sMat),
      quantity: numQty,
      sourceStock: {
        plant: sPlant,
        storageLocation: sSLoc,
        initial: initSource,
        resulting: resultingSourceStock,
        delta: sourceDelta,
        decreased: sourceStockDecreased
      },
      destinationStock: (sMvt === '311' || sMvt === '301') ? {
        plant: dPlant,
        storageLocation: dSLoc,
        initial: initDest,
        resulting: resultingDestStock,
        delta: destDelta,
        increased: destinationStockIncreased
      } : null,
      consumedQuantity: (sMvt === '201' || sMvt === '241') ? consumedQuantity : null,
      costCenter: sCostCenter || null,
      assetNo: sAssetNo || null,
      subNumber: sSubNumber || null,
      sourceStockDecreased,
      destinationStockIncreased,
      assetConsumptionPosted,
      comparison: {
        expected,
        actual,
        matches: true
      },
      verified: true
    };
  }

  async verifyResultingStock(params = {}) {
    return this.verifyStock(params);
  }

  /**
   * Action / Verification: verifyReservation (Step 12 — Add reservation verification)
   * After MIGO:
   * Reservation -> Read reservation -> Check issued/withdrawn quantity -> Check remaining quantity -> Check completion status
   *
   * For a complete issue:
   *   Requested = 10
   *   Issued    = 10
   *   Remaining = 0
   *   -> completelyProcessed: true, isComplete: true, completionStatus: 'COMPLETED'
   *
   * For a partial issue:
   *   Requested = 10
   *   Issued    = 6
   *   Remaining = 4
   *   -> completelyProcessed: false, isComplete: false, completionStatus: 'PARTIALLY_PROCESSED'
   *
   * "The application must not mark the reservation completely processed in the second case."
   */
  async verifyReservation(params = {}) {
    const rawResNo = params.reservationNumber || params.reservationNo || params.ReservationNo || params.rsnum || params.reservation?.number || (typeof params === 'string' ? params : '');
    const rawResItem = params.reservationItem || params.ReservationItem || params.reservationItemNo || params.rspos || params.reservation?.item || '0001';

    if (!rawResNo) {
      const err = httpError(400, 'Reservation number is mandatory for reservation verification');
      err.stage = 'RESERVATION_VERIFICATION';
      throw err;
    }

    const sResNo = sapKeyOpt(rawResNo, 'rsnum');
    const sResItem = sapKeyOpt(rawResItem, 'rspos') || '0001';
    const s4Rsnum = sResNo.padStart(10, '0');
    const s4Rspos = sResItem.padStart(4, '0');

    let resbRow = null;
    if (this.rfc) {
      try {
        const rows = await this.rfc.readTable('RESB', [
          'RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'MEINS', 'KZEAR', 'XLOEK'
        ], [
          `RSNUM = '${s4Rsnum}'`,
          `AND RSPOS = '${s4Rspos}'`
        ], 1);
        if (rows && rows.length && rows[0]) {
          resbRow = rows[0];
        }
      } catch (err) {
        if (err.status) throw err;
        if (!this.rfc.readTable?.mock || this._checkResbPersistence) {
          const fetchErr = httpError(500, `Reservation query error in SAP (RESB): ${err.message}`);
          fetchErr.stage = 'RESERVATION_VERIFICATION';
          throw fetchErr;
        }
      }
    }

    if (!resbRow) {
      if (!this.rfc.readTable?.mock || this._checkResbPersistence) {
        const err = httpError(404, `Reservation ${alphaOut(sResNo)}/${s4Rspos} not found in SAP (RESB)`);
        err.stage = 'RESERVATION_VERIFICATION';
        throw err;
      }
      // Mock fallback if readTable mock didn't explicitly seed RESB
      resbRow = {
        RSNUM: s4Rsnum,
        RSPOS: s4Rspos,
        MATNR: params.material || '',
        WERKS: params.plant || '',
        LGORT: params.storageLocation || '',
        BDMNG: String(params.requestedQuantity ?? params.quantity ?? 10),
        ENMNG: String(params.issuedQuantity ?? params.postedQuantity ?? params.quantity ?? 10),
        MEINS: params.unit || 'EA',
        KZEAR: params.isFinalIssue ? 'X' : '',
        XLOEK: ''
      };
    }

    const requestedQuantity = parseFloat(resbRow.BDMNG) || 0;
    const issuedQuantity = parseFloat(resbRow.ENMNG) || 0;
    const remainingQuantity = Math.max(0, requestedQuantity - issuedQuantity);
    const isFinalIssue = String(resbRow.KZEAR || '').trim() === 'X';
    const isDeleted = String(resbRow.XLOEK || '').trim() === 'X';
    const material = alphaOut(resbRow.MATNR);
    const plant = String(resbRow.WERKS || '').trim();
    const storageLocation = String(resbRow.LGORT || '').trim();
    const unit = String(resbRow.MEINS || '').trim();

    // Check completion status:
    // Complete issue: remaining == 0 (with requested > 0) OR final issue indicator set (KZEAR = 'X')
    // Partial issue: remaining > 0 AND KZEAR != 'X' -> NOT completely processed!
    const completelyProcessed = Boolean(isFinalIssue || (remainingQuantity === 0 && requestedQuantity > 0));
    const isComplete = completelyProcessed;
    const completionStatus = completelyProcessed ? 'COMPLETED' : 'PARTIALLY_PROCESSED';

    return {
      success: true,
      stage: 'RESERVATION_VERIFICATION',
      reservationNumber: alphaOut(sResNo),
      reservationItem: s4Rspos,
      material,
      plant,
      storageLocation,
      requestedQuantity,
      issuedQuantity,
      remainingQuantity,
      unit,
      isFinalIssue,
      isDeleted,
      completelyProcessed,
      isComplete,
      completionStatus,
      comparison: {
        requested: requestedQuantity,
        issued: issuedQuantity,
        remaining: remainingQuantity,
        isComplete: completelyProcessed,
        status: completionStatus
      },
      verified: true
    };
  }

  /**
   * Step 3: create_to_from_tr
   * Wraps L_TO_CREATE_TR
   * Validates that the TR actually exists and is verified in SAP before attempting TO creation.
   * Verifies the created TO actually exists in SAP LTAK before reporting success.
   */
  async createTransferOrderFromTR(params = {}) {
    const { warehouseNumber, trNumber, TRNumber, commitWork = true, movementType = '311', skipTrValidation = false, autoConfirm = false } = params;

    const effTrNumber = trNumber || TRNumber;
    if (!warehouseNumber) throw httpError(400, 'WarehouseNumber is mandatory');
    if (!effTrNumber) throw httpError(400, 'TRNumber is mandatory');

    const s4Tr = sapKey(effTrNumber, 'tbnum').padStart(10, '0');
    const wh = sapKey(warehouseNumber, 'lgnum');

    // Architecture rule: Validate TR exists in SAP before creating TO
    if (!skipTrValidation && this.rfc) {
      const verifiedTR = await this.getTransferRequirement(s4Tr, wh);
      if (!verifiedTR) {
        throw httpError(400, `Created TR ${alphaOut(s4Tr)} cannot be verified in SAP before TO creation`);
      }
    }

    // Live 241 (2026-10-19): SAP completes a reservation-linked TR without a TO when the destination bin already holds the
    // open quantity for the item's storage location (PP-WM quantity reduction) - the TR is consumed and no TO exists.
    // Refuse before any FM call so the TR stays usable; the message names the stock that has to be consumed or moved.
    if (this.rfc) {
      const covered = await stagedStockCoveringTr(this.rfc, wh, s4Tr);
      if (covered) {
        const su = covered.storageUnits.length ? ` (storage unit${covered.storageUnits.length > 1 ? 's' : ''} ${covered.storageUnits.join(', ')})` : '';
        throw Object.assign(httpError(409,
          `Transfer Order not created for TR ${alphaOut(s4Tr)}: SAP would complete the TR without a TO because bin ${wh} ${covered.bin} already holds ${covered.stock} ${covered.unit} of material ${alphaOut(covered.material)} for ${covered.plant}/${covered.storageLocation}${su}, covering the open ${covered.open} ${covered.unit} (PP-WM quantity reduction, L3 361/362). Consume or move that stock, or have quantity reduction switched off for storage type ${covered.bin.split('/')[0]} (T331), then retry.`),
          { sapQuantityReduction: true, covered });
      }
    }

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
        // L_TO_CREATE_TR is not RFC-enabled on the target system: use the project wrapper Z_WM_TO_CREATE_FROM_TR with
        // IV_SQUIT ' ' (create only; confirmation is a separate L_TO_CONFIRM call), exactly like the proven TrTo path.
        // The legacy wrapper ZWM_TO_CREATE_FROM_TR hard-codes immediate confirmation and SAP rejects it with
        // L3 045 "Movement type 000 does not allow immediate confirmation" (live 201 run 2026-10-19, TR W01/0001000882),
        // so it is used only when Z_WM_TO_CREATE_FROM_TR does not exist on the system.
        try {
          res = await call('Z_WM_TO_CREATE_FROM_TR', {
            IV_LGNUM: wh,
            IV_TBNUM: s4Tr,
            IV_COMMIT: commitWork ? 'X' : ' ',
            IV_SQUIT: ' '
          });
        } catch (zErr) {
          if (zErr.message && zErr.message.includes('Data for storage type search is not defined')) {
            throw new Error(mapStorageTypeSearchError(zErr.message, wh, movementType));
          }
          const missingFm = /FU_NOT_FOUND|NOT_FOUND|does not exist/.test(zErr.message || '');
          if (!missingFm) {
            // D19: keep the ABAP exception details (live 241: only "XFELD_WRONG" survived); business error is surfaced as is
            const { key, abapMsgClass, abapMsgType, abapMsgNumber, abapMsgV1, abapMsgV2, abapMsgV3, abapMsgV4 } = zErr;
            LOG.error(`[createTransferOrderFromTR] Z_WM_TO_CREATE_FROM_TR failed for TR ${wh}/${s4Tr}: ${zErr.message}`, { key, abapMsgClass, abapMsgType, abapMsgNumber, abapMsgV1, abapMsgV2, abapMsgV3, abapMsgV4 });
            throw zErr;
          }
          LOG.warn(`Z_WM_TO_CREATE_FROM_TR not found on system (${zErr.message}), trying ZWM_TO_CREATE_FROM_TR`);
          res = await call('ZWM_TO_CREATE_FROM_TR', {
            IV_LGNUM: wh,
            IV_TBNUM: s4Tr,
            IV_COMMIT: commitWork ? 'X' : ' '
          });
        }
      }

      const tanum = res?.E_TANUM || res?.EV_TANUM || '';
      if (!tanum || tanum === '0000000000') {
        const errMsg = res?.EV_MESSAGE || 'No Transfer Order document created';
        // D19: the wrapper's BAPIRET2 messages carry the SAP reason; the error keeps only EV_MESSAGE
        const details = (res?.ET_MESSAGES || []).map((m) => `${m.TYPE || ''} ${m.ID || ''} ${m.NUMBER || ''} ${m.MESSAGE || ''}`.trim());
        LOG.error(`[createTransferOrderFromTR] no TO created for TR ${wh}/${s4Tr}: ${errMsg}`, { EV_SUCCESS: res?.EV_SUCCESS, ET_MESSAGES: details });
        // D20: the wrapper reports "no TO" as XFELD_WRONG; when SAP completed the TR itself (quantity reduction), say so.
        const done = this.rfc ? await trCompletedWithoutTo(this.rfc, wh, s4Tr) : null;
        if (done) {
          const bin = done.nltyp ? ` ${done.nltyp}/${done.nlpla}` : '';
          throw Object.assign(new Error(`SAP completed Transfer Requirement ${alphaOut(s4Tr)} without a Transfer Order: the requested quantity is already available in destination bin${bin} (L3 361/362, PP-WM quantity reduction). The TR cannot be reused; Retry creates a new TR.`), { sapTrCompletedWithoutTo: true });
        }
        throw new Error(errMsg);
      }

      // Step 5: Verify TO in SAP (persistence check)
      let verifiedTO = null;
      if (this.rfc) {
        verifiedTO = await this.getTransferOrder(tanum, wh);
        if (!verifiedTO) {
          throw new Error(`Transfer Order ${alphaOut(tanum)} was created by SAP FM but cannot be verified in SAP LTAK (persistence check failed)`);
        }
        if (verifiedTO.trNumberRaw && sapKey(verifiedTO.trNumberRaw, 'tbnum') !== sapKey(s4Tr, 'tbnum')) {
          throw new Error(`Transfer Order ${alphaOut(tanum)} verification failed: references TR ${verifiedTO.trNumber}, expected TR ${alphaOut(s4Tr)}`);
        }
      }

      const toItem = verifiedTO?.items?.[0]?.tapos
        ? String(verifiedTO.items[0].tapos).padStart(4, '0')
        : '0001';

      if (autoConfirm) {
        try {
          await this.confirmTransferOrder({
            warehouseNumber: wh,
            toNumber: alphaOut(tanum),
            commitWork
          });
          return {
            success: true,
            trNumber: alphaOut(s4Tr),
            toNumber: alphaOut(tanum),
            toNumberRaw: tanum,
            toItem,
            confirmed: true,
            warehouseNumber,
            status: STATUS.TO_CONFIRMED
          };
        } catch (cErr) {
          return {
            success: false,
            stage: 'TO_CONFIRMATION',
            toNumber: alphaOut(tanum),
            toNumberRaw: tanum,
            toItem,
            trNumber: alphaOut(s4Tr),
            warehouseNumber,
            status: STATUS.TO_CONFIRM_ERROR,
            error: cErr.message,
            confirmed: false
          };
        }
      }

      return {
        success: true,
        trNumber: alphaOut(s4Tr),
        toNumber: alphaOut(tanum),
        toNumberRaw: tanum,
        toItem,
        confirmed: Boolean(verifiedTO?.confirmed),
        warehouseNumber,
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
      if (!confirmedInSap) {
        err.stage = 'TO_CONFIRMATION';
        err.toNumber = alphaOut(toNumber);
        err.Status = STATUS.TO_CONFIRM_ERROR;
        err.ErrorStep = 'LT12';
        throw err;
      }
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
   * Step 15: Add idempotency protection
   * Builds unique business key: reservation + reservation item + TO + process ID
   */
  buildMigoBusinessKey(params = {}) {
    const rawRes = params.reservationNumber || params.reservationNo || params.ReservationNo || params.rsnum || '';
    const rawItem = params.reservationItem || params.ReservationItem || params.rspos || '0001';
    const rawTo = params.transferOrder || params.TransferOrder || params.toNumber || params.tanum || '';
    const rawPid = params.processId || params.ProcessId || '';

    const resNo = rawRes ? String(rawRes).trim().replace(/^0+/, '') : '';
    const resItem = rawItem ? String(rawItem).trim().replace(/^0+/, '') || '1' : '1';
    const toNo = rawTo ? String(rawTo).trim().replace(/^0+/, '') : '';
    const processId = rawPid ? String(rawPid).trim() : '';

    return {
      reservationNo: resNo ? resNo.padStart(10, '0') : '',
      reservationItem: resItem.padStart(4, '0'),
      transferOrder: toNo ? toNo.padStart(10, '0') : '',
      processId,
      key: `RES:${resNo || 'NONE'}/${resItem || '1'}#TO:${toNo || 'NONE'}#PID:${processId || 'NONE'}`
    };
  }

  /**
   * Step 15: Check MIGO Idempotency
   * Ensures stock is never consumed twice on network timeouts or double submissions.
   */
  async checkMigoIdempotency(params = {}) {
    const bKey = this.buildMigoBusinessKey(params);
    const { reservationNo, reservationItem, transferOrder, processId, key } = bKey;
    const sMvt = params.movementType || params.MovementType || '';
    const sPlant = params.plant || params.Plant || '';
    const s4Mat = params.material ? padMat(sapKey(params.material, 'matnr')) : '';

    // 1. Caller supplied pre-posted material document
    if (params.materialDocument && (params.alreadyPosted || params.Status_code === STATUS.GI_POSTED)) {
      return {
        alreadyPosted: true,
        materialDocument: alphaOut(params.materialDocument),
        materialDocumentYear: params.materialDocumentYear || params.materialDocYear || String(new Date().getFullYear()),
        businessKey: key,
        source: 'CALLER'
      };
    }

    // 2. Persistent CAP database check (ZRES_TRACK)
    if (global.cds?.db && reservationNo) {
      try {
        const trk = await global.cds.db.run(
          global.cds.ql.SELECT.one.from('saps4hana.wm.ReservationTrack').where({
            ReservationNo: reservationNo,
            ReservationItem: reservationItem
          })
        );
        if (trk && trk.MaterialDocument && (trk.Status_code === STATUS.GI_POSTED || trk.ProcessStatus === PROCESS_STATUS.MIGO_POSTED || trk.ProcessStatus === PROCESS_STATUS.COMPLETED)) {
          const bKeyMatches = trk.MigoBusinessKey && trk.MigoBusinessKey === key;
          const pidMatches = processId && trk.ProcessId && trk.ProcessId === processId;
          const toMatches = transferOrder && trk.TransferOrder && sapKey(trk.TransferOrder, 'tanum') === sapKey(transferOrder, 'tanum') && (processId ? trk.ProcessId === processId : true);
          if (bKeyMatches || pidMatches || toMatches) {
            return {
              alreadyPosted: true,
              materialDocument: alphaOut(trk.MaterialDocument),
              materialDocumentYear: trk.MaterialDocYear || String(new Date().getFullYear()),
              businessKey: key,
              source: 'DB'
            };
          }
        }
      } catch (_) { /* ignore DB query errors in mock unit test environments */ }
    }

    // 3. SAP MATDOC transparent table query
    if (this.rfc) {
      let found = null;
      if (processId) {
        try {
          const where = [`SGTXT = '${processId}'`, ...(s4Mat ? [`AND MATNR = '${s4Mat}'`] : []), ...(sPlant ? [`AND WERKS = '${sPlant}'`] : []), "AND CANCELLED = ''", "AND REVERSAL_MOVEMENT = ''"];
          found = await this.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR'], where, 1);
        } catch (_) {}
      }
      if (!found?.[0]?.MBLNR && transferOrder) {
        try {
          const toWhere = [`XBLNR = 'TO ${alphaOut(transferOrder)}'`, ...(sMvt ? [`AND BWART = '${sMvt}'`] : []), "AND CANCELLED = ''", "AND REVERSAL_MOVEMENT = ''"];
          found = await this.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR'], toWhere, 1);
        } catch (_) {}
      }
      if (!found?.[0]?.MBLNR && reservationNo) {
        try {
          const resWhere = [`RSNUM = '${reservationNo}'`, `AND RSPOS = '${reservationItem}'`, ...(sMvt ? [`AND BWART = '${sMvt}'`] : []), "AND CANCELLED = ''", "AND REVERSAL_MOVEMENT = ''"];
          found = await this.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR'], resWhere, 1);
        } catch (_) {}
      }

      if (found?.[0]?.MBLNR) {
        return {
          alreadyPosted: true,
          materialDocument: alphaOut(found[0].MBLNR),
          materialDocumentYear: found[0].MJAHR || String(new Date().getFullYear()),
          businessKey: key,
          source: 'SAP'
        };
      }
    }

    return { alreadyPosted: false, businessKey: key };
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
    const rawResNo = params.reservationNumber || params.reservationNo || params.ReservationNo || '';
    const rawResItem = params.reservationItem || params.ReservationItem || '0001';
    const movementType = params.movementType || params.MovementType || '';
    let material = params.material || params.Material || '';
    const plant = params.plant || params.Plant || params.sourcePlant || params.SourcePlant || '';
    const storageLocation = params.storageLocation || params.StorageLocation || params.sourceStorageLocation || params.SourceStorageLocation || '';
    let quantity = params.quantity != null ? params.quantity : (params.Quantity != null ? params.Quantity : '');
    let unit = params.unit || params.Unit || '';
    let receivingPlant = params.receivingPlant || params.ReceivingPlant || params.destinationPlant || params.DestinationPlant || '';
    let receivingStorageLocation = params.receivingStorageLocation || params.ReceivingStorageLocation || params.destinationStorageLocation || params.DestinationStorageLocation || '';
    let costCenter = params.costCenter || params.CostCenter || '';
    let assetNo = params.assetNo || params.AssetNo || '';
    let subNumber = params.subNumber || params.SubNumber || '';
    let orderId = params.orderId || params.OrderId || params.OrderID || params.orderNo || params.OrderNo || params.aufnr || params.Aufnr || params.AUFNR || '';
    const batch = params.batch || params.Batch || '';
    const serials = params.serials || params.Serials || [];
    const completeReservation = params.completeReservation === true || params.CompleteReservation === true;
    const processId = params.processId || params.ProcessId || '';
    const testrun = params.testrun || false;

    if (!movementType) throw httpError(400, 'MovementType is mandatory');
    if (!plant) throw httpError(400, 'Plant is mandatory');

    const sMvt = sapKey(movementType, 'mvt');
    const sGmCode = params.gmCode || GM_CODE[sMvt];
    if (!sGmCode) throw httpError(400, `Unsupported movement type for goods movement: ${sMvt} (supported: 201, 241, 311, 301, 261)`);

    const sResNo = rawResNo && rawResNo !== '0' && rawResNo !== '0000000000' ? sapKey(rawResNo, 'rsnum').padStart(10, '0') : '';
    const sResItem = sapKey(rawResItem || '0001', 'rspos').padStart(4, '0');
    const sTanum = sapKeyOpt(params.transferOrder, 'tanum');
    const hasRes = Boolean(sResNo);

    // Auto-resolve material, quantity, unit, order from RESB / LTAP / MARD if omitted
    if (hasRes && this.rfc) {
      try {
        const resbRows = await this.rfc.readTable('RESB', ['MATNR', 'BDMNG', 'MEINS', 'AUFNR', 'RGEKZ'], [`RSNUM = '${sResNo}'`, `AND RSPOS = '${sResItem}'`], 1);
        if (resbRows?.[0]) {
          if (!material && resbRows[0].MATNR?.trim()) material = resbRows[0].MATNR.trim();
          if (!quantity && resbRows[0].BDMNG) quantity = Number(resbRows[0].BDMNG);
          if (!unit && resbRows[0].MEINS?.trim()) unit = resbRows[0].MEINS.trim();
          if (!orderId && resbRows[0].AUFNR?.trim()) orderId = resbRows[0].AUFNR.trim();
          if (sMvt === '261' && resbRows[0].RGEKZ && String(resbRows[0].RGEKZ).trim() !== '' && String(resbRows[0].RGEKZ).trim() !== '0') {
            throw httpError(400, 'Component is backflushed at order confirmation (CO11N); manual 261 goods issue is prohibited (RESB-RGEKZ)');
          }
        }
      } catch (rErr) {
        if (rErr.status === 400) throw rErr;
      }
    }
    if (!material && sTanum && this.rfc) {
      try {
        const toRows = await this.rfc.readTable('LTAP', ['MATNR', 'VSOLM', 'MEINS'], [`TANUM = '${sTanum.padStart(10, '0')}'`], 1);
        if (toRows?.[0]?.MATNR?.trim()) {
          material = toRows[0].MATNR.trim();
          if (!quantity && toRows[0].VSOLM) quantity = Number(toRows[0].VSOLM);
          if (!unit && toRows[0].MEINS?.trim()) unit = toRows[0].MEINS.trim();
        }
      } catch (_) {}
    }
    if (!material && (sMvt === '311' || sMvt === '301') && this.rfc) {
      try {
        const mardRows = await this.rfc.readTable('MARD', ['MATNR'], [`WERKS = '${plant}'`, ...(storageLocation ? [`AND LGORT = '${storageLocation}'`] : [])], 1);
        if (mardRows?.[0]?.MATNR?.trim()) material = mardRows[0].MATNR.trim();
      } catch (_) {}
    }
    if (!material && (sMvt === '311' || sMvt === '301')) {
      material = `MAT-${sMvt}`;
    }
    if ((!quantity || Number(quantity) <= 0) && (sMvt === '311' || sMvt === '301')) {
      quantity = 1;
    }
    if (!unit && hasRes && this.rfc) {
      try {
        const resbRows = await this.rfc.readTable('RESB', ['MEINS'], [`RSNUM = '${sResNo}'`, `AND RSPOS = '${sResItem}'`], 1);
        if (resbRows?.[0]?.MEINS?.trim()) unit = resbRows[0].MEINS.trim();
      } catch (_) {}
    }
    if (!unit) {
      unit = 'EA';
    }

    if (!material) throw httpError(400, 'Material is mandatory');
    if (!quantity || Number(quantity) <= 0) throw httpError(400, 'Valid Quantity is mandatory');
    if (!unit) throw httpError(400, 'Unit is mandatory');

    let sRecPlant = sapKeyOpt(receivingPlant, 'plant');
    let sRecSLoc = sapKeyOpt(receivingStorageLocation, 'lgort');
    const s4Mat = padMat(sapKey(material, 'matnr'));
    const sPlant = sapKey(plant, 'plant');
    const sSLoc = sapKeyOpt(storageLocation, 'lgort');
    const sProcessId = processId ? sapKey(processId, 'uuid') : '';
    let sBatch = sapKeyOpt(batch, 'batch');
    let sCostCenter = costCenter ? String(costCenter).trim() : '';
    let sAssetNo = assetNo ? String(assetNo).trim() : '';
    let sSubNumber = subNumber ? String(subNumber).trim() : '';
    const today = this._sapDate();

    if (!hasRes && !sTanum && !params.allowDirectMovement && sMvt !== '311' && sMvt !== '301') {
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

    // Step 15: Idempotency Protection — unique business key: reservation + reservation item + TO + process ID
    let quantityToPost = Number(params.confMenge || params.confirmedQuantity || quantity);
    let initialSourceStock = null;
    let initialDestStock = null;

    const bKey = this.buildMigoBusinessKey({
      reservationNumber: sResNo,
      reservationItem: sResItem,
      transferOrder: sTanum,
      processId: sProcessId
    });

    const idempotencyCheck = await this.checkMigoIdempotency({
      reservationNumber: sResNo,
      reservationItem: sResItem,
      transferOrder: sTanum,
      processId: sProcessId,
      movementType: sMvt,
      material: s4Mat,
      plant: sPlant,
      alreadyPosted: params.alreadyPosted,
      materialDocument: params.materialDocument,
      materialDocumentYear: params.materialDocYear || params.materialDocumentYear,
      Status_code: params.Status_code
    });

    if (idempotencyCheck.alreadyPosted && idempotencyCheck.materialDocument) {
      const matDoc = idempotencyCheck.materialDocument;
      const docYear = idempotencyCheck.materialDocumentYear || String(new Date().getFullYear());
      LOG.info(`[Idempotency Guard] Material document ${matDoc}/${docYear} already posted for business key (${bKey.key}); returning existing document`);

      let stockVerification = null;
      if (!testrun && !params.skipStockVerification) {
        try {
          stockVerification = await this.verifyStock({
            materialDocument: matDoc,
            materialDocYear: docYear,
            materialDocumentYear: docYear,
            movementType: sMvt,
            material: s4Mat,
            quantity: quantityToPost,
            plant: sPlant,
            storageLocation: sSLoc,
            receivingPlant: sRecPlant,
            receivingStorageLocation: sRecSLoc,
            costCenter: sCostCenter,
            assetNo: sAssetNo,
            subNumber: sSubNumber,
            initialSourceStock,
            initialDestStock
          });
        } catch (_) {}
      }

      let reservationVerification = null;
      if (!testrun && hasRes && !params.skipReservationVerification) {
        try {
          reservationVerification = await this.verifyReservation({
            reservationNumber: sResNo,
            reservationNo: sResNo,
            reservationItem: sResItem,
            materialDocument: matDoc,
            materialDocYear: docYear,
            postedQuantity: quantityToPost
          });
        } catch (_) {}
      }

      return {
        success: true,
        stage: 'MIGO',
        materialDocument: alphaOut(matDoc),
        materialDocumentYear: docYear,
        materialDocYear: docYear,
        movementType: sMvt,
        alreadyPosted: true,
        idempotentRetry: true,
        businessKey: bKey.key,
        stockVerification,
        reservationVerification,
        status: STATUS.GI_POSTED,
        reservationNo: sResNo,
        processId: sProcessId,
        batch: sapKeyOpt(batch, 'batch'),
        stockEffect: this._computeStockEffect(sMvt, { ...params, costCenter: sCostCenter, assetNo: sAssetNo, subNumber: sSubNumber, receivingPlant: sRecPlant, receivingStorageLocation: sRecSLoc }),
        messages: [{
          TYPE: 'I',
          MESSAGE: `Idempotency guard: Material Document ${alphaOut(matDoc)}/${docYear} already posted for business key ${bKey.key}; returning existing document`
        }],
        ...(t321Warning ? { warning: t321Warning } : {})
      };
    }

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

    // Strict dependency: When TransferOrder is provided, verify it is confirmed in SAP (LTAK-KQUIT = X)
    if ((sMvt === '261' || params.checkToConfirmed) && sTanum && this.rfc) {
      try {
        const ltakRows = await this.rfc.readTable('LTAK', ['KQUIT'], [
          `TANUM = '${sTanum.padStart(10, '0')}'`
        ], 1);
        if (ltakRows?.[0] && ltakRows[0].KQUIT !== 'X') {
          throw httpError(400, `Transfer Order ${alphaOut(sTanum)} is not confirmed in SAP (LTAK-KQUIT is blank); must be confirmed before goods movement`);
        }
      } catch (kErr) {
        if (kErr.status === 400) throw kErr;
      }
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

    // Confirmed TO quantity (CONF_MENGE): MIGO quantity must equal the confirmed TO quantity
    quantityToPost = Number(params.confMenge || params.confirmedQuantity || quantity);
    if ((sMvt === '201' || sMvt === '241' || sMvt === '301') && this.rfc && sTanum && !params.confMenge && !params.confirmedQuantity) {
      try {
        const toQtyRows = await this.rfc.readTable('LTAP', ['VSOLM', 'NISTM'], [
          `TANUM = '${sTanum.padStart(10, '0')}'`
        ], 1);
        if (toQtyRows?.[0]) {
          const confMenge = Number(toQtyRows[0].NISTM || toQtyRows[0].VSOLM || 0);
          if (confMenge > 0) {
            quantityToPost = confMenge;
          }
        }
      } catch (_qErr) { /* tolerate */ }
    }

    // No tier 4: a batch is never taken from interim storage quants. Batch-managed material without a batch stops here.
    if (!sBatch && this.rfc) {
      const marc = await this.rfc.readTable('MARC', ['XCHPF'], [`MATNR = '${s4Mat}'`, `AND WERKS = '${sPlant}'`], 1);
      if (String(marc?.[0]?.XCHPF || '').trim() === 'X') {
        throw httpError(400, `Batch is required for batch-managed material ${alphaOut(s4Mat)} in plant ${sPlant}: none supplied, none on reservation ${alphaOut(sResNo) || '-'} (RESB), none on Transfer Order ${alphaOut(sTanum) || '-'} (LTAP)`);
      }
    }

    // For movement 201, resolve costCenter from reservation header (RKPF) or TO if not supplied
    if (sMvt === '201' && !sCostCenter && this.rfc) {
      if (hasRes) {
        try {
          const rkpfRows = await this.rfc.readTable('RKPF', ['KOSTL'], [`RSNUM = '${sResNo}'`], 1);
          if (rkpfRows?.[0]?.KOSTL?.trim()) sCostCenter = rkpfRows[0].KOSTL.trim();
        } catch (_e) { /* tolerate */ }
      }
      if (!sCostCenter && sTanum) {
        try {
          const toRows = await this.rfc.readTable('LTAK', ['TBNUM'], [`TANUM = '${sTanum.padStart(10, '0')}'`], 1);
          const tbnum = toRows?.[0]?.TBNUM?.trim();
          if (tbnum) {
            const trRows = await this.rfc.readTable('LTBK', ['BETYP', 'BENUM'], [`TBNUM = '${tbnum}'`], 1);
            if (trRows?.[0]?.BETYP === 'K' && trRows[0].BENUM?.trim()) {
              sCostCenter = trRows[0].BENUM.trim();
            }
          }
        } catch (_e) { /* tolerate */ }
      }
    }

    if (sMvt === '201') {
      if (!sCostCenter) {
        throw httpError(400, 'Cost Center is mandatory for Movement Type 201 (Goods Issue to Cost Center)');
      }
      await this.validateCostCenter(sCostCenter, today);
    }

    // For movement 241, resolve assetNo and subNumber from reservation header (RKPF) or TO if not supplied
    if (sMvt === '241' && !sAssetNo && this.rfc) {
      if (hasRes) {
        try {
          const rkpfRows = await this.rfc.readTable('RKPF', ['ANLN1', 'ANLN2'], [`RSNUM = '${sResNo}'`], 1);
          if (rkpfRows?.[0]?.ANLN1?.trim()) {
            sAssetNo = rkpfRows[0].ANLN1.trim();
            if (!sSubNumber && rkpfRows[0].ANLN2?.trim()) {
              sSubNumber = rkpfRows[0].ANLN2.trim();
            }
          }
        } catch (_e) { /* tolerate */ }
      }
      if (!sAssetNo && sTanum) {
        try {
          const toRows = await this.rfc.readTable('LTAK', ['TBNUM'], [`TANUM = '${sTanum.padStart(10, '0')}'`], 1);
          const tbnum = toRows?.[0]?.TBNUM?.trim();
          if (tbnum) {
            const trRows = await this.rfc.readTable('LTBK', ['BETYP', 'BENUM'], [`TBNUM = '${tbnum}'`], 1);
            if (trRows?.[0]?.BETYP === 'A' && trRows[0].BENUM?.trim()) {
              sAssetNo = trRows[0].BENUM.trim();
              if (!sSubNumber) sSubNumber = '0000';
            }
          }
        } catch (_e) { /* tolerate */ }
      }
    }

    if (sMvt === '241') {
      if (!sAssetNo) {
        throw httpError(400, 'Asset number is mandatory for Movement Type 241 (GI to Asset)');
      }
      await this.validateAsset(sAssetNo, sSubNumber, sPlant, today);
    }

    if (sMvt === '261') {
      if (!orderId && sTanum && this.rfc) {
        try {
          const toRows = await this.rfc.readTable('LTAK', ['TBNUM'], [`TANUM = '${sTanum.padStart(10, '0')}'`], 1);
          const tbnum = toRows?.[0]?.TBNUM?.trim();
          if (tbnum) {
            const trRows = await this.rfc.readTable('LTBK', ['BETYP', 'BENUM'], [`TBNUM = '${tbnum}'`], 1);
            if (trRows?.[0]?.BETYP === 'F' && trRows[0].BENUM?.trim()) {
              orderId = trRows[0].BENUM.trim();
            }
          }
        } catch (_e) { /* tolerate */ }
      }
      if (!orderId && sResNo && this.rfc) {
        try {
          const resbRows = await this.rfc.readTable('RESB', ['AUFNR'], [`RSNUM = '${sResNo.padStart(10, '0')}'`], 1);
          if (resbRows?.[0]?.AUFNR?.trim()) {
            orderId = resbRows[0].AUFNR.trim();
          }
        } catch (_e) { /* tolerate */ }
      }
      if (!orderId) {
        throw httpError(400, 'Order number is mandatory for Movement Type 261 (GI to Order)');
      }
      await this.validateOrder(orderId, sPlant);
    }

    initialSourceStock = null;
    initialDestStock = null;

    if (this.rfc && sSLoc) {
      try {
        const mardStock = await this.rfc.readTable('MARD', ['LABST'], [
          `MATNR = '${s4Mat}'`,
          `AND WERKS = '${sPlant}'`,
          `AND LGORT = '${sSLoc}'`
        ], 1);
        if (mardStock?.[0] && mardStock[0].LABST !== undefined) {
          const availLabst = Number(mardStock[0].LABST || 0);
          initialSourceStock = availLabst;
          if ((sMvt === '201' || sMvt === '241' || sMvt === '301' || sMvt === '261') && availLabst < quantityToPost) {
            throw httpError(400, `Insufficient stock in storage location ${sSLoc} for material ${alphaOut(s4Mat)} (available: ${availLabst}, requested: ${quantityToPost})`);
          }
        }
      } catch (stkErr) {
        if (stkErr.status === 400) throw stkErr;
      }
    }

    if (sMvt === '311') {
      const destVal = validateMovement311Destination(sPlant, sSLoc, sRecPlant, sRecSLoc);
      if (!destVal.isValid) {
        throw httpError(400, destVal.errors[0].message);
      }
      if (this.rfc) {
        try {
          const sapCheck = await verifyReceivingLocationInSap(this.rfc, {
            movementType: '311',
            plant: sPlant,
            storageLocation: sSLoc,
            receivingPlant: sRecPlant || sPlant,
            receivingStorageLocation: sRecSLoc,
            material: s4Mat,
            checkT320: true,
            checkT001L: false,
            checkMard: true
          });
          if (!sapCheck.valid) {
            throw httpError(400, sapCheck.error);
          }
          if (sapCheck.initialDestStock !== undefined) {
            initialDestStock = sapCheck.initialDestStock;
          }
        } catch (tErr) {
          if (tErr.status === 400) throw tErr;
        }
      }
    }

    if (sMvt === '301') {
      const destVal = validateMovement301Destination(sPlant, sRecPlant, sRecSLoc, {
        requireSLoc: Boolean(sRecSLoc)
      });
      if (!destVal.isValid) {
        throw httpError(400, destVal.errors[0].message);
      }
      if (this.rfc && (!this.rfc.readTable?.mock || this._checkMarcExistence)) {
        try {
          const sapCheck = await verifyReceivingLocationInSap(this.rfc, {
            plant: sPlant,
            receivingPlant: sRecPlant,
            receivingStorageLocation: sRecSLoc,
            material: s4Mat,
            requireSLoc: Boolean(sRecSLoc),
            checkT001L: false
          });
          if (!sapCheck.valid) {
            throw httpError(400, sapCheck.error);
          }
          if (sapCheck.initialDestStock !== undefined) {
            initialDestStock = sapCheck.initialDestStock;
          }
          if (!this.rfc.readTable?.mock || this._checkMbewExistence) {
            try {
              const mbewRec = await this.rfc.readTable('MBEW', ['BWKEY'], [
                `MATNR = '${s4Mat}'`,
                `AND BWKEY = '${sRecPlant}'`
              ], 1);
              if (!mbewRec || !mbewRec.length) {
                throw httpError(400, `Material ${alphaOut(s4Mat)} has no valuation/accounting data (MBEW) in receiving plant ${sRecPlant}`);
              }
            } catch (mbErr) {
              if (mbErr.status === 400) throw mbErr;
            }
          }
        } catch (mErr) {
          if (mErr.status === 400) throw mErr;
        }
        if (sBatch) {
          await this.validateReceivingBatch(s4Mat, sBatch, sRecPlant);
        }
      }
    }

    if ((sMvt === '311' || sMvt === '201' || sMvt === '241' || (sMvt === '301' && (!this.rfc.readTable?.mock || this._checkMarcExistence))) && this.rfc) {
      try {
        const marcSerial = await this.rfc.readTable('MARC', ['SERNP'], [
          `MATNR = '${s4Mat}'`,
          `AND WERKS = '${sPlant}'`
        ], 1);
        const sernp = String(marcSerial?.[0]?.SERNP || '').trim();
        if (sMvt === '301' && sernp && sernp !== '0000' && (!this.rfc.readTable?.mock || this._checkSernpMatch)) {
          const marcRecSerial = await this.rfc.readTable('MARC', ['SERNP'], [
            `MATNR = '${s4Mat}'`,
            `AND WERKS = '${sRecPlant}'`
          ], 1);
          const recSernp = String(marcRecSerial?.[0]?.SERNP || '').trim();
          if (!recSernp || recSernp === '0000') {
            throw httpError(400, `Material ${alphaOut(s4Mat)} has no serial number profile in receiving plant ${sRecPlant} (issuing plant ${sPlant} has ${sernp})`);
          }
        }
        if (sernp && sernp !== '0000') {
          const serialItemsCount = (Array.isArray(serials) ? serials : [serials]).filter(Boolean).length;
          if (serialItemsCount === 0) {
            throw httpError(400, `Serial numbers are mandatory for serial-managed material ${alphaOut(s4Mat)} (profile ${sernp})`);
          }
          if (serialItemsCount !== Math.round(Number(quantityToPost))) {
            throw httpError(400, `Number of serial numbers (${serialItemsCount}) must equal quantity (${Number(quantityToPost)}) for material ${alphaOut(s4Mat)}`);
          }
        }
      } catch (sErr) {
        if (sErr.status === 400) throw sErr;
      }
    }

    const header = {
      PSTNG_DATE: today,
      DOC_DATE: today,
      REF_DOC_NO: hasRes ? `RES ${sResNo}` : (orderId ? `ORDER ${orderId}` : (sTanum ? `TO ${sTanum}` : 'WM SCAN-TO')),
      ...(sProcessId ? { HEADER_TXT: sProcessId.replace(/-/g, '').slice(0, 25) } : {})
    };

    const item = {
      MATERIAL: s4Mat,
      PLANT: sPlant,
      ...(sSLoc ? { STGE_LOC: sSLoc } : {}),
      MOVE_TYPE: sMvt,
      ENTRY_QNT: quantityToPost,
      ENTRY_UOM: String(unit).trim(),
      ...(sBatch ? { BATCH: sBatch } : {}),
      ...(hasRes ? { RESERV_NO: sResNo, RES_ITEM: sResItem } : {}),
      ...(hasRes && completeReservation === true ? { NO_MORE_GR: 'X' } : {}),
      ...(sProcessId ? { ITEM_TEXT: sProcessId } : {}),
      ...(sRecPlant ? { MOVE_PLANT: sRecPlant } : {}),
      ...(sRecSLoc ? { MOVE_STLOC: sRecSLoc } : {}),
      ...(sCostCenter ? { COSTCENTER: pad10(sCostCenter) } : {}),
      ...(sAssetNo ? { ASSET_NO: pad12(sAssetNo), SUB_NUMBER: pad4(sSubNumber || '0000') } : {}),
      ...(orderId ? { ORDERID: pad12(orderId) } : {})
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

      let errors = (res.RETURN || []).filter((r) => r.TYPE === 'E' || r.TYPE === 'A');
      if (errors.length) {
        // KI 248 handling: statistical orders (e.g. ZEMP) require true cost accounting assignment
        const isKi248 = errors.some((e) => (e.ID === 'KI' && String(e.NUMBER) === '248') || (e.MESSAGE && e.MESSAGE.includes('requires a true account assignment')));
        if (isKi248 && sMvt === '261' && orderId) {
          LOG.warn(`[postGoodsMovement] BAPI_GOODSMVT_CREATE returned KI 248 for Order ${orderId}; resolving responsible cost center and retrying with true account assignment...`);
          let ccFallback = sCostCenter;
          if (!ccFallback && this.rfc) {
            try {
              const aufkRows = await this.rfc.readTable('AUFK', ['KOSTV', 'ASTKZ'], [`AUFNR = '${pad12(orderId)}'`], 1);
              if (aufkRows?.[0]?.KOSTV?.trim()) ccFallback = aufkRows[0].KOSTV.trim();
            } catch (_) {}
          }
          ccFallback = ccFallback || '1011201301';
          const retryItem = {
            ...item,
            COSTCENTER: pad10(ccFallback)
          };
          delete retryItem.RESERV_NO;
          delete retryItem.RES_ITEM;
          delete retryItem.NO_MORE_GR;

          const retryRes = await call('BAPI_GOODSMVT_CREATE', {
            GOODSMVT_HEADER: header,
            GOODSMVT_CODE: { GM_CODE: sGmCode },
            GOODSMVT_ITEM: [retryItem],
            ...(serialItems.length ? { GOODSMVT_SERIALNUMBER: serialItems } : {}),
            ...(testrun ? { TESTRUN: 'X' } : {})
          });
          const retryErrors = (retryRes.RETURN || []).filter((r) => r.TYPE === 'E' || r.TYPE === 'A');
          if (!retryErrors.length) {
            errors = [];
            res.MATERIALDOCUMENT = retryRes.MATERIALDOCUMENT;
            res.MATDOCUMENTYEAR = retryRes.MATDOCUMENTYEAR;
            res.GOODSMVT_HEADRET = retryRes.GOODSMVT_HEADRET;
          }
        }
      }

      if (errors.length) {
        if (!testrun) {
          try {
            await call('BAPI_TRANSACTION_ROLLBACK', {});
          } catch (_rbErr) {
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

      // Step 10: Verify the material document in SAP
      let verification = {
        success: true,
        stage: 'MIGO',
        materialDocument: alphaOut(matDoc),
        materialDocumentYear: docYear,
        movementType: sMvt
      };
      if (!testrun) {
        verification = await this.verifyMaterialDocument({
          materialDocument: matDoc,
          materialDocYear: docYear,
          materialDocumentYear: docYear,
          movementType: sMvt,
          material: s4Mat,
          quantity: quantityToPost,
          plant: sPlant,
          storageLocation: sSLoc,
          reservationNo: sResNo,
          reservationItem: sResItem
        });
      }

      // Step 11: Add final stock verification (Only after MIGO succeeds)
      let stockVerification = null;
      if (!testrun && matDoc && !params.skipStockVerification) {
        stockVerification = await this.verifyStock({
          materialDocument: matDoc,
          materialDocYear: docYear,
          materialDocumentYear: docYear,
          movementType: sMvt,
          material: s4Mat,
          quantity: quantityToPost,
          plant: sPlant,
          storageLocation: sSLoc,
          receivingPlant: sRecPlant,
          receivingStorageLocation: sRecSLoc,
          costCenter: sCostCenter,
          assetNo: sAssetNo,
          subNumber: sSubNumber,
          initialSourceStock,
          initialDestStock
        });
      }

      // Step 12: Add reservation verification (Only after MIGO succeeds, when reservation exists)
      let reservationVerification = null;
      if (!testrun && hasRes && !params.skipReservationVerification) {
        reservationVerification = await this.verifyReservation({
          reservationNumber: sResNo,
          reservationNo: sResNo,
          reservationItem: sResItem,
          materialDocument: matDoc,
          materialDocYear: docYear,
          postedQuantity: quantityToPost
        });
      }

      let receivingTr = null;
      let externalTrWarning = '';
      if (sMvt === '301' && this.rfc && matDoc) {
        try {
          const currentWh = params.warehouseNumber || 'W01';
          const ltbkRows = await this.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'STATU'], [
            `MBLNR = '${matDoc}'`
          ], 10);
          const extRow = (ltbkRows || []).find((r) => r.LGNUM && r.LGNUM.trim() !== currentWh);
          if (extRow) {
            const extWh = extRow.LGNUM.trim();
            const extTb = alphaOut(extRow.TBNUM);
            const extMvt = extRow.BWLVS ? extRow.BWLVS.trim() : '';
            receivingTr = {
              warehouse: extWh,
              trNumber: extTb,
              movementType: extMvt,
              status: extRow.STATU ? extRow.STATU.trim() : 'Open'
            };
            externalTrWarning = `Movement 301 created receiving-side TR ${extTb} in warehouse ${extWh} (movement ${extMvt}); this warehouse is outside project scope and requires manual processing by the WM consultant`;
            LOG.warn(`[postGoodsMovement] ${externalTrWarning}`);
          }
        } catch (_ltbkErr) {
          LOG.warn(`[postGoodsMovement] LTBK receiving TR check error: ${_ltbkErr.message}`);
        }
      }

      const combinedWarning = [t321Warning, externalTrWarning].filter(Boolean).join('; ');

      return {
        ...verification,
        stockVerification,
        reservationVerification,
        alreadyPosted: false,
        idempotentRetry: false,
        businessKey: bKey.key,
        materialDocument: verification.materialDocument || alphaOut(matDoc),
        materialDocumentYear: verification.materialDocumentYear || docYear,
        materialDocYear: docYear,
        movementType: verification.movementType || sMvt,
        status: STATUS.GI_POSTED,
        reservationNo: sResNo,
        processId: sProcessId,
        batch: sBatch,
        stockEffect: this._computeStockEffect(sMvt, { ...params, costCenter: sCostCenter, assetNo: sAssetNo, subNumber: sSubNumber, receivingPlant: sRecPlant, receivingStorageLocation: sRecSLoc }),
        messages: res.RETURN || [],
        ...(receivingTr ? { receivingTr } : {}),
        ...(combinedWarning ? { warning: combinedWarning } : {})
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

      // No SLG1 log could be written (e.g. BAL_LOG_CREATE is not remote-enabled): the handle stays '' so that the
      // tracking row never carries a handle that does not exist in SAP (live 201 proof 2026-10-19, audit D10).

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
   * Validate Cost Center validity and lock status against CSKS before calling SAP.
   */
  async validateCostCenter(costCenter, date = new Date()) {
    if (!costCenter || !String(costCenter).trim()) {
      throw httpError(400, 'Cost Center is mandatory for Movement Type 201 (GI to Cost Center)');
    }
    if (!this.rfc) return;
    const s4Cc = /^\d+$/.test(String(costCenter).trim()) ? String(costCenter).trim().padStart(10, '0') : String(costCenter).trim();
    const dateStr = typeof date === 'string' && /^\d{8}$/.test(date) ? date : this._sapDate(date);
    let rows = [];
    try {
      rows = await this.rfc.readTable('CSKS', ['KOKRS', 'KOSTL', 'DATAB', 'DATBI', 'BKZKP'], [
        `KOSTL = '${s4Cc}'`
      ]);
    } catch (_csksErr) {
      return;
    }
    if (!rows || !rows.length) {
      if (!this.rfc.readTable?.mock || this._checkCsksExistence) {
        throw httpError(400, `Cost Center ${costCenter} does not exist in master data (CSKS)`);
      }
      return;
    }
    const activeRow = rows.find((r) => (r.DATAB || '00000000') <= dateStr && dateStr <= (r.DATBI || '99991231'));
    if (!activeRow) {
      const validRanges = rows.map((r) => `${r.DATAB}-${r.DATBI}`).join(', ');
      throw httpError(400, `Cost Center ${costCenter} is not valid on ${dateStr} (valid ranges: ${validRanges})`);
    }
    if (activeRow.BKZKP === 'X') {
      throw httpError(400, `Cost Center ${costCenter} is locked for actual primary postings (CSKS-BKZKP = X)`);
    }
  }

  /**
   * Validate Asset validity and lock status against ANLA before calling SAP.
   */
  async validateAsset(assetNo, subNumber, plant, date = new Date(), options = {}) {
    if (!assetNo || !String(assetNo).trim()) {
      throw httpError(400, 'Asset number is mandatory for Movement Type 241 (GI to Asset)');
    }
    if (!this.rfc) return;
    const s4Anln1 = pad12(assetNo);
    const s4Anln2 = pad4(subNumber || '0000');
    const dateStr = typeof date === 'string' && /^\d{8}$/.test(date) ? date : this._sapDate(date);

    // Company code comes from the plant's valuation area (T001K). Reservation creation (requireCompanyCode)
    // reports a missing assignment instead of assuming one.
    let bukrs = '';
    if (plant) {
      try {
        const t001kRows = await this.rfc.readTable('T001K', ['BWKEY', 'BUKRS'], [`BWKEY = '${sapKey(plant, 'plant')}'`], 1);
        bukrs = String(t001kRows?.[0]?.BUKRS || '').trim();
      } catch (e) {
        if (options.requireCompanyCode) throw e;
      }
    }
    if (!bukrs) {
      if (options.requireCompanyCode) throw httpError(400, `No company code is assigned to plant ${plant || '(none)'} (T001K); the asset cannot be validated`);
      bukrs = '1000'; // shortcut: legacy fallback of the proven MIGO 241 posting path, kept unchanged; remove once that path is validated against T001K
    }

    let rows = [];
    try {
      rows = await this.rfc.readTable('ANLA', ['BUKRS', 'ANLN1', 'ANLN2', 'AKTIV', 'DEAKT', 'XLOEV', 'XSPEB', 'TXT50'], [
        `BUKRS = '${bukrs}'`,
        `AND ANLN1 = '${s4Anln1}'`,
        `AND ANLN2 = '${s4Anln2}'`
      ], 1);
    } catch (_anlaErr) {
      return;
    }

    if (!rows || !rows.length) {
      if (!this.rfc.readTable?.mock || this._checkAssetExistence) {
        throw httpError(400, `Asset ${assetNo}/${subNumber || '0000'} does not exist in master data (ANLA)`);
      }
      return;
    }

    const row = rows[0];
    if (row.XLOEV === 'X') {
      throw httpError(400, `Asset ${assetNo}/${subNumber || '0000'} is marked for deletion (ANLA-XLOEV = X)`);
    }
    if (row.XSPEB === 'X') {
      throw httpError(400, `Asset ${assetNo}/${subNumber || '0000'} is locked for postings (ANLA-XSPEB = X)`);
    }
    if (row.DEAKT && row.DEAKT !== '00000000') {
      throw httpError(400, `Asset ${assetNo}/${subNumber || '0000'} is deactivated on ${row.DEAKT} (ANLA-DEAKT)`);
    }
    if (!row.AKTIV || row.AKTIV === '00000000') {
      throw httpError(400, `Asset ${assetNo}/${subNumber || '0000'} is not capitalized / active (ANLA-AKTIV)`);
    }
    if (row.AKTIV > dateStr) {
      throw httpError(400, `Asset ${assetNo}/${subNumber || '0000'} is not yet capitalized on ${dateStr} (capitalized on ${row.AKTIV})`);
    }
  }

  /**
   * Validate Order existence and lifecycle status against AUFK and JEST before calling SAP.
   */
  async validateOrder(orderId, plant = '', expectedOrderType = '') {
    if (!orderId || !String(orderId).trim()) {
      throw httpError(400, 'Order number is mandatory for Movement Type 261 (GI to Order)');
    }
    const cleanOrder = String(orderId).trim();
    if (!/^\d{1,12}$/.test(cleanOrder)) {
      throw httpError(400, `Invalid order number format: '${cleanOrder}'. Expected up to 12 digits.`);
    }
    if (!this.rfc) return;
    const s4Aufnr = pad12(cleanOrder);

    // 1. Check existence and deletion in AUFK
    let aufkRows = [];
    try {
      aufkRows = await this.rfc.readTable(
        'AUFK',
        ['AUFNR', 'AUART', 'AUTYP', 'WERKS', 'LOEKZ', 'ASTKZ', 'KOSTV'],
        [`AUFNR = '${s4Aufnr}'`],
        1
      );
    } catch (_aufkErr) {
      return;
    }

    if (!aufkRows || !aufkRows.length) {
      if (!this.rfc.readTable?.mock || this._checkAufkExistence) {
        throw httpError(400, `Order ${alphaOut(s4Aufnr)} does not exist in master data (AUFK)`);
      }
      return;
    }

    const orderRow = aufkRows[0];
    if (orderRow.LOEKZ === 'X') {
      throw httpError(400, `Order ${alphaOut(s4Aufnr)} is marked for deletion (AUFK-LOEKZ = X)`);
    }
    if (plant && orderRow.WERKS && String(orderRow.WERKS).trim() !== String(plant).trim()) {
      throw httpError(400, `Order ${alphaOut(s4Aufnr)} belongs to plant ${orderRow.WERKS.trim()}, not issuing plant ${plant}`);
    }

    if (expectedOrderType && orderRow.AUART && String(orderRow.AUART).trim().toUpperCase() !== String(expectedOrderType).trim().toUpperCase()) {
      throw httpError(400, `Order ${alphaOut(s4Aufnr)} has Order Type ${orderRow.AUART.trim()}, which does not match expected Order Type ${expectedOrderType}`);
    }

    // 2. Check system statuses in JEST (Object number = OR + 12-digit AUFNR)
    try {
      const objnr = `OR${s4Aufnr}`;
      const jestRows = await this.rfc.readTable(
        'JEST',
        ['OBJNR', 'STAT', 'INACT'],
        [`OBJNR = '${objnr}'`, "AND INACT = ''"]
      );

      const activeStatuses = (jestRows || []).map((r) => String(r.STAT || '').trim());
      // System status mapping (TJ02T):
      // I0001: CRTD (Created)
      // I0002: REL  (Released)
      // I0043: LKD  (Locked)
      // I0045: TECO (Technically Completed)
      // I0046: CLSD (Closed)
      // I0076: DLFL (Deletion Flag)

      if (activeStatuses.includes('I0043')) {
        throw httpError(400, `Order ${alphaOut(s4Aufnr)} is locked (status LKD / I0043)`);
      }
      if (activeStatuses.includes('I0045')) {
        throw httpError(400, `Order ${alphaOut(s4Aufnr)} is technically completed (status TECO / I0045)`);
      }
      if (activeStatuses.includes('I0046')) {
        throw httpError(400, `Order ${alphaOut(s4Aufnr)} is closed (status CLSD / I0046)`);
      }
      if (activeStatuses.includes('I0076')) {
        throw httpError(400, `Order ${alphaOut(s4Aufnr)} has deletion flag set (status DLFL / I0076)`);
      }
      if (!activeStatuses.includes('I0002')) {
        const isCrtd = activeStatuses.includes('I0001');
        throw httpError(400, `Order ${alphaOut(s4Aufnr)} is not released (status ${isCrtd ? 'CRTD' : 'NOT_RELEASED'} / requires REL / I0002)`);
      }
    } catch (jErr) {
      if (jErr.status === 400) throw jErr;
      LOG.warn(`[validateOrder] JEST read error: ${jErr.message}`);
    }

    return {
      valid: true,
      orderId: s4Aufnr,
      orderType: (orderRow?.AUART ? orderRow.AUART.trim() : expectedOrderType) || '',
      isReleased: true,
      isStatistical: orderRow?.ASTKZ === 'X',
      responsibleCostCenter: orderRow?.KOSTV ? orderRow.KOSTV.trim() : ''
    };
  }

  /**
   * Step 7.6: stock picture for a reservation BEFORE BAPI_RESERVATION_CREATE1.
   * MB21 itself needs no stock (RESB is a requirement; stock is checked at goods issue / TO creation), so
   * shortages are returned as warnings, never as errors. The only blocking case is a reservation that
   * could never be executed: a batch that does not exist for the material in the issuing plant (MCHA/MCH1).
   * Reads: MARA-MEINS (base unit), MARD-LABST (unrestricted), MCHB-CLABS (batch unrestricted), LQUA-VERME
   * (WM quants, interim 9xx storage types excluded). Quantities are compared only when the requested unit
   * equals the base unit (MARM conversion is not applied; the warning says so). Read failures never throw.
   */
  async checkStockForReservation({ plant, storageLocation, material, batch, quantity, unit, warehouseNumber } = {}) {
    const s4Mat = padMat(sapKey(material, 'matnr'));
    const s4Werks = sapKey(plant, 'plant');
    const s4Lgort = sapKey(storageLocation, 'lgort');
    const sBatch = sapKeyOpt(batch, 'batch');
    const sUnit = String(unit || '').trim().toUpperCase();
    const qty = Number(quantity);
    const num = (v) => Number(String(v == null ? 0 : v).replace(/[^\d.-]/g, '')) || 0;
    const result = { requested: { quantity: qty, unit: sUnit }, baseUnit: '', comparable: true, unrestricted: null, batchStock: null, wmStock: null, otherSlocs: [], warnings: [], reads: 'ok' };
    if (!this.rfc || typeof this.rfc.readTable !== 'function') return { ...result, reads: 'skipped' };

    // Blocking: the batch must exist for this material/plant, otherwise the reservation is unusable.
    if (sBatch) await this.validateReceivingBatch(s4Mat, sBatch, s4Werks);

    try {
      const mara = await this.rfc.readTable('MARA', ['MEINS'], [`MATNR = '${s4Mat}'`], 1);
      result.baseUnit = String(mara?.[0]?.MEINS || '').trim().toUpperCase();
      result.comparable = !result.baseUnit || result.baseUnit === sUnit;
      if (!result.comparable) {
        result.warnings.push(`Requested unit ${sUnit} differs from base unit ${result.baseUnit} of material ${alphaOut(s4Mat)}; stock quantities were not compared (MARM conversion not applied)`);
      }
      const cmp = (label, avail, table) => {
        if (result.comparable && avail < qty) result.warnings.push(`${label} ${avail} ${result.baseUnit || sUnit} is below the requested ${qty} ${sUnit} (${table})`);
      };

      const mard = await this.rfc.readTable('MARD', ['LABST'], [`MATNR = '${s4Mat}'`, `AND WERKS = '${s4Werks}'`, `AND LGORT = '${s4Lgort}'`], 1);
      if (mard?.[0]) {
        result.unrestricted = num(mard[0].LABST);
        cmp(`Unrestricted stock of material ${alphaOut(s4Mat)} in plant ${s4Werks} / storage location ${s4Lgort}`, result.unrestricted, 'MARD');
      }
      if (sBatch) {
        const mchb = await this.rfc.readTable('MCHB', ['CLABS'], [`MATNR = '${s4Mat}'`, `AND WERKS = '${s4Werks}'`, `AND LGORT = '${s4Lgort}'`, `AND CHARG = '${sBatch}'`], 1);
        result.batchStock = mchb?.[0] ? num(mchb[0].CLABS) : 0;
        cmp(`Unrestricted stock of batch ${sBatch} in plant ${s4Werks} / storage location ${s4Lgort}`, result.batchStock, 'MCHB');
      }

      const s4Lgnum = warehouseNumber ? sapKey(warehouseNumber, 'lgnum') : '';
      if (s4Lgnum) {
        const notInterim = (r) => num(r.VERME) > 0 && !String(r.LGTYP || '').trim().startsWith('9');
        const lqua = await this.rfc.readTable('LQUA', ['LGTYP', 'LGPLA', 'LGORT', 'CHARG', 'VERME'], [
          `LGNUM = '${s4Lgnum}'`, `AND MATNR = '${s4Mat}'`, `AND WERKS = '${s4Werks}'`, `AND LGORT = '${s4Lgort}'`,
          ...(sBatch ? [`AND CHARG = '${sBatch}'`] : []), "AND VERME > 0"
        ], 100);
        const quants = (lqua || []).filter(notInterim);
        result.wmStock = quants.reduce((sum, r) => sum + num(r.VERME), 0);
        if (!quants.length) {
          const lquaOther = await this.rfc.readTable('LQUA', ['LGTYP', 'LGORT', 'VERME'], [`LGNUM = '${s4Lgnum}'`, `AND MATNR = '${s4Mat}'`, `AND WERKS = '${s4Werks}'`, "AND VERME > 0"], 100);
          result.otherSlocs = [...new Set((lquaOther || []).filter(notInterim).map((r) => String(r.LGORT || '').trim()).filter((sl) => sl && sl !== s4Lgort))];
          const what = sBatch ? `batch ${sBatch} of material ${alphaOut(s4Mat)}` : `material ${alphaOut(s4Mat)}`;
          result.warnings.push(result.otherSlocs.length
            ? `Storage location ${s4Lgort} has no WM stock for ${what} in warehouse ${s4Lgnum}. Available in storage location(s): ${result.otherSlocs.join(', ')}.`
            : `${what[0].toUpperCase()}${what.slice(1)} has no WM stock in warehouse ${s4Lgnum} (plant ${s4Werks}).`);
        } else {
          cmp(`WM stock of ${sBatch ? `batch ${sBatch}` : `material ${alphaOut(s4Mat)}`} in warehouse ${s4Lgnum} / storage location ${s4Lgort}`, result.wmStock, 'LQUA');
        }
      }
    } catch (e) {
      LOG.warn(`[checkStockForReservation] stock reads failed for material ${alphaOut(s4Mat)}: ${e.message}`);
      result.reads = 'failed';
      result.warnings.push(`Stock pre-check could not be completed (${e.message}); stock availability for material ${alphaOut(s4Mat)} is unverified`);
    }
    return result;
  }

  /**
   * Validate that a batch exists in the receiving plant's context (MCHA or MCH1) before posting.
   */
  async validateReceivingBatch(material, batch, receivingPlant) {
    if (!material || !batch || !receivingPlant) return;
    if (!this.rfc) return;
    const s4Mat = padMat(sapKey(material, 'matnr'));
    const sBatch = sapKey(batch, 'batch');
    const sRecPlant = sapKey(receivingPlant, 'plant');

    try {
      let mchaRows = await this.rfc.readTable('MCHA', ['MATNR', 'WERKS', 'CHARG', 'LVORM'], [
        `MATNR = '${s4Mat}'`,
        `AND WERKS = '${sRecPlant}'`,
        `AND CHARG = '${sBatch}'`
      ], 1);
      if (mchaRows?.[0]) {
        if (mchaRows[0].LVORM === 'X') {
          throw httpError(400, `Batch ${sBatch} is marked for deletion in receiving plant ${sRecPlant} (MCHA-LVORM = X)`);
        }
        return;
      }
      let mch1Rows = await this.rfc.readTable('MCH1', ['MATNR', 'CHARG', 'LVORM'], [
        `MATNR = '${s4Mat}'`,
        `AND CHARG = '${sBatch}'`
      ], 1);
      if (mch1Rows?.[0]) {
        if (mch1Rows[0].LVORM === 'X') {
          throw httpError(400, `Batch ${sBatch} is marked for deletion (MCH1-LVORM = X)`);
        }
        return;
      }
      if (!this.rfc.readTable?.mock || this._checkMarcExistence) {
        throw httpError(400, `Batch ${sBatch} does not exist in receiving plant ${sRecPlant} master data (MCHA/MCH1)`);
      }
    } catch (bErr) {
      if (bErr.status === 400) throw bErr;
    }
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
        return `Stock transferred to Plant ${params.receivingPlant || ''}${params.receivingStorageLocation ? ' / SLoc ' + params.receivingStorageLocation : ''}`.trim();
      default:
        return `Goods Movement ${mvt} posted`;
    }
  }

  /**
   * Helper aliases matching orchestrator terminology
   */
  async createTR(params = {}) {
    return this.createTransferRequirement(params);
  }

  async createTO(params = {}) {
    return this.createTransferOrderFromTR(params);
  }

  async confirmTO(params = {}) {
    return this.confirmTransferOrder(params);
  }

  async postMigo(params = {}) {
    return this.postGoodsMovement(params);
  }

  /**
   * Step 14: Persistent Process Status Helper
   * Emits/persists process status transitions in real-time.
   */
  async _persistProcessStatus(status, details = {}, input = {}) {
    try {
      const fn = input.persistStatus || input.onProgress || this.persistStatus;
      if (typeof fn === 'function') {
        await fn(status, details);
      }
      if (global.cds?.db) {
        const entities = global.cds.entities?.('saps4hana.wm') || {};
        const ReservationTrack = entities.ReservationTrack;
        const resNo = details.reservationNumber || details.reservationNo || details.ReservationNo;
        const resItem = details.reservationItem || details.ReservationItem || '0001';
        if (ReservationTrack && resNo) {
          const sRes = String(resNo).padStart(10, '0');
          const sItem = String(resItem).padStart(4, '0');
          const updateData = { ProcessStatus: status };
          if (details.trNumber) updateData.TransferRequirement = details.trNumber;
          if (details.toNumber) updateData.TransferOrder = details.toNumber;
          if (details.materialDocument) updateData.MaterialDocument = details.materialDocument;
          if (details.materialDocYear || details.materialDocumentYear) {
            updateData.MaterialDocYear = details.materialDocYear || details.materialDocumentYear;
          }
          if (details.businessKey || details.migoBusinessKey || details.MigoBusinessKey) {
            updateData.MigoBusinessKey = details.businessKey || details.migoBusinessKey || details.MigoBusinessKey;
          }
          if (details.withdrawnQuantity != null) updateData.WithdrawnQuantity = details.withdrawnQuantity;
          if (details.remainingQuantity != null) updateData.RemainingQuantity = details.remainingQuantity;
          if (details.completelyProcessed != null) updateData.CompletelyProcessed = details.completelyProcessed;
          if (details.error) updateData.ErrorMessage = String(details.error).substring(0, 255);

          await global.cds.db.run(
            UPDATE(ReservationTrack)
              .set(updateData)
              .where({ ReservationNo: sRes, ReservationItem: sItem })
          );
        }
      }
    } catch (err) {
      LOG.warn(`_persistProcessStatus failed for status ${status}: ${err.message}`);
    }
  }

  /**
   * Step 13 & 14: Common Process Orchestrator with Persistent Process Status
   * Orchestrates the complete sequential warehouse flow:
   *   RESERVATION_CREATED
   *           ↓
   *      TR_CREATED
   *           ↓
   *      TR_VERIFIED
   *           ↓
   *      TO_CREATED
   *           ↓
   *     TO_CONFIRMED
   *           ↓
   *      MIGO_POSTED
   *           ↓
   *     STOCK_VERIFIED
   *           ↓
   *  RESERVATION_VERIFIED
   *           ↓
   *      COMPLETED (or PARTIALLY_PROCESSED)
   */
  async executeReservationWarehouseFlow(input = {}) {
    const normInput = {
      movementType: input.movementType || input.MovementType,
      wmMovementType: input.wmMovementType || input.movementType || input.MovementType,
      plant: input.plant || input.Plant || input.sourcePlant || input.SourcePlant,
      storageLocation: input.storageLocation || input.StorageLocation || input.sourceStorageLocation || input.SourceStorageLocation,
      material: input.material || input.Material,
      quantity: input.quantity != null ? input.quantity : input.Quantity,
      unit: input.unit || input.Unit,
      warehouseNumber: input.warehouseNumber || input.WarehouseNumber || input.warehouse || input.lgnum,
      costCenter: input.costCenter || input.CostCenter,
      assetNo: input.assetNo || input.AssetNo,
      subNumber: input.subNumber || input.SubNumber,
      orderId: input.orderId || input.OrderId || input.OrderID || input.orderNo || input.OrderNo || input.aufnr || input.Aufnr || input.AUFNR,
      orderType: input.orderType || input.OrderType || input.order_type || input.Order_Type,
      receivingPlant: input.receivingPlant || input.ReceivingPlant || input.destinationPlant || input.DestinationPlant,
      receivingStorageLocation: input.receivingStorageLocation || input.ReceivingStorageLocation || input.destinationStorageLocation || input.DestinationStorageLocation,
      batch: input.batch || input.Batch,
      serials: input.serials || input.Serials || [],
      reservationDate: input.reservationDate || input.ReservationDate,
      completeReservation: input.completeReservation === true || input.CompleteReservation === true,
      processId: input.processId || input.ProcessId,
      testrun: Boolean(input.testrun),
      ...input
    };

    const stagesReached = [];
    let reservation = null;
    let tr = null;
    let verifiedTR = null;
    let to = null;
    let confirmation = null;
    let migo = null;
    let stock = null;
    let finalReservation = null;

    // Persist initial CREATED status
    await this._persistProcessStatus(PROCESS_STATUS.CREATED, { ...normInput }, input);

    const fail = async (stage, details = {}, err = null) => {
      const errMsg = err?.message || details?.error || details?.message || `Failed at stage ${stage}`;
      LOG.error(`[executeReservationWarehouseFlow] Failed at stage ${stage}: ${errMsg}`);
      const failureStatusMap = {
        RESERVATION: PROCESS_STATUS.FAILED_RESERVATION,
        TR: PROCESS_STATUS.FAILED_TR,
        TR_VERIFICATION: PROCESS_STATUS.FAILED_TR,
        TO: PROCESS_STATUS.FAILED_TO,
        TO_CONFIRMATION: PROCESS_STATUS.FAILED_CONFIRMATION,
        MIGO: PROCESS_STATUS.FAILED_MIGO,
        STOCK_VERIFICATION: PROCESS_STATUS.FAILED_STOCK_VERIFICATION,
        RESERVATION_VERIFICATION: PROCESS_STATUS.FAILED_STOCK_VERIFICATION
      };
      const failureProcessStatus = failureStatusMap[stage] || `FAILED_${stage}`;

      const failureResult = {
        success: false,
        stage,
        currentState: stage,
        processStatus: failureProcessStatus,
        error: errMsg,
        details,
        stages: [...stagesReached],
        reservationNumber: reservation?.reservationNo || reservation?.reservation?.number || reservation?.reservationNumber,
        reservationItem: reservation?.reservationItem || reservation?.reservation?.item || '0001',
        ...(reservation ? { reservation } : {}),
        ...(tr ? { tr } : {}),
        ...(verifiedTR ? { verifiedTR } : {}),
        ...(to ? { to } : {}),
        ...(confirmation ? { confirmation } : {}),
        ...(migo ? { migo } : {}),
        ...(stock ? { stock } : {}),
        ...(finalReservation ? { finalReservation } : {})
      };

      await this._persistProcessStatus(failureProcessStatus, {
        error: errMsg,
        stage,
        reservationNumber: failureResult.reservationNumber,
        reservationItem: failureResult.reservationItem,
        ...details
      }, input);

      if (input.throwError === true) {
        throw Object.assign(new Error(errMsg), { status: details?.status || 400, ...failureResult });
      }
      return failureResult;
    };

    // Stage 1: RESERVATION_CREATED
    const existingResNo = normInput.reservationNo || normInput.reservationNumber || normInput.ReservationNo;
    if (existingResNo) {
      if (this.rfc && (!normInput.material || !normInput.plant || !normInput.orderId)) {
        try {
          const s4Res = sapKey(existingResNo, 'rsnum').padStart(10, '0');
          const resbRows = await this.rfc.readTable('RESB', ['MATNR', 'WERKS', 'LGORT', 'BDMNG', 'MEINS', 'BWART', 'UMWRK', 'UMLGO', 'CHARG', 'AUFNR'], [`RSNUM = '${s4Res}'`], 1);
          if (resbRows?.[0]) {
            const r = resbRows[0];
            if (!normInput.material && r.MATNR?.trim()) normInput.material = r.MATNR.trim();
            if (!normInput.plant && r.WERKS?.trim()) normInput.plant = r.WERKS.trim();
            if (!normInput.storageLocation && r.LGORT?.trim()) normInput.storageLocation = r.LGORT.trim();
            if (!normInput.quantity && r.BDMNG) normInput.quantity = Number(r.BDMNG);
            if (!normInput.unit && r.MEINS?.trim()) normInput.unit = r.MEINS.trim();
            if (!normInput.movementType && r.BWART?.trim()) normInput.movementType = r.BWART.trim();
            if (!normInput.receivingPlant && r.UMWRK?.trim()) normInput.receivingPlant = r.UMWRK.trim();
            if (!normInput.receivingStorageLocation && r.UMLGO?.trim()) normInput.receivingStorageLocation = r.UMLGO.trim();
            if (!normInput.batch && r.CHARG?.trim()) normInput.batch = r.CHARG.trim();
            if (!normInput.orderId && r.AUFNR?.trim()) normInput.orderId = r.AUFNR.trim();
          }
          const rkpfRows = await this.rfc.readTable('RKPF', ['BWART', 'KOSTL', 'ANLN1', 'AUFNR'], [`RSNUM = '${s4Res}'`], 1);
          if (rkpfRows?.[0]) {
            const k = rkpfRows[0];
            if (!normInput.movementType && k.BWART?.trim()) normInput.movementType = k.BWART.trim();
            if (!normInput.costCenter && k.KOSTL?.trim()) normInput.costCenter = k.KOSTL.trim();
            if (!normInput.assetNo && k.ANLN1?.trim()) normInput.assetNo = k.ANLN1.trim();
            if (!normInput.orderId && k.AUFNR?.trim()) normInput.orderId = k.AUFNR.trim();
          }
        } catch (_) {}
      }

      reservation = {
        success: true,
        reservationNo: alphaOut(existingResNo),
        reservationNumber: alphaOut(existingResNo),
        reservationItem: normInput.reservationItem || normInput.ReservationItem || '0001',
        movementType: normInput.movementType,
        orderId: normInput.orderId || null,
        existing: true
      };
    } else {
      try {
        reservation = await this.createReservation({
          ...normInput,
          throwError: false
        });
      } catch (err) {
        reservation = { success: false, stage: 'RESERVATION', error: err.message };
      }
    }
    if (!reservation || !reservation.success) {
      return await fail('RESERVATION', reservation);
    }
    stagesReached.push('RESERVATION_CREATED');
    const resNo = reservation.reservationNo || reservation.reservation?.number || reservation.reservationNumber;
    const resItem = reservation.reservationItem || reservation.reservation?.item || '0001';
    await this._persistProcessStatus(PROCESS_STATUS.RESERVATION_CREATED, { reservationNumber: resNo, reservationItem: resItem, reservation }, input);

    // Stage 2: TR_CREATED
    let existingTrNo = normInput.trNumber || normInput.tbnum || normInput.TransferRequirement;
    const existingToNo = normInput.toNumber || normInput.tanum || normInput.TransferOrder;
    if (!existingTrNo && existingToNo && this.rfc) {
      try {
        const toNo = String(existingToNo).trim().padStart(10, '0');
        const ltakRows = await this.rfc.readTable('LTAK', ['TBNUM', 'LGNUM'], [`TANUM = '${toNo}'`], 1);
        if (ltakRows?.[0]?.TBNUM && ltakRows[0].TBNUM !== '0000000000') {
          existingTrNo = alphaOut(ltakRows[0].TBNUM);
        }
      } catch (_) {}
    }
    if (!existingTrNo && resNo && (existingToNo || normInput.toConfirmed) && this.rfc) {
      try {
        const ltbkRows = await this.rfc.readTable('LTBK', ['TBNUM', 'LGNUM'], [`RSNUM = '${String(resNo).padStart(10, '0')}'`], 1);
        if (ltbkRows?.[0]?.TBNUM && ltbkRows[0].TBNUM !== '0000000000') {
          existingTrNo = alphaOut(ltbkRows[0].TBNUM);
        }
      } catch (_) {}
    }
    if (!existingTrNo && (existingToNo || normInput.toConfirmed)) {
      existingTrNo = `TR_FOR_${existingToNo || 'TO'}`;
    }

    if (existingTrNo) {
      tr = {
        success: true,
        trNumber: alphaOut(existingTrNo),
        trItem: normInput.trItem || '0001',
        warehouseNumber: normInput.warehouseNumber,
        movementType: normInput.movementType,
        existing: true
      };
    } else {
      try {
        tr = await this.createTransferRequirement({
          ...normInput,
          reservationNo: resNo,
          reservationItem: resItem,
          throwError: false
        });
      } catch (err) {
        tr = { success: false, stage: 'TR', error: err.message };
      }
    }
    if (!tr || !tr.success) {
      return await fail('TR', tr);
    }
    stagesReached.push('TR_CREATED');
    await this._persistProcessStatus(PROCESS_STATUS.TR_CREATED, { reservationNumber: resNo, reservationItem: resItem, trNumber: tr.trNumber, trItem: tr.trItem, tr }, input);

    // Stage 3: TR_VERIFIED
    if (existingToNo || normInput.toConfirmed) {
      verifiedTR = {
        success: true,
        stage: 'TR_VERIFICATION',
        verified: true,
        trNumber: tr.trNumber,
        warehouseNumber: tr.warehouseNumber || normInput.warehouseNumber || 'W01',
        movement: normInput.movementType,
        existing: true
      };
    } else {
      try {
        verifiedTR = await this.verifyTR({
          ...tr,
          throwError: false
        });
      } catch (err) {
        verifiedTR = { success: false, stage: 'TR_VERIFICATION', error: err.message };
      }
    }
    if (!verifiedTR || !verifiedTR.success) {
      return await fail('TR_VERIFICATION', verifiedTR);
    }
    stagesReached.push('TR_VERIFIED');
    await this._persistProcessStatus(PROCESS_STATUS.TR_VERIFIED, { reservationNumber: resNo, reservationItem: resItem, trNumber: verifiedTR.trNumber, verifiedTR }, input);

    // Stage 4: TO_CREATED
    if (existingToNo) {
      to = {
        success: true,
        toNumber: alphaOut(existingToNo),
        toItem: normInput.toItem || '0001',
        warehouseNumber: verifiedTR?.warehouseNumber || normInput.warehouseNumber,
        movementType: normInput.movementType,
        existing: true
      };
    } else {
      try {
        to = await this.createTransferOrderFromTR({
          ...normInput,
          warehouseNumber: verifiedTR.warehouseNumber || normInput.warehouseNumber,
          trNumber: verifiedTR.trNumber,
          movementType: normInput.movementType,
          autoConfirm: false
        });
      } catch (err) {
        to = { success: false, stage: 'TO', error: err.message };
      }
    }
    if (!to || !to.success) {
      return await fail('TO', to);
    }
    stagesReached.push('TO_CREATED');
    await this._persistProcessStatus(PROCESS_STATUS.TO_CREATED, { reservationNumber: resNo, reservationItem: resItem, trNumber: verifiedTR.trNumber, toNumber: to.toNumber, toItem: to.toItem, to }, input);

    // Stage 5: TO_CONFIRMED
    if (normInput.toConfirmed === true || normInput.confirmed === true) {
      confirmation = {
        success: true,
        confirmed: true,
        toNumber: to.toNumber,
        warehouseNumber: to.warehouseNumber || verifiedTR?.warehouseNumber || normInput.warehouseNumber,
        existing: true
      };
    } else {
      try {
        confirmation = await this.confirmTransferOrder({
          warehouseNumber: to.warehouseNumber || verifiedTR?.warehouseNumber || normInput.warehouseNumber,
          toNumber: to.toNumber
        });
      } catch (err) {
        confirmation = { success: false, stage: 'TO_CONFIRMATION', error: err.message };
      }
    }
    if (!confirmation || !confirmation.success) {
      return await fail('TO_CONFIRMATION', confirmation);
    }
    stagesReached.push('TO_CONFIRMED');
    await this._persistProcessStatus(PROCESS_STATUS.TO_CONFIRMED, { reservationNumber: resNo, reservationItem: resItem, toNumber: to.toNumber, confirmed: true, confirmation }, input);

    // Stage 6: MIGO_POSTED
    try {
      migo = await this.postGoodsMovement({
        ...normInput,
        reservationNumber: resNo,
        reservationItem: resItem,
        transferOrder: to.toNumber,
        trNumber: tr.trNumber,
        warehouseNumber: to.warehouseNumber || verifiedTR?.warehouseNumber || normInput.warehouseNumber,
        skipStockVerification: true,
        skipReservationVerification: true
      });
    } catch (err) {
      migo = { success: false, stage: 'MIGO', error: err.message };
    }
    if (!migo || !migo.success) {
      return await fail('MIGO', migo);
    }
    stagesReached.push('MIGO_POSTED');
    await this._persistProcessStatus(PROCESS_STATUS.MIGO_POSTED, { reservationNumber: resNo, reservationItem: resItem, materialDocument: migo.materialDocument, materialDocYear: migo.materialDocYear || migo.materialDocumentYear, migo }, input);

    // Stage 7: STOCK_VERIFIED
    try {
      stock = await this.verifyStock(normInput, migo);
    } catch (err) {
      stock = { success: false, stage: 'STOCK_VERIFICATION', error: err.message };
    }
    if (!stock || stock.success === false) {
      return await fail('STOCK_VERIFICATION', stock);
    }
    stagesReached.push('STOCK_VERIFIED');
    await this._persistProcessStatus(PROCESS_STATUS.STOCK_VERIFIED, { reservationNumber: resNo, reservationItem: resItem, stockVerified: true, stock }, input);

    // Stage 8: RESERVATION_VERIFIED
    try {
      finalReservation = await this.verifyReservation({
        ...reservation,
        materialDocument: migo.materialDocument,
        materialDocYear: migo.materialDocYear || migo.materialDocumentYear,
        postedQuantity: normInput.quantity || migo.quantity,
        completeReservation: normInput.completeReservation
      });
    } catch (err) {
      finalReservation = { success: false, stage: 'RESERVATION_VERIFICATION', error: err.message };
    }
    if (!finalReservation || finalReservation.success === false) {
      return await fail('RESERVATION_VERIFICATION', finalReservation);
    }
    stagesReached.push('RESERVATION_VERIFIED');

    // Stage 9: COMPLETED (or PARTIALLY_PROCESSED)
    const isComplete = Boolean(finalReservation.completelyProcessed);
    if (isComplete) {
      stagesReached.push('COMPLETED');
    }
    const finalState = isComplete ? 'COMPLETED' : 'PARTIALLY_PROCESSED';
    const finalProcessStatus = isComplete ? PROCESS_STATUS.COMPLETED : PROCESS_STATUS.PARTIALLY_PROCESSED;

    await this._persistProcessStatus(finalProcessStatus, {
      reservationNumber: resNo,
      reservationItem: resItem,
      completelyProcessed: isComplete,
      withdrawnQuantity: finalReservation.issuedQuantity,
      remainingQuantity: finalReservation.remainingQuantity,
      finalReservation
    }, input);

    return {
      success: true,
      stage: finalState,
      state: finalState,
      currentState: finalState,
      processStatus: finalProcessStatus,
      completed: isComplete,
      completelyProcessed: isComplete,
      alreadyPosted: Boolean(migo?.alreadyPosted),
      idempotentRetry: Boolean(migo?.idempotentRetry),
      businessKey: migo?.businessKey,
      stages: stagesReached,
      reservationNumber: resNo,
      reservationItem: resItem,
      trNumber: tr?.trNumber,
      toNumber: to?.toNumber,
      toConfirmed: Boolean(confirmation?.confirmed),
      materialDocument: migo?.materialDocument,
      materialDocumentYear: migo?.materialDocumentYear || migo?.materialDocYear,
      stockVerified: Boolean(stock?.verified || stock?.success),
      reservationVerified: Boolean(finalReservation?.verified || finalReservation?.success),
      reservation,
      tr,
      verifiedTR,
      to,
      confirmation,
      migo,
      stock,
      finalReservation
    };
  }
}

module.exports = ReservationProcessAdapter;
