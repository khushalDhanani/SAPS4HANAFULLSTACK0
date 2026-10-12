const cds = require('@sap/cds');
const TrToAdapter = require('../../../integration/s4hana/wm/TrToAdapter');
const ReservationProcessAdapter = require('../../../integration/s4hana/wm/ReservationProcessAdapter');
const { STATUS, STATUS_TEXT, UNCONFIRMED_TO } = require('../../../common/wmStatus');
const { sapKey, sapKeyOpt } = require('../../../integration/s4hana/sapKey');
const { withReservationLock } = require('../../../integration/s4hana/wm/resLock');

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Thin CAP binding; all validation lives in TrToAdapter and ReservationProcessAdapter. */
class TrToHandler {
  static init(srv, options = {}) {
    const adapter = options.adapter || new TrToAdapter();
    const resProcessAdapter = options.resProcessAdapter || new ReservationProcessAdapter();

    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {});
      } catch (err) {
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };

    srv.on('getOpenTRs', run(({ lgnum, mvt }) => adapter.getOpenTRs(lgnum, mvt)));
    srv.on('getTR', run(({ tbnum, lgnum }) => adapter.getTR(tbnum, lgnum)));
    srv.on('lookupTR', run(({ tbnum, lgnum, docType, tbpos }) => adapter.lookupTR(tbnum, lgnum, docType, tbpos)));
    srv.on('getFifoBatches', run(({ material, plant, storageLocation, warehouseNumber }) => adapter.getFifoBatches(material, plant, storageLocation, warehouseNumber)));
    srv.on('getAvailableSerials', run(({ material, plant, storageLocation, batch }) => adapter.getAvailableSerials(material, plant, storageLocation, batch)));
    srv.on('getAvailableSUs', run(({ tbnum, lgnum, tbpos }) => adapter.getAvailableSUs(tbnum, lgnum, tbpos)));
    srv.on('checkSU', run(({ lenum, tbnum, lgnum }) => adapter.checkSU(lenum, tbnum, lgnum)));
    srv.on('createTO', run(({ lgnum, tbnum, lenum, qty }) => adapter.createTO({ lgnum, tbnum, lenum, qty })));

    const entities = () => {
      const db = cds.db;
      if (!db) return {};
      try { return db.entities('saps4hana.wm'); } catch (_) { return {}; }
    };
    const userOf = (req) => req.user?.id || process.env.S4_USERNAME || '';
    const log = async (ReservationLog, row) => {
      if (!ReservationLog) return;
      await INSERT.into(ReservationLog).entries({ ID: cds.utils.uuid(), ...row });
    };
    /** Row lock for the duration of the request transaction (HANA; a no-op on SQLite). */
    const lockTrack = (ReservationTrack, where) => SELECT.one.from(ReservationTrack).where(where).forUpdate();

    // Step 3 Service (MIGO Goods Movement Posting & Retry)
    const handlePostMigoGoodsMovement = async (req) => {
      const data = req.data || {};
      const { ReservationTrack, ReservationLog } = entities();
      let existingTrack = null;

      const sResNoIn = sapKeyOpt(data.ReservationNo, 'rsnum');
      const sTanumIn = sapKeyOpt(data.TransferOrder, 'tanum');
      if (!sResNoIn && !sTanumIn) throw httpError(400, 'ReservationNo or TransferOrder is required');
      const sResItemIn = sapKeyOpt(data.ReservationItem, 'rspos');

      if (ReservationTrack) {
        try {
          existingTrack = await lockTrack(ReservationTrack,
            sResNoIn
              ? { ReservationNo: data.ReservationNo, ReservationItem: data.ReservationItem || '0001' }
              : { TransferOrder: data.TransferOrder });
        } catch (dbErr) {
          console.warn('[trTo.handler] ReservationTrack lookup warning:', dbErr.message);
        }
      }

      const sResNo = sResNoIn || existingTrack?.ReservationNo || '';
      const sResItem = sResItemIn || existingTrack?.ReservationItem || '0001';
      const sMvt = data.MovementType || existingTrack?.MovementType;
      const sMat = data.Material || existingTrack?.Material;
      const sPlant = data.Plant || existingTrack?.Plant;
      const sSLoc = data.StorageLocation || existingTrack?.StorageLocation;
      const nQty = data.Quantity || existingTrack?.Quantity;
      const sUnit = data.Unit || existingTrack?.Unit;
      const sRecPlant = data.ReceivingPlant || existingTrack?.ReceivingPlant;
      const sRecSLoc = data.ReceivingStorageLocation || existingTrack?.ReceivingStorageLocation;
      const sCostCenter = data.CostCenter || existingTrack?.CostCenter;
      const sAssetNo = data.AssetNo || existingTrack?.AssetNo;
      const sSubNumber = data.SubNumber || existingTrack?.SubNumber;
      const sTanum = sTanumIn || existingTrack?.TransferOrder || '';
      const sBatch = data.Batch || data.batch || existingTrack?.Batch || '';
      const sSerials = data.Serials || data.serials || (data.SerialNo ? [data.SerialNo] : []);
      const completeReservation = data.CompleteReservation === true;
      for (const [v, label] of [[sMvt, 'MovementType'], [sMat, 'Material'], [sPlant, 'Plant'], [nQty, 'Quantity'], [sUnit, 'Unit']]) {
        if (!v) throw httpError(400, `${label} is required (not in the request and not on the tracking record)`);
      }

      // PROCESS_ID of this GI step: reused on retry so an already posted document is found, never posted twice.
      const processId = data.ProcessId || existingTrack?.ProcessId || cds.utils.uuid();
      const trackKey = existingTrack ? { ReservationNo: existingTrack.ReservationNo, ReservationItem: existingTrack.ReservationItem } : null;
      if (trackKey && existingTrack.ProcessId !== processId) {
        await UPDATE(ReservationTrack).set({ ProcessId: processId }).where(trackKey);
      }

      const result = {
        ProcessId: processId,
        ReservationNo: sResNo,
        ReservationItem: sResItem,
        TransferOrder: sTanum,
        MovementType: sMvt,
        Quantity: Number(nQty),
        Unit: sUnit,
        Batch: sBatch,
        Serials: sSerials
      };

      // SAP-side lock (feature flag, off by default): lock conflicts leave here as 409 before any step runs.
      const lockKey = sResNo ? { rsnum: sResNo, rspos: sResItem } : null;
      return withReservationLock(lockKey ? resProcessAdapter.rfc : null, lockKey, async (scopedRfc) => {
      const gm = scopedRfc && resProcessAdapter.withRfc ? resProcessAdapter.withRfc(scopedRfc) : resProcessAdapter;
      try {
        await gm.checkAuthorization('M_MSEG_BWA', { ACTVT: '01', BWART: sapKey(sMvt, 'mvt') });
        await gm.checkAuthorization('M_MSEG_WWA', { ACTVT: '01', WERKS: sapKey(sPlant, 'plant') });

        const migoRes = await gm.postGoodsMovement({
          reservationNo: sResNo,
          reservationItem: sResItem,
          movementType: sMvt,
          material: sMat,
          plant: sPlant,
          storageLocation: sSLoc,
          quantity: nQty,
          unit: sUnit,
          receivingPlant: sRecPlant,
          receivingStorageLocation: sRecSLoc,
          costCenter: sCostCenter,
          assetNo: sAssetNo,
          subNumber: sSubNumber,
          transferOrder: sTanum,
          batch: sBatch,
          serials: sSerials,
          completeReservation,
          processId
        });

        if (trackKey) {
          try {
            await UPDATE(ReservationTrack)
              .set({ MaterialDocument: migoRes.materialDocument, MaterialDocYear: migoRes.materialDocYear, Status_code: STATUS.GI_POSTED, ErrorMessage: '', ErrorStep: '' })
              .where(trackKey);
            await log(ReservationLog, {
              ...trackKey, ProcessId: processId, DocumentNo: migoRes.materialDocument,
              Step: 'MIGO', Status: STATUS.GI_POSTED, MessageType: 'S', MessageId: 'M7', MessageNo: '060',
              MessageText: migoRes.alreadyPosted
                ? `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} already existed for process ${processId}; not posted again`
                : `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect})`
            });
          } catch (dbErr) {
            console.warn('[trTo.handler] DB post-MIGO tracking update warning:', dbErr.message);
          }
        }

        return {
          ...result,
          Success: true,
          MaterialDocument: migoRes.materialDocument,
          MaterialDocYear: migoRes.materialDocYear,
          Status: STATUS.GI_POSTED,
          StatusText: STATUS_TEXT[STATUS.GI_POSTED],
          ReservationNo: migoRes.reservationNo || sResNo,
          Batch: migoRes.batch || sBatch,
          StockEffect: migoRes.stockEffect,
          Message: migoRes.alreadyPosted
            ? `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} already existed for this process step; not posted again.`
            : `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} posted successfully.`,
          ErrorStep: '',
          ErrorMessage: ''
        };
      } catch (err) {
        // Rollback executed by the adapter; tracking goes to 90 (GI error, retryable)
        if (trackKey) {
          try {
            await UPDATE(ReservationTrack).set({ Status_code: STATUS.GI_ERROR, ErrorMessage: err.message, ErrorStep: 'MIGO' }).where(trackKey);
            await log(ReservationLog, {
              ...trackKey, ProcessId: processId, DocumentNo: '',
              Step: 'MIGO', Status: STATUS.GI_ERROR, MessageType: 'E', MessageId: 'M7', MessageNo: '021',
              MessageText: `Goods movement failed: ${err.message}`
            });
          } catch (dbErr) {
            console.warn('[trTo.handler] DB MIGO error status update warning:', dbErr.message);
          }
        }
        return {
          ...result,
          Success: false,
          MaterialDocument: '',
          MaterialDocYear: '',
          Status: STATUS.GI_ERROR,
          StatusText: STATUS_TEXT[STATUS.GI_ERROR],
          StockEffect: '',
          Message: `Goods movement failed: ${err.message}`,
          ErrorStep: 'MIGO',
          ErrorMessage: err.message
        };
      }
      });
    };

    // Step 2: Create TO from TR + Auto Confirm + Optional Auto MIGO
    const handleCreateTOFromTR = async (req) => {
      const data = req.data || {};
      const { ReservationTrack, ReservationLog } = entities();
      let existing = null;

      if (ReservationTrack) {
        try {
          const tbnum = sapKeyOpt(data.tbnum, 'tbnum').padStart(10, '0');
          const rsnum = sapKeyOpt(data.ReservationNo, 'rsnum');
          if (tbnum.trim() || rsnum) {
            existing = await lockTrack(ReservationTrack, tbnum.trim() ? { TransferRequirement: tbnum } : { ReservationNo: rsnum });
          }
        } catch (_) {}
      }

      // A tracked TO that is not yet confirmed (03/13) is confirmed again, never re-created. A confirmed TO does not
      // block another TO for the remaining quantity.
      if (existing?.TransferOrder && UNCONFIRMED_TO.includes(existing.Status_code)) {
        data.existingToNumber = existing.TransferOrder;
        data.status = existing.Status_code;
      }
      const isRetry = Boolean(data.existingToNumber);
      const processId = (isRetry && existing?.ProcessId) || cds.utils.uuid();
      const trackKey = existing ? { ReservationNo: existing.ReservationNo, ReservationItem: existing.ReservationItem } : null;

      try {
        // SAP-side lock (feature flag, off by default) around the TO step only; a conflict leaves as 409.
        const lockKey = existing?.ReservationNo ? { rsnum: existing.ReservationNo, rspos: existing.ReservationItem } : null;
        const result = await withReservationLock(lockKey ? adapter.rfc : null, lockKey, (scopedRfc) =>
          (scopedRfc && adapter.withRfc ? adapter.withRfc(scopedRfc) : adapter).createTOFromTR(data));
        result.ProcessId = processId;

        if (trackKey && result.TransferOrder) {
          try {
            await UPDATE(ReservationTrack)
              .set({ TransferOrder: result.TransferOrder, Status_code: result.Status, ErrorMessage: result.ErrorMessage || '', ErrorStep: result.ErrorStep || '', ProcessId: processId })
              .where(trackKey);
            if (!isRetry) {
              await log(ReservationLog, {
                ...trackKey, ProcessId: processId, DocumentNo: result.TransferOrder,
                Step: 'LT04', Status: STATUS.TO_CREATED, MessageType: 'S', MessageId: 'L3', MessageNo: '001',
                MessageText: `Transfer Order ${result.TransferOrder} created from TR ${result.TransferRequirement} item ${result.TRItem} (${result.Quantity} ${result.Unit})`
              });
            }
            if (result.Confirmed) {
              await log(ReservationLog, {
                ...trackKey, ProcessId: processId, DocumentNo: result.TransferOrder,
                Step: 'LT12', Status: STATUS.TO_CONFIRMED, MessageType: 'S', MessageId: 'L3', MessageNo: '025',
                MessageText: `Transfer Order ${result.TransferOrder} confirmed via L_TO_CONFIRM`
              });
            } else if (result.Status === STATUS.TO_CONFIRM_ERROR) {
              await log(ReservationLog, {
                ...trackKey, ProcessId: processId, DocumentNo: result.TransferOrder,
                Step: 'LT12', Status: STATUS.TO_CONFIRM_ERROR, MessageType: 'E', MessageId: 'L3', MessageNo: '026',
                MessageText: result.ErrorMessage || `Transfer Order ${result.TransferOrder} confirmation failed (LT12)`
              });
            }
          } catch (dbErr) {
            console.warn('[trTo.handler] Tracking update warning:', dbErr.message);
          }
        }

        // Auto-trigger MIGO if requested and TO confirmed
        if (data.autoPostMigo && result.Confirmed) {
          try {
            const migoResult = await handlePostMigoGoodsMovement({
              user: req.user,
              data: {
                ReservationNo: existing?.ReservationNo || result.ReservationNo,
                ReservationItem: existing?.ReservationItem || result.ReservationItem,
                TransferOrder: result.TransferOrder,
                Quantity: result.Quantity,
                Unit: result.Unit,
                MovementType: existing?.MovementType || result.MovementType,
                Material: result.Material || existing?.Material,
                Plant: existing?.Plant || result.Plant,
                StorageLocation: existing?.StorageLocation || result.StorageLocation,
                CostCenter: existing?.CostCenter,
                AssetNo: existing?.AssetNo,
                SubNumber: existing?.SubNumber,
                ReceivingPlant: existing?.ReceivingPlant,
                ReceivingStorageLocation: existing?.ReceivingStorageLocation,
                Batch: result.Batch || data.batch || existing?.Batch || '',
                Serials: result.Serials || data.serials || [],
                CompleteReservation: data.CompleteReservation === true,
                ProcessId: cds.utils.uuid() // the goods movement is its own step
              }
            });

            result.ProcessId = migoResult.ProcessId || result.ProcessId;
            if (migoResult && migoResult.MaterialDocument) {
              result.Status = STATUS.GI_POSTED;
              result.StatusText = STATUS_TEXT[STATUS.GI_POSTED];
              result.MaterialDocument = migoResult.MaterialDocument;
              result.MaterialDocYear = migoResult.MaterialDocYear;
              result.StockEffect = migoResult.StockEffect;
              result.Batch = migoResult.Batch || result.Batch;
              result.ReservationNo = migoResult.ReservationNo || result.ReservationNo;
              result.MovementType = migoResult.MovementType || result.MovementType || existing?.MovementType || '';
              result.Message = `Transfer Order ${result.TransferOrder} confirmed and Material Document ${migoResult.MaterialDocument} posted successfully.`;
            } else {
              result.Status = STATUS.GI_ERROR;
              result.StatusText = STATUS_TEXT[STATUS.GI_ERROR];
              result.ErrorStep = 'MIGO';
              result.ErrorMessage = migoResult?.ErrorMessage || 'Goods movement posting failed';
            }
          } catch (migoErr) {
            result.Status = STATUS.GI_ERROR;
            result.StatusText = STATUS_TEXT[STATUS.GI_ERROR];
            result.ErrorStep = 'MIGO';
            result.ErrorMessage = migoErr.message;
          }
        }

        result.IsConfirmed = Boolean(result.Confirmed || result.Status === STATUS.TO_CONFIRMED || result.Status === STATUS.GI_POSTED);
        result.ConfirmationNumber = result.ConfirmationNumber || result.TransferOrder;
        result.ConfirmedBy = result.ConfirmedBy || (result.IsConfirmed ? userOf(req) : '');

        return result;
      } catch (err) {
        if (err.code === 'RES_LOCKED') throw err;
        if (trackKey) {
          try {
            await UPDATE(ReservationTrack).set({
              Status_code: err.Status || STATUS.TO_ERROR,
              ErrorMessage: err.message || '',
              ErrorStep: err.ErrorStep || 'LT04',
              ProcessId: processId
            }).where(trackKey);
            await log(ReservationLog, {
              ...trackKey, ProcessId: processId, DocumentNo: existing?.TransferOrder || '',
              Step: err.ErrorStep || 'LT04', Status: err.Status || STATUS.TO_ERROR, MessageType: 'E', MessageId: 'L3', MessageNo: '110',
              MessageText: err.message || 'TO Step failed'
            });
          } catch (_) {}
        }
        return req.error(err.status || 400, err.message || 'CreateTOFromTR failed');
      }
    };

    srv.on('createTOFromTR', handleCreateTOFromTR);
    srv.on('CreateTOFromTR', handleCreateTOFromTR);
    srv.on('postMigoGoodsMovement', handlePostMigoGoodsMovement);
    srv.on('PostMigoGoodsMovement', handlePostMigoGoodsMovement);
  }
}

module.exports = TrToHandler;
