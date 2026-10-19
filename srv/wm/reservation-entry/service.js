'use strict';

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssueAdapter = require('../../integration/s4hana/wm/GoodsIssueAdapter');
const { findUnconfirmedToItems, isTrClosedWithoutTo } = require('../../integration/s4hana/wm/toState');
const { STATUS, STEP_ERROR, UNCONFIRMED_TO, PROCESS_STATUS } = require('../../common/wmStatus');
const { sapKey } = require('../../integration/s4hana/sapKey');
const { withReservationLock, isLockConflict } = require('../../integration/s4hana/wm/resLock');
const attemptStore = require('./ReservationAttemptStore');
const { userFacingSapError } = require('../../common/sapErrorText');
const { classifyCreateFailure } = require('./ReservationAttemptStore');
const { validateReservationInput, getMovementConfig, SUPPORTED_MOVEMENT_TYPES } = require('../../common/movementConfig');
const LOG = cds.log('reservation-entry');
const alphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');

module.exports = class ReservationEntryService extends cds.ApplicationService {
  async init() {
    const { ReservationEntries, ReservationLogs, OrderTypeVH, InternalOrderVH, CostCenterVH } = this.entities;
    const adapter = new ReservationProcessAdapter();

    // Validation per movement type backed by normalized MOVEMENT_CONFIG
    function validateMovementType(data, req) {
      validateReservationInput(data, { req });
    }

    /**
     * Step 7.5: the warehouse is always derived from the SAP plant/storage-location assignment (T320).
     * A supplied value is validated against it and rejected on mismatch; it is never used unverified.
     */
    async function warehouseFor(plant, sloc, given) {
      const sGiven = given ? sapKey(given, 'lgnum') : '';
      const rows = await adapter.rfc.readTable('T320', ['LGNUM'], [`( WERKS = '${sapKey(plant, 'plant')}' AND LGORT = '${sapKey(sloc, 'lgort')}' )`], 1);
      const wh = rows?.[0]?.LGNUM?.trim();
      if (!wh) {
        const e = new Error(`No warehouse number assigned to plant ${plant} / storage location ${sloc} (T320)`);
        e.status = 400;
        throw e;
      }
      if (sGiven && sGiven !== wh) {
        const e = new Error(`Warehouse ${sGiven} does not match the warehouse assigned to plant ${plant} / storage location ${sloc} in SAP (T320: ${wh})`);
        e.status = 400;
        throw e;
      }
      return wh;
    }
    /** Issuing warehouse (+ same-warehouse check for the receiving SLoc when the policy forbids cross-warehouse). */
    async function resolveWarehouses(mvt, plant, sloc, recSloc, given) {
      const wh = await warehouseFor(plant, sloc, given);
      if (getMovementConfig(mvt)?.destinationRules?.crossWarehouseForbidden && recSloc) {
        const recWh = await warehouseFor(plant, recSloc, '');
        if (recWh !== wh) {
          const e = new Error(`Receiving storage location ${recSloc} belongs to warehouse ${recWh}, but issuing storage location ${sloc} belongs to warehouse ${wh} (cross-warehouse transfer not supported in ${mvt})`);
          e.status = 400;
          throw e;
        }
      }
      return wh;
    }
    const lockEntry = (key) => SELECT.one.from(ReservationEntries).where(key).forUpdate();
    const logRow = (row) => INSERT.into(ReservationLogs).entries({ ID: cds.utils.uuid(), ...row });

    // Common execution handler for creating reservation and auto-TR
    async function executeReservationAndAutoTR(payload, req) {
      validateMovementType(payload, req);
      if (req.errors?.length) return;

      const {
        MovementType,
        Plant,
        StorageLocation,
        Material,
        MaterialName,
        Quantity,
        Unit,
        ReservationDate,
        ReceivingPlant,
        ReceivingStorageLocation,
        CostCenter,
        AssetNo,
        SubNumber,
        WarehouseNumber,
        Batch,
        OrderID,
        OrderType
      } = payload;
      // Canonical contract (Step 7.2): PascalCase only; CAP rejects unknown parameters such as orderId/reservationDate.
      const effResDate = ReservationDate || undefined;
      const effOrderId = OrderID || '';
      const effOrderType = OrderType || '';

      // Step 7.5: warehouse resolved from T320 and validated against a supplied value BEFORE any SAP write.
      let determinedWh = '';
      try {
        determinedWh = await resolveWarehouses(MovementType, Plant, StorageLocation, ReceivingStorageLocation, WarehouseNumber);
      } catch (whErr) {
        req.error(whErr.status || 502, userFacingSapError(whErr, req, 'warehouse determination'));
        return;
      }

      // Step 7.6: stock picture before the BAPI. MB21 needs no stock; only an unusable reservation (batch that
      // does not exist) is blocked. Shortages are warnings (response messages + ReservationLog rows below).
      let stockWarnings = [];
      try {
        const stock = await adapter.checkStockForReservation({ plant: Plant, storageLocation: StorageLocation, material: Material, batch: Batch, quantity: Quantity, unit: Unit, warehouseNumber: determinedWh });
        stockWarnings = stock?.warnings || [];
      } catch (stockErr) {
        if (stockErr.status === 400) {
          req.error(400, stockErr.message);
          return;
        }
        LOG.warn(`Stock pre-check failed for material ${Material}: ${stockErr.message}`);
      }
      for (const w of stockWarnings) req?.warn?.(200, w);

      // Step 7.7: attempt record (own transaction) BEFORE the SAP write: RESERVATION_PENDING.
      const reqUser = (req.user && req.user.id) || '';
      const claim = await attemptStore.claim({
        clientAttemptId: payload.ClientAttemptId,
        requestHash: attemptStore.constructor.hash(payload, reqUser),
        user: reqUser,
        fields: { MovementType, Plant, StorageLocation, Material, Quantity, Unit }
      });
      if (!claim.created) {
        const prior = claim.row;
        if (claim.reason === 'replay') {
          const tracked = await SELECT.one.from(ReservationEntries).where({ ReservationNo: prior.ReservationNo, ReservationItem: prior.ReservationItem || '0001' });
          if (tracked) {
            req?.warn?.(200, `Identical request already created reservation ${alphaOut(prior.ReservationNo)}; no new reservation was created`);
            return tracked;
          }
        }
        const docHint = prior.ReservationNo ? ` SAP reservation ${alphaOut(prior.ReservationNo)} belongs to that attempt.` : '';
        req.error(409, claim.reason === 'in_progress'
          ? `An identical reservation request is still in progress (attempt ${prior.AttemptKey}); wait for it to finish.${docHint}`
          : `A previous identical request is at stage ${prior.Stage} (${prior.LastError ? userFacingSapError({ message: prior.LastError }, req, 'prior attempt') : 'no error text'}).${docHint} Resolve it (open the reservation in the app to import it) before creating a new one.`);
        return;
      }
      const attemptId = claim.row.ID;
      // Stage writes after the first local INSERT must wait until the request transaction has ended
      // (own-transaction write while this transaction holds the lock deadlocks on SQLite); 'done' fires
      // after commit or rollback, so the record survives a req.error.
      const stageLater = (stage, fields) => (typeof req.on === 'function'
        ? req.on('done', () => attemptStore.setStage(attemptId, stage, fields))
        : attemptStore.setStage(attemptId, stage, fields));

      let resResult;
      try {
        // Step 1: Create Reservation via BAPI_RESERVATION_CREATE1
        resResult = await adapter.createReservation({
          movementType: MovementType,
          plant: Plant,
          storageLocation: StorageLocation,
          material: Material,
          quantity: Quantity,
          unit: Unit,
          reservationDate: effResDate,
          receivingPlant: ReceivingPlant || (MovementType === '311' ? Plant : undefined),
          receivingStorageLocation: ReceivingStorageLocation,
          costCenter: CostCenter,
          assetNo: AssetNo,
          subNumber: SubNumber,
          orderId: effOrderId,
          orderType: effOrderType,
          batch: Batch
        });
      } catch (err) {
        const errorMsg = userFacingSapError(err, req, 'BAPI_RESERVATION_CREATE1');
        const stage = classifyCreateFailure(err);
        await attemptStore.setStage(attemptId, stage, { LastError: String(err.error || err.message || ''), ...(err.reservationNo ? { ReservationNo: String(err.reservationNo).padStart(10, '0'), ReservationItem: '0001' } : {}) });
        const hint = stage === 'RESERVATION_UNKNOWN'
          ? ' The outcome in SAP is unknown: check the reservation list before submitting again (the app blocks an identical re-submit until this attempt is resolved).'
          : (stage === 'RESERVATION_CREATED_MISMATCH' ? ` Reservation ${alphaOut(err.reservationNo)} exists in SAP; open it in the app to import it.` : '');
        req.error(err.status || 500, `Failed to create reservation: ${errorMsg}${hint}`);
        return {
          success: false,
          stage: 'RESERVATION',
          error: errorMsg
        };
      }

      if (!resResult || !resResult.success || (!resResult.reservation?.number && !resResult.reservationNo)) {
        const errorMsg = resResult?.error || 'Failed to create reservation: No reservation number returned from SAP';
        await attemptStore.setStage(attemptId, resResult?.success === false ? 'RESERVATION_REJECTED' : 'RESERVATION_UNKNOWN', { LastError: errorMsg });
        req.error(500, errorMsg);
        return {
          success: false,
          stage: 'RESERVATION',
          error: errorMsg
        };
      }

      const resNumber = resResult.reservation?.number || resResult.reservationNo;
      const resItem = resResult.reservation?.item || resResult.reservationItem || '0001';
      const resNo = resResult.reservationNoRaw || String(resNumber).padStart(10, '0');
      const extId = `${resNo}/${resItem}`;
      await attemptStore.setStage(attemptId, 'RESERVATION_CREATED', { ReservationNo: resNo, ReservationItem: resItem, LastError: resResult.sapVerified ? '' : 'RKPF/RESB read-back unavailable' });

      // Step 7.7: nothing below may silently lose the SAP document number. A local failure is recorded on
      // the attempt (own transaction) and reported with the RSNUM; the request transaction rolls back.
      let sLogHandle = '';
      try {
      // Initialize SLG1 Application Log header
      let slg1Log;
      try {
        slg1Log = await adapter.writeApplicationLog({
          object: 'ZWM_RES',
          subObject: 'TRACK',
          externalId: extId,
          reservationNo: resNo,
          reservationItem: resItem,
          step: 'MB21',
          status: STATUS.RES_CREATED,
          messageType: 'S',
          messageId: 'M7',
          messageNo: '060',
          messageText: `Reservation ${resNo} created via BAPI_RESERVATION_CREATE1`
        });
      } catch (_logErr) {
        slg1Log = { logHandle: '' }; // no synthetic handle: '' means "no SLG1 log exists" (audit D10)
      }
      sLogHandle = slg1Log?.logHandle || '';

      // Log Step 1 (MB21)
      await INSERT.into(ReservationLogs).entries({
        ID: cds.utils.uuid(),
        ReservationNo: resNo,
        ReservationItem: resItem,
        LogHandle: sLogHandle,
        ExternalId: extId,
        SubObject: 'TRACK',
        Step: 'MB21',
        Status: STATUS.RES_CREATED,
        MessageType: 'S',
        MessageId: 'M7',
        MessageNo: '060',
        MessageText: `Reservation ${resNo} created via BAPI_RESERVATION_CREATE1${resResult.sapVerified ? ' and verified in RKPF/RESB' : ' (RKPF/RESB read-back unavailable)'}`
      });

      for (const w of stockWarnings) {
        await logRow({ ReservationNo: resNo, ReservationItem: resItem, LogHandle: sLogHandle, ExternalId: extId, SubObject: 'TRACK', Step: 'MB21', Status: STATUS.RES_CREATED, MessageType: 'W', MessageId: 'ZRES', MessageNo: '001', MessageText: `Stock pre-check: ${w}`.substring(0, 255) });
      }

      // Step 1b: Persist tracking row immediately with RSNUM as soon as SAP returns it
      const sCreatedBy = payload.CreatedByUser || (resResult && (resResult.createdByUser || resResult.USNAM)) || (req.user && req.user.id) || '';
      const initialTrackRecord = {
        ReservationNo: resNo,
        ReservationItem: resItem,
        MovementType,
        WarehouseNumber: determinedWh,
        Plant,
        StorageLocation,
        Material,
        MaterialName: MaterialName || '',
        Quantity: Number(Quantity),
        Unit,
        ReservationDate: resResult.reservationDate || effResDate || null,
        CreatedByUser: sCreatedBy,
        ReceivingPlant: ReceivingPlant || '',
        ReceivingStorageLocation: ReceivingStorageLocation || '',
        CostCenter: CostCenter || '',
        AssetNo: AssetNo || '',
        SubNumber: SubNumber || '',
        OrderID: effOrderId,
        OrderType: effOrderType || resResult.orderType || '',
        TransferRequirement: '',
        LogHandle: sLogHandle,
        ExternalId: extId,
        Status_code: STATUS.RES_CREATED,
        ProcessStatus: PROCESS_STATUS.RESERVATION_CREATED,
        ErrorStep: '',
        ErrorMessage: ''
      };

      const existing = await SELECT.one.from(ReservationEntries).where({
        ReservationNo: resNo,
        ReservationItem: resItem
      });

      if (existing) {
        // Audit D5: a tracked row with progress (TR/TO/MIGO or a status beyond 01/11) is never reset.
        const hasProgress = existing.TransferRequirement || existing.TransferOrder || existing.MaterialDocument ||
          ![STATUS.RES_CREATED, STATUS.TR_ERROR].includes(existing.Status_code);
        if (hasProgress) {
          stageLater('RESERVATION_ALREADY_TRACKED', { ReservationNo: resNo, ReservationItem: resItem, LastError: `already tracked with status ${existing.Status_code}` });
          req.error(409, `Reservation ${alphaOut(resNo)}/${resItem} is already tracked with status ${existing.Status_code}; its tracking record was not changed`);
          return;
        }
        await UPDATE(ReservationEntries).set(initialTrackRecord).where({
          ReservationNo: resNo,
          ReservationItem: resItem
        });
      } else {
        await INSERT.into(ReservationEntries).entries(initialTrackRecord);
      }
      } catch (persistErr) {
        if (req.errors?.length) return; // the 409 above
        stageLater('LOCAL_PERSIST_FAILED', { ReservationNo: resNo, ReservationItem: resItem, LastError: persistErr.message });
        req.error(500, `Reservation ${alphaOut(resNo)}/${resItem} was created in SAP but could not be recorded locally (${persistErr.message}). Open reservation ${alphaOut(resNo)} in the app to import it; do not create it again.`);
        return;
      }

      // Step 2: Auto-create Transfer Requirement (background/immediate step)
      let trNumber = '';
      let trError = null;

      try {
        const trResult = await adapter.createTransferRequirement({
          warehouseNumber: determinedWh,
          wmMovementType: MovementType,
          movementType: MovementType,
          isTransferPosting: MovementType === '301',
          material: Material,
          plant: Plant,
          storageLocation: StorageLocation,
          quantity: Quantity,
          unit: Unit,
          reservationNo: resNo,
          reservationItem: resItem,
          costCenter: CostCenter,
          assetNo: AssetNo,
          subNumber: SubNumber,
          orderId: effOrderId,
          batch: Batch
        });

        if (!trResult || trResult.success === false || (!trResult.trNumber && !trResult.trNumberRaw) || trResult.trNumber === '0000000000') {
          throw new Error('TR creation verification failed: missing or invalid TR number from SAP');
        }
        const verifiedTrItem = trResult.trItem || '0001';
        if (!verifiedTrItem) {
          throw new Error('TR creation verification failed: missing TR item from SAP');
        }
        if (trResult.material && alphaOut(trResult.material) !== alphaOut(Material)) {
          throw new Error(`TR creation verification failed: material mismatch (expected ${alphaOut(Material)}, got ${alphaOut(trResult.material)})`);
        }
        if (trResult.quantity !== undefined && Number(trResult.quantity) !== Number(Quantity)) {
          throw new Error(`TR creation verification failed: quantity mismatch (expected ${Number(Quantity)}, got ${Number(trResult.quantity)})`);
        }
        if (trResult.plant && String(trResult.plant).trim() !== String(Plant).trim()) {
          throw new Error(`TR creation verification failed: plant mismatch (expected ${Plant}, got ${trResult.plant})`);
        }
        if (trResult.storageLocation && String(trResult.storageLocation).trim() !== String(StorageLocation).trim()) {
          throw new Error(`TR creation verification failed: storage location mismatch (expected ${StorageLocation}, got ${trResult.storageLocation})`);
        }
        if (trResult.warehouseNumber && determinedWh && String(trResult.warehouseNumber).trim() !== String(determinedWh).trim()) {
          throw new Error(`TR creation verification failed: warehouse mismatch (expected ${determinedWh}, got ${trResult.warehouseNumber})`);
        }

        trNumber = trResult.trNumberRaw || String(trResult.trNumber).padStart(10, '0');

        if (trResult.warning) {
          req?.warn?.(200, trResult.warning);
          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: resNo,
            ReservationItem: resItem,
            LogHandle: sLogHandle,
            ExternalId: extId,
            SubObject: 'TRACK',
            Step: 'LB01',
            Status: STATUS.TR_CREATED,
            MessageType: 'W',
            MessageId: 'L3',
            MessageNo: '001',
            MessageText: trResult.warning
          });
        }

        // Persist TBNUM immediately as soon as SAP returns it
        await UPDATE(ReservationEntries).set({
          WarehouseNumber: determinedWh,
          TransferRequirement: trNumber,
          Status_code: STATUS.TR_CREATED,
          ProcessStatus: PROCESS_STATUS.TR_CREATED,
          ErrorStep: '',
          ErrorMessage: ''
        }).where({
          ReservationNo: resNo,
          ReservationItem: resItem
        });

        // Log Step 2 (LB01)
        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: resNo,
          ReservationItem: resItem,
          LogHandle: sLogHandle,
          ExternalId: extId,
          SubObject: 'TRACK',
          Step: 'LB01',
          Status: STATUS.TR_CREATED,
          ProcessStatus: PROCESS_STATUS.TR_CREATED,
          MessageType: 'S',
          MessageId: 'L3',
          MessageNo: '001',
          MessageText: `Transfer Requirement ${trNumber} auto-created via L_TR_CREATE`
        });
        stageLater('TR_CREATED', { TransferRequirement: trNumber });
      } catch (err) {
        // Reservation exists but the backend created no TR: status 11 (TR error), a backend issue to fix in SAP.
        trError = `TR creation failed in SAP backend: ${userFacingSapError(err, req, 'L_TR_CREATE')}`;
        stageLater('TR_FAILED', { LastError: trError });

        await UPDATE(ReservationEntries).set({
          WarehouseNumber: determinedWh,
          Status_code: STATUS.TR_ERROR,
          ProcessStatus: PROCESS_STATUS.FAILED_TR,
          ErrorStep: 'LB01',
          ErrorMessage: trError
        }).where({
          ReservationNo: resNo,
          ReservationItem: resItem
        });

        await logRow({
          ReservationNo: resNo,
          ReservationItem: resItem,
          LogHandle: sLogHandle,
          ExternalId: extId,
          SubObject: 'TRACK',
          Step: 'LB01',
          Status: STATUS.TR_ERROR,
          MessageType: 'E',
          MessageId: 'L3',
          MessageNo: '999',
          MessageText: trError
        });
      }

      return await SELECT.one.from(ReservationEntries).where({
        ReservationNo: resNo,
        ReservationItem: resItem
      });
    }

    // Live detail for a reservation with no local ZRES_TRACK row (created outside this app): read RKPF/RESB.
    const fetchSapReservation = async (resNo, resItem) => {
      if (!adapter.rfc) return null;
      const strip = (v) => String(v || '').replace(/^0+(?=\d)/, '');
      const s4Rsnum = String(resNo).padStart(10, '0');
      const s4Rspos = String(resItem || '0001').padStart(4, '0');
      try {
        const [rkpf, resb] = await Promise.all([
          adapter.rfc.readTable('RKPF', ['BWART', 'KOSTL', 'ANLN1', 'ANLN2', 'UMWRK', 'UMLGO', 'USNAM', 'AUFNR'], [`RSNUM = '${s4Rsnum}'`], 1),
          adapter.rfc.readTable('RESB', ['MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'MEINS', 'CHARG', 'KZEAR', 'AUFNR'], [`RSNUM = '${s4Rsnum}'`, `AND RSPOS = '${s4Rspos}'`], 1)
        ]);
        const h = rkpf && rkpf[0];
        const i = resb && resb[0];
        if (!i) return null;
        const mvt = String((h && h.BWART) || '').trim();
        if (!SUPPORTED_MOVEMENT_TYPES.includes(mvt)) return null;
        const reqQty = Number(i.BDMNG) || 0;
        const wdnQty = Number(i.ENMNG) || 0;
        const remQty = Math.max(0, reqQty - wdnQty);
        const closed = String(i.KZEAR || '').trim() === 'X' || (remQty === 0 && reqQty > 0);
        const completelyProcessed = closed;
        const sMat = strip(i.MATNR);
        const sMatPad = String(i.MATNR).padStart(18, '0');

        let matName = '';
        try {
          const makt = await adapter.rfc.readTable('MAKT', ['MAKTX'], [`MATNR = '${sMatPad}'`, `AND SPRAS = 'E'`], 1);
          matName = (makt && makt[0]?.MAKTX) || '';
        } catch (_mErr) {}

        let existingTr = '';
        let allTr = '';
        let trWarehouse = ''; // TR numbers are unique per warehouse only: every LTAK/LTAP lookup needs LGNUM too
        try {
          const ltbk = await adapter.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'STATU'], [`RSNUM = '${s4Rsnum}'`], 1);
          if (ltbk && ltbk.length > 0) {
            const liveTr = ltbk.find((r) => r.TBNUM && r.STATU !== 'E') || ltbk[0];
            allTr = ltbk[0].TBNUM || '';
            existingTr = liveTr.TBNUM || allTr;
            trWarehouse = String(liveTr.LGNUM || ltbk[0].LGNUM || '').trim();
          }
        } catch (_trErr) {}

        let existingTo = '';
        if (!allTr) {
          try {
            const track = (await SELECT.one.from(ReservationEntries).columns(['TransferRequirement', 'TransferOrder', 'WarehouseNumber']).where({
              ReservationNo: s4Rsnum,
              ReservationItem: s4Rspos
            })) || (await SELECT.one.from(ReservationEntries).columns(['TransferRequirement', 'TransferOrder', 'WarehouseNumber']).where({
              ReservationNo: strip(resNo),
              ReservationItem: s4Rspos
            }));
            if (track) {
              if (track.TransferRequirement) {
                allTr = track.TransferRequirement;
                existingTr = track.TransferRequirement;
                trWarehouse = String(track.WarehouseNumber || '').trim();
              }
              if (track.TransferOrder) {
                existingTo = track.TransferOrder;
              }
            }
          } catch (_dbErr) {}
        }

        // Live 201 proof 2026-10-19: TR 0001000882 exists in W01 (ours) and in W12/W13 (other warehouses); a lookup by
        // TBNUM alone returned W13's TO 0001011029 for our reservation. Only look up the TO inside the TR's warehouse.
        if (allTr && !existingTo && trWarehouse) {
          try {
            const s4TrPad = String(allTr).padStart(10, '0');
            const ltak = await adapter.rfc.readTable('LTAK', ['LGNUM', 'TANUM'], [`LGNUM = '${sapKey(trWarehouse, 'lgnum')}'`, `AND TBNUM = '${s4TrPad}'`], 1);
            existingTo = (ltak && ltak[0]?.TANUM) || '';
          } catch (_toErr) {}
        }

        let existingMatDoc = '';
        let existingMatDocYear = '';
        if (closed) {
          try {
            const matdoc = await adapter.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR'], [`RSNUM = '${s4Rsnum}'`], 1);
            if (matdoc && matdoc.length > 0) {
              existingMatDoc = matdoc[0].MBLNR || '';
              existingMatDocYear = matdoc[0].MJAHR || '';
            }
          } catch (_mdErr) {}
        }

        const statusCode = closed ? STATUS.GI_POSTED : (existingTr ? STATUS.TR_CREATED : STATUS.RES_CREATED);
        const statusText = closed ? 'Goods Issue Posted' : (existingTr ? 'TR Created' : 'Reservation Created');

        return {
          ReservationNo: strip(resNo),
          ReservationItem: s4Rspos,
          MovementType: String((h && h.BWART) || '').trim(),
          Material: sMat,
          MaterialName: matName,
          Plant: String(i.WERKS || '').trim(),
          StorageLocation: String(i.LGORT || '').trim(),
          ReceivingPlant: String((h && h.UMWRK) || '').trim(),
          ReceivingStorageLocation: String((h && h.UMLGO) || '').trim(),
          Quantity: reqQty,
          Unit: String(i.MEINS || '').trim(),
          WithdrawnQuantity: wdnQty,
          RemainingQuantity: remQty,
          CompletelyProcessed: completelyProcessed,
          Batch: String(i.CHARG || '').trim(),
          CostCenter: String((h && h.KOSTL) || '').trim(),
          AssetNo: strip((h && h.ANLN1) || ''),
          SubNumber: String((h && h.ANLN2) || '').trim(),
          OrderID: strip((i && i.AUFNR) || (h && h.AUFNR) || ''),
          WarehouseNumber: await warehouseFor(i.WERKS, i.LGORT, '').catch(() => ''),
          Status_code: statusCode,
          StatusText: statusText,
          TransferRequirement: allTr ? String(allTr).replace(/^0+/, '') : '',
          TransferOrder: existingTo ? String(existingTo).replace(/^0+/, '') : '',
          MaterialDocument: existingMatDoc ? String(existingMatDoc).replace(/^0+/, '') : '',
          MaterialDocYear: existingMatDocYear || '',
          ErrorMessage: '',
          ExternalId: `${strip(resNo)}/${s4Rspos}`,
          LogHandle: '',
          CreatedByUser: (h && h.USNAM) || '',
          createdBy: (h && h.USNAM) || ''
        };
      } catch (_e) {
        return null;
      }
    };

    // Standalone MB21 reservation creation action (independent from TR creation)
    this.on('createReservation', async (req) => {
      validateMovementType(req.data, req);
      if (req.errors && req.errors.length) {
        return {
          success: false,
          stage: 'RESERVATION',
          error: req.errors[0]?.message || 'Validation failed'
        };
      }

      const payload = req.data;
      const effResDate = payload.ReservationDate || undefined;

      // Step 7.5: fail before the SAP write when the warehouse cannot be resolved or a supplied one mismatches.
      let determinedWh = '';
      try {
        determinedWh = await resolveWarehouses(payload.MovementType, payload.Plant, payload.StorageLocation, payload.ReceivingStorageLocation, payload.WarehouseNumber);
      } catch (whErr) {
        return { success: false, stage: 'WAREHOUSE', error: userFacingSapError(whErr, req, 'warehouse determination') };
      }
      try {
        const stock = await adapter.checkStockForReservation({ plant: payload.Plant, storageLocation: payload.StorageLocation, material: payload.Material, batch: payload.Batch, quantity: payload.Quantity, unit: payload.Unit, warehouseNumber: determinedWh });
        for (const w of stock?.warnings || []) req?.warn?.(200, w);
      } catch (stockErr) {
        if (stockErr.status === 400) return { success: false, stage: 'STOCK', error: stockErr.message };
        LOG.warn(`Stock pre-check failed for material ${payload.Material}: ${stockErr.message}`);
      }

      const reqUser = (req.user && req.user.id) || '';
      const claim = await attemptStore.claim({ clientAttemptId: payload.ClientAttemptId, requestHash: attemptStore.constructor.hash(payload, reqUser), user: reqUser, fields: payload });
      if (!claim.created) {
        const prior = claim.row;
        if (claim.reason === 'replay') {
          return { success: true, stage: 'REPLAY', reservation: { number: alphaOut(prior.ReservationNo), item: prior.ReservationItem || '0001' }, movementType: String(payload.MovementType).trim() };
        }
        return { success: false, stage: claim.reason === 'in_progress' ? 'IN_PROGRESS' : 'UNRESOLVED', error: `Attempt ${prior.AttemptKey} is in stage ${prior.Stage}${prior.ReservationNo ? ` (reservation ${alphaOut(prior.ReservationNo)})` : ''}: ${prior.LastError || 'no error text'}` };
      }
      const attemptId = claim.row.ID;

      let resResult;
      try {
        resResult = await adapter.createReservation({
          movementType: payload.MovementType,
          plant: payload.Plant,
          storageLocation: payload.StorageLocation,
          material: payload.Material,
          quantity: payload.Quantity,
          unit: payload.Unit,
          reservationDate: effResDate,
          receivingPlant: payload.ReceivingPlant || (payload.MovementType === '311' ? payload.Plant : undefined),
          receivingStorageLocation: payload.ReceivingStorageLocation,
          costCenter: payload.CostCenter,
          assetNo: payload.AssetNo,
          subNumber: payload.SubNumber,
          orderId: payload.OrderID,
          orderType: payload.OrderType,
          batch: payload.Batch,
          throwError: false
        });
      } catch (err) {
        const errorMsg = userFacingSapError(err, req, 'BAPI_RESERVATION_CREATE1');
        await attemptStore.setStage(attemptId, classifyCreateFailure(err), { LastError: String(err.error || err.message || ''), ...(err.reservationNo ? { ReservationNo: String(err.reservationNo).padStart(10, '0'), ReservationItem: '0001' } : {}) });
        return {
          success: false,
          stage: 'RESERVATION',
          error: errorMsg
        };
      }

      if (!resResult || !resResult.success || (!resResult.reservation?.number && !resResult.reservationNo)) {
        const errorMsg = resResult?.error || 'Failed to create reservation: No reservation number returned from SAP';
        // throwError:false turns every adapter failure into {success:false,status}; classify by that status.
        await attemptStore.setStage(attemptId, classifyCreateFailure({ status: resResult?.status }), { LastError: errorMsg });
        return {
          success: false,
          stage: 'RESERVATION',
          error: errorMsg
        };
      }

      const resNumber = resResult.reservation?.number || resResult.reservationNo;
      const resItem = resResult.reservation?.item || resResult.reservationItem || '0001';
      const resNo = resResult.reservationNoRaw || String(resNumber).padStart(10, '0');
      const extId = `${resNo}/${resItem}`;
      await attemptStore.setStage(attemptId, 'RESERVATION_CREATED', { ReservationNo: resNo, ReservationItem: resItem });

      // Persist reservation in tracking table with status RES_CREATED
      const sCreatedBy = payload.CreatedByUser || (resResult && (resResult.createdByUser || resResult.USNAM)) || (req.user && req.user.id) || '';
      const initialTrackRecord = {
        ReservationNo: resNo,
        ReservationItem: resItem,
        MovementType: payload.MovementType,
        WarehouseNumber: determinedWh,
        Plant: payload.Plant,
        StorageLocation: payload.StorageLocation,
        Material: payload.Material,
        MaterialName: payload.MaterialName || '',
        Quantity: Number(payload.Quantity),
        Unit: payload.Unit,
        ReservationDate: resResult.reservationDate || effResDate || null,
        CreatedByUser: sCreatedBy,
        ReceivingPlant: payload.ReceivingPlant || '',
        ReceivingStorageLocation: payload.ReceivingStorageLocation || '',
        CostCenter: payload.CostCenter || '',
        AssetNo: payload.AssetNo || '',
        SubNumber: payload.SubNumber || '',
        OrderID: payload.OrderID || '',
        OrderType: payload.OrderType || '',
        TransferRequirement: '',
        LogHandle: '',
        ExternalId: extId,
        Status_code: STATUS.RES_CREATED,
        ProcessStatus: PROCESS_STATUS.RESERVATION_CREATED,
        ErrorStep: '',
        ErrorMessage: ''
      };

      const existing = await SELECT.one.from(ReservationEntries).where({
        ReservationNo: resNo,
        ReservationItem: resItem
      });

      if (existing) {
        await UPDATE(ReservationEntries).set(initialTrackRecord).where({
          ReservationNo: resNo,
          ReservationItem: resItem
        });
      } else {
        await INSERT.into(ReservationEntries).entries(initialTrackRecord);
      }

      await INSERT.into(ReservationLogs).entries({
        ID: cds.utils.uuid(),
        ReservationNo: resNo,
        ReservationItem: resItem,
        LogHandle: '',
        ExternalId: extId,
        SubObject: 'TRACK',
        Step: 'MB21',
        Status: STATUS.RES_CREATED,
        MessageType: 'S',
        MessageId: 'M7',
        MessageNo: '060',
        MessageText: `Reservation ${resNo} created via BAPI_RESERVATION_CREATE1${resResult.sapVerified ? ' and verified in RKPF/RESB' : ' (RKPF/RESB read-back unavailable)'}`
      });

      return {
        success: true,
        reservation: {
          number: resNumber,
          item: resItem
        },
        movementType: String(payload.MovementType).trim()
      };
    });

    this.on('createTransferRequirement', async (req) => {
      const { ReservationNo, ReservationItem, WarehouseNumber } = req.data;
      if (!ReservationNo) return req.error(400, 'ReservationNo is mandatory');
      const sResNo = String(ReservationNo).padStart(10, '0');
      const sResItem = String(ReservationItem || '0001').padStart(4, '0');

      const track = await SELECT.one.from(ReservationEntries).where({
        ReservationNo: sResNo,
        ReservationItem: sResItem
      });

      if (!track) {
        return req.error(404, `Reservation ${alphaOut(sResNo)}/${sResItem} not found in tracking records`);
      }

      let determinedWh = '';
      try {
        determinedWh = await warehouseFor(track.Plant, track.StorageLocation, WarehouseNumber || track.WarehouseNumber);
      } catch (whErr) {
        return req.error(whErr.status || 502, userFacingSapError(whErr, req, 'warehouse determination'));
      }

      let trResult;
      try {
        trResult = await adapter.createTransferRequirement({
          warehouseNumber: determinedWh,
          wmMovementType: track.MovementType,
          movementType: track.MovementType,
          isTransferPosting: track.MovementType === '301',
          material: track.Material,
          plant: track.Plant,
          storageLocation: track.StorageLocation,
          quantity: track.Quantity,
          unit: track.Unit,
          reservationNo: sResNo,
          reservationItem: sResItem,
          costCenter: track.CostCenter,
          assetNo: track.AssetNo,
          subNumber: track.SubNumber,
          batch: track.Batch,
          throwError: false
        });
      } catch (err) {
        trResult = { success: false, stage: 'TR', error: err.message };
      }

      if (!trResult || !trResult.success) {
        await UPDATE(ReservationEntries).set({
          Status_code: STATUS.TR_ERROR,
          ProcessStatus: PROCESS_STATUS.FAILED_TR,
          ErrorStep: 'LB01',
          ErrorMessage: trResult?.error || 'TR creation failed'
        }).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });

        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          LogHandle: track.LogHandle || '',
          ExternalId: track.ExternalId || '',
          SubObject: 'TRACK',
          Step: 'LB01',
          Status: STATUS.TR_ERROR,
          ProcessStatus: PROCESS_STATUS.FAILED_TR,
          MessageType: 'E',
          MessageId: 'L3',
          MessageNo: '999',
          MessageText: trResult?.error || 'TR creation failed'
        });

        return {
          success: false,
          stage: 'TR',
          error: trResult?.error || 'TR creation failed',
          reservationNumber: alphaOut(sResNo),
          trNumber: '',
          trItem: ''
        };
      }

      const trNo = trResult.trNumberRaw || String(trResult.trNumber).padStart(10, '0');
      const trItem = trResult.trItem || '0001';

      await UPDATE(ReservationEntries).set({
        WarehouseNumber: determinedWh || track.WarehouseNumber || '',
        TransferRequirement: trNo,
        Status_code: STATUS.TR_CREATED,
        ProcessStatus: PROCESS_STATUS.TR_CREATED,
        ErrorStep: '',
        ErrorMessage: ''
      }).where({
        ReservationNo: sResNo,
        ReservationItem: sResItem
      });

      await INSERT.into(ReservationLogs).entries({
        ID: cds.utils.uuid(),
        ReservationNo: sResNo,
        ReservationItem: sResItem,
        LogHandle: track.LogHandle || '',
        ExternalId: track.ExternalId || '',
        SubObject: 'TRACK',
        Step: 'LB01',
        Status: STATUS.TR_CREATED,
        MessageType: 'S',
        MessageId: 'L3',
        MessageNo: '001',
        MessageText: `Transfer Requirement ${trNo}/${trItem} created and verified via L_TR_CREATE`
      });

      return {
        success: true,
        reservationNumber: alphaOut(sResNo),
        trNumber: trResult.trNumber,
        trItem: trItem,
        material: trResult.material,
        quantity: trResult.quantity,
        plant: trResult.plant,
        storageLocation: trResult.storageLocation,
        warehouse: trResult.warehouse,
        movement: trResult.movement
      };
    });

    // Action handler for Step 5: Separate TR creation from TO creation
    this.on('createTOFromTR', async (req) => {
      const { ReservationNo, ReservationItem, WarehouseNumber, TRNumber } = req.data || {};
      if (!ReservationNo && !TRNumber) {
        return req.error(400, 'ReservationNo or TRNumber is mandatory');
      }

      const sResNo = ReservationNo ? String(ReservationNo).padStart(10, '0') : '';
      const sResItem = String(ReservationItem || '0001').padStart(4, '0');

      let track = null;
      if (sResNo) {
        track = await SELECT.one.from(ReservationEntries).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });
      }

      const rawTrNumber = TRNumber || track?.TransferRequirement || '';
      if (!rawTrNumber || rawTrNumber === '0' || rawTrNumber === '0000000000') {
        if (track) {
          await UPDATE(ReservationEntries).set({
            Status_code: STATUS.TR_ERROR,
            ProcessStatus: PROCESS_STATUS.FAILED_TR,
            ErrorStep: 'LT04',
            ErrorMessage: 'TR was not created or TR number is missing'
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });
        }
        return {
          success: false,
          stage: 'TR',
          error: 'TR was not created or TR number is missing',
          reservationNumber: sResNo ? alphaOut(sResNo) : '',
          trNumber: '',
          toNumber: '',
          warehouse: '',
          itemsCreated: 0
        };
      }

      let determinedWh = WarehouseNumber || track?.WarehouseNumber || '';
      if (!determinedWh && track?.Plant && track?.StorageLocation) {
        try {
          determinedWh = await warehouseFor(track.Plant, track.StorageLocation, '');
        } catch (_whErr) {
          determinedWh = '';
        }
      }

      // TR validation: Check that TR exists and is verified in SAP
      const verifiedTR = await adapter.getTransferRequirement(rawTrNumber, determinedWh);
      if (!verifiedTR) {
        if (track) {
          await UPDATE(ReservationEntries).set({
            Status_code: STATUS.TR_ERROR,
            ProcessStatus: PROCESS_STATUS.FAILED_TR,
            ErrorStep: 'LT04',
            ErrorMessage: `Created TR ${alphaOut(rawTrNumber)} cannot be verified in SAP`
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: track.LogHandle || '',
            ExternalId: track.ExternalId || '',
            SubObject: 'TRACK',
            Step: 'LT04',
            Status: STATUS.TR_ERROR,
            MessageType: 'E',
            MessageId: 'L3',
            MessageNo: '999',
            MessageText: `TR validation failed: TR ${alphaOut(rawTrNumber)} not found or unverified in SAP`
          });
        }

        return {
          success: false,
          stage: 'TR_VALIDATION',
          error: `Created TR ${alphaOut(rawTrNumber)} cannot be verified in SAP`,
          reservationNumber: sResNo ? alphaOut(sResNo) : '',
          trNumber: alphaOut(rawTrNumber),
          toNumber: '',
          warehouse: determinedWh,
          itemsCreated: 0
        };
      }

      const targetWh = determinedWh || verifiedTR.warehouse;
      const targetTr = verifiedTR.trNumberRaw || rawTrNumber;

      // Check unconfirmed TO items for this TR
      try {
        const pending = await findUnconfirmedToItems(adapter.rfc, targetWh, targetTr);
        if (pending && pending.length) {
          const pendingTo = pending[0].TANUM.replace(/^0+/, '');
          return {
            success: false,
            stage: 'TO',
            error: `Unconfirmed Transfer Order ${pendingTo} exists for TR ${alphaOut(targetTr)}; confirm it before creating another TO`,
            reservationNumber: sResNo ? alphaOut(sResNo) : '',
            trNumber: alphaOut(targetTr),
            toNumber: pendingTo,
            warehouse: targetWh,
            itemsCreated: 0
          };
        }
      } catch (_pErr) {
        // tolerate read error
      }

      let toResult;
      const bAutoConfirm = Boolean(req.data?.autoConfirm);
      try {
        toResult = await adapter.createTransferOrderFromTR({
          warehouseNumber: targetWh,
          trNumber: targetTr,
          movementType: track?.MovementType || verifiedTR.movement || '311',
          autoConfirm: bAutoConfirm
        });
      } catch (err) {
        if (track) {
          await UPDATE(ReservationEntries).set({
            Status_code: STATUS.TO_ERROR,
            ProcessStatus: PROCESS_STATUS.FAILED_TO,
            ErrorStep: 'LT04',
            ErrorMessage: err.message
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: track.LogHandle || '',
            ExternalId: track.ExternalId || '',
            SubObject: 'TRACK',
            Step: 'LT04',
            Status: STATUS.TO_ERROR,
            ProcessStatus: PROCESS_STATUS.FAILED_TO,
            MessageType: 'E',
            MessageId: 'L3',
            MessageNo: '999',
            MessageText: `TO creation failed: ${err.message}`
          });
        }

        return {
          success: false,
          stage: 'TO',
          error: err.message,
          reservationNumber: sResNo ? alphaOut(sResNo) : '',
          trNumber: alphaOut(targetTr),
          toNumber: '',
          toItem: '',
          confirmed: false,
          warehouse: targetWh,
          itemsCreated: 0
        };
      }

      const toNo = toResult.toNumberRaw || String(toResult.toNumber).padStart(10, '0');
      const toItem = toResult.toItem || '0001';

      if (toResult.success === false && toResult.stage === 'TO_CONFIRMATION') {
        if (track) {
          await UPDATE(ReservationEntries).set({
            WarehouseNumber: targetWh,
            TransferRequirement: targetTr,
            TransferOrder: toNo,
            Status_code: STATUS.TO_CONFIRM_ERROR,
            ProcessStatus: PROCESS_STATUS.FAILED_CONFIRMATION,
            ErrorStep: 'LT12',
            ErrorMessage: toResult.error
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: track.LogHandle || '',
            ExternalId: track.ExternalId || '',
            SubObject: 'TRACK',
            Step: 'LT12',
            Status: STATUS.TO_CONFIRM_ERROR,
            ProcessStatus: PROCESS_STATUS.FAILED_CONFIRMATION,
            MessageType: 'E',
            MessageId: 'L3',
            MessageNo: '026',
            MessageText: `Transfer Order ${alphaOut(toNo)} confirmation failed: ${toResult.error}`
          });
        }

        return {
          success: false,
          stage: 'TO_CONFIRMATION',
          toNumber: alphaOut(toNo),
          error: toResult.error,
          reservationNumber: sResNo ? alphaOut(sResNo) : '',
          trNumber: alphaOut(targetTr),
          toItem: toItem,
          confirmed: false,
          warehouse: targetWh,
          itemsCreated: 0
        };
      }

      if (track) {
        const finalStatus = toResult.confirmed ? STATUS.TO_CONFIRMED : STATUS.TO_CREATED;
        const finalProcessStatus = toResult.confirmed ? PROCESS_STATUS.TO_CONFIRMED : PROCESS_STATUS.TO_CREATED;
        await UPDATE(ReservationEntries).set({
          WarehouseNumber: targetWh,
          TransferRequirement: targetTr,
          TransferOrder: toNo,
          Status_code: finalStatus,
          ProcessStatus: finalProcessStatus,
          ErrorStep: '',
          ErrorMessage: ''
        }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          LogHandle: track.LogHandle || '',
          ExternalId: track.ExternalId || '',
          SubObject: 'TRACK',
          Step: 'LT04',
          Status: STATUS.TO_CREATED,
          MessageType: 'S',
          MessageId: 'L3',
          MessageNo: '001',
          MessageText: `Transfer Order ${alphaOut(toNo)} item ${toItem} created from verified TR ${alphaOut(targetTr)}`
        });

        if (toResult.confirmed) {
          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: track.LogHandle || '',
            ExternalId: track.ExternalId || '',
            SubObject: 'TRACK',
            Step: 'LT12',
            Status: STATUS.TO_CONFIRMED,
            MessageType: 'S',
            MessageId: 'L3',
            MessageNo: '025',
            MessageText: `Transfer Order ${alphaOut(toNo)} confirmed via L_TO_CONFIRM`
          });
        }
      }

      return {
        success: true,
        trNumber: alphaOut(targetTr),
        toNumber: alphaOut(toNo),
        toItem: toItem,
        confirmed: Boolean(toResult.confirmed),
        reservationNumber: sResNo ? alphaOut(sResNo) : '',
        warehouse: targetWh,
        itemsCreated: 1
      };
    });

    // Action handler for Step 8: Standalone TO Confirmation
    this.on('confirmTransferOrder', async (req) => {
      const { ReservationNo, ReservationItem, WarehouseNumber, TransferOrder } = req.data || {};
      if (!TransferOrder) return req.error(400, 'TransferOrder is mandatory');
      const sResNo = ReservationNo ? String(ReservationNo).padStart(10, '0') : '';
      const sResItem = String(ReservationItem || '0001').padStart(4, '0');

      let track = null;
      if (sResNo) {
        track = await SELECT.one.from(ReservationEntries).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });
      }
      const wh = WarehouseNumber || track?.WarehouseNumber || '';
      try {
        await adapter.confirmTransferOrder({
          warehouseNumber: wh,
          toNumber: TransferOrder
        });

        if (track) {
          await UPDATE(ReservationEntries).set({
            Status_code: STATUS.TO_CONFIRMED,
            ProcessStatus: PROCESS_STATUS.TO_CONFIRMED,
            ErrorStep: '',
            ErrorMessage: ''
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: track.LogHandle || '',
            ExternalId: track.ExternalId || '',
            SubObject: 'TRACK',
            Step: 'LT12',
            Status: STATUS.TO_CONFIRMED,
            ProcessStatus: PROCESS_STATUS.TO_CONFIRMED,
            MessageType: 'S',
            MessageId: 'L3',
            MessageNo: '025',
            MessageText: `Transfer Order ${alphaOut(TransferOrder)} confirmed via L_TO_CONFIRM`
          });
        }

        return {
          success: true,
          stage: 'TO_CONFIRMATION',
          error: '',
          warehouseNumber: wh,
          toNumber: alphaOut(TransferOrder),
          confirmed: true,
          status: STATUS.TO_CONFIRMED
        };
      } catch (err) {
        if (track) {
          await UPDATE(ReservationEntries).set({
            Status_code: STATUS.TO_CONFIRM_ERROR,
            ProcessStatus: PROCESS_STATUS.FAILED_CONFIRMATION,
            ErrorStep: 'LT12',
            ErrorMessage: err.message
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: track.LogHandle || '',
            ExternalId: track.ExternalId || '',
            SubObject: 'TRACK',
            Step: 'LT12',
            Status: STATUS.TO_CONFIRM_ERROR,
            MessageType: 'E',
            MessageId: 'L3',
            MessageNo: '026',
            MessageText: `Transfer Order ${alphaOut(TransferOrder)} confirmation failed: ${err.message}`
          });
        }

        return {
          success: false,
          stage: 'TO_CONFIRMATION',
          error: err.message,
          warehouseNumber: wh,
          toNumber: alphaOut(TransferOrder),
          confirmed: false,
          status: STATUS.TO_CONFIRM_ERROR
        };
      }
    });

    // Action handler
    this.on('createReservationEntry', async (req) => {
      return await executeReservationAndAutoTR(req.data, req);
    });

    // OData Standard CREATE handler on ReservationEntries
    this.on('CREATE', ReservationEntries, async (req) => {
      return await executeReservationAndAutoTR(req.data, req);
    });

    // OData Standard READ handler on ReservationEntries: supports auto-resolving GUI-created reservations from SAP
    this.on('READ', ReservationEntries, async (req, next) => {
      const result = await next();

      const isSingleKeyRead = req.params && req.params.length > 0;
      const keyResNo = (req.params && req.params[0] && (req.params[0].ReservationNo || req.params[0])) ||
        req.data?.ReservationNo;
      const keyResItem = (req.params && req.params[0] && req.params[0].ReservationItem) ||
        req.data?.ReservationItem || '0001';

      if (isSingleKeyRead && keyResNo) {
        if (result) {
          if (!result.CreatedByUser && result.createdBy) {
            result.CreatedByUser = result.createdBy;
          }
          return result;
        }

        const sClean = String(keyResNo).trim().replace(/^0+/, '');
        const sPadded = sClean.padStart(10, '0');
        const altKey = keyResNo === sPadded ? sClean : sPadded;

        const altEntry = await SELECT.one.from(ReservationEntries).where({
          ReservationNo: altKey,
          ReservationItem: keyResItem
        });
        if (altEntry) {
          if (!altEntry.CreatedByUser && altEntry.createdBy) {
            altEntry.CreatedByUser = altEntry.createdBy;
          }
          return altEntry;
        }

        // Auto-seed from SAP if created outside this app (e.g. SAP GUI)
        const live = await fetchSapReservation(keyResNo, keyResItem);
        if (live) {
          const imported = {
            ReservationNo: sPadded,
            ReservationItem: keyResItem,
            MovementType: live.MovementType,
            WarehouseNumber: live.WarehouseNumber || '',
            Plant: live.Plant,
            StorageLocation: live.StorageLocation,
            Material: live.Material,
            MaterialName: live.MaterialName || '',
            Quantity: live.Quantity,
            Unit: live.Unit,
            CreatedByUser: live.CreatedByUser || live.createdBy || '',
            ReceivingPlant: live.ReceivingPlant || '',
            ReceivingStorageLocation: live.ReceivingStorageLocation || '',
            CostCenter: live.CostCenter || '',
            AssetNo: live.AssetNo || '',
            SubNumber: live.SubNumber || '',
            TransferRequirement: live.TransferRequirement || '',
            TransferOrder: live.TransferOrder || '',
            LogHandle: `LOG_${Date.now().toString(36).toUpperCase()}`,
            ExternalId: `${sPadded}/${keyResItem}`,
            Status_code: live.Status_code || STATUS.RES_CREATED,
            ErrorStep: '',
            ErrorMessage: ''
          };
          await INSERT.into(ReservationEntries).entries(imported);

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sPadded,
            ReservationItem: keyResItem,
            LogHandle: imported.LogHandle,
            ExternalId: imported.ExternalId,
            SubObject: 'TRACK',
            Step: 'MB21',
            Status: imported.Status_code,
            MessageType: 'S',
            MessageId: 'M7',
            MessageNo: '060',
            MessageText: `Reservation ${sPadded} imported from SAP GUI / S/4HANA`
          });

          return await SELECT.one.from(ReservationEntries).where({
            ReservationNo: sPadded,
            ReservationItem: keyResItem
          });
        }
      }

      if (Array.isArray(result)) {
        result.forEach((row) => {
          if (!row.CreatedByUser && row.createdBy) {
            row.CreatedByUser = row.createdBy;
          }
        });
      } else if (result && typeof result === 'object') {
        if (!result.CreatedByUser && result.createdBy) {
          result.CreatedByUser = result.createdBy;
        }
      }

      return result;
    });

    // Value Help for Order Types (loaded dynamically from SAP customizing tables T003O & T003P)
    this.on('READ', OrderTypeVH, async () => {
      try {
        if (adapter.rfc) {
          const [t003o, t003p] = await Promise.all([
            adapter.rfc.readTable('T003O', ['AUART', 'AUTYP'], [], 200),
            adapter.rfc.readTable('T003P', ['AUART', 'TXT'], ["SPRAS = 'E'"], 200)
          ]);

          const descMap = {};
          (t003p || []).forEach((p) => {
            const key = String(p.AUART || '').trim();
            if (key) descMap[key] = String(p.TXT || '').trim();
          });

          // Build unique order types for categories applicable to goods issue (01 Internal, 10 Production, 40 Process, 30 Maintenance)
          const allowedCategories = new Set(['01', '10', '20', '30', '40']);
          const typeMap = new Map();
          (t003o || []).forEach((r) => {
            const auart = String(r.AUART || '').trim();
            const autyp = String(r.AUTYP || '').trim();
            if (auart && (!autyp || allowedCategories.has(autyp))) {
              typeMap.set(auart, autyp);
            }
          });

          const result = Array.from(typeMap.entries()).map(([auart, autyp]) => ({
            OrderType: auart,
            OrderTypeName: descMap[auart] || `Order Type ${auart}`,
            OrderCategory: autyp || '01'
          }));

          result.sort((a, b) => {
            if (a.OrderType === 'ZEMP') return -1;
            if (b.OrderType === 'ZEMP') return 1;
            if (a.OrderType === 'ZP01') return -1;
            if (b.OrderType === 'ZP01') return 1;
            return a.OrderType.localeCompare(b.OrderType);
          });
          return result;
        }
      } catch (err) {
        LOG.warn(`[OrderTypeVH] SAP read error: ${err.message}`);
      }
      return [
        { OrderType: 'ZEMP', OrderTypeName: 'Internal orders: EMP', OrderCategory: '01' },
        { OrderType: 'ZP01', OrderTypeName: 'Process Order', OrderCategory: '40' },
        { OrderType: 'PP01', OrderTypeName: 'Standard Production Order', OrderCategory: '10' },
        { OrderType: 'PM01', OrderTypeName: 'Maintenance Order', OrderCategory: '30' },
        { OrderType: '0100', OrderTypeName: 'Internal orders: Development', OrderCategory: '01' },
        { OrderType: '0400', OrderTypeName: 'Internal orders: Marketing', OrderCategory: '01' }
      ];
    });

    // Value Help for Internal Orders (AUFK dynamically queried by OrderType / Plant)
    this.on('READ', InternalOrderVH, async (req) => {
      try {
        if (adapter.rfc) {
          let orderTypeFilter = '';
          let plantFilter = '';
          const whereClause = req.query?.SELECT?.where;
          if (Array.isArray(whereClause)) {
            for (let i = 0; i < whereClause.length; i++) {
              const token = whereClause[i];
              const col = token?.ref?.[0] || (typeof token === 'string' ? token : '');
              if (col === 'OrderType') {
                const val = whereClause[i + 2]?.val ?? whereClause[i + 2];
                if (typeof val === 'string' && val.trim()) orderTypeFilter = val.trim();
              } else if (col === 'Plant') {
                const val = whereClause[i + 2]?.val ?? whereClause[i + 2];
                if (typeof val === 'string' && val.trim()) plantFilter = val.trim();
              }
            }
          }

          const rfcFilters = [];
          if (orderTypeFilter) {
            rfcFilters.push(`AUART = '${orderTypeFilter}'`);
          }
          if (plantFilter) {
            rfcFilters.push(rfcFilters.length ? `AND WERKS = '${plantFilter}'` : `WERKS = '${plantFilter}'`);
          }

          const orders = await adapter.rfc.readTable(
            'AUFK',
            ['AUFNR', 'AUART', 'AUTYP', 'WERKS', 'KTEXT', 'LOEKZ'],
            rfcFilters,
            100
          );
          return (orders || [])
            .filter((o) => o.LOEKZ !== 'X')
            .map((o) => ({
              OrderID: alphaOut(o.AUFNR),
              OrderType: String(o.AUART || '').trim(),
              OrderDescription: String(o.KTEXT || '').trim() || 'Internal Order',
              Plant: String(o.WERKS || '').trim(),
              Status: 'REL'
            }));
        }
      } catch (err) {
        LOG.warn(`[InternalOrderVH] SAP read error: ${err.message}`);
      }
      return [
        { OrderID: '1007', OrderType: 'ZEMP', OrderDescription: '1006-Birendra Baitha', Plant: '1120', Status: 'REL' },
        { OrderID: '1011', OrderType: 'ZEMP', OrderDescription: '1059-Naresh Nagar', Plant: '1120', Status: 'REL' },
        { OrderID: '1002790', OrderType: 'ZP01', OrderDescription: 'CDCT Organic Process Order', Plant: '1120', Status: 'REL' },
        { OrderID: '1012', OrderType: 'ZEMP', OrderDescription: '1066-Suresh Bagada', Plant: '1120', Status: 'REL' },
        { OrderID: '1016', OrderType: 'ZEMP', OrderDescription: '1151-Purnima Desai', Plant: '1120', Status: 'REL' },
        { OrderID: '1019', OrderType: 'ZEMP', OrderDescription: '1180-Hemant Badgujar', Plant: '1120', Status: 'REL' }
      ];
    });

    // Value Help for Cost Centers (loaded dynamically from CSKS and CSKT)
    this.on('READ', CostCenterVH, async () => {
      try {
        if (adapter.rfc) {
          const [csks, cskt] = await Promise.all([
            adapter.rfc.readTable('CSKS', ['KOSTL', 'BUKRS'], ["BKZKP = ''"], 100),
            adapter.rfc.readTable('CSKT', ['KOSTL', 'KTEXT'], ["SPRAS = 'E'"], 200)
          ]);
          const descMap = {};
          (cskt || []).forEach((t) => {
            const k = String(t.KOSTL || '').trim();
            if (k) descMap[k] = String(t.KTEXT || '').trim();
          });
          const result = (csks || []).map((c) => {
            const cc = String(c.KOSTL || '').trim();
            return {
              CostCenter: cc,
              CostCenterName: descMap[cc] || `Cost Center ${cc}`,
              CompanyCode: String(c.BUKRS || '').trim() || '1000'
            };
          });
          result.sort((a, b) => {
            if (a.CostCenter === '1011201301') return -1;
            if (b.CostCenter === '1011201301') return 1;
            return a.CostCenter.localeCompare(b.CostCenter);
          });
          return result;
        }
      } catch (err) {
        LOG.warn(`[CostCenterVH] SAP read error: ${err.message}`);
      }
      return [
        { CostCenter: '1011201301', CostCenterName: 'AIL 8202 Production', CompanyCode: '1000' },
        { CostCenter: '1010001001', CostCenterName: 'AIL HO Admin', CompanyCode: '1000' },
        { CostCenter: '1010001301', CostCenterName: 'AIL HO CIS', CompanyCode: '1000' },
        { CostCenter: '1011301801', CostCenterName: 'AIL 8202 Finance', CompanyCode: '1000' },
        { CostCenter: '1011302001', CostCenterName: 'AIL 8202 Logistic', CompanyCode: '1000' }
      ];
    });

    /** Goods movement for a tracked reservation item (step MIGO). Shares one adapter path with tr-to. */
    async function postMigoForTrack(track, data, req, { sLogHandle, extId, subObject }) {
      const sResNo = track.ReservationNo;
      const sResItem = track.ReservationItem;
      const key = { ReservationNo: sResNo, ReservationItem: sResItem };
      const sMvt = data.movementType || data.MovementType || track.MovementType;
      const sPlant = data.plant || data.Plant || data.sourcePlant || data.SourcePlant || track.Plant;
      // PROCESS_ID of this GI step; persisted before posting so a retry finds an already posted document.
      const processId = data.ProcessId || track.ProcessId || cds.utils.uuid();
      if (track.ProcessId !== processId) await UPDATE(ReservationEntries).set({ ProcessId: processId }).where(key);

      // SAP-side lock (feature flag, off by default); lock, authorization checks and posting share one RFC session.
      const migoRes = await withReservationLock(adapter.rfc, { rsnum: sResNo, rspos: sResItem }, async (scopedRfc) => {
      const gm = scopedRfc ? adapter.withRfc(scopedRfc) : adapter;
      await gm.checkAuthorization('M_MSEG_BWA', { ACTVT: '01', BWART: sapKey(sMvt, 'mvt') });
      await gm.checkAuthorization('M_MSEG_WWA', { ACTVT: '01', WERKS: sapKey(sPlant, 'plant') });

      return gm.postGoodsMovement({
        reservationNo: sResNo,
        reservationNumber: sResNo,
        reservationItem: sResItem,
        movementType: sMvt,
        material: data.material || data.Material || track.Material,
        plant: sPlant,
        sourcePlant: sPlant,
        storageLocation: data.storageLocation || data.StorageLocation || data.sourceStorageLocation || data.SourceStorageLocation || track.StorageLocation,
        sourceStorageLocation: data.storageLocation || data.StorageLocation || data.sourceStorageLocation || data.SourceStorageLocation || track.StorageLocation,
        quantity: data.quantity != null ? data.quantity : (data.Quantity != null ? data.Quantity : track.Quantity),
        unit: data.unit || data.Unit || track.Unit,
        receivingPlant: data.receivingPlant || data.ReceivingPlant || data.destinationPlant || data.DestinationPlant || track.ReceivingPlant,
        destinationPlant: data.receivingPlant || data.ReceivingPlant || data.destinationPlant || data.DestinationPlant || track.ReceivingPlant,
        receivingStorageLocation: data.receivingStorageLocation || data.ReceivingStorageLocation || data.destinationStorageLocation || data.DestinationStorageLocation || track.ReceivingStorageLocation,
        destinationStorageLocation: data.receivingStorageLocation || data.ReceivingStorageLocation || data.destinationStorageLocation || data.DestinationStorageLocation || track.ReceivingStorageLocation,
        costCenter: data.costCenter || data.CostCenter || track.CostCenter,
        assetNo: data.assetNo || data.AssetNo || track.AssetNo,
        subNumber: data.subNumber || data.SubNumber || track.SubNumber,
        orderId: data.orderId || data.OrderId || data.OrderID || track.OrderID || '',
        transferOrder: track.TransferOrder || '',
        batch: data.batch || data.Batch || track.Batch || '',
        serials: data.serials || data.Serials || (data.SerialNo ? [data.SerialNo] : (track.SerialNo ? [track.SerialNo] : [])),
        completeReservation: data.completeReservation === true || data.CompleteReservation === true,
        processId
      });
      });

      const resVer = migoRes.reservationVerification;
      const isCompletelyProcessed = resVer ? resVer.completelyProcessed === true : (data.completeReservation === true || data.CompleteReservation === true || (migoRes.Quantity && track.Quantity && Number(migoRes.Quantity) >= Number(track.Quantity)));
      const withdrawnQty = resVer ? resVer.issuedQuantity : ((track.WithdrawnQuantity || 0) + Number(data.Quantity || migoRes.Quantity || 0));
      const remainingQty = resVer ? resVer.remainingQuantity : Math.max(0, (track.Quantity || 0) - Number(data.Quantity || migoRes.Quantity || 0));

      await UPDATE(ReservationEntries).set({
        MaterialDocument: migoRes.materialDocument,
        MaterialDocYear: migoRes.materialDocYear,
        Status_code: STATUS.GI_POSTED,
        ProcessStatus: isCompletelyProcessed ? PROCESS_STATUS.COMPLETED : PROCESS_STATUS.MIGO_POSTED,
        MigoBusinessKey: migoRes.businessKey || null,
        WithdrawnQuantity: withdrawnQty,
        RemainingQuantity: remainingQty,
        CompletelyProcessed: isCompletelyProcessed,
        ErrorMessage: '',
        ErrorStep: '',
        LogHandle: sLogHandle,
        ExternalId: extId
      }).where(key);

      await logRow({
        ...key, LogHandle: sLogHandle, ExternalId: extId, SubObject: subObject, ProcessId: processId, DocumentNo: migoRes.materialDocument,
        Step: 'MIGO', Status: STATUS.GI_POSTED, MessageType: 'S', MessageId: 'M7', MessageNo: '060',
        MessageText: migoRes.alreadyPosted
          ? `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} already existed for process ${processId}; not posted again`
          : (isCompletelyProcessed
              ? `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect}) - Reservation completely processed`
              : `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect}) - Partial issue: remaining quantity ${resVer?.remainingQuantity ?? remainingQty}`)
      });

      if (migoRes.warning) {
        if (req && typeof req.warn === 'function') req.warn(migoRes.warning);
        await logRow({
          ...key, LogHandle: sLogHandle, ExternalId: extId, SubObject: subObject, ProcessId: processId, DocumentNo: migoRes.materialDocument,
          Step: 'MIGO', Status: STATUS.GI_POSTED, MessageType: 'W', MessageId: 'L3', MessageNo: '001',
          MessageText: migoRes.warning
        });
      }

      return migoRes;
    }

    // Action handler for MIGO Goods Movement posting
    this.on('postMigoGoodsMovement', async (req) => {
      const data = req.data || {};
      const sResNo = data.ReservationNo;
      const sResItem = data.ReservationItem || '0001';

      if (!sResNo) {
        return req.error(400, 'ReservationNo is mandatory for MIGO posting');
      }
      const key = { ReservationNo: sResNo, ReservationItem: sResItem };

      // Read (and lock) the current record to fill in any omitted fields
      let existing = await lockEntry(key);

      if (!existing && adapter.rfc) {
        try {
          const s4Rsnum = sapKey(sResNo, 'rsnum').padStart(10, '0');
          const s4Rspos = sapKey(sResItem, 'rspos').padStart(4, '0');
          const [rkpfRows, resbRows] = await Promise.all([
            adapter.rfc.readTable('RKPF', ['RSNUM', 'BWART', 'KOSTL', 'ANLN1', 'ANLN2', 'USNAM', 'AUFNR'], [`RSNUM = '${s4Rsnum}'`], 1),
            adapter.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'MEINS', 'AUFNR'], [`RSNUM = '${s4Rsnum}'`, `AND RSPOS = '${s4Rspos}'`], 1)
          ]);
          if (resbRows && resbRows[0]) {
            existing = {
              ReservationNo: sResNo,
              ReservationItem: sResItem,
              MovementType: rkpfRows?.[0]?.BWART || data.MovementType || '',
              CostCenter: rkpfRows?.[0]?.KOSTL || data.CostCenter || '',
              AssetNo: rkpfRows?.[0]?.ANLN1 || data.AssetNo || '',
              SubNumber: rkpfRows?.[0]?.ANLN2 || data.SubNumber || '',
              OrderID: (resbRows[0].AUFNR || rkpfRows?.[0]?.AUFNR || data.OrderID || data.orderId || '').trim(),
              Material: resbRows[0].MATNR,
              Plant: resbRows[0].WERKS,
              StorageLocation: resbRows[0].LGORT,
              Quantity: parseFloat(resbRows[0].BDMNG) || 0,
              Unit: resbRows[0].MEINS || '',
              WarehouseNumber: await warehouseFor(resbRows[0].WERKS, resbRows[0].LGORT, data.WarehouseNumber),
              Status_code: STATUS.TO_CONFIRMED
            };
            await INSERT.into(ReservationEntries).entries(existing);
          }
        } catch (_fetchErr) {
          // ignore DDIC read error
        }
      }
      if (!existing) return req.error(404, `Reservation ${sResNo}/${sResItem} not found`);

      const extId = `${sResNo}/${sResItem}`;
      const sLogHandle = existing?.LogHandle || `LOG_${Date.now().toString(36).toUpperCase()}`;

      // Step 15: Idempotency Protection — if MIGO was already posted for this reservation item and TO/processId, return existing record
      if (existing.MaterialDocument && (existing.Status_code === STATUS.GI_POSTED || existing.ProcessStatus === PROCESS_STATUS.MIGO_POSTED || existing.ProcessStatus === PROCESS_STATUS.COMPLETED)) {
        const reqTo = data.TransferOrder || data.transferOrder || '';
        const reqPid = data.ProcessId || '';
        const toMatches = reqTo && existing.TransferOrder && sapKey(existing.TransferOrder, 'tanum') === sapKey(reqTo, 'tanum');
        const pidMatches = reqPid && existing.ProcessId && existing.ProcessId === reqPid;
        const bKeyMatches = existing.MigoBusinessKey && (data.businessKey === existing.MigoBusinessKey || (reqPid && existing.MigoBusinessKey.includes(reqPid)));
        if (bKeyMatches || pidMatches || toMatches) {
          const bKey = existing.MigoBusinessKey || `RES:${sResNo}/${sResItem}#TO:${existing.TransferOrder || reqTo || 'NONE'}#PID:${existing.ProcessId || reqPid || 'NONE'}`;
          LOG.info(`[Idempotency Guard] Reservation ${sResNo}/${sResItem} already has Material Document ${existing.MaterialDocument}; returning existing record`);
          await logRow({
            ...key, LogHandle: sLogHandle, ExternalId: extId, SubObject: 'PROCESS', ProcessId: existing.ProcessId || reqPid || null, DocumentNo: existing.MaterialDocument,
            Step: 'MIGO', Status: STATUS.GI_POSTED, MessageType: 'I', MessageId: 'M7', MessageNo: '060',
            MigoBusinessKey: bKey,
            MessageText: `Idempotency guard: Material Document ${existing.MaterialDocument}/${existing.MaterialDocYear || ''} already posted for business key ${bKey}; returning existing document`
          });
          return existing;
        }
      }

      try {
        const migoRes = await postMigoForTrack(existing, data, req, { sLogHandle, extId, subObject: 'PROCESS' });
        const updated = await SELECT.one.from(ReservationEntries).where(key);
        return updated || { ...key, MaterialDocument: migoRes.materialDocument, MaterialDocYear: migoRes.materialDocYear, Status_code: STATUS.GI_POSTED };
      } catch (err) {
        if (isLockConflict(err)) throw err;
        // Rollback already executed by adapter; status 90 (GI error, retryable) and log
        await UPDATE(ReservationEntries).set({
          Status_code: STATUS.GI_ERROR,
          ProcessStatus: PROCESS_STATUS.FAILED_MIGO,
          ErrorMessage: err.message,
          ErrorStep: 'MIGO',
          LogHandle: sLogHandle,
          ExternalId: extId
        }).where(key);

        await logRow({
          ...key, LogHandle: sLogHandle, ExternalId: extId, SubObject: 'PROCESS', ProcessId: existing.ProcessId || null, DocumentNo: '',
          Step: 'MIGO', Status: STATUS.GI_ERROR, MessageType: 'E', MessageId: 'M7', MessageNo: '021',
          MessageText: `Goods movement failed: ${err.message}`
        });

        return await SELECT.one.from(ReservationEntries).where(key);
      }
    });

    // Action handler for Material Document verification (Step 10)
    this.on('verifyMaterialDocument', async (req) => {
      try {
        return await adapter.verifyMaterialDocument(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    });

    // Action handler for Final Stock Verification (Step 11)
    this.on('verifyStock', async (req) => {
      try {
        return await adapter.verifyStock(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    });
    this.on('verifyResultingStock', async (req) => {
      try {
        return await adapter.verifyStock(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    });

    // Action handler for Reservation Verification (Step 12)
    this.on('verifyReservation', async (req) => {
      try {
        return await adapter.verifyReservation(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    });

    // Retry Action per failed step
    this.on('retryStep', async (req) => {
      const data = req.data || {};
      const sResNo = data.ReservationNo;
      const sResItem = data.ReservationItem || '0001';
      let requestedStep = (data.Step || '').toUpperCase().trim();

      if (!sResNo) {
        return req.error(400, 'ReservationNo is mandatory for retryStep');
      }
      const key = { ReservationNo: sResNo, ReservationItem: sResItem };

      let track = await lockEntry(key);

      if (!track) {
        const sClean = String(sResNo).trim().replace(/^0+/, '');
        const sPadded = sClean.padStart(10, '0');
        track = await lockEntry({ ReservationNo: sPadded, ReservationItem: sResItem }) ||
          await lockEntry({ ReservationNo: sClean, ReservationItem: sResItem });
      }

      if (!track && adapter.rfc) {
        const live = await fetchSapReservation(sResNo, sResItem);
        if (live) {
          const sPadded = String(sResNo).padStart(10, '0');
          const imported = {
            ReservationNo: sPadded,
            ReservationItem: sResItem,
            MovementType: live.MovementType,
            WarehouseNumber: live.WarehouseNumber || '',
            Plant: live.Plant,
            StorageLocation: live.StorageLocation,
            Material: live.Material,
            MaterialName: live.MaterialName || '',
            Quantity: live.Quantity,
            Unit: live.Unit,
            ReceivingPlant: live.ReceivingPlant || '',
            ReceivingStorageLocation: live.ReceivingStorageLocation || '',
            CostCenter: live.CostCenter || '',
            AssetNo: live.AssetNo || '',
            SubNumber: live.SubNumber || '',
            TransferRequirement: live.TransferRequirement || '',
            TransferOrder: live.TransferOrder || '',
            LogHandle: `LOG_${Date.now().toString(36).toUpperCase()}`,
            ExternalId: `${sPadded}/${sResItem}`,
            Status_code: live.Status_code || STATUS.RES_CREATED,
            ErrorStep: '',
            ErrorMessage: ''
          };
          await INSERT.into(ReservationEntries).entries(imported);
          track = await lockEntry({ ReservationNo: sPadded, ReservationItem: sResItem });
        }
      }

      if (!track) {
        return req.error(404, `Reservation ${sResNo}/${sResItem} not found`);
      }

      // D18 (live 241): SAP can complete a TR without creating a TO (XFELD_WRONG). LT04 would then fail on a completed TR,
      // so such a TR may be replaced by a new one (LB01). READ-ONLY LTBK/LTAK check, only when it can matter.
      const isAuto = !requestedStep || requestedStep === 'AUTO';
      let trClosedWithoutTo = false;
      if (track.TransferRequirement && adapter.rfc && (requestedStep === 'LB01' || (isAuto && track.Status_code === STATUS.TO_ERROR))) {
        const trWh = track.WarehouseNumber || await warehouseFor(track.Plant, track.StorageLocation, '');
        trClosedWithoutTo = await isTrClosedWithoutTo(adapter.rfc, trWh, track.TransferRequirement);
      }

      // Auto-detect step if not specified: the failed step's status, else the next open step
      if (isAuto) {
        const byStatus = { [STATUS.TR_ERROR]: 'LB01', [STATUS.TO_ERROR]: trClosedWithoutTo ? 'LB01' : 'LT04', [STATUS.TO_CONFIRM_ERROR]: 'LT12', [STATUS.GI_ERROR]: 'MIGO' }[track.Status_code];
        if (byStatus) {
          requestedStep = byStatus;
        } else if (!track.TransferRequirement || track.Status_code === STATUS.RES_CREATED) {
          requestedStep = 'LB01';
        } else if (!track.TransferOrder || track.Status_code === STATUS.TR_CREATED) {
          requestedStep = 'LT04';
        } else if (track.Status_code === STATUS.TO_CREATED) {
          requestedStep = 'LT12';
        } else {
          requestedStep = 'MIGO';
        }
      }
      if (!STEP_ERROR[requestedStep]) {
        return req.error(400, `Unsupported retry step: '${requestedStep}'. Supported: LB01, LT04, LT12, MIGO`);
      }
      if (requestedStep === 'LB01' && track.TransferRequirement && !trClosedWithoutTo) {
        return req.error(400, `Transfer Requirement ${alphaOut(track.TransferRequirement)} already exists for reservation ${sResNo}/${sResItem}; retry LT04 (TO creation) instead`);
      }
      const replacedTr = requestedStep === 'LB01' && trClosedWithoutTo ? track.TransferRequirement : '';
      if (replacedTr) LOG.warn(`[retryStep] TR ${alphaOut(replacedTr)} of reservation ${sResNo}/${sResItem} is completed in SAP without a TO; creating a new TR`);
      if (requestedStep === 'MIGO' && track.MaterialDocument && track.Status_code === STATUS.GI_POSTED) {
        return req.error(400, `Material Document ${track.MaterialDocument} is already posted for reservation ${sResNo}/${sResItem}`);
      }

      const extId = `${sResNo}/${sResItem}`;
      let slg1Log;
      try {
        slg1Log = await adapter.writeApplicationLog({
          object: 'ZWM_RES',
          subObject: 'PROCESS',
          externalId: extId,
          reservationNo: sResNo,
          reservationItem: sResItem,
          step: requestedStep,
          messageText: `Initiating retry for step ${requestedStep}`
        });
      } catch (_slgErr) {
        slg1Log = { logHandle: `LOG_${Date.now().toString(36).toUpperCase()}` };
      }
      const sLogHandle = slg1Log?.logHandle || track.LogHandle || '';
      const common = { ...key, LogHandle: sLogHandle, ExternalId: extId, SubObject: 'PROCESS' };
      const fail = async (status, step, message, processId = track.ProcessId || null) => {
        await UPDATE(ReservationEntries).set({ Status_code: status, ErrorMessage: message, ErrorStep: step, LogHandle: sLogHandle, ExternalId: extId }).where(key);
        await logRow({ ...common, ProcessId: processId, DocumentNo: '', Step: step, Status: status, MessageType: 'E', MessageId: 'L3', MessageNo: '999', MessageText: message });
      };
      const wh = () => {
        if (!track.WarehouseNumber) throw Object.assign(new Error(`Reservation ${sResNo}/${sResItem} has no warehouse number on its tracking record`), { status: 400 });
        return track.WarehouseNumber;
      };

      try {
        // SAP-side lock (feature flag, off by default) around the whole retried step; conflicts leave as 409.
        await withReservationLock(adapter.rfc, { rsnum: sResNo, rspos: sResItem }, async (scopedRfc) => {
        const stepAdapter = scopedRfc ? adapter.withRfc(scopedRfc) : adapter;
        if (requestedStep === 'LB01') {
          let trResult;
          try {
            trResult = await stepAdapter.createTransferRequirement({
              warehouseNumber: track.WarehouseNumber || await warehouseFor(track.Plant, track.StorageLocation, ''),
              wmMovementType: track.MovementType,
              movementType: track.MovementType,
              isTransferPosting: track.MovementType === '301',
              material: track.Material,
              plant: track.Plant,
              storageLocation: track.StorageLocation,
              quantity: track.Quantity,
              unit: track.Unit,
              reservationNo: sResNo,
              reservationItem: sResItem,
              costCenter: track.CostCenter,
              assetNo: track.AssetNo,
              subNumber: track.SubNumber,
              batch: track.Batch
            });

            if (trResult.warning) {
              req?.warn?.(200, trResult.warning);
            }

            if (!trResult || trResult.success === false || (!trResult.trNumber && !trResult.trNumberRaw) || trResult.trNumber === '0000000000') {
              throw new Error('TR creation verification failed: missing or invalid TR number from SAP');
            }
            const verifiedTrItem = trResult.trItem || '0001';
            if (!verifiedTrItem) {
              throw new Error('TR creation verification failed: missing TR item from SAP');
            }
            if (trResult.material && alphaOut(trResult.material) !== alphaOut(track.Material)) {
              throw new Error(`TR creation verification failed: material mismatch (expected ${alphaOut(track.Material)}, got ${alphaOut(trResult.material)})`);
            }
            if (trResult.quantity !== undefined && Number(trResult.quantity) !== Number(track.Quantity)) {
              throw new Error(`TR creation verification failed: quantity mismatch (expected ${Number(track.Quantity)}, got ${Number(trResult.quantity)})`);
            }
            if (trResult.plant && String(trResult.plant).trim() !== String(track.Plant).trim()) {
              throw new Error(`TR creation verification failed: plant mismatch (expected ${track.Plant}, got ${trResult.plant})`);
            }
            if (trResult.storageLocation && String(trResult.storageLocation).trim() !== String(track.StorageLocation).trim()) {
              throw new Error(`TR creation verification failed: storage location mismatch (expected ${track.StorageLocation}, got ${trResult.storageLocation})`);
            }
          } catch (trErr) {
            await fail(STATUS.TR_ERROR, 'LB01', `TR creation failed in SAP backend: ${trErr.message}`);
            throw Object.assign(trErr, { handled: true });
          }

          const trNo = trResult.trNumberRaw || String(trResult.trNumber).padStart(10, '0');

          await UPDATE(ReservationEntries).set({
            TransferRequirement: trNo,
            Status_code: STATUS.TR_CREATED,
            ErrorMessage: '',
            ErrorStep: '',
            LogHandle: sLogHandle,
            ExternalId: extId
          }).where(key);

          await logRow({ ...common, DocumentNo: trNo, Step: 'LB01', Status: STATUS.TR_CREATED, MessageType: 'S', MessageId: 'L3', MessageNo: '001',
            MessageText: `Retry successful: Transfer Requirement ${trNo} created via L_TR_CREATE${replacedTr ? ` (replaces TR ${alphaOut(replacedTr)}, completed in SAP without a TO)` : ''}` });
        } else if (requestedStep === 'LT04' || requestedStep === 'LT12') {
          // A tracked unconfirmed TO (03/13) is confirmed only; a confirmed TO never blocks another TO for the open quantity.
          let toNo = UNCONFIRMED_TO.includes(track.Status_code) ? track.TransferOrder : '';
          let processId = toNo ? (track.ProcessId || cds.utils.uuid()) : cds.utils.uuid();
          if (requestedStep === 'LT12' && !toNo) {
            return req.error(400, `Cannot confirm TO: no unconfirmed Transfer Order is tracked for reservation ${sResNo}/${sResItem}`);
          }
          if (!toNo) {
            if (!track.TransferRequirement) return req.error(400, `Cannot create TO: no Transfer Requirement on reservation ${sResNo}/${sResItem}`);
            // Guard read from SAP: any unconfirmed TO item for this TR blocks another TO (L_TO_CREATE_TR works on the whole TR).
            const pending = await findUnconfirmedToItems(stepAdapter.rfc, wh(), track.TransferRequirement);
            if (pending.length) {
              return req.error(400, `Unconfirmed Transfer Order ${pending[0].TANUM.replace(/^0+/, '')} exists for TR ${track.TransferRequirement.replace(/^0+/, '')}; confirm it before creating another TO`);
            }
            await stepAdapter.checkAuthorization('L_BWLVS', { LGNUM: wh(), BWLVS: sapKey(track.MovementType, 'mvt') });
            let toResult;
            try {
              toResult = await stepAdapter.createTransferOrderFromTR({
                warehouseNumber: wh(),
                trNumber: track.TransferRequirement,
                movementType: track.MovementType
              });
              toNo = toResult.toNumberRaw || String(toResult.toNumber).padStart(10, '0');

              await UPDATE(ReservationEntries).set({
                TransferOrder: toNo,
                Status_code: STATUS.TO_CREATED,
                ProcessStatus: PROCESS_STATUS.TO_CREATED,
                ErrorMessage: '',
                ErrorStep: '',
                ProcessId: processId,
                LogHandle: sLogHandle,
                ExternalId: extId
              }).where(key);

              await logRow({ ...common, ProcessId: processId, DocumentNo: toNo, Step: 'LT04', Status: STATUS.TO_CREATED, MessageType: 'S', MessageId: 'L3', MessageNo: '001',
                MessageText: `Transfer Order ${toNo} created from TR ${track.TransferRequirement}` });
            } catch (createErr) {
              await fail(STATUS.TO_ERROR, 'LT04', createErr.message, processId);
              throw Object.assign(createErr, { handled: true });
            }
          }

          // Real second call: Confirm TO
          try {
            await stepAdapter.checkAuthorization('L_LGNUM', { LGNUM: wh() });
            await stepAdapter.confirmTransferOrder({ warehouseNumber: wh(), toNumber: toNo });

            await UPDATE(ReservationEntries).set({
              TransferOrder: toNo,
              Status_code: STATUS.TO_CONFIRMED,
              ProcessStatus: PROCESS_STATUS.TO_CONFIRMED,
              ErrorMessage: '',
              ErrorStep: '',
              ProcessId: processId,
              LogHandle: sLogHandle,
              ExternalId: extId
            }).where(key);

            await logRow({ ...common, ProcessId: processId, DocumentNo: toNo, Step: 'LT12', Status: STATUS.TO_CONFIRMED, MessageType: 'S', MessageId: 'L3', MessageNo: '025',
              MessageText: `Retry successful: Transfer Order ${toNo} confirmed via L_TO_CONFIRM` });
          } catch (confirmErr) {
            await UPDATE(ReservationEntries).set({ TransferOrder: toNo, ProcessId: processId }).where(key);
            await fail(STATUS.TO_CONFIRM_ERROR, 'LT12', `Confirmation failed for Transfer Order ${toNo}: ${confirmErr.message}`, processId);
            throw Object.assign(confirmErr, { handled: true });
          }
        }
        });

        if (requestedStep === 'MIGO') {
          // postMigoForTrack takes its own lock (same flag); it must not run inside the step lock above.
          try {
            await postMigoForTrack(track, data, req, { sLogHandle, extId, subObject: 'PROCESS' });
          } catch (migoErr) {
            if (isLockConflict(migoErr)) throw migoErr;
            await fail(STATUS.GI_ERROR, 'MIGO', `Goods movement failed: ${migoErr.message}`);
            throw Object.assign(migoErr, { handled: true });
          }
        }

        return await SELECT.one.from(ReservationEntries).where(key);
      } catch (err) {
        if (isLockConflict(err)) throw err;
        // The failed step's own status (11/12/13/90) is already recorded; never overwrite it with another code.
        if (!err.handled) await fail(STEP_ERROR[requestedStep], requestedStep, `Retry ${requestedStep} failed: ${err.message}`);
        return await SELECT.one.from(ReservationEntries).where(key);
      }
    });

    // Chunk 6: SLG1 Application Log query function
    this.on('getApplicationLogs', async (req) => {
      const { ReservationNo, ReservationItem = '0001' } = req.data || {};
      if (!ReservationNo) return req.error(400, 'ReservationNo is mandatory');

      return await SELECT.from(ReservationLogs)
        .where({ ReservationNo, ReservationItem })
        .orderBy('createdAt desc');
    });

    this.on('getReservationDetail', async (req) => {
      const { ReservationNo, ReservationItem = '0001' } = req.data || {};
      if (!ReservationNo) return req.error(400, 'ReservationNo is mandatory');
      const live = await fetchSapReservation(ReservationNo, ReservationItem);
      if (!live) return req.error(404, `Reservation ${ReservationNo}/${ReservationItem} not found in SAP`);

      const key = {
        ReservationNo: String(ReservationNo).padStart(10, '0'),
        ReservationItem: String(ReservationItem).padStart(4, '0')
      };
      const track = await SELECT.one.from(ReservationEntries).where(key);
      if (track?.ProcessStatus) {
        live.ProcessStatus = track.ProcessStatus;
      } else if (!live.ProcessStatus) {
        live.ProcessStatus = live.CompletelyProcessed
          ? PROCESS_STATUS.COMPLETED
          : (live.MaterialDocument
              ? PROCESS_STATUS.MIGO_POSTED
              : (live.TransferOrder
                  ? PROCESS_STATUS.TO_CREATED
                  : (live.TransferRequirement ? PROCESS_STATUS.TR_CREATED : PROCESS_STATUS.RESERVATION_CREATED)));
      }
      if (!live.CreatedByUser && (track?.CreatedByUser || track?.createdBy)) {
        live.CreatedByUser = track.CreatedByUser || track.createdBy;
      }
      return live;
    });

    // All open reservations, read live from SAP S/4HANA (reuses the proven open-reservations reader).
    this.on('getOpenReservations', async (req) => {
      const plant = String(req.data.plant || '').trim();
      const mvt = String(req.data.movementType || '').trim();

      if (mvt && !SUPPORTED_MOVEMENT_TYPES.includes(mvt)) {
        return [];
      }

      const targetMvt = mvt || '311,201,241,301,261';
      try {
        const rows = await GoodsIssueAdapter.getOpenReservations(targetMvt, plant);
        const filteredRows = (rows || []).filter((r) =>
          SUPPORTED_MOVEMENT_TYPES.includes(String(r.MovementType || '').trim())
        );
        return filteredRows.map((r) => ({
          ReservationNo: r.ReservationNo || '',
          ReservationItem: '0001',
          MovementType: r.MovementType || '',
          MovementTypeName: r.MovementTypeName || '',
          Material: r.SampleMaterial || '',
          MaterialName: r.SampleMaterialDesc || '',
          Plant: r.Plant || '',
          StorageLocation: r.StorageLocation || '',
          ReceivingPlant: r.ReceivingPlant || '',
          ReceivingStorageLocation: r.ReceivingStorageLocation || '',
          OrderNo: r.OrderNo || '',
          OrderID: r.OrderNo || '',
          CreatedByUser: r.CreatedByUser || '',
          ItemCount: r.ItemCount || 0,
          DisplayText: r.DisplayText || '',
          Status_code: STATUS.RES_CREATED,
          StatusText: 'Reservation Created'
        }));
      } catch (err) {
        return req.error(err.status || 502, `Failed to load open reservations: ${err.message}`);
      }
    });

    this.on('executeReservationWarehouseFlow', async (req) => {
      try {
        const persistStatus = async (status, extra = {}) => {
          const resNo = extra.reservationNumber || extra.reservationNo;
          const resItem = extra.reservationItem || '0001';
          if (!resNo) return;
          const key = {
            ReservationNo: String(resNo).padStart(10, '0'),
            ReservationItem: String(resItem).padStart(4, '0')
          };
          const existing = await SELECT.one.from(ReservationEntries).where(key);
          const updateData = { ProcessStatus: status };
          if (extra.trNumber) updateData.TransferRequirement = extra.trNumber;
          if (extra.toNumber) updateData.TransferOrder = extra.toNumber;
          if (extra.materialDocument) updateData.MaterialDocument = extra.materialDocument;
          if (extra.materialDocYear || extra.materialDocumentYear) updateData.MaterialDocYear = extra.materialDocYear || extra.materialDocumentYear;
          if (extra.businessKey || extra.migoBusinessKey) updateData.MigoBusinessKey = extra.businessKey || extra.migoBusinessKey;
          if (extra.withdrawnQuantity != null) updateData.WithdrawnQuantity = extra.withdrawnQuantity;
          if (extra.remainingQuantity != null) updateData.RemainingQuantity = extra.remainingQuantity;
          if (extra.completelyProcessed != null) updateData.CompletelyProcessed = extra.completelyProcessed;
          if (extra.error) updateData.ErrorMessage = String(extra.error).substring(0, 255);

          if (existing) {
            await UPDATE(ReservationEntries).set(updateData).where(key);
          } else {
            await INSERT.into(ReservationEntries).entries({
              ...key,
              MovementType: req.data?.MovementType || req.data?.movementType || '201',
              Plant: req.data?.Plant || req.data?.plant || '',
              StorageLocation: req.data?.StorageLocation || req.data?.storageLocation || '',
              Material: req.data?.Material || req.data?.material || '',
              Quantity: req.data?.Quantity || req.data?.quantity || 0,
              Unit: req.data?.Unit || req.data?.unit || 'EA',
              Status_code: STATUS.RES_CREATED,
              ...updateData
            });
          }
        };

        const result = await adapter.executeReservationWarehouseFlow({
          ...req.data,
          persistStatus
        });
        return {
          success: result.success,
          stage: result.stage || result.state || '',
          state: result.state || '',
          currentState: result.currentState || '',
          processStatus: result.processStatus || '',
          completed: Boolean(result.completed),
          stages: result.stages || [],
          reservationNumber: result.reservation?.reservationNo || result.reservation?.reservation?.number || result.reservationNumber || '',
          reservationItem: result.reservation?.reservationItem || result.reservationItem || '0001',
          trNumber: result.tr?.trNumber || result.verifiedTR?.trNumber || result.trNumber || '',
          trItem: result.tr?.trItem || '0001',
          toNumber: result.to?.toNumber || result.toNumber || '',
          toItem: result.to?.toItem || '0001',
          toConfirmed: Boolean(result.confirmation?.confirmed || result.toConfirmed),
          materialDocument: result.migo?.materialDocument || result.materialDocument || '',
          materialDocumentYear: result.migo?.materialDocumentYear || result.materialDocumentYear || '',
          alreadyPosted: Boolean(result.migo?.alreadyPosted || result.alreadyPosted),
          idempotentRetry: Boolean(result.migo?.idempotentRetry || result.idempotentRetry),
          businessKey: result.migo?.businessKey || result.businessKey || '',
          stockVerified: Boolean(result.stock?.verified || result.stock?.success || result.stockVerified),
          reservationVerified: Boolean(result.finalReservation?.verified || result.finalReservation?.success || result.reservationVerified),
          completelyProcessed: Boolean(result.finalReservation?.completelyProcessed || result.completelyProcessed),
          error: result.error || ''
        };
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    });

    return super.init();
  }
};
