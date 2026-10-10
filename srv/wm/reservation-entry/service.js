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
          unit: Unit || 'NOS',
          receivingPlant: ReceivingPlant,
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

      // Log Step 1 (MB21)
      await INSERT.into(ReservationLogs).entries({
        ID: cds.utils.uuid(),
        ReservationNo: resNo,
        ReservationItem: resItem,
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
          unit: Unit || 'NOS',
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
          Step: 'LB01',
          Status: '02',
          MessageType: 'S',
          MessageId: 'L3',
          MessageNo: '001',
          MessageText: `Transfer Requirement ${trNumber} auto-created via L_TR_CREATE`
        });
      } catch (err) {
        trError = err.message;
        // Reservation is created, but TR failed: log warning
        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: resNo,
          ReservationItem: resItem,
          Step: 'LB01',
          Status: '01',
          MessageType: 'W',
          MessageId: 'L3',
          MessageNo: '999',
          MessageText: `Auto TR creation deferred/failed: ${err.message}`
        });
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
            ErrorMessage: ''
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
            ErrorMessage: err.message
          })
          .where({
            ReservationNo: sResNo,
            ReservationItem: sResItem
          });

        await INSERT.into(ReservationLogs).entries({
          ID: cds.utils.uuid(),
          ReservationNo: sResNo,
          ReservationItem: sResItem,
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

    return super.init();
  }
};
