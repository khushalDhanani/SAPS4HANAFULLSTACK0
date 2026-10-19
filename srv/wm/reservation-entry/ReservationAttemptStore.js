'use strict';

const crypto = require('crypto');
const cds = require('@sap/cds');
const LOG = require('../../common/logger')('reservation-attempts');

const { INSERT, SELECT, UPDATE } = cds.ql;

const ATTEMPT_ENTITY = 'saps4hana.wm.ReservationCreateAttempt';

/** Still running inside a request (the TR phase runs under RESERVATION_CREATED; TR_* is written when the request ends). */
const PENDING_STAGES = Object.freeze(['RESERVATION_PENDING']);
/** SAP may hold a document the app has not recorded; a human (or an import) must resolve before any new create. */
const UNRESOLVED_STAGES = Object.freeze(['RESERVATION_UNKNOWN', 'LOCAL_PERSIST_FAILED', 'RESERVATION_CREATED_MISMATCH']);
/** The reservation exists and is tracked: an identical re-submit inside the replay window returns it instead of creating another. */
const REPLAYABLE_STAGES = Object.freeze(['RESERVATION_CREATED', 'TR_CREATED', 'TR_FAILED', 'RESERVATION_ALREADY_TRACKED']);
const FINAL_STAGES = Object.freeze(['RESERVATION_REJECTED', 'TR_CREATED', 'TR_FAILED', 'RESERVATION_ALREADY_TRACKED']);

/**
 * ReservationAttemptStore — log of reservation-create attempts (Step 7.7, audit D3/D10).
 * A row is written with stage RESERVATION_PENDING before BAPI_RESERVATION_CREATE1 and moved through the
 * stages afterwards. Every write runs in its own committed transaction so it survives a request that
 * ends in req.error (whose own transaction is rolled back).
 */
class ReservationAttemptStore {
  constructor(options = {}) {
    this._dbProvider = options.db !== undefined ? () => options.db : () => cds.db;
  }

  get db() { return this._dbProvider() || null; }

  /** Window in which an identical re-submit is answered with the existing reservation (RES_ATTEMPT_REPLAY_WINDOW_MS, default 10 min). */
  static replayWindowMs() {
    const n = Number(process.env.RES_ATTEMPT_REPLAY_WINDOW_MS);
    return Number.isFinite(n) && n >= 0 && process.env.RES_ATTEMPT_REPLAY_WINDOW_MS ? n : 600000;
  }

  /**
   * Business key of a reservation intent (Step 7.8): SHA-256 over the canonical fields and the requesting
   * user. Two requests with the same key are the same intent; a different quantity, batch, movement type,
   * location, account assignment or user is a different intent. Numeric keys compare without leading zeros.
   */
  static hash(payload = {}, user = '') {
    const pick = (k) => {
      const v = payload[k] === undefined || payload[k] === null ? '' : String(payload[k]).trim().toUpperCase();
      return /^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, '') : v;
    };
    const parts = ['MovementType', 'Plant', 'StorageLocation', 'Material', 'Unit', 'Batch', 'ReceivingPlant', 'ReceivingStorageLocation', 'CostCenter', 'AssetNo', 'SubNumber', 'OrderID', 'OrderType', 'ReservationDate']
      .map((k) => `${k}=${pick(k)}`);
    parts.push(`Quantity=${Number(payload.Quantity)}`, `User=${String(user || '')}`);
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }

  _run(query) {
    const db = this.db;
    if (!db) {
      const err = new Error('Reservation attempt log is not available: no database is bound to this deployment.');
      err.status = 503;
      throw err;
    }
    return db.tx({ user: cds.User.privileged }, (tx) => tx.run(query));
  }

  /** All attempts of one intent (RequestHash), oldest first. ClientAttemptId is kept for audit only. */
  async _group(requestHash) {
    const rows = await this._run(SELECT.from(ATTEMPT_ENTITY).where({ RequestHash: requestHash }));
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  /**
   * Claims a new attempt or explains why not.
   * @returns {Promise<{ created: boolean, reason?: 'in_progress'|'unresolved'|'replay', row: object }>}
   */
  async claim({ clientAttemptId = '', requestHash, user = '', fields = {} }) {
    const cid = String(clientAttemptId || '').trim();
    const hash = String(requestHash || '').trim();
    if (!hash) throw new Error('RequestHash is required to claim a reservation attempt');
    const priors = await this._group(hash);
    const latest = priors[priors.length - 1];
    if (latest) {
      const stage = String(latest.Stage || '');
      if (PENDING_STAGES.includes(stage)) return { created: false, reason: 'in_progress', row: latest };
      if (UNRESOLVED_STAGES.includes(stage)) return { created: false, reason: 'unresolved', row: latest };
      const age = Date.now() - new Date(latest.createdAt || 0).getTime();
      if (REPLAYABLE_STAGES.includes(stage) && latest.ReservationNo && age < ReservationAttemptStore.replayWindowMs()) {
        return { created: false, reason: 'replay', row: latest };
      }
    }
    const row = {
      ID: cds.utils.uuid(),
      AttemptKey: `${hash}:${priors.length}`,
      ClientAttemptId: cid,
      RequestHash: hash,
      RequestUser: String(user || '').slice(0, 255),
      MovementType: String(fields.MovementType || '').trim(),
      Plant: String(fields.Plant || '').trim(),
      StorageLocation: String(fields.StorageLocation || '').trim(),
      Material: String(fields.Material || '').trim(),
      Quantity: Number(fields.Quantity) || 0,
      Unit: String(fields.Unit || '').trim(),
      Stage: 'RESERVATION_PENDING',
      ReservationNo: '',
      ReservationItem: '',
      TransferRequirement: '',
      LastError: '',
      ResolvedAt: null,
      createdAt: new Date().toISOString()
    };
    try {
      await this._run(INSERT.into(ATTEMPT_ENTITY).entries(row));
      return { created: true, row };
    } catch (insertErr) {
      // Unique AttemptKey lost a race against a concurrent identical submit: report that one as in progress.
      const raced = await this._run(SELECT.one.from(ATTEMPT_ENTITY).where({ AttemptKey: row.AttemptKey }));
      if (raced) return { created: false, reason: 'in_progress', row: raced };
      throw insertErr;
    }
  }

  /** Moves an attempt to a stage; document numbers and the exact error are kept. */
  async setStage(id, stage, fields = {}) {
    const updates = { Stage: stage, ResolvedAt: FINAL_STAGES.includes(stage) ? new Date().toISOString() : null };
    if (fields.ReservationNo !== undefined) updates.ReservationNo = String(fields.ReservationNo || '');
    if (fields.ReservationItem !== undefined) updates.ReservationItem = String(fields.ReservationItem || '');
    if (fields.TransferRequirement !== undefined) updates.TransferRequirement = String(fields.TransferRequirement || '');
    if (fields.LastError !== undefined) updates.LastError = String(fields.LastError || '').slice(0, 500);
    try {
      await this._run(UPDATE(ATTEMPT_ENTITY).set(updates).where({ ID: id }));
    } catch (e) {
      // The attempt log must never turn a SAP outcome into a different outcome; log and continue.
      LOG.warn(`Attempt ${id} could not be moved to ${stage}: ${e.message}`);
    }
  }

  async get(id) {
    return this._run(SELECT.one.from(ATTEMPT_ENTITY).where({ ID: id }));
  }
}

/** Which attempt stage a failed BAPI call maps to, from the error the adapter raised. */
function classifyCreateFailure(err) {
  if (err && err.reservationNo) return 'RESERVATION_CREATED_MISMATCH';
  const st = Number(err && err.status);
  // 400/403: SAP or a preflight rejected the request; 503: the RFC layer was unavailable before any call.
  if (st === 400 || st === 403 || st === 503) return 'RESERVATION_REJECTED';
  return 'RESERVATION_UNKNOWN';
}

module.exports = new ReservationAttemptStore();
module.exports.ReservationAttemptStore = ReservationAttemptStore;
module.exports.ATTEMPT_ENTITY = ATTEMPT_ENTITY;
module.exports.classifyCreateFailure = classifyCreateFailure;
module.exports.STAGES = Object.freeze({ PENDING_STAGES, UNRESOLVED_STAGES, REPLAYABLE_STAGES, FINAL_STAGES });
