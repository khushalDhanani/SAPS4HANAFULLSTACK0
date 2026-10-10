'use strict';

const LOG = require('../logger')('reservation-track-adapter');
const { RfcClient } = require('../RfcClient');

const httpError = (status, message) => Object.assign(new Error(message), { status });
const alphaIn = (v, len) => (/^\d+$/.test(v) ? v.padStart(len, '0') : v);
const alphaOut = (v) => String(v || '').replace(/^0+(?=\d)/, '');

class ReservationTrackAdapter {
  constructor(options = {}) {
    this.rfc = options.rfc || new RfcClient();
  }

  /**
   * Check if ZRES_TRACK transparent table is active in SAP DDIC
   */
  async isTableActive() {
    try {
      const res = await this.rfc.readTable('DD02L', ['TABNAME', 'AS4LOCAL'], [
        "TABNAME = 'ZRES_TRACK' AND AS4LOCAL = 'A'"
      ]);
      return res.length > 0;
    } catch (e) {
      LOG.warn(`isTableActive check failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Read tracking row from SAP table ZRES_TRACK
   */
  async getTrack(rsnum, rspos = '0001') {
    const formattedRsnum = alphaIn(rsnum, 10);
    const formattedRspos = alphaIn(rspos, 4);

    try {
      const rows = await this.rfc.readTable(
        'ZRES_TRACK',
        ['RSNUM', 'RSPOS', 'MOVE_TYPE', 'LGNUM', 'TBNUM', 'TANUM', 'MBLNR', 'MJAHR', 'STATUS', 'ERR_MSG', 'ERNAM', 'ERDAT', 'AENAM', 'AEDAT'],
        [`RSNUM = '${formattedRsnum}' AND RSPOS = '${formattedRspos}'`]
      );

      if (!rows || rows.length === 0) return null;
      const r = rows[0];
      return {
        ReservationNo: alphaOut(r.RSNUM),
        ReservationItem: alphaOut(r.RSPOS),
        MovementType: r.MOVE_TYPE,
        WarehouseNumber: r.LGNUM,
        TransferRequirement: alphaOut(r.TBNUM),
        TransferOrder: alphaOut(r.TANUM),
        MaterialDocument: alphaOut(r.MBLNR),
        MaterialDocYear: r.MJAHR,
        Status: r.STATUS,
        ErrorMessage: r.ERR_MSG,
        CreatedBy: r.ERNAM,
        CreatedOn: r.ERDAT,
        ChangedBy: r.AENAM,
        ChangedOn: r.AEDAT
      };
    } catch (e) {
      LOG.error(`getTrack error for ${formattedRsnum}/${formattedRspos}: ${e.message}`);
      throw httpError(502, `Failed to read ZRES_TRACK from SAP: ${e.message}`);
    }
  }

  /**
   * Read step-wise logs from SAP table ZRES_LOG
   */
  async getLogs(rsnum, rspos = '0001') {
    const formattedRsnum = alphaIn(rsnum, 10);
    const formattedRspos = alphaIn(rspos, 4);

    try {
      const rows = await this.rfc.readTable(
        'ZRES_LOG',
        ['LOG_ID', 'RSNUM', 'RSPOS', 'STEP', 'STATUS', 'MSGTY', 'MSGID', 'MSGNO', 'MESSAGE', 'ERNAM', 'ERDAT', 'ERZET'],
        [`RSNUM = '${formattedRsnum}' AND RSPOS = '${formattedRspos}'`],
        50
      );

      return (rows || []).map((r) => ({
        LogId: r.LOG_ID,
        ReservationNo: alphaOut(r.RSNUM),
        ReservationItem: alphaOut(r.RSPOS),
        Step: r.STEP,
        Status: r.STATUS,
        MessageType: r.MSGTY,
        MessageId: r.MSGID,
        MessageNo: r.MSGNO,
        MessageText: r.MESSAGE,
        CreatedBy: r.ERNAM,
        CreatedOn: r.ERDAT,
        CreatedAt: r.ERZET
      }));
    } catch (e) {
      LOG.error(`getLogs error for ${formattedRsnum}/${formattedRspos}: ${e.message}`);
      throw httpError(502, `Failed to read ZRES_LOG from SAP: ${e.message}`);
    }
  }
}

module.exports = ReservationTrackAdapter;
