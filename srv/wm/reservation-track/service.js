'use strict';

const cds = require('@sap/cds');

module.exports = class ReservationTrackService extends cds.ApplicationService {
  async init() {
    const { ReservationTracks, ReservationStatuses, ReservationLogs } = this.entities;

    // Validation helper
    async function validateStatus(statusCode, req) {
      if (!statusCode) return;
      const status = await SELECT.one.from(ReservationStatuses).where({ code: statusCode });
      if (!status) {
        req.error(400, `Invalid reservation status code '${statusCode}'. Valid codes are: 01, 02, 03, 04, 05, 99`);
      }
    }

    this.before(['CREATE', 'UPDATE'], ReservationTracks, async (req) => {
      if (req.data.Status_code) {
        await validateStatus(req.data.Status_code, req);
      }
    });

    this.on('updateTrack', async (req) => {
      const {
        ReservationNo,
        ReservationItem,
        MovementType,
        WarehouseNumber,
        TransferRequirement,
        TransferOrder,
        MaterialDocument,
        MaterialDocYear,
        Status,
        ErrorMessage
      } = req.data;

      if (!ReservationNo || !ReservationItem) {
        return req.error(400, 'ReservationNo and ReservationItem are mandatory');
      }

      if (Status) {
        await validateStatus(Status, req);
      }

      const existing = await SELECT.one.from(ReservationTracks).where({
        ReservationNo,
        ReservationItem
      });

      const payload = {
        ReservationNo,
        ReservationItem,
        ...(MovementType !== undefined ? { MovementType } : {}),
        ...(WarehouseNumber !== undefined ? { WarehouseNumber } : {}),
        ...(TransferRequirement !== undefined ? { TransferRequirement } : {}),
        ...(TransferOrder !== undefined ? { TransferOrder } : {}),
        ...(MaterialDocument !== undefined ? { MaterialDocument } : {}),
        ...(MaterialDocYear !== undefined ? { MaterialDocYear } : {}),
        ...(Status !== undefined ? { Status_code: Status } : {}),
        ...(ErrorMessage !== undefined ? { ErrorMessage } : {})
      };

      if (existing) {
        await UPDATE(ReservationTracks).set(payload).where({ ReservationNo, ReservationItem });
      } else {
        await INSERT.into(ReservationTracks).entries(payload);
      }

      return await SELECT.one.from(ReservationTracks).where({ ReservationNo, ReservationItem });
    });

    this.on('addLog', async (req) => {
      const {
        ReservationNo,
        ReservationItem,
        Step,
        Status,
        MessageType,
        MessageId,
        MessageNo,
        MessageText
      } = req.data;

      if (!ReservationNo || !ReservationItem) {
        return req.error(400, 'ReservationNo and ReservationItem are mandatory');
      }

      if (Status) {
        await validateStatus(Status, req);
      }

      const logId = cds.utils.uuid();
      const logEntry = {
        ID: logId,
        ReservationNo,
        ReservationItem,
        Step: Step || 'MB21',
        Status: Status || '01',
        MessageType: MessageType || 'I',
        MessageId: MessageId || '',
        MessageNo: MessageNo || '',
        MessageText: MessageText || ''
      };

      await INSERT.into(ReservationLogs).entries(logEntry);
      return await SELECT.one.from(ReservationLogs).where({ ID: logId });
    });

    this.on('advanceStatus', async (req) => {
      const {
        ReservationNo,
        ReservationItem,
        NextStatus,
        DocumentNo,
        Step,
        Message
      } = req.data;

      if (!ReservationNo || !ReservationItem || !NextStatus) {
        return req.error(400, 'ReservationNo, ReservationItem, and NextStatus are mandatory');
      }

      await validateStatus(NextStatus, req);

      const existing = await SELECT.one.from(ReservationTracks).where({ ReservationNo, ReservationItem });
      if (!existing) {
        return req.error(404, `Reservation ${ReservationNo}/${ReservationItem} not found in tracking`);
      }

      const updateData = { Status_code: NextStatus };

      // Map document number to step field
      if (DocumentNo) {
        if (NextStatus === '02' || Step === 'LB01') updateData.TransferRequirement = DocumentNo;
        else if (NextStatus === '03' || NextStatus === '04' || Step === 'LT04' || Step === 'LT12') updateData.TransferOrder = DocumentNo;
        else if (NextStatus === '05' || Step === 'MIGO') {
          updateData.MaterialDocument = DocumentNo;
          updateData.MaterialDocYear = String(new Date().getFullYear());
        }
      }

      if (Message && NextStatus === '99') {
        updateData.ErrorMessage = Message;
      }

      await UPDATE(ReservationTracks).set(updateData).where({ ReservationNo, ReservationItem });

      // Automatically record log entry
      await INSERT.into(ReservationLogs).entries({
        ID: cds.utils.uuid(),
        ReservationNo,
        ReservationItem,
        Step: Step || (NextStatus === '01' ? 'MB21' : NextStatus === '02' ? 'LB01' : NextStatus === '03' ? 'LT04' : NextStatus === '04' ? 'LT12' : NextStatus === '05' ? 'MIGO' : 'ERROR'),
        Status: NextStatus,
        MessageType: NextStatus === '99' ? 'E' : 'S',
        MessageId: 'ZRES',
        MessageNo: NextStatus,
        MessageText: Message || `Status advanced to ${NextStatus}${DocumentNo ? ` (Doc: ${DocumentNo})` : ''}`
      });

      return await SELECT.one.from(ReservationTracks).where({ ReservationNo, ReservationItem });
    });

    return super.init();
  }
};
