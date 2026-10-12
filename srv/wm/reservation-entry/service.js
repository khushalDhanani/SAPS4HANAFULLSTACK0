'use strict';

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssueAdapter = require('../../integration/s4hana/wm/GoodsIssueAdapter');

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
      let determinedWh = WarehouseNumber;
      if (!determinedWh || determinedWh === 'W01') {
        try {
          const t320 = await adapter.rfc.readTable('T320', ['LGNUM'], [`( WERKS = '${Plant}' AND LGORT = '${StorageLocation}' )`], 1);
          if (t320 && t320[0] && t320[0].LGNUM) {
            determinedWh = t320[0].LGNUM;
          }
        } catch (_t320Err) {
          determinedWh = WarehouseNumber || 'W01';
        }
      }

      try {
        const trResult = await adapter.createTransferRequirement({
          warehouseNumber: determinedWh || WarehouseNumber || 'W01',
          wmMovementType: MovementType,
          movementType: MovementType,
          isTransferPosting: MovementType === '311' || MovementType === '301',
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
        WarehouseNumber: determinedWh || WarehouseNumber || 'W01',
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
      let existing = await SELECT.one.from(ReservationEntries).where({
        ReservationNo: sResNo,
        ReservationItem: sResItem
      });

      if (!existing && adapter.rfc) {
        try {
          const s4Rsnum = String(sResNo).padStart(10, '0');
          const s4Rspos = String(sResItem).padStart(4, '0');
          const [rkpfRows, resbRows] = await Promise.all([
            adapter.rfc.readTable('RKPF', ['RSNUM', 'BWART', 'KOSTL', 'ANLN1', 'ANLN2', 'USNAM'], [`RSNUM = '${s4Rsnum}'`], 1),
            adapter.rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'MEINS'], [`RSNUM = '${s4Rsnum}'`, `AND RSPOS = '${s4Rspos}'`], 1)
          ]);
          if (resbRows && resbRows[0]) {
            existing = {
              ReservationNo: sResNo,
              ReservationItem: sResItem,
              MovementType: rkpfRows?.[0]?.BWART || data.MovementType || '201',
              CostCenter: rkpfRows?.[0]?.KOSTL || data.CostCenter || '',
              AssetNo: rkpfRows?.[0]?.ANLN1 || data.AssetNo || '',
              SubNumber: rkpfRows?.[0]?.ANLN2 || data.SubNumber || '',
              Material: resbRows[0].MATNR,
              Plant: resbRows[0].WERKS,
              StorageLocation: resbRows[0].LGORT,
              Quantity: parseFloat(resbRows[0].BDMNG) || 1,
              Unit: resbRows[0].MEINS || 'NOS',
              WarehouseNumber: 'W01',
              Status_code: '04'
            };
            await INSERT.into(ReservationEntries).entries(existing);
          }
        } catch (_fetchErr) {
          // ignore DDIC read error
        }
      }

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

      let sBatch = data.Batch || data.batch || existing?.Batch || '';
      if (!sBatch && adapter.rfc) {
        try {
          const s4Rsnum = String(sResNo).padStart(10, '0');
          const s4Rspos = String(sResItem).padStart(4, '0');
          const resbBatch = await adapter.rfc.readTable('RESB', ['CHARG'], [`RSNUM = '${s4Rsnum}'`, `AND RSPOS = '${s4Rspos}'`], 1);
          if (resbBatch?.[0]?.CHARG?.trim()) {
            sBatch = resbBatch[0].CHARG.trim();
          } else {
            const cleanMat = String(sMat || '').replace(/^0+/, '');
            const lquaBatch = await adapter.rfc.readTable('LQUA', ['CHARG'], [
              "LGNUM = 'W01'",
              `AND MATNR LIKE '%${cleanMat}%'`,
              "AND LGTYP = '921'",
              "AND VERME > 0"
            ], 1);
            if (lquaBatch?.[0]?.CHARG?.trim()) {
              sBatch = lquaBatch[0].CHARG.trim();
            }
          }
        } catch (_bErr) {
          // ignore batch lookup error
        }
      }

      const sSerials = data.Serials || data.serials || (data.SerialNo ? [data.SerialNo] : (existing?.SerialNo ? [existing.SerialNo] : []));

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
          batch: sBatch,
          deriveGmCode: true,
          serials: sSerials
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

        const updated = await SELECT.one.from(ReservationEntries).where({
          ReservationNo: sResNo,
          ReservationItem: sResItem
        });
        return updated || {
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          MaterialDocument: migoRes.materialDocument,
          MaterialDocYear: migoRes.materialDocYear,
          Status_code: '05'
        };
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
            movementType: track.MovementType,
            isTransferPosting: track.MovementType === '311' || track.MovementType === '301',
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
          // Never create a second TO when TANUM is already set for this process.
          // Retry logic: status 12 retries create. Status 13 retries confirm only.
          let toNo = track.TransferOrder;
          if (toNo) {
            if (track.Status_code === '04') {
              return req.error(400, `Transfer Order ${toNo} is already confirmed for this process. Creating a second TO is blocked.`);
            }
            // Status 13: retry confirm only
          } else {
            let toResult;
            try {
              toResult = await adapter.createTransferOrderFromTR({
                warehouseNumber: track.WarehouseNumber || 'W01',
                trNumber: track.TransferRequirement
              });
              toNo = toResult.toNumberRaw || String(toResult.toNumber).padStart(10, '0');

              // Persist TANUM and status 03
              await UPDATE(ReservationEntries).set({
                TransferOrder: toNo,
                Status_code: '03',
                ErrorMessage: '',
                ErrorStep: '',
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
                Status: '03',
                MessageType: 'S',
                MessageId: 'L3',
                MessageNo: '001',
                MessageText: `Transfer Order ${toNo} created from TR ${track.TransferRequirement}`
              });
            } catch (createErr) {
              await UPDATE(ReservationEntries).set({
                Status_code: '12',
                ErrorMessage: createErr.message,
                ErrorStep: 'LT04',
                LogHandle: sLogHandle,
                ExternalId: extId
              }).where({ ReservationNo: sResNo, ReservationItem: sResItem });
              throw createErr;
            }
          }

          // Real second call: Confirm TO
          try {
            await adapter.confirmTransferOrder({
              warehouseNumber: track.WarehouseNumber || 'W01',
              toNumber: toNo
            });

            await UPDATE(ReservationEntries).set({
              TransferOrder: toNo,
              Status_code: '04',
              ErrorMessage: '',
              ErrorStep: '',
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
              MessageText: `Retry successful: Transfer Order ${toNo} created and confirmed`
            });
          } catch (confirmErr) {
            await UPDATE(ReservationEntries).set({
              TransferOrder: toNo,
              Status_code: '13',
              ErrorMessage: confirmErr.message,
              ErrorStep: 'LT12',
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
              Status: '13',
              MessageType: 'E',
              MessageId: 'L3',
              MessageNo: '026',
              MessageText: `Confirmation failed for Transfer Order ${toNo}: ${confirmErr.message}`
            });
            throw confirmErr;
          }
        } else if (requestedStep === 'LT12') {
          // Retry confirm only
          if (!track.TransferOrder) {
            return req.error(400, `Cannot confirm TO: No Transfer Order document exists on reservation ${sResNo}/${sResItem}`);
          }
          if (track.Status_code === '04') {
            return req.error(400, `Transfer Order ${track.TransferOrder} is already confirmed for this process. Creating a second TO is blocked.`);
          }

          try {
            await adapter.confirmTransferOrder({
              warehouseNumber: track.WarehouseNumber || 'W01',
              toNumber: track.TransferOrder
            });

            await UPDATE(ReservationEntries).set({
              Status_code: '04',
              ErrorMessage: '',
              ErrorStep: '',
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
          } catch (confirmErr) {
            await UPDATE(ReservationEntries).set({
              Status_code: '13',
              ErrorMessage: confirmErr.message,
              ErrorStep: 'LT12',
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
              Status: '13',
              MessageType: 'E',
              MessageId: 'L3',
              MessageNo: '026',
              MessageText: `Confirmation failed for Transfer Order ${track.TransferOrder}: ${confirmErr.message}`
            });
            throw confirmErr;
          }
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
            batch: data.Batch || data.batch || track.Batch || '',
            deriveGmCode: true,
            serials: data.Serials || data.serials || (data.SerialNo ? [data.SerialNo] : (track.SerialNo ? [track.SerialNo] : []))
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
          DisplayText: r.DisplayText || ''
        }));
      } catch (err) {
        return req.error(err.status || 502, `Failed to load open reservations: ${err.message}`);
      }
    });

    return super.init();
  }
};
