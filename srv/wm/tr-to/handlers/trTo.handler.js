const TrToAdapter = require('../../../integration/s4hana/wm/TrToAdapter');

/** Thin CAP binding; all validation lives in TrToAdapter so every caller gets it. */
class TrToHandler {
  static init(srv, options = {}) {
    const adapter = options.adapter || new TrToAdapter();

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

    // Chunk 4: Step 2 Service (Create TO from TR + Auto Confirm)
    const handleCreateTOFromTR = async (req) => {
      try {
        const result = await adapter.createTOFromTR(req.data || {});

        // Update ZRES_TRACK and ZRES_LOG if CDS entities are available
        const cds = require('@sap/cds');
        const db = cds.db;
        if (db && result.TransferOrder) {
          try {
            const { ReservationTrack, ReservationLog } = db.entities('saps4hana.wm');
            if (ReservationTrack) {
              const tbnum = result.TransferRequirement;
              const rsnum = result.ReservationNo;

              // Find tracking record
              const existing = await SELECT.one.from(ReservationTrack).where(
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
            // DB tracking error should not fail the SAP transaction
            console.warn('[trTo.handler] Tracking update warning:', dbErr.message);
          }
        }

        return result;
      } catch (err) {
        return req.error(err.status || 500, err.message || 'CreateTOFromTR failed');
      }
    };

    srv.on('createTOFromTR', handleCreateTOFromTR);
    srv.on('CreateTOFromTR', handleCreateTOFromTR);
  }
}

module.exports = TrToHandler;
