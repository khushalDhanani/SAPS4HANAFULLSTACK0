const cds = require('@sap/cds');
const TrToAdapter = require('../../../integration/s4hana/wm/TrToAdapter');
const ReservationProcessAdapter = require('../../../integration/s4hana/wm/ReservationProcessAdapter');
const { STATUS, STATUS_TEXT } = require('../../../common/wmStatus');
const { sapKey, sapKeyOpt } = require('../../../integration/s4hana/sapKey');
const { withReservationLock } = require('../../../integration/s4hana/wm/resLock');
const { assertPlantsInScope, plantScope, isPlantAllowed } = require('../../readScope');

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Thin CAP binding; all validation lives in TrToAdapter and ReservationProcessAdapter. */
class TrToHandler {
  static init(srv, options = {}) {
    const adapter = options.adapter || new TrToAdapter();
    const resProcessAdapter = options.resProcessAdapter || new ReservationProcessAdapter();

    const run = (fn) => async (req) => {
      try {
        return await fn(req.data || {}, req);
      } catch (err) {
        if (err.details) {
          return req.error({
            code: String(err.status || 500),
            status: err.status || 500,
            message: err.message || 'SAP S/4HANA request failed',
            details: err.details
          });
        }
        return req.error(err.status || 500, err.message || 'SAP S/4HANA request failed');
      }
    };

    const isAdmin = (req) => plantScope(req?.user) === null;

    /** A document outside the user's plants answers like one that does not exist, whichever warehouse the request names. */
    const inScopeOr404 = (req, doc, plants) => {
      const allowed = plantScope(req?.user);
      if (allowed === null) return doc;
      const known = plants.filter(Boolean);
      if (!known.length || known.some((plant) => !isPlantAllowed(plant, allowed))) throw httpError(404, 'TR not found in any warehouse');
      return doc;
    };
    const itemPlants = (doc) => [doc?.Plant, ...(doc?.Items || []).map((item) => item.Plant)];

    /** A non-Admin must name a plant of their own: without one, the read is not limited to a plant. */
    const assertPlantParam = (req, plant) => {
      if (isAdmin(req)) return;
      if (!isPlantAllowed(plant, plantScope(req?.user))) {
        throw httpError(403, `Plant ${plant || '(none)'} is outside the authenticated user's plant scope`);
      }
    };

    srv.on('getOpenTRs', run(async ({ lgnum, mvt }, req) => {
      if (lgnum && !isAdmin(req)) await adapter.assertWarehouseInScope(lgnum, req.user);
      return adapter.getOpenTRs(lgnum, mvt, req?.user);
    }));
    srv.on('getTR', run(async ({ tbnum, lgnum }, req) => {
      const tr = await adapter.getTR(tbnum, lgnum);
      return inScopeOr404(req, tr, itemPlants(tr));
    }));
    srv.on('lookupTR', run(async ({ tbnum, lgnum, docType, tbpos }, req) => {
      const tr = await adapter.lookupTR(tbnum, lgnum, docType, tbpos, req?.user);
      return inScopeOr404(req, tr, itemPlants(tr));
    }));
    srv.on('getFifoBatches', run(async ({ material, plant, storageLocation, warehouseNumber }, req) => {
      assertPlantParam(req, plant);
      if (warehouseNumber && !isAdmin(req)) await adapter.assertWarehouseInScope(warehouseNumber, req.user);
      return adapter.getFifoBatches(material, plant, storageLocation, warehouseNumber);
    }));
    srv.on('getAvailableSerials', run(({ material, plant, storageLocation, batch }, req) => {
      assertPlantParam(req, plant);
      return adapter.getAvailableSerials(material, plant, storageLocation, batch);
    }));

    // Confirm the authenticated CAP user; never expose the technical RFC account in an API response.
    const userOf = (req) => req.user?.id || '';

    // Step 3 Service (MIGO Goods Movement Posting & Retry)
    const handlePostMigoGoodsMovement = async (req) => {
      const data = req.data || {};

      const sResNoIn = sapKeyOpt(data.ReservationNo || data.reservationNumber || data.reservationNo, 'rsnum');
      const sTanumIn = sapKeyOpt(data.TransferOrder || data.transferOrder, 'tanum');
      const movementAliases = ['MovementType', 'movementType', 'ReservationMovementType', 'reservationMovementType']
        .filter((key) => data[key] !== undefined && data[key] !== null)
        .map((key) => String(data[key]).trim());
      const sMvt = movementAliases[0] || '';
      if (!sMvt || movementAliases.some((mvt) => mvt !== sMvt) || !['201', '241', '261', '301', '311'].includes(sMvt)) {
        throw httpError(400, 'MovementType is required and aliases must exactly match one supported type (201, 241, 261, 301, 311)');
      }
      if (!sResNoIn && !sTanumIn && sMvt !== '311' && sMvt !== '301') {
        throw httpError(400, 'ReservationNo or TransferOrder is required');
      }
      const sResItemIn = sapKeyOpt(data.ReservationItem || data.reservationItem, 'rspos');

      const sResNo = sResNoIn || '';
      const sResItem = sResItemIn || '0001';
      let sMat = data.Material || data.material;
      let sPlant = data.Plant || data.plant || data.sourcePlant || data.SourcePlant;
      let sSLoc = data.StorageLocation || data.storageLocation || data.sourceStorageLocation || data.SourceStorageLocation;
      const nQty = data.Quantity != null ? data.Quantity : data.quantity;
      const sUnit = data.Unit || data.unit;
      let sRecPlant = data.ReceivingPlant || data.receivingPlant || data.destinationPlant || data.DestinationPlant;
      let sRecSLoc = data.ReceivingStorageLocation || data.receivingStorageLocation || data.destinationStorageLocation || data.DestinationStorageLocation;
      let sCostCenter = data.CostCenter || data.costCenter;
      let sAssetNo = data.AssetNo || data.assetNo;
      let sSubNumber = data.SubNumber || data.subNumber;
      let sOrderId = data.OrderID || data.orderId || data.OrderNo || data.orderNo;
      const sTanum = sTanumIn || '';
      let sBatch = data.Batch || data.batch || '';
      const sSerials = data.Serials || data.serials || (data.SerialNo ? [data.SerialNo] : []);
      const completeReservation = data.CompleteReservation === true || data.completeReservation === true;

      // Resilient destination/account resolution from TO (LTAK -> LTAP -> RESB/RKPF) if missing on untracked records
      if (sTanum && resProcessAdapter.rfc) {
        // The confirmation and double-posting checks depend on these reads: if SAP cannot answer, do not post.
        const guardReadFailed = (what) => (err) => {
          throw Object.assign(httpError(503, `Could not read ${what} to rule out a double posting: ${err.message}. The goods movement was not posted.`), { failClosed: true });
        };
        try {
          const ltakRows = await resProcessAdapter.rfc.readTable('LTAK', ['LGNUM', 'TBNUM', 'RSNUM', 'BWLVS', 'KQUIT'], [`TANUM = '${sTanum.padStart(10, '0')}'`], 1)
            .catch(guardReadFailed(`Transfer Order ${sTanum}`));
          if (ltakRows?.[0]) {
            if (ltakRows[0].KQUIT !== undefined && ltakRows[0].KQUIT !== null && ltakRows[0].KQUIT.trim() === '') {
              throw httpError(400, `Transfer Order ${sTanum} is not confirmed in SAP (LTAK-KQUIT is blank). TO must be confirmed before posting MIGO goods movement.`);
            }
            const tbnum = ltakRows[0].TBNUM?.trim();
            // Never post a second goods movement for a TR that SAP created from an already posted material document.
            if (tbnum && ltakRows[0].LGNUM?.trim() && typeof adapter.getTR === 'function') {
              const trHeader = await adapter.getTR(tbnum, ltakRows[0].LGNUM.trim()).catch(guardReadFailed(`Transfer Requirement ${tbnum}`));
              if (trHeader?.Mblnr && String(trHeader.Mblnr).trim()) {
                throw httpError(409, `Transfer Requirement ${tbnum} was created by material document ${String(trHeader.Mblnr).trim()}: the goods movement is already posted in SAP; MIGO is not allowed.`);
              }
            }
            const rsnumRaw = ltakRows[0].RSNUM?.trim();
            const rsnum = rsnumRaw ? sapKey(rsnumRaw, 'rsnum').padStart(10, '0') : '';
            if (ltakRows[0].BWLVS?.trim() && ltakRows[0].BWLVS.trim() !== sMvt) {
              throw httpError(400, `Transfer Order WM movement ${ltakRows[0].BWLVS.trim()} does not exactly equal requested MovementType ${sMvt}; Goods Issue was not posted.`);
            }
            if (rsnum && rsnum !== '0000000000') {
              const resbRows = await resProcessAdapter.rfc.readTable('RESB', ['BWART', 'UMWRK', 'UMLGO', 'CHARG'], [`RSNUM = '${rsnum}'`], 1);
              if (resbRows?.[0]) {
                const resbMvt = resbRows[0].BWART?.trim();
                if (resbMvt && resbMvt !== sMvt) {
                  throw httpError(400, `Reservation BWART ${resbMvt} does not exactly equal requested MovementType ${sMvt}; Goods Issue was not posted.`);
                }
                if (!sRecPlant && resbRows[0].UMWRK?.trim()) sRecPlant = resbRows[0].UMWRK.trim();
                if (!sRecSLoc && resbRows[0].UMLGO?.trim()) sRecSLoc = resbRows[0].UMLGO.trim();
                if (!sBatch && resbRows[0].CHARG?.trim()) sBatch = resbRows[0].CHARG.trim().toUpperCase();
              }
              if (!sCostCenter || !sAssetNo || !sOrderId) {
                const rkpfRows = await resProcessAdapter.rfc.readTable('RKPF', ['KOSTL', 'ANLN1', 'ANLN2', 'AUFNR'], [`RSNUM = '${rsnum}'`], 1);
                if (rkpfRows?.[0]) {
                  if (!sCostCenter && rkpfRows[0].KOSTL?.trim()) sCostCenter = rkpfRows[0].KOSTL.trim();
                  if (!sAssetNo && rkpfRows[0].ANLN1?.trim()) {
                    sAssetNo = rkpfRows[0].ANLN1.trim();
                    sSubNumber = rkpfRows[0].ANLN2?.trim() || '0000';
                  }
                  if (!sOrderId && rkpfRows[0].AUFNR?.trim()) {
                    sOrderId = rkpfRows[0].AUFNR.trim();
                  }
                }
              }
            } else if (tbnum && (!sRecPlant || !sRecSLoc || !sCostCenter || !sAssetNo || !sOrderId)) {
              const ltbkRows = await resProcessAdapter.rfc.readTable('LTBK', ['RSNUM', 'BETYP', 'BENUM', 'MBLNR', 'MJAHR'], [`TBNUM = '${tbnum}'`], 1);
              if (ltbkRows?.[0]?.BETYP === 'K' && !sCostCenter) {
                sCostCenter = ltbkRows[0].BENUM?.trim();
              } else if (ltbkRows?.[0]?.BETYP === 'A' && !sAssetNo) {
                sAssetNo = ltbkRows[0].BENUM?.trim();
                if (!sSubNumber) sSubNumber = '0000';
              } else if (ltbkRows?.[0]?.BETYP === 'F' && !sOrderId) {
                sOrderId = ltbkRows[0].BENUM?.trim();
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
          if (_lookupErr.status === 400 || _lookupErr.status === 409 || _lookupErr.failClosed) throw _lookupErr;
          console.warn('[trTo.handler] TransferOrder metadata lookup note:', _lookupErr.message);
        }
      }
      const requiredFields = [[sMvt, 'MovementType'], [sPlant, 'Plant']];
      if (sMvt !== '311' && sMvt !== '301') {
        requiredFields.push([sMat, 'Material'], [nQty, 'Quantity'], [sUnit, 'Unit']);
      }
      for (const [v, label] of requiredFields) {
        if (!v) throw httpError(400, `${label} is required (not in the request)`);
      }
      // The reservation or transfer order decides the plant in SAP; the named plant is checked too because it is posted.
      await assertPlantsInScope(req.user, async () => {
        const plants = [sPlant];
        if (sResNo) {
          const rows = await resProcessAdapter.rfc.readTable('RESB', ['WERKS'], [`RSNUM = '${sapKey(sResNo, 'rsnum').padStart(10, '0')}'`, `AND RSPOS = '${sapKey(sResItem, 'rspos').padStart(4, '0')}'`]);
          plants.push(rows[0]?.WERKS);
        }
        if (sTanum) {
          const rows = await resProcessAdapter.rfc.readTable('LTAP', ['WERKS'], [`TANUM = '${sapKey(sTanum, 'tanum').padStart(10, '0')}'`]);
          plants.push(rows[0]?.WERKS);
        }
        return plants;
      }, sResNo ? `reservation ${sResNo}` : (sTanum ? `Transfer Order ${sTanum}` : `plant ${sPlant}`));

      // PROCESS_ID of this GI step: a retry sends the same id, so an already posted document is found, never posted twice.
      const processId = data.ProcessId || cds.utils.uuid();

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
          orderId: sOrderId,
          OrderID: sOrderId,
          transferOrder: sTanum,
          batch: sBatch,
          serials: sSerials,
          completeReservation,
          confMenge: data.confMenge || data.ConfirmedQuantity,
          deliveryNumber: data.deliveryNumber || data.DeliveryNumber || undefined,
          DeliveryNumber: data.deliveryNumber || data.DeliveryNumber || undefined,
          processId
        });

        const delivNo = migoRes.deliveryNumber || migoRes.DeliveryNumber || '';
        const matDocNo = migoRes.materialDocument || migoRes.MaterialDocument || '';
        const isDocConfirmed = Boolean(matDocNo);

        return {
          ...result,
          success: isDocConfirmed,
          Success: isDocConfirmed,
          stage: 'MIGO',
          materialDocument: matDocNo,
          materialDocumentYear: migoRes.materialDocumentYear || migoRes.materialDocYear || '',
          movementType: migoRes.movementType || sMvt,
          MovementType: migoRes.movementType || sMvt,
          MaterialDocument: matDocNo,
          MaterialDocYear: migoRes.materialDocYear || '',
          DeliveryNumber: delivNo,
          deliveryNumber: delivNo,
          Status: isDocConfirmed ? STATUS.GI_POSTED : STATUS.GI_ERROR,
          StatusText: isDocConfirmed ? STATUS_TEXT[STATUS.GI_POSTED] : STATUS_TEXT[STATUS.GI_ERROR],
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
          Message: isDocConfirmed
            ? (delivNo
                ? `PGI posted for Outbound Delivery ${delivNo}; Material Document ${matDocNo}/${migoRes.materialDocYear || ''} confirmed in SAP.`
                : (migoRes.alreadyPosted
                    ? `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} already existed for this process step; not posted again.`
                    : `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} posted successfully.`))
            : `Outbound Delivery ${delivNo} created, but Material Document not confirmed in SAP. Goods issue pending.`,
          ErrorStep: '',
          ErrorMessage: ''
        };
      } catch (err) {
        // Rollback executed by the adapter; status 90 (GI error, retryable)
        const failedDeliveryNo = err.deliveryNumber || err.DeliveryNumber || '';
        return {
          ...result,
          success: false,
          Success: false,
          stage: 'MIGO',
          error: err.message,
          MaterialDocument: '',
          MaterialDocYear: '',
          DeliveryNumber: failedDeliveryNo,
          deliveryNumber: failedDeliveryNo,
          Status: STATUS.GI_ERROR,
          StatusText: STATUS_TEXT[STATUS.GI_ERROR],
          StockEffect: '',
          Message: failedDeliveryNo
            ? (err.stage === 'PGI' ? err.message : `PGI failed for Outbound Delivery ${failedDeliveryNo}: ${err.message}`)
            : `Goods movement failed: ${err.message}`,
          ErrorStep: 'MIGO',
          ErrorMessage: err.message
        };
      }
      });
    };

    // Step 2: Create TO from TR + Auto Confirm + Optional Auto MIGO
    const handleCreateTOFromTR = async (req) => {
      const data = req.data || {};
      const autoPostMovementAliases = ['MovementType', 'movementType', 'ReservationMovementType', 'reservationMovementType']
        .filter((key) => data[key] !== undefined && data[key] !== null)
        .map((key) => String(data[key]).trim());
      const requestedAutoPostMovementType = autoPostMovementAliases[0] || '';
      if (data.autoPostMigo && (!requestedAutoPostMovementType || autoPostMovementAliases.some((mvt) => mvt !== requestedAutoPostMovementType) || !['201', '241', '261', '301', '311'].includes(requestedAutoPostMovementType))) {
        throw httpError(400, 'MovementType is required for autoPostMigo and aliases must exactly match one supported type (201, 241, 261, 301, 311)');
      }
      const wh = sapKeyOpt(data.lgnum || data.WarehouseNumber || data.warehouseNumber, 'lgnum');
      const trToCheck = data.tbnum || data.trNumber || data.TRNumber;
      if (trToCheck) {
        await assertPlantsInScope(req.user, async () => ((await adapter.getTR(trToCheck, wh)).Items || []).map((i) => i.Plant), `Transfer Requirement ${trToCheck}`);
      }

      const processId = cds.utils.uuid();

      try {
        // SAP-side lock (feature flag, off by default) around the TO step only; a conflict leaves as 409.
        const lockRsnum = sapKeyOpt(data.ReservationNo || data.reservationNo, 'rsnum');
        const lockKey = lockRsnum ? { rsnum: lockRsnum, rspos: sapKeyOpt(data.ReservationItem || data.reservationItem, 'rspos') || '0001' } : null;
        const result = await withReservationLock(lockKey ? adapter.rfc : null, lockKey, (scopedRfc) =>
          (scopedRfc && adapter.withRfc ? adapter.withRfc(scopedRfc) : adapter).createTOFromTR({ ...data, trackedReservation: null }));
        result.ProcessId = processId;

        // A TR created by an already posted material document needs no MIGO: posting again would move the stock twice.
        if (result.GoodsMovementPosted && data.autoPostMigo && result.Confirmed && result.success !== false) {
          result.MigoSkipped = true;
          result.Message = `${result.Message ? result.Message + ' ' : ''}Goods movement already posted in SAP as material document ${result.MaterialDocument}; no MIGO posted.`;
        }
        // Auto-trigger MIGO only if both autoConfirm and autoPostMigo are on and the TO is confirmed successfully
        if (data.autoConfirm !== false && data.autoPostMigo && result.Confirmed && result.success !== false && !result.GoodsMovementPosted) {
          try {
            const confirmedQty = Number(result.ConfirmedQuantity != null && result.ConfirmedQuantity > 0 ? result.ConfirmedQuantity : result.Quantity);
            const effMvt = requestedAutoPostMovementType;
            const migoResult = await handlePostMigoGoodsMovement({
              user: req.user,
              data: {
                ReservationNo: (result.ReservationNo && result.ReservationNo !== '0' ? result.ReservationNo : '') || (data.ReservationNo && data.ReservationNo !== '0' ? data.ReservationNo : '') || data.reservationNo,
                ReservationItem: (result.ReservationItem && result.ReservationItem !== '0' ? result.ReservationItem : '') || data.ReservationItem || data.reservationItem || '1',
                ReservationMovementType: requestedAutoPostMovementType,
                TransferOrder: result.TransferOrder,
                Quantity: confirmedQty,
                confMenge: confirmedQty,
                Unit: result.Unit,
                MovementType: effMvt,
                Material: result.Material || data.Material || data.material,
                Plant: result.Plant || data.Plant || data.plant,
                StorageLocation: result.StorageLocation || data.StorageLocation || data.storageLocation,
                CostCenter: result.CostCenter || (result.Betyp === 'K' ? result.Benum : '') || data.CostCenter || data.costCenter,
                AssetNo: result.AssetNo || (result.Betyp === 'A' ? result.Benum : '') || data.AssetNo || data.assetNo,
                SubNumber: result.SubNumber || data.SubNumber || data.subNumber || (result.Betyp === 'A' ? '0000' : ''),
                OrderID: result.OrderID || (result.Betyp === 'F' ? result.Benum : '') || data.OrderID || data.orderId,
                orderId: result.OrderID || (result.Betyp === 'F' ? result.Benum : '') || data.OrderID || data.orderId,
                ReceivingPlant: result.ReceivingPlant || data.ReceivingPlant || data.receivingPlant || '',
                receivingPlant: result.ReceivingPlant || data.ReceivingPlant || data.receivingPlant || '',
                ReceivingStorageLocation: result.ReceivingStorageLocation || data.ReceivingStorageLocation || data.receivingStorageLocation || '',
                receivingStorageLocation: result.ReceivingStorageLocation || data.ReceivingStorageLocation || data.receivingStorageLocation || '',
                Batch: result.Batch || data.batch || '',
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
              result.MovementType = migoResult.MovementType || migoResult.movementType || result.ReservationMovementType || result.MovementType || '';
              result.Warning = migoResult.Warning || migoResult.warning || '';
              result.ReceivingTr = migoResult.ReceivingTr || migoResult.receivingTr || null;
              if (result.Warning && req && typeof req.warn === 'function') {
                req.warn(result.Warning);
              }
              result.DeliveryNumber = migoResult.DeliveryNumber || migoResult.deliveryNumber || '';
              result.deliveryNumber = result.DeliveryNumber;
              result.Message = `Transfer Order ${result.TransferOrder} confirmed and Material Document ${migoResult.MaterialDocument} posted successfully${result.DeliveryNumber ? ` via Delivery ${result.DeliveryNumber}` : ''}.`;
            } else if (migoResult && (migoResult.deliveryNumber || migoResult.DeliveryNumber) && !migoResult.MaterialDocument) {
              const deliv = migoResult.deliveryNumber || migoResult.DeliveryNumber;
              result.Status = STATUS.GI_ERROR;
              result.StatusText = 'Delivery Created - PGI Pending';
              result.DeliveryNumber = deliv;
              result.deliveryNumber = deliv;
              result.MaterialDocument = '';
              result.MaterialDocYear = '';
              result.ErrorStep = 'MIGO';
              const sapReason = migoResult.ErrorMessage || migoResult.error || '';
              result.ErrorMessage = sapReason || `Outbound Delivery ${deliv} created, but Material Document not confirmed in SAP. Goods issue pending.`;
              result.Warning = migoResult.Warning || migoResult.warning || '';
              result.Message = `Transfer Order ${result.TransferOrder} confirmed; Outbound Delivery ${deliv} created, but Goods Issue (PGI) is pending${sapReason ? `: ${sapReason}` : '. Material Document not confirmed.'}`;
              if (result.Warning && req && typeof req.warn === 'function') {
                req.warn(result.Warning);
              }
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

        result.ReceivingPlant = data.ReceivingPlant || data.receivingPlant || result.ReceivingPlant || '';
        result.ReceivingStorageLocation = data.ReceivingStorageLocation || data.receivingStorageLocation || result.ReceivingStorageLocation || '';
        result.CostCenter = data.CostCenter || data.costCenter || result.CostCenter || '';
        result.AssetNo = data.AssetNo || data.assetNo || result.AssetNo || '';
        result.SubNumber = data.SubNumber || data.subNumber || result.SubNumber || '';
        result.OrderID = data.OrderID || data.orderId || (result.Betyp === 'F' ? result.Benum : '') || result.OrderID || '';

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
        return req.error(err.status || 400, err.message || 'CreateTOFromTR failed');
      }
    };

    const handleVerifyMaterialDocument = async (req) => {
      try {
        assertPlantParam(req, req.data?.plant);
        return await resProcessAdapter.verifyMaterialDocument(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    };

    const handleVerifyStock = async (req) => {
      try {
        assertPlantParam(req, req.data?.plant);
        return await resProcessAdapter.verifyStock(req.data || {});
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    };

    const handleVerifyReservation = async (req) => {
      try {
        const res = await resProcessAdapter.verifyReservation(req.data || {});
        return inScopeOr404(req, res, [res?.plant]);
      } catch (err) {
        return req.error(err.status || 400, err.message);
      }
    };

    const handleExecuteOrchestrator = async (req) => {
      try {
        const result = await resProcessAdapter.executeReservationWarehouseFlow({ ...req.data });
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
    srv.on('verifyStock', handleVerifyStock);
    srv.on('verifyReservation', handleVerifyReservation);
    srv.on('executeReservationWarehouseFlow', handleExecuteOrchestrator);
  }
}

module.exports = TrToHandler;
