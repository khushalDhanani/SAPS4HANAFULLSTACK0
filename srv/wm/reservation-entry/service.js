'use strict';

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../integration/s4hana/wm/ReservationProcessAdapter');

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
        WarehouseNumber = 'W01'
      } = payload;

      let resResult;
      try {
        // Step 1: Create Reservation via BAPI_RESERVATION_CREATE1
        resResult = await adapter.createReservation({
          movementType: MovementType,
          plant: Plant,
          storageLocation: StorageLocation,
          material: Material,
          quantity: Quantity,
          unit: Unit || 'KG',
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
          status: '01',
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
        Status: '01',
        MessageType: 'S',
        MessageId: 'M7',
        MessageNo: '060',
        MessageText: `Reservation ${resNo} created via BAPI_RESERVATION_CREATE1`
      });

      // Step 2: Auto-create Transfer Requirement (background/immediate step)
      let trNumber = '';
      let currentStatus = '01';
      let trError = null;

      try {
        const trResult = await adapter.createTransferRequirement({
          warehouseNumber: WarehouseNumber,
          wmMovementType: MovementType,
          material: Material,
          plant: Plant,
          storageLocation: StorageLocation,
          quantity: Quantity,
          unit: Unit || 'KG',
          reservationNo: resNo,
          reservationItem: resItem
        });

        trNumber = trResult.trNumberRaw || String(trResult.trNumber).padStart(10, '0');
        currentStatus = '02'; // TR Created

        // Log Step 2 (LB01)
        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: resNo,
          ReservationItem: resItem,
          LogHandle: sLogHandle,
          ExternalId: extId,
          SubObject: 'TRACK',
          Step: 'LB01',
          Status: '02',
          MessageType: 'S',
          MessageId: 'L3',
          MessageNo: '001',
          MessageText: `Transfer Requirement ${trNumber} auto-created via L_TR_CREATE`
        });
      } catch (err) {
        trError = err.message;
        const isUcon = err.code === 'UCON_BLOCKED' || (err.message && (err.message.includes('2295840') || err.message.includes('Incompatible Call Rejected')));
        const cleanMsg = isUcon
          ? 'Auto TR creation deferred: restricted by SAP Note 2295840 (use LB01 or deploy ZWM_TR_CREATE)'
          : `Auto TR creation deferred/failed: ${err.message}`;

        // Reservation is created, but TR failed: log warning
        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: resNo,
          ReservationItem: resItem,
          LogHandle: sLogHandle,
          ExternalId: extId,
          SubObject: 'TRACK',
          Step: 'LB01',
          Status: '01',
          MessageType: 'W',
          MessageId: 'L3',
          MessageNo: '999',
          MessageText: cleanMsg
        });

        if (isUcon) {
          trError = 'TR deferred: restricted under SAP Note 2295840 (use LB01 or deploy ZWM_TR_CREATE)';
        }
      }

      // Step 3: Upsert into ReservationTrack
      const trackRecord = {
        ReservationNo: resNo,
        ReservationItem: resItem,
        MovementType,
        WarehouseNumber,
        Plant,
        StorageLocation,
        Material,
        MaterialName: MaterialName || '',
        Quantity: Number(Quantity),
        Unit: Unit || 'NOS',
        ReceivingPlant: ReceivingPlant || '',
        ReceivingStorageLocation: ReceivingStorageLocation || '',
        CostCenter: CostCenter || '',
        AssetNo: AssetNo || '',
        SubNumber: SubNumber || '',
        TransferRequirement: trNumber,
        LogHandle: sLogHandle,
        ExternalId: extId,
        Status_code: currentStatus,
        ErrorMessage: trError || ''
      };

      const existing = await SELECT.one.from(ReservationEntries).where({
        ReservationNo: resNo,
        ReservationItem: resItem
      });

      if (existing) {
        await UPDATE(ReservationEntries).set(trackRecord).where({
          ReservationNo: resNo,
          ReservationItem: resItem
        });
      } else {
        await INSERT.into(ReservationEntries).entries(trackRecord);
      }

      return await SELECT.one.from(ReservationEntries).where({
        ReservationNo: resNo,
        ReservationItem: resItem
      });
    }

    // Action handler
    this.on('createReservationEntry', async (req) => {
      return await executeReservationAndAutoTR(req.data, req);
    });

    // OData Standard CREATE handler on ReservationEntries
    this.on('CREATE', ReservationEntries, async (req) => {
      return await executeReservationAndAutoTR(req.data, req);
    });

    // Chunk 5: Action handler for MIGO Goods Movement posting
    this.on('postMigoGoodsMovement', async (req) => {
      const data = req.data || {};
      const sResNo = data.ReservationNo;
      const sResItem = data.ReservationItem || '0001';

      if (!sResNo) {
        return req.error(400, 'ReservationNo is mandatory for MIGO posting');
      }

      // Read current record to fill in any omitted fields
      const existing = await SELECT.one.from(ReservationEntries).where({
        ReservationNo: sResNo,
        ReservationItem: sResItem
      });

      const sMvt = data.MovementType || existing?.MovementType;
      const sMat = data.Material || existing?.Material;
      const sPlant = data.Plant || existing?.Plant;
      const sSLoc = data.StorageLocation || existing?.StorageLocation;
      const nQty = data.Quantity != null ? data.Quantity : existing?.Quantity;
      const sUnit = data.Unit || existing?.Unit || 'NOS';
      const sRecPlant = data.ReceivingPlant || existing?.ReceivingPlant;
      const sRecSLoc = data.ReceivingStorageLocation || existing?.ReceivingStorageLocation;
      const sCostCenter = data.CostCenter || existing?.CostCenter;
      const sAssetNo = data.AssetNo || existing?.AssetNo;
      const sSubNumber = data.SubNumber || existing?.SubNumber;
      const extId = `${sResNo}/${sResItem}`;
      const sLogHandle = existing?.LogHandle || `LOG_${Date.now().toString(36).toUpperCase()}`;

      try {
        const migoRes = await adapter.postGoodsMovement({
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
          deriveGmCode: true
        });

        // Update status to 05 (Goods Issue Posted)
        await UPDATE(ReservationEntries)
          .set({
            MaterialDocument: migoRes.materialDocument,
            MaterialDocYear: migoRes.materialDocYear,
            Status_code: '05',
            ErrorMessage: '',
            LogHandle: sLogHandle,
            ExternalId: extId
          })
          .where({
            ReservationNo: sResNo,
            ReservationItem: sResItem
          });

        // Insert log entry
        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          LogHandle: sLogHandle,
          ExternalId: extId,
          SubObject: 'PROCESS',
          Step: 'MIGO',
          Status: '05',
          MessageType: 'S',
          MessageId: 'M7',
          MessageNo: '060',
          MessageText: `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect})`
        });

        return await SELECT.one.from(ReservationEntries).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });
      } catch (err) {
        // Rollback already executed by adapter; update status to 99 (Error) and record log
        await UPDATE(ReservationEntries)
          .set({
            Status_code: '99',
            ErrorMessage: err.message,
            LogHandle: sLogHandle,
            ExternalId: extId
          })
          .where({
            ReservationNo: sResNo,
            ReservationItem: sResItem
          });

        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          LogHandle: sLogHandle,
          ExternalId: extId,
          SubObject: 'PROCESS',
          Step: 'MIGO',
          Status: '99',
          MessageType: 'E',
          MessageId: 'M7',
          MessageNo: '021',
          MessageText: `MIGO failed: ${err.message}`
        });

        return await SELECT.one.from(ReservationEntries).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });
      }
    });

    // Chunk 6: Retry Action per failed step
    this.on('retryStep', async (req) => {
      const data = req.data || {};
      const sResNo = data.ReservationNo;
      const sResItem = data.ReservationItem || '0001';
      let requestedStep = (data.Step || '').toUpperCase().trim();

      if (!sResNo) {
        return req.error(400, 'ReservationNo is mandatory for retryStep');
      }

      const track = await SELECT.one.from(ReservationEntries).where({
        ReservationNo: sResNo,
        ReservationItem: sResItem
      });

      if (!track) {
        return req.error(404, `Reservation ${sResNo}/${sResItem} not found`);
      }

      // Auto-detect step if not specified
      if (!requestedStep || requestedStep === 'AUTO') {
        if (!track.TransferRequirement || track.Status_code === '01') {
          requestedStep = 'LB01';
        } else if (!track.TransferOrder || track.Status_code === '02') {
          requestedStep = 'LT04';
        } else if (track.Status_code === '03') {
          requestedStep = 'LT12';
        } else if (!track.MaterialDocument || track.Status_code === '04' || track.Status_code === '99') {
          requestedStep = 'MIGO';
        } else {
          requestedStep = 'MIGO';
        }
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

      try {
        if (requestedStep === 'LB01') {
          const trResult = await adapter.createTransferRequirement({
            warehouseNumber: track.WarehouseNumber || 'W01',
            wmMovementType: track.MovementType || '311',
            material: track.Material,
            plant: track.Plant || '1120',
            storageLocation: track.StorageLocation || 'HS01',
            quantity: track.Quantity,
            unit: track.Unit || 'EA',
            reservationNo: sResNo,
            reservationItem: sResItem
          });

          const trNo = trResult.trNumberRaw || String(trResult.trNumber).padStart(10, '0');

          await UPDATE(ReservationEntries).set({
            TransferRequirement: trNo,
            Status_code: '02',
            ErrorMessage: '',
            LogHandle: sLogHandle,
            ExternalId: extId
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: sLogHandle,
            ExternalId: extId,
            SubObject: 'PROCESS',
            Step: 'LB01',
            Status: '02',
            MessageType: 'S',
            MessageId: 'L3',
            MessageNo: '001',
            MessageText: `Retry successful: Transfer Requirement ${trNo} created via L_TR_CREATE`
          });
        } else if (requestedStep === 'LT04') {
          const toResult = await adapter.createTransferOrderFromTR({
            warehouseNumber: track.WarehouseNumber || 'W01',
            trNumber: track.TransferRequirement
          });

          const toNo = toResult.toNumberRaw || String(toResult.toNumber).padStart(10, '0');

          await adapter.confirmTransferOrder({
            warehouseNumber: track.WarehouseNumber || 'W01',
            toNumber: toNo
          });

          await UPDATE(ReservationEntries).set({
            TransferOrder: toNo,
            Status_code: '04',
            ErrorMessage: '',
            LogHandle: sLogHandle,
            ExternalId: extId
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: sLogHandle,
            ExternalId: extId,
            SubObject: 'PROCESS',
            Step: 'LT04',
            Status: '04',
            MessageType: 'S',
            MessageId: 'L3',
            MessageNo: '025',
            MessageText: `Retry successful: Transfer Order ${toNo} created and confirmed`
          });
        } else if (requestedStep === 'LT12') {
          await adapter.confirmTransferOrder({
            warehouseNumber: track.WarehouseNumber || 'W01',
            toNumber: track.TransferOrder
          });

          await UPDATE(ReservationEntries).set({
            Status_code: '04',
            ErrorMessage: '',
            LogHandle: sLogHandle,
            ExternalId: extId
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: sLogHandle,
            ExternalId: extId,
            SubObject: 'PROCESS',
            Step: 'LT12',
            Status: '04',
            MessageType: 'S',
            MessageId: 'L3',
            MessageNo: '025',
            MessageText: `Retry successful: Transfer Order ${track.TransferOrder} confirmed via L_TO_CONFIRM`
          });
        } else if (requestedStep === 'MIGO') {
          const migoRes = await adapter.postGoodsMovement({
            reservationNo: sResNo,
            reservationItem: sResItem,
            movementType: track.MovementType,
            material: track.Material,
            plant: track.Plant,
            storageLocation: track.StorageLocation,
            quantity: track.Quantity,
            unit: track.Unit,
            receivingPlant: track.ReceivingPlant,
            receivingStorageLocation: track.ReceivingStorageLocation,
            costCenter: track.CostCenter,
            assetNo: track.AssetNo,
            subNumber: track.SubNumber,
            deriveGmCode: true
          });

          await UPDATE(ReservationEntries).set({
            MaterialDocument: migoRes.materialDocument,
            MaterialDocYear: migoRes.materialDocYear,
            Status_code: '05',
            ErrorMessage: '',
            LogHandle: sLogHandle,
            ExternalId: extId
          }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

          await INSERT.into(ReservationLogs).entries({
            ID: cds.utils.uuid(),
            ReservationNo: sResNo,
            ReservationItem: sResItem,
            LogHandle: sLogHandle,
            ExternalId: extId,
            SubObject: 'PROCESS',
            Step: 'MIGO',
            Status: '05',
            MessageType: 'S',
            MessageId: 'M7',
            MessageNo: '060',
            MessageText: `Retry successful: Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} created (${migoRes.stockEffect})`
          });
        } else {
          return req.error(400, `Unsupported retry step: '${requestedStep}'. Supported: LB01, LT04, LT12, MIGO`);
        }

        return await SELECT.one.from(ReservationEntries).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });
      } catch (err) {
        const isUcon = err.code === 'UCON_BLOCKED' || (err.message && (err.message.includes('2295840') || err.message.includes('Incompatible Call Rejected')));
        const cleanErrMsg = isUcon
          ? `Retry ${requestedStep} deferred: L_TR_CREATE restricted by SAP Note 2295840 (use LB01 or deploy ZWM_TR_CREATE)`
          : `Retry ${requestedStep} failed: ${err.message}`;

        await UPDATE(ReservationEntries).set({
          Status_code: '99',
          ErrorMessage: cleanErrMsg,
          LogHandle: sLogHandle,
          ExternalId: extId
        }).where({ ReservationNo: sResNo, ReservationItem: sResItem });

        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          LogHandle: sLogHandle,
          ExternalId: extId,
          SubObject: 'PROCESS',
          Step: requestedStep,
          Status: '99',
          MessageType: 'E',
          MessageId: 'ZWM',
          MessageNo: '999',
          MessageText: cleanErrMsg
        });

        return await SELECT.one.from(ReservationEntries).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });
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

    return super.init();
  }
};
