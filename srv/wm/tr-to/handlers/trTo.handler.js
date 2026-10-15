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

      const sResNoIn = sapKeyOpt(data.ReservationNo || data.reservationNumber || data.reservationNo, 'rsnum');
      const sTanumIn = sapKeyOpt(data.TransferOrder || data.transferOrder, 'tanum');
      let sMvt = data.ReservationMovementType || data.reservationMovementType || data.MovementType || data.movementType;
      if (!sResNoIn && !sTanumIn && sMvt !== '311' && sMvt !== '301') {
        throw httpError(400, 'ReservationNo or TransferOrder is required');
      }
      const sResItemIn = sapKeyOpt(data.ReservationItem || data.reservationItem, 'rspos');

      if (ReservationTrack) {
        try {
          existingTrack = await lockTrack(ReservationTrack,
            sResNoIn
              ? { ReservationNo: data.ReservationNo || data.reservationNumber || data.reservationNo, ReservationItem: data.ReservationItem || data.reservationItem || '0001' }
              : (sTanumIn ? { TransferOrder: data.TransferOrder || data.transferOrder } : { ID: '__dummy__' }));
        } catch (dbErr) {
          console.warn('[trTo.handler] ReservationTrack lookup warning:', dbErr.message);
        }
      }

      const sResNo = sResNoIn || existingTrack?.ReservationNo || '';
      const sResItem = sResItemIn || existingTrack?.ReservationItem || '0001';
      if (!sMvt) sMvt = existingTrack?.MovementType;
      let sMat = data.Material || data.material || existingTrack?.Material;
      let sPlant = data.Plant || data.plant || data.sourcePlant || data.SourcePlant || existingTrack?.Plant;
      let sSLoc = data.StorageLocation || data.storageLocation || data.sourceStorageLocation || data.SourceStorageLocation || existingTrack?.StorageLocation;
      const nQty = data.Quantity != null ? data.Quantity : (data.quantity != null ? data.quantity : existingTrack?.Quantity);
      const sUnit = data.Unit || data.unit || existingTrack?.Unit;
      let sRecPlant = data.ReceivingPlant || data.receivingPlant || data.destinationPlant || data.DestinationPlant || existingTrack?.ReceivingPlant;
      let sRecSLoc = data.ReceivingStorageLocation || data.receivingStorageLocation || data.destinationStorageLocation || data.DestinationStorageLocation || existingTrack?.ReceivingStorageLocation;
      let sCostCenter = data.CostCenter || data.costCenter || existingTrack?.CostCenter;
      let sAssetNo = data.AssetNo || data.assetNo || existingTrack?.AssetNo;
      let sSubNumber = data.SubNumber || data.subNumber || existingTrack?.SubNumber;
      const sTanum = sTanumIn || existingTrack?.TransferOrder || '';
      let sBatch = data.Batch || data.batch || existingTrack?.Batch || '';
      const sSerials = data.Serials || data.serials || (data.SerialNo ? [data.SerialNo] : []);
      const completeReservation = data.CompleteReservation === true || data.completeReservation === true;

      // Enforce strict dependency: TO CREATED AND TO CONFIRMED -> MIGO
      if (existingTrack && [STATUS.TO_CREATED, STATUS.TO_CONFIRM_ERROR, STATUS.TO_ERROR].includes(existingTrack.Status_code)) {
        throw httpError(400, `Transfer Order ${sTanum || existingTrack.TransferOrder} is not confirmed (status ${existingTrack.Status_code}). TO must be confirmed before posting MIGO goods movement.`);
      }

      // Resilient destination/account resolution from TO (LTAK -> LTAP -> RESB/RKPF) if missing on untracked records
      if (sTanum && resProcessAdapter.rfc) {
        try {
          const ltakRows = await resProcessAdapter.rfc.readTable('LTAK', ['TBNUM', 'RSNUM', 'BWLVS', 'KQUIT'], [`TANUM = '${sTanum.padStart(10, '0')}'`], 1);
          if (ltakRows?.[0]) {
            if (ltakRows[0].KQUIT !== undefined && ltakRows[0].KQUIT !== null && ltakRows[0].KQUIT.trim() === '') {
              throw httpError(400, `Transfer Order ${sTanum} is not confirmed in SAP (LTAK-KQUIT is blank). TO must be confirmed before posting MIGO goods movement.`);
            }
            const tbnum = ltakRows[0].TBNUM?.trim();
            const rsnumRaw = ltakRows[0].RSNUM?.trim();
            const rsnum = rsnumRaw ? sapKey(rsnumRaw, 'rsnum').padStart(10, '0') : '';
            if (!sMvt && ltakRows[0].BWLVS?.trim()) sMvt = ltakRows[0].BWLVS.trim();
            if (rsnum && rsnum !== '0000000000') {
              const resbRows = await resProcessAdapter.rfc.readTable('RESB', ['BWART', 'UMWRK', 'UMLGO', 'CHARG'], [`RSNUM = '${rsnum}'`], 1);
              if (resbRows?.[0]) {
                const resbMvt = resbRows[0].BWART?.trim();
                if (resbMvt && resbMvt !== sMvt) {
                  sMvt = resbMvt;
                }
                if (!sRecPlant && resbRows[0].UMWRK?.trim()) sRecPlant = resbRows[0].UMWRK.trim();
                if (!sRecSLoc && resbRows[0].UMLGO?.trim()) sRecSLoc = resbRows[0].UMLGO.trim();
                if (!sBatch && resbRows[0].CHARG?.trim()) sBatch = resbRows[0].CHARG.trim().toUpperCase();
              }
              if (!sCostCenter || !sAssetNo) {
                const rkpfRows = await resProcessAdapter.rfc.readTable('RKPF', ['KOSTL', 'ANLN1', 'ANLN2'], [`RSNUM = '${rsnum}'`], 1);
                if (rkpfRows?.[0]) {
                  if (!sCostCenter && rkpfRows[0].KOSTL?.trim()) sCostCenter = rkpfRows[0].KOSTL.trim();
                  if (!sAssetNo && rkpfRows[0].ANLN1?.trim()) {
                    sAssetNo = rkpfRows[0].ANLN1.trim();
                    sSubNumber = rkpfRows[0].ANLN2?.trim() || '0000';
                  }
                }
              }
            } else if (tbnum && (!sRecPlant || !sRecSLoc || !sCostCenter || !sAssetNo)) {
              const ltbkRows = await resProcessAdapter.rfc.readTable('LTBK', ['RSNUM', 'BETYP', 'BENUM', 'MBLNR', 'MJAHR'], [`TBNUM = '${tbnum}'`], 1);
              if (ltbkRows?.[0]?.BETYP === 'K' && !sCostCenter) {
                sCostCenter = ltbkRows[0].BENUM?.trim();
              } else if (ltbkRows?.[0]?.BETYP === 'A' && !sAssetNo) {
                sAssetNo = ltbkRows[0].BENUM?.trim();
                if (!sSubNumber) sSubNumber = '0000';
              }
              if ((!sRecPlant || !sRecSLoc) && ltbkRows?.[0]?.MBLNR?.trim()) {
                try {
                  const mblnr = ltbkRows[0].MBLNR.trim();
                  const mjahr = (ltbkRows[0].MJAHR?.trim()) || '2026';
                  const matdoc = await resProcessAdapter.rfc.readTable('MATDOC', ['UMWRK', 'UMLGO'], [
                    `MBLNR = '${mblnr}'`,
                    `AND MJAHR = '${mjahr}'`
                  ], 1);
                  if (matdoc?.[0]) {
                    if (!sRecPlant && matdoc[0].UMWRK?.trim()) sRecPlant = matdoc[0].UMWRK.trim().toUpperCase();
                    if (!sRecSLoc && matdoc[0].UMLGO?.trim()) sRecSLoc = matdoc[0].UMLGO.trim().toUpperCase();
                  }
                } catch (_) {}
              }
            }

            // Fallback 1: ReservationTrack by TBNUM or TANUM
            if ((!sRecPlant || !sRecSLoc) && ReservationTrack) {
              try {
                const tbPad = (tbnum || '').padStart(10, '0');
                const tanumPad = sTanum.padStart(10, '0');
                const conds = [];
                if (tbnum) conds.push(`TransferRequirement = '${tbnum}'`, `TransferRequirement = '${tbPad}'`);
                conds.push(`TransferOrder = '${sTanum}'`, `TransferOrder = '${tanumPad}'`);
                const trk = await cds.db.run(
                  cds.ql.SELECT.one.from(ReservationTrack).where(conds.join(' or '))
                );
                if (trk) {
                  if (!sRecPlant && trk.ReceivingPlant?.trim()) sRecPlant = trk.ReceivingPlant.trim().toUpperCase();
                  if (!sRecSLoc && trk.ReceivingStorageLocation?.trim()) sRecSLoc = trk.ReceivingStorageLocation.trim().toUpperCase();
                  if (!sCostCenter && trk.CostCenter?.trim()) sCostCenter = trk.CostCenter.trim();
                  if (!sAssetNo && trk.AssetNo?.trim()) {
                    sAssetNo = trk.AssetNo.trim();
                    sSubNumber = trk.SubNumber?.trim() || '0000';
                  }
                }
              } catch (_) {}
            }
          }
          if ((!sMat || !sPlant || !sSLoc || !sBatch) && (!resProcessAdapter.rfc.readTable?.mock)) {
            const ltapRows = await resProcessAdapter.rfc.readTable('LTAP', ['MATNR', 'WERKS', 'LGORT', 'CHARG'], [`TANUM = '${sTanum.padStart(10, '0')}'`], 1);
            if (ltapRows?.[0]) {
              if (!sMat && ltapRows[0].MATNR?.trim()) sMat = ltapRows[0].MATNR.trim();
              if (!sPlant && ltapRows[0].WERKS?.trim()) sPlant = ltapRows[0].WERKS.trim();
              if (!sSLoc && ltapRows[0].LGORT?.trim()) sSLoc = ltapRows[0].LGORT.trim();
              if (!sBatch && ltapRows[0].CHARG?.trim()) sBatch = ltapRows[0].CHARG.trim().toUpperCase();
            }
          }
        } catch (_lookupErr) {
          if (_lookupErr.status === 400) throw _lookupErr;
          console.warn('[trTo.handler] TransferOrder metadata lookup note:', _lookupErr.message);
        }
      }
      const requiredFields = [[sMvt, 'MovementType'], [sPlant, 'Plant']];
      if (sMvt !== '311' && sMvt !== '301') {
        requiredFields.push([sMat, 'Material'], [nQty, 'Quantity'], [sUnit, 'Unit']);
      }
      for (const [v, label] of requiredFields) {
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
          reservationNumber: sResNo,
          reservationItem: sResItem,
          movementType: sMvt,
          material: sMat,
          plant: sPlant,
          sourcePlant: sPlant,
          storageLocation: sSLoc,
          sourceStorageLocation: sSLoc,
          quantity: nQty,
          unit: sUnit,
          receivingPlant: sRecPlant,
          destinationPlant: sRecPlant,
          receivingStorageLocation: sRecSLoc,
          destinationStorageLocation: sRecSLoc,
          costCenter: sCostCenter,
          assetNo: sAssetNo,
          subNumber: sSubNumber,
          transferOrder: sTanum,
          batch: sBatch,
          serials: sSerials,
          completeReservation,
          confMenge: data.confMenge || data.ConfirmedQuantity,
          processId
        });

        if (trackKey) {
          try {
            const resVer = migoRes.reservationVerification;
            const isCompletelyProcessed = resVer ? resVer.completelyProcessed === true : (completeReservation === true);
            const updateFields = {
              MaterialDocument: migoRes.materialDocument,
              MaterialDocYear: migoRes.materialDocYear,
              Status_code: STATUS.GI_POSTED,
              ErrorMessage: '',
              ErrorStep: ''
            };
            if (migoRes.businessKey) {
              updateFields.MigoBusinessKey = migoRes.businessKey;
            }
            if (resVer) {
              updateFields.WithdrawnQuantity = resVer.issuedQuantity;
              updateFields.RemainingQuantity = resVer.remainingQuantity;
              updateFields.CompletelyProcessed = isCompletelyProcessed;
            }
            await UPDATE(ReservationTrack)
              .set(updateFields)
              .where(trackKey);
            await log(ReservationLog, {
              ...trackKey, ProcessId: processId, DocumentNo: migoRes.materialDocument,
              Step: 'MIGO', Status: STATUS.GI_POSTED, MessageType: 'S', MessageId: 'M7', MessageNo: '060',
              MigoBusinessKey: migoRes.businessKey || '',
              MessageText: migoRes.alreadyPosted
                ? `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} already existed for process ${processId}; not posted again`
                : (isCompletelyProcessed
                    ? `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect}) - Reservation completely processed`
                    : `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect}) - Partial issue: remaining quantity ${resVer?.remainingQuantity ?? 'open'}`)
            });
            if (migoRes.warning) {
              if (req && typeof req.warn === 'function') req.warn(migoRes.warning);
              await log(ReservationLog, {
                ...trackKey, ProcessId: processId, DocumentNo: migoRes.materialDocument,
                Step: 'MIGO', Status: STATUS.GI_POSTED, MessageType: 'W', MessageId: 'L3', MessageNo: '001',
                MigoBusinessKey: migoRes.businessKey || '',
                MessageText: migoRes.warning
              });
            }
          } catch (dbErr) {
            console.warn('[trTo.handler] DB post-MIGO tracking update warning:', dbErr.message);
          }
        }

        return {
          ...result,
          success: true,
          Success: true,
          stage: 'MIGO',
          materialDocument: migoRes.materialDocument,
          materialDocumentYear: migoRes.materialDocumentYear || migoRes.materialDocYear,
          movementType: migoRes.movementType || sMvt,
          MaterialDocument: migoRes.materialDocument,
          MaterialDocYear: migoRes.materialDocYear,
          Status: STATUS.GI_POSTED,
          StatusText: STATUS_TEXT[STATUS.GI_POSTED],
          ReservationNo: migoRes.reservationNo || sResNo,
          Batch: migoRes.batch || sBatch,
          StockEffect: migoRes.stockEffect,
          alreadyPosted: Boolean(migoRes.alreadyPosted),
          AlreadyPosted: Boolean(migoRes.alreadyPosted),
          idempotentRetry: Boolean(migoRes.idempotentRetry),
          businessKey: migoRes.businessKey || '',
          BusinessKey: migoRes.businessKey || '',
          stockVerification: migoRes.stockVerification || null,
          reservationVerification: migoRes.reservationVerification || null,
          ReceivingTr: migoRes.receivingTr || null,
          Warning: migoRes.warning || '',
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
          success: false,
          Success: false,
          stage: 'MIGO',
          error: err.message,
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
        const trackedReservation = existing?.TransferRequirement && existing?.ReservationNo ? {
          TransferRequirement: existing.TransferRequirement,
          ReservationNo: existing.ReservationNo,
          ReservationItem: existing.ReservationItem,
          MovementType: existing.MovementType
        } : null;
        // SAP-side lock (feature flag, off by default) around the TO step only; a conflict leaves as 409.
        const lockKey = existing?.ReservationNo ? { rsnum: existing.ReservationNo, rspos: existing.ReservationItem } : null;
        const result = await withReservationLock(lockKey ? adapter.rfc : null, lockKey, (scopedRfc) =>
          (scopedRfc && adapter.withRfc ? adapter.withRfc(scopedRfc) : adapter).createTOFromTR({ ...data, trackedReservation }));
        result.ProcessId = processId;

        if (result.TransferOrder &&
            result.ReservationMovementType && result.MovementType &&
            result.ReservationMovementType !== result.MovementType) {
          await log(ReservationLog, {
            ReservationNo: result.ReservationNo || existing?.ReservationNo || '',
            ReservationItem: result.ReservationItem || existing?.ReservationItem || '',
            ProcessId: processId,
            DocumentNo: result.TransferOrder,
            Step: 'LT04',
            Status: result.Status || STATUS.TO_CREATED,
            MessageType: 'W',
            MessageText: `Linked reservation staging: TR movement ${result.MovementType}, reservation/MIGO movement ${result.ReservationMovementType}; verify the TR destination before processing.`
          });
        }

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

        // Auto-trigger MIGO only if both autoConfirm and autoPostMigo are on and the TO is confirmed successfully
        if (data.autoConfirm !== false && data.autoPostMigo && result.Confirmed && result.success !== false) {
          try {
            const confirmedQty = Number(result.ConfirmedQuantity != null && result.ConfirmedQuantity > 0 ? result.ConfirmedQuantity : result.Quantity);
            const effMvt = result.ReservationMovementType || data.ReservationMovementType || data.reservationMovementType || existing?.MovementType || result.MovementType || data.MovementType || data.movementType;
            const migoResult = await handlePostMigoGoodsMovement({
              user: req.user,
              data: {
                ReservationNo: existing?.ReservationNo || result.ReservationNo,
                ReservationItem: existing?.ReservationItem || result.ReservationItem,
                ReservationMovementType: result.ReservationMovementType || data.ReservationMovementType || data.reservationMovementType || '',
                TransferOrder: result.TransferOrder,
                Quantity: confirmedQty,
                confMenge: confirmedQty,
                Unit: result.Unit,
                MovementType: effMvt,
                Material: result.Material || existing?.Material || data.Material || data.material,
                Plant: existing?.Plant || result.Plant || data.Plant || data.plant,
                StorageLocation: existing?.StorageLocation || result.StorageLocation || data.StorageLocation || data.storageLocation,
                CostCenter: existing?.CostCenter || result.CostCenter || (result.Betyp === 'K' ? result.Benum : '') || data.CostCenter || data.costCenter,
                AssetNo: existing?.AssetNo || result.AssetNo || (result.Betyp === 'A' ? result.Benum : '') || data.AssetNo || data.assetNo,
                SubNumber: existing?.SubNumber || result.SubNumber || data.SubNumber || data.subNumber || (result.Betyp === 'A' ? '0000' : ''),
                ReceivingPlant: result.ReceivingPlant || data.ReceivingPlant || data.receivingPlant || existing?.ReceivingPlant || '',
                receivingPlant: result.ReceivingPlant || data.ReceivingPlant || data.receivingPlant || existing?.ReceivingPlant || '',
                ReceivingStorageLocation: result.ReceivingStorageLocation || data.ReceivingStorageLocation || data.receivingStorageLocation || existing?.ReceivingStorageLocation || '',
                receivingStorageLocation: result.ReceivingStorageLocation || data.ReceivingStorageLocation || data.receivingStorageLocation || existing?.ReceivingStorageLocation || '',
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
              result.Warning = migoResult.Warning || migoResult.warning || '';
              result.ReceivingTr = migoResult.ReceivingTr || migoResult.receivingTr || null;
              if (result.Warning && req && typeof req.warn === 'function') {
                req.warn(result.Warning);
              }
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

        result.ReceivingPlant = data.ReceivingPlant || data.receivingPlant || result.ReceivingPlant || existing?.ReceivingPlant || '';
        result.ReceivingStorageLocation = data.ReceivingStorageLocation || data.receivingStorageLocation || result.ReceivingStorageLocation || existing?.ReceivingStorageLocation || '';
        result.CostCenter = data.CostCenter || data.costCenter || result.CostCenter || existing?.CostCenter || '';
        result.AssetNo = data.AssetNo || data.assetNo || result.AssetNo || existing?.AssetNo || '';
        result.SubNumber = data.SubNumber || data.subNumber || result.SubNumber || existing?.SubNumber || '';

        if (result.success === false && result.stage === 'TO_CONFIRMATION') {
          result.confirmed = false;
          result.Confirmed = false;
          result.IsConfirmed = false;
          result.ConfirmationNumber = '';
          result.ConfirmedBy = '';
        } else {
          result.IsConfirmed = Boolean(result.Confirmed || result.Status === STATUS.TO_CONFIRMED || result.Status === STATUS.GI_POSTED);
          result.ConfirmationNumber = result.ConfirmationNumber || result.TransferOrder;
          result.ConfirmedBy = result.ConfirmedBy || (result.IsConfirmed ? userOf(req) : '');
        }

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

    const handleVerifyMaterialDocument = async (req) => {
      try {
        return await resProcessAdapter.verifyMaterialDocument(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    };

    const handleVerifyStock = async (req) => {
      try {
        return await resProcessAdapter.verifyStock(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    };

    const handleVerifyReservation = async (req) => {
      try {
        return await resProcessAdapter.verifyReservation(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    };

    const handleExecuteOrchestrator = async (req) => {
      try {
        const { ReservationTrack } = entities();
        const persistStatus = async (status, extra = {}) => {
          if (!ReservationTrack) return;
          const resNo = extra.reservationNumber || extra.reservationNo;
          const resItem = extra.reservationItem || '0001';
          if (!resNo) return;
          const sRes = String(resNo).padStart(10, '0');
          const sItem = String(resItem).padStart(4, '0');
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

          try {
            await UPDATE(ReservationTrack).set(updateData).where({ ReservationNo: sRes, ReservationItem: sItem });
          } catch (_) { /* ignore */ }
        };

        const result = await resProcessAdapter.executeReservationWarehouseFlow({
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
    };

    srv.on('createTOFromTR', handleCreateTOFromTR);
    srv.on('CreateTOFromTR', handleCreateTOFromTR);
    srv.on('postMigoGoodsMovement', handlePostMigoGoodsMovement);
    srv.on('PostMigoGoodsMovement', handlePostMigoGoodsMovement);
    srv.on('verifyMaterialDocument', handleVerifyMaterialDocument);
    srv.on('VerifyMaterialDocument', handleVerifyMaterialDocument);
    srv.on('verifyStock', handleVerifyStock);
    srv.on('VerifyStock', handleVerifyStock);
    srv.on('verifyResultingStock', handleVerifyStock);
    srv.on('VerifyResultingStock', handleVerifyStock);
    srv.on('verifyReservation', handleVerifyReservation);
    srv.on('VerifyReservation', handleVerifyReservation);
    srv.on('executeReservationWarehouseFlow', handleExecuteOrchestrator);
    srv.on('ExecuteReservationWarehouseFlow', handleExecuteOrchestrator);
  }
}

module.exports = TrToHandler;
