const TrToAdapter = require('../../../integration/s4hana/wm/TrToAdapter');
const ReservationProcessAdapter = require('../../../integration/s4hana/wm/ReservationProcessAdapter');

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
    srv.on('lookupTR', run(({ tbnum, lgnum }) => adapter.lookupTR(tbnum, lgnum)));
    srv.on('getAvailableSUs', run(({ tbnum, lgnum, tbpos }) => adapter.getAvailableSUs(tbnum, lgnum, tbpos)));
    srv.on('checkSU', run(({ lenum, tbnum, lgnum }) => adapter.checkSU(lenum, tbnum, lgnum)));
    srv.on('createTO', run(({ lgnum, tbnum, lenum, qty }) => adapter.createTO({ lgnum, tbnum, lenum, qty })));

    // Chunk 5: Step 3 Service (MIGO Goods Movement Posting & Retry)
    const handlePostMigoGoodsMovement = async (req) => {
      const data = req.data || {};
      const cds = require('@sap/cds');
      const db = cds.db;
      let existingTrack = null;

      if (db) {
        try {
          const { ReservationTrack } = db.entities('saps4hana.wm');
          if (ReservationTrack) {
            existingTrack = await SELECT.one.from(ReservationTrack).where(
              data.ReservationNo
                ? { ReservationNo: data.ReservationNo, ReservationItem: data.ReservationItem || '0001' }
                : (data.TransferOrder ? { TransferOrder: data.TransferOrder } : {})
            );
          }
        } catch (dbErr) {
          console.warn('[trTo.handler] ReservationTrack lookup warning:', dbErr.message);
        }
      }

      const sResNo = data.ReservationNo || existingTrack?.ReservationNo;
      const sResItem = data.ReservationItem || existingTrack?.ReservationItem || '0001';
      const sMvt = data.MovementType || existingTrack?.MovementType || '311';
      const sMat = data.Material || existingTrack?.Material;
      const sPlant = data.Plant || existingTrack?.Plant || '1120';
      const sSLoc = data.StorageLocation || existingTrack?.StorageLocation || 'HS01';
      const nQty = data.Quantity || existingTrack?.Quantity || 1;
      const sUnit = data.Unit || existingTrack?.Unit || 'EA';
      const sRecPlant = data.ReceivingPlant || existingTrack?.ReceivingPlant;
      const sRecSLoc = data.ReceivingStorageLocation || existingTrack?.ReceivingStorageLocation;
      const sCostCenter = data.CostCenter || existingTrack?.CostCenter;
      const sAssetNo = data.AssetNo || existingTrack?.AssetNo;
      const sSubNumber = data.SubNumber || existingTrack?.SubNumber;
      const sTanum = data.TransferOrder || existingTrack?.TransferOrder || '';

      try {
        const migoRes = await resProcessAdapter.postGoodsMovement({
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

        // Update tracking to 05 (GI_POSTED)
        if (db && sResNo) {
          try {
            const { ReservationTrack, ReservationLog } = db.entities('saps4hana.wm');
            if (ReservationTrack) {
              await UPDATE(ReservationTrack)
                .set({
                  MaterialDocument: migoRes.materialDocument,
                  MaterialDocYear: migoRes.materialDocYear,
                  Status_code: '05',
                  ErrorMessage: ''
                })
                .where({ ReservationNo: sResNo, ReservationItem: sResItem });

              if (ReservationLog) {
                await INSERT.into(ReservationLog).entries({
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
              }
            }
          } catch (dbErr) {
            console.warn('[trTo.handler] DB post-MIGO tracking update warning:', dbErr.message);
          }
        }

        return {
          Success: true,
          MaterialDocument: migoRes.materialDocument,
          MaterialDocYear: migoRes.materialDocYear,
          Status: '05',
          StatusText: 'Goods Issue Posted',
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          TransferOrder: sTanum,
          MovementType: sMvt,
          Quantity: Number(nQty),
          Unit: sUnit,
          StockEffect: migoRes.stockEffect,
          Message: `Material Document ${migoRes.materialDocument}/${migoRes.materialDocYear} posted successfully.`,
          ErrorMessage: ''
        };
      } catch (err) {
        // Rollback executed; update tracking to 99 (ERROR)
        if (db && sResNo) {
          try {
            const { ReservationTrack, ReservationLog } = db.entities('saps4hana.wm');
            if (ReservationTrack) {
              await UPDATE(ReservationTrack)
                .set({
                  Status_code: '99',
                  ErrorMessage: err.message
                })
                .where({ ReservationNo: sResNo, ReservationItem: sResItem });

              if (ReservationLog) {
                await INSERT.into(ReservationLog).entries({
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
              }
            }
          } catch (dbErr) {
            console.warn('[trTo.handler] DB MIGO error status update warning:', dbErr.message);
          }
        }
        return {
          Success: false,
          MaterialDocument: '',
          MaterialDocYear: '',
          Status: '99',
          StatusText: 'MIGO Failed (Retry Available)',
          ReservationNo: sResNo,
          ReservationItem: sResItem,
          TransferOrder: sTanum,
          MovementType: sMvt,
          Quantity: Number(nQty),
          Unit: sUnit,
          StockEffect: '',
          Message: `MIGO failed: ${err.message}`,
          ErrorMessage: err.message
        };
      }
    };

    // Chunk 4 & Chunk 5: Create TO from TR + Auto Confirm + Optional Auto MIGO
    const handleCreateTOFromTR = async (req) => {
      try {
        const result = await adapter.createTOFromTR(req.data || {});

        // Update ZRES_TRACK and ZRES_LOG if CDS entities are available
        const cds = require('@sap/cds');
        const db = cds.db;
        let existing = null;
        if (db && result.TransferOrder) {
          try {
            const { ReservationTrack, ReservationLog } = db.entities('saps4hana.wm');
            if (ReservationTrack) {
              const tbnum = result.TransferRequirement;
              const rsnum = result.ReservationNo;

              // Find tracking record
              existing = await SELECT.one.from(ReservationTrack).where(
                tbnum ? { TransferRequirement: tbnum } : { ReservationNo: rsnum }
              );

              if (existing) {
                await UPDATE(ReservationTrack)
                  .set({
                    TransferOrder: result.TransferOrder,
                    Status_code: result.Status
                  })
                  .where({
                    ReservationNo: existing.ReservationNo,
                    ReservationItem: existing.ReservationItem
                  });

                if (ReservationLog) {
                  // Log Step LT04 (TO Created)
                  await INSERT.into(ReservationLog).entries({
                    ID: cds.utils.uuid(),
                    ReservationNo: existing.ReservationNo,
                    ReservationItem: existing.ReservationItem,
                    Step: 'LT04',
                    Status: '03',
                    MessageType: 'S',
                    MessageId: 'L3',
                    MessageNo: '001',
                    MessageText: `Transfer Order ${result.TransferOrder} created from TR ${result.TransferRequirement}`
                  });

                  // Log Step LT12 (TO Confirmed)
                  if (result.Confirmed) {
                    await INSERT.into(ReservationLog).entries({
                      ID: cds.utils.uuid(),
                      ReservationNo: existing.ReservationNo,
                      ReservationItem: existing.ReservationItem,
                      Step: 'LT12',
                      Status: '04',
                      MessageType: 'S',
                      MessageId: 'L3',
                      MessageNo: '025',
                      MessageText: `Transfer Order ${result.TransferOrder} auto-confirmed via L_TO_CONFIRM`
                    });
                  }
                }
              }
            }
          } catch (dbErr) {
            console.warn('[trTo.handler] Tracking update warning:', dbErr.message);
          }
        }

        // Chunk 5: Auto-trigger MIGO if requested and TO confirmed
        if (req.data && req.data.autoPostMigo && result.Confirmed) {
          try {
            const migoResult = await handlePostMigoGoodsMovement({
              data: {
                ReservationNo: existing?.ReservationNo || result.ReservationNo,
                ReservationItem: existing?.ReservationItem || result.ReservationItem || '0001',
                TransferOrder: result.TransferOrder,
                Quantity: result.Quantity,
                Unit: result.Unit,
                MovementType: existing?.MovementType,
                Material: result.Material || existing?.Material,
                Plant: existing?.Plant,
                StorageLocation: existing?.StorageLocation,
                CostCenter: existing?.CostCenter,
                AssetNo: existing?.AssetNo,
                SubNumber: existing?.SubNumber,
                ReceivingPlant: existing?.ReceivingPlant,
                ReceivingStorageLocation: existing?.ReceivingStorageLocation
              },
              error: (code, msg) => { throw new Error(msg); }
            });

            if (migoResult && migoResult.MaterialDocument) {
              result.Status = '05';
              result.StatusText = 'Goods Issue Posted';
              result.MaterialDocument = migoResult.MaterialDocument;
              result.MaterialDocYear = migoResult.MaterialDocYear;
              result.StockEffect = migoResult.StockEffect;
              result.Message = `Transfer Order ${result.TransferOrder} confirmed and Material Document ${migoResult.MaterialDocument} posted successfully.`;
            } else if (migoResult && (!migoResult.Success || migoResult.Status === '99')) {
              result.Status = '99';
              result.StatusText = 'MIGO Failed (Retry Available)';
              result.ErrorMessage = migoResult.ErrorMessage || 'MIGO posting failed';
            }
          } catch (migoErr) {
            result.Status = '99';
            result.StatusText = 'MIGO Failed (Retry Available)';
            result.ErrorMessage = migoErr.message;
          }
        }

        return result;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'CreateTOFromTR failed');
      }
    };

    srv.on('createTOFromTR', handleCreateTOFromTR);
    srv.on('CreateTOFromTR', handleCreateTOFromTR);
    srv.on('postMigoGoodsMovement', handlePostMigoGoodsMovement);
    srv.on('PostMigoGoodsMovement', handlePostMigoGoodsMovement);
  }
}

module.exports = TrToHandler;
