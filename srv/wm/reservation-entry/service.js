'use strict';

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssueAdapter = require('../../integration/s4hana/wm/GoodsIssueAdapter');
const { findUnconfirmedToItems } = require('../../integration/s4hana/wm/toState');
const { STATUS, STEP_ERROR, ERROR_STATUSES, UNCONFIRMED_TO } = require('../../common/wmStatus');
const { sapKey, sapKeyOpt } = require('../../integration/s4hana/sapKey');
const { withReservationLock, isLockConflict } = require('../../integration/s4hana/wm/resLock');
const LOG = cds.log('reservation-entry');

module.exports = class ReservationEntryService extends cds.ApplicationService {
  async init() {
    const { ReservationEntries, ReservationLogs } = this.entities;
    const adapter = new ReservationProcessAdapter();

    // Validation per movement type
    function validateMovementType(data, req) {
      const {
        MovementType,
        Plant,
        StorageLocation,
        Material,
        Quantity,
        ReceivingPlant,
        ReceivingStorageLocation,
        CostCenter,
        AssetNo
      } = data;

      if (!MovementType) req.error(400, 'MovementType is mandatory (201, 241, 311, 301)');
      if (!Plant) req.error(400, 'Plant is mandatory');
      if (!StorageLocation) req.error(400, 'StorageLocation is mandatory');
      if (!Material) req.error(400, 'Material is mandatory');
      if (!Quantity || Number(Quantity) <= 0) req.error(400, 'Quantity must be greater than 0');
      if (!data.Unit) req.error(400, 'Unit is mandatory');

      switch (MovementType) {
        case '201':
          if (!CostCenter || !String(CostCenter).trim()) {
            req.error(400, 'Cost Center is mandatory for Movement Type 201 (GI to Cost Center)');
          }
          break;
        case '241':
          if (!AssetNo || !String(AssetNo).trim()) {
            req.error(400, 'Asset Number is mandatory for Movement Type 241 (GI to Asset)');
          }
          break;
        case '311':
          if (!ReceivingStorageLocation || !String(ReceivingStorageLocation).trim()) {
            req.error(400, 'Receiving Storage Location is mandatory for Movement Type 311 (SLoc Transfer)');
          } else if (String(ReceivingStorageLocation).trim() === String(StorageLocation).trim()) {
            req.error(400, 'Receiving Storage Location must be different from Issuing Storage Location');
          }
          break;
        case '301':
          if (!ReceivingPlant || !String(ReceivingPlant).trim()) {
            req.error(400, 'Receiving Plant is mandatory for Movement Type 301 (Plant Transfer)');
          } else if (String(ReceivingPlant).trim() === String(Plant).trim()) {
            req.error(400, 'Receiving Plant must be different from Issuing Plant');
          }
          break;
        default:
          req.error(400, `Unsupported movement type '${MovementType}'. Valid movement types are: 201, 241, 311, 301`);
      }
    }

    /** Warehouse from the request, else from plant/storage location assignment (T320); never a literal. */
    async function warehouseFor(plant, sloc, given) {
      if (given) return sapKey(given, 'lgnum');
      const rows = await adapter.rfc.readTable('T320', ['LGNUM'], [`( WERKS = '${sapKey(plant, 'plant')}' AND LGORT = '${sapKey(sloc, 'lgort')}' )`], 1);
      const wh = rows?.[0]?.LGNUM?.trim();
      if (!wh) {
        const e = new Error(`No warehouse number assigned to plant ${plant} / storage location ${sloc} (T320)`);
        e.status = 400;
        throw e;
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
        ReceivingPlant,
        ReceivingStorageLocation,
        CostCenter,
        AssetNo,
        SubNumber,
        WarehouseNumber
      } = payload;

      // Task 8: SLoc pre-check at reservation creation: read LQUA for item's plant/SLoc.
      let slocWarning = '';
      if (Material && Plant && StorageLocation) {
        try {
          const wh = await warehouseFor(Plant, StorageLocation, WarehouseNumber);
          const matPadded = String(Material || '').trim().padStart(18, '0');
          const lquaCurrent = await adapter.rfc.readTable(
            'LQUA',
            ['LGTYP', 'LGPLA', 'VERME'],
            [
              `LGNUM = '${wh}'`,
              `AND MATNR = '${matPadded}'`,
              `AND WERKS = '${Plant}'`,
              `AND LGORT = '${StorageLocation}'`,
              "AND VERME > 0"
            ],
            10
          );
          const currentStock = (lquaCurrent || []).filter((q) => Number(String(q.VERME || 0).replace(/[^\d.-]/g, '')) > 0);
          if (!currentStock.length) {
            const lquaOther = await adapter.rfc.readTable(
              'LQUA',
              ['LGORT', 'VERME'],
              [
                `LGNUM = '${wh}'`,
                `AND MATNR = '${matPadded}'`,
                `AND WERKS = '${Plant}'`,
                "AND VERME > 0"
              ],
              100
            );
            const otherSlocs = [...new Set((lquaOther || []).map((r) => String(r.LGORT || '').trim()).filter(Boolean))];
            if (otherSlocs.length > 0) {
              slocWarning = `Storage location ${StorageLocation} has no WM stock for material ${Material} in warehouse ${wh}. Available in storage location(s): ${otherSlocs.join(', ')}.`;
            } else {
              slocWarning = `Material ${Material} has no WM stock in warehouse ${wh} (plant ${Plant}).`;
            }
            if (req && typeof req.warn === 'function') {
              req.warn(slocWarning);
            }
          }
        } catch (preErr) {
          LOG.warn(`SLoc pre-check failed for material ${Material}: ${preErr.message}`);
        }
      }

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
          receivingPlant: ReceivingPlant || (MovementType === '311' ? Plant : undefined),
          receivingStorageLocation: ReceivingStorageLocation,
          costCenter: CostCenter,
          assetNo: AssetNo,
          subNumber: SubNumber
        });
      } catch (err) {
        return req.error(err.status || 500, `Failed to create reservation: ${err.message}`);
      }

      const resNo = resResult.reservationNoRaw || String(resResult.reservationNo).padStart(10, '0');
      const resItem = resResult.reservationItem || '0001';
      const extId = `${resNo}/${resItem}`;

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
        slg1Log = { logHandle: `LOG_${Date.now().toString(36).toUpperCase()}` };
      }
      const sLogHandle = slg1Log?.logHandle || '';

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
        MessageText: `Reservation ${resNo} created via BAPI_RESERVATION_CREATE1`
      });

      // Step 1b: Persist tracking row immediately with RSNUM as soon as SAP returns it
      const initialTrackRecord = {
        ReservationNo: resNo,
        ReservationItem: resItem,
        MovementType,
        WarehouseNumber: WarehouseNumber || '',
        Plant,
        StorageLocation,
        Material,
        MaterialName: MaterialName || '',
        Quantity: Number(Quantity),
        Unit,
        ReceivingPlant: ReceivingPlant || '',
        ReceivingStorageLocation: ReceivingStorageLocation || '',
        CostCenter: CostCenter || '',
        AssetNo: AssetNo || '',
        SubNumber: SubNumber || '',
        TransferRequirement: '',
        LogHandle: sLogHandle,
        ExternalId: extId,
        Status_code: STATUS.RES_CREATED,
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

      // Step 2: Auto-create Transfer Requirement (background/immediate step)
      let trNumber = '';
      let currentStatus = STATUS.RES_CREATED;
      let trError = null;
      let determinedWh = '';

      try {
        determinedWh = await warehouseFor(Plant, StorageLocation, WarehouseNumber);
        const trResult = await adapter.createTransferRequirement({
          warehouseNumber: determinedWh,
          wmMovementType: MovementType,
          movementType: MovementType,
          isTransferPosting: MovementType === '311' || MovementType === '301',
          material: Material,
          plant: Plant,
          storageLocation: StorageLocation,
          quantity: Quantity,
          unit: Unit,
          reservationNo: resNo,
          reservationItem: resItem,
          costCenter: CostCenter,
          assetNo: AssetNo,
          subNumber: SubNumber
        });

        trNumber = trResult.trNumberRaw || String(trResult.trNumber).padStart(10, '0');
        currentStatus = STATUS.TR_CREATED;

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
          WarehouseNumber: determinedWh || WarehouseNumber || '',
          TransferRequirement: trNumber,
          Status_code: STATUS.TR_CREATED,
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
          MessageType: 'S',
          MessageId: 'L3',
          MessageNo: '001',
          MessageText: `Transfer Requirement ${trNumber} auto-created via L_TR_CREATE`
        });
      } catch (err) {
        // Reservation exists but the backend created no TR: status 11 (TR error), a backend issue to fix in SAP.
        currentStatus = STATUS.TR_ERROR;
        trError = `TR creation failed in SAP backend: ${err.message}`;

        await UPDATE(ReservationEntries).set({
          WarehouseNumber: determinedWh || WarehouseNumber || '',
          Status_code: STATUS.TR_ERROR,
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
          adapter.rfc.readTable('RKPF', ['BWART', 'KOSTL', 'ANLN1', 'ANLN2', 'UMWRK', 'UMLGO', 'USNAM'], [`RSNUM = '${s4Rsnum}'`], 1),
          adapter.rfc.readTable('RESB', ['MATNR', 'WERKS', 'LGORT', 'BDMNG', 'MEINS', 'CHARG', 'KZEAR'], [`RSNUM = '${s4Rsnum}'`, `AND RSPOS = '${s4Rspos}'`], 1)
        ]);
        const h = rkpf && rkpf[0];
        const i = resb && resb[0];
        if (!i) return null;
        const closed = String(i.KZEAR || '').trim() === 'X';
        const sMat = strip(i.MATNR);
        const sMatPad = String(i.MATNR).padStart(18, '0');

        let matName = '';
        try {
          const makt = await adapter.rfc.readTable('MAKT', ['MAKTX'], [`MATNR = '${sMatPad}'`, `AND SPRAS = 'E'`], 1);
          matName = (makt && makt[0]?.MAKTX) || '';
        } catch (_mErr) {}

        let existingTr = '';
        try {
          const ltbk = await adapter.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'STATU'], [`RSNUM = '${s4Rsnum}'`], 1);
          existingTr = (ltbk || []).find((r) => r.TBNUM && r.STATU !== 'E')?.TBNUM || '';
        } catch (_trErr) {}

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
          Quantity: Number(i.BDMNG) || 0,
          Unit: String(i.MEINS || '').trim(),
          Batch: String(i.CHARG || '').trim(),
          CostCenter: String((h && h.KOSTL) || '').trim(),
          AssetNo: strip((h && h.ANLN1) || ''),
          SubNumber: String((h && h.ANLN2) || '').trim(),
          WarehouseNumber: await warehouseFor(i.WERKS, i.LGORT, '').catch(() => ''),
          Status_code: statusCode,
          StatusText: statusText,
          TransferRequirement: existingTr ? String(existingTr).replace(/^0+/, '') : '',
          TransferOrder: '',
          MaterialDocument: '',
          MaterialDocYear: '',
          ErrorMessage: '',
          ExternalId: `${strip(resNo)}/${s4Rspos}`,
          LogHandle: ''
        };
      } catch (_e) {
        return null;
      }
    };

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
        if (result) return result;

        const sClean = String(keyResNo).trim().replace(/^0+/, '');
        const sPadded = sClean.padStart(10, '0');
        const altKey = keyResNo === sPadded ? sClean : sPadded;

        const altEntry = await SELECT.one.from(ReservationEntries).where({
          ReservationNo: altKey,
          ReservationItem: keyResItem
        });
        if (altEntry) return altEntry;

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

      return result;
    });

    /** Goods movement for a tracked reservation item (step MIGO). Shares one adapter path with tr-to. */
    async function postMigoForTrack(track, data, req, { sLogHandle, extId, subObject }) {
      const sResNo = track.ReservationNo;
      const sResItem = track.ReservationItem;
      const key = { ReservationNo: sResNo, ReservationItem: sResItem };
      const sMvt = data.MovementType || track.MovementType;
      const sPlant = data.Plant || track.Plant;
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
        reservationItem: sResItem,
        movementType: sMvt,
        material: data.Material || track.Material,
        plant: sPlant,
        storageLocation: data.StorageLocation || track.StorageLocation,
        quantity: data.Quantity != null ? data.Quantity : track.Quantity,
        unit: data.Unit || track.Unit,
        receivingPlant: data.ReceivingPlant || track.ReceivingPlant,
        receivingStorageLocation: data.ReceivingStorageLocation || track.ReceivingStorageLocation,
        costCenter: data.CostCenter || track.CostCenter,
        assetNo: data.AssetNo || track.AssetNo,
        subNumber: data.SubNumber || track.SubNumber,
        transferOrder: track.TransferOrder || '',
        batch: data.Batch || data.batch || track.Batch || '',
        serials: data.Serials || data.serials || (data.SerialNo ? [data.SerialNo] : (track.SerialNo ? [track.SerialNo] : [])),
        completeReservation: data.CompleteReservation === true,
        processId
      });
      });

      await UPDATE(ReservationEntries).set({
        MaterialDocument: migoRes.materialDocument,
        MaterialDocYear: migoRes.materialDocYear,
        Status_code: STATUS.GI_POSTED,
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
          : `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect})`
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
            adapter.rfc.readTable('RKPF', ['RSNUM', 'BWART', 'KOSTL', 'ANLN1', 'ANLN2', 'USNAM'], [`RSNUM = '${s4Rsnum}'`], 1),
            adapter.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'MEINS'], [`RSNUM = '${s4Rsnum}'`, `AND RSPOS = '${s4Rspos}'`], 1)
          ]);
          if (resbRows && resbRows[0]) {
            existing = {
              ReservationNo: sResNo,
              ReservationItem: sResItem,
              MovementType: rkpfRows?.[0]?.BWART || data.MovementType || '',
              CostCenter: rkpfRows?.[0]?.KOSTL || data.CostCenter || '',
              AssetNo: rkpfRows?.[0]?.ANLN1 || data.AssetNo || '',
              SubNumber: rkpfRows?.[0]?.ANLN2 || data.SubNumber || '',
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

      try {
        const migoRes = await postMigoForTrack(existing, data, req, { sLogHandle, extId, subObject: 'PROCESS' });
        const updated = await SELECT.one.from(ReservationEntries).where(key);
        return updated || { ...key, MaterialDocument: migoRes.materialDocument, MaterialDocYear: migoRes.materialDocYear, Status_code: STATUS.GI_POSTED };
      } catch (err) {
        if (isLockConflict(err)) throw err;
        // Rollback already executed by adapter; status 90 (GI error, retryable) and log
        await UPDATE(ReservationEntries).set({
          Status_code: STATUS.GI_ERROR,
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

      // Auto-detect step if not specified: the failed step's status, else the next open step
      if (!requestedStep || requestedStep === 'AUTO') {
        const byStatus = { [STATUS.TR_ERROR]: 'LB01', [STATUS.TO_ERROR]: 'LT04', [STATUS.TO_CONFIRM_ERROR]: 'LT12', [STATUS.GI_ERROR]: 'MIGO' }[track.Status_code];
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
              isTransferPosting: track.MovementType === '311' || track.MovementType === '301',
              material: track.Material,
              plant: track.Plant,
              storageLocation: track.StorageLocation,
              quantity: track.Quantity,
              unit: track.Unit,
              reservationNo: sResNo,
              reservationItem: sResItem,
              costCenter: track.CostCenter,
              assetNo: track.AssetNo,
              subNumber: track.SubNumber
            });

            if (trResult.warning) {
              req?.warn?.(200, trResult.warning);
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
            MessageText: `Retry successful: Transfer Requirement ${trNo} created via L_TR_CREATE` });
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
      return live;
    });

    // All open reservations, read live from SAP S/4HANA (reuses the proven open-reservations reader).
    this.on('getOpenReservations', async (req) => {
      const plant = String(req.data.plant || '').trim();
      const mvt = String(req.data.movementType || '').trim();
      try {
        const rows = await GoodsIssueAdapter.getOpenReservations(mvt, plant);
        return (rows || []).map((r) => ({
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

    return super.init();
  }
};
