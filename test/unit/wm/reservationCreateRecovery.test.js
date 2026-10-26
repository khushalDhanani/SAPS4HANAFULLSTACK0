'use strict';

/**
 * Step 7.7: partial failure / recovery of the reservation-create flow.
 * State machine (attempt log + ReservationTrack):
 *   RESERVATION_PENDING -> RESERVATION_CREATED (01) -> TR_PENDING -> TR_CREATED (02) -> TO (03) -> TO confirmed (04) -> MIGO (05)
 * Every failure persists its stage, the SAP document numbers known so far and the exact error; retryStep
 * resumes from the failed stage and never re-runs a successful one. Mock adapter only - no SAP call.
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
const { ATTEMPT_ENTITY, classifyCreateFailure, STAGES } = require('../../../srv/wm/reservation-entry/ReservationAttemptStore');

const { POST } = cds.test(__dirname + '/../../../');
const { SELECT, DELETE, INSERT } = cds.ql;

const TRACK = 'saps4hana.wm.ReservationTrack';
const LOGS = 'saps4hana.wm.ReservationLog';
const auth = { auth: { username: 'carol', password: '' } };
const URL = '/odata/v4/reservation-entry';

const RES = '0000777077';
const body = { MovementType: '311', Plant: '1120', StorageLocation: 'CS01', ReceivingStorageLocation: 'ST02', Material: '1000000045', Quantity: 3, Unit: 'KG', ClientAttemptId: 'form-7-7' };
const okRes = { success: true, reservationNo: '777077', reservationNoRaw: RES, reservationItem: '0001', sapVerified: true, status: '01' };
const okTr = { success: true, warehouseNumber: 'W01', trNumber: '1007077', trNumberRaw: '0001007077', trItem: '0001', status: '02' };

const attempts = () => cds.db.run(SELECT.from(ATTEMPT_ENTITY).orderBy('createdAt'));
// Stages after the first local write are written in req.on('done'), i.e. just after the HTTP response.
const waitForStage = async (stage, idx = 0, ms = 2000) => {
  const until = Date.now() + ms;
  for (;;) {
    const rows = await attempts();
    if (rows[idx] && rows[idx].Stage === stage) return rows[idx];
    if (Date.now() > until) return rows[idx];
    await new Promise((r) => setTimeout(r, 25));
  }
};
const track = () => cds.db.run(SELECT.one.from(TRACK).where({ ReservationNo: RES }));
const spies = [];
// Failure injection for local persistence: a db-level before-INSERT handler that throws while armed
// (queries inside the request transaction do not go through cds.db.run, so a spy there cannot see them).
const failTrackInsert = { armed: false };
beforeAll(() => {
  // The service inserts into its projection (ReservationEntryService.ReservationEntries), so match by name suffix.
  cds.db.before('INSERT', '*', (req) => { if (failTrackInsert.armed && /ReservationEntries$|ReservationTrack$/.test(req.target?.name || '')) throw new Error('DB down'); });
});
const spy = (m, impl) => { const s = jest.spyOn(ReservationProcessAdapter.prototype, m); spies.push(s); return impl ? s.mockImplementation(impl) : s; };
const create = (extra = {}) => POST(`${URL}/createReservationEntry`, { ...body, ...extra }, auth);
const expect409 = (p, re) => expect(p).rejects.toMatchObject({ response: { status: 409, data: { error: { message: expect.stringMatching(re) } } } });

describe('Step 7.7: reservation-create partial failure and recovery', () => {
  beforeEach(() => {
    spies.push(jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
      if (table === 'T320') return [{ LGNUM: 'W01' }];
      if (table === 'LTAK' || table === 'LTAP' || table === 'LTBK') return []; // no unconfirmed TO items
      throw Object.assign(new Error('node-rfc is not available (test stub)'), { status: 503 });
    }));
    spies.push(jest.spyOn(ReservationProcessAdapter.prototype, 'checkAuthorization').mockResolvedValue(true));
  });
  afterEach(async () => {
    while (spies.length) spies.pop().mockRestore();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    await cds.db.run(DELETE.from(LOGS).where({ ReservationNo: RES }));
    await cds.db.run(DELETE.from(TRACK).where({ ReservationNo: RES }));
  });

  test('happy path: attempt walks PENDING -> CREATED -> TR_PENDING -> TR_CREATED with both SAP numbers', async () => {
    spy('createReservation').mockResolvedValue(okRes);
    spy('createTransferRequirement').mockResolvedValue(okTr);
    const { data } = await create();
    expect(data).toMatchObject({ ReservationNo: RES, TransferRequirement: '0001007077', Status_code: '02' });
    const a = await waitForStage('TR_CREATED');
    expect(a).toMatchObject({ Stage: 'TR_CREATED', ClientAttemptId: 'form-7-7', AttemptKey: expect.stringMatching(/^[0-9a-f]{64}:0$/), ReservationNo: RES, ReservationItem: '0001', TransferRequirement: '0001007077', LastError: '' });
    expect(a.ResolvedAt).toBeTruthy();
  });

  test('BAPI reservation failure: stage RESERVATION_REJECTED with the SAP message, no track row, re-submit allowed', async () => {
    const bapiErr = Object.assign(new Error('BAPI_RESERVATION_CREATE1 failed: Deficit of stock'), { status: 400, stage: 'RESERVATION', error: 'Deficit of stock' });
    const resSpy = spy('createReservation').mockRejectedValueOnce(bapiErr).mockResolvedValue(okRes);
    spy('createTransferRequirement').mockResolvedValue(okTr);
    await expect(create()).rejects.toMatchObject({ response: { status: 400, data: { error: { message: expect.stringMatching(/Deficit of stock/) } } } });
    expect(await track()).toBeFalsy();
    let rows = await attempts();
    expect(rows).toEqual([expect.objectContaining({ Stage: 'RESERVATION_REJECTED', LastError: 'Deficit of stock', ReservationNo: '' })]);
    // The user fixes nothing and submits again: a rejected attempt never blocks, and a new generation is created.
    const { data } = await create();
    expect(data.ReservationNo).toBe(RES);
    await waitForStage('TR_CREATED', 1);
    rows = await attempts();
    expect(rows.map((r) => [r.AttemptKey.slice(-2), r.Stage])).toEqual([[':0', 'RESERVATION_REJECTED'], [':1', 'TR_CREATED']]);
    expect(resSpy).toHaveBeenCalledTimes(2);
  });

  test('timeout / unknown SAP response: stage RESERVATION_UNKNOWN, identical re-submit is blocked with 409 (no duplicate)', async () => {
    const resSpy = spy('createReservation').mockRejectedValueOnce(Object.assign(new Error('RFC_COMMUNICATION_FAILURE: timeout'), { status: 504 }));
    const unknownErr = await create().catch((e) => e);
    expect(unknownErr.response.status).toBe(504);
    expect(unknownErr.response.data.error.message).toMatch(/outcome in SAP is unknown/);
    expect(unknownErr.response.data.error.message).not.toMatch(/RFC_COMMUNICATION_FAILURE/); // technical code stays in the log / attempt row
    expect((await attempts())[0]).toMatchObject({ Stage: 'RESERVATION_UNKNOWN', LastError: 'RFC_COMMUNICATION_FAILURE: timeout' });
    await expect409(create(), /is at stage RESERVATION_UNKNOWN \(The SAP system connection is currently unavailable/);
    expect(resSpy).toHaveBeenCalledTimes(1);
    expect(await attempts()).toHaveLength(1);
  });

  test('read-back failure (unavailable): reservation is created and tracked, attempt notes the missing verification', async () => {
    spy('createReservation').mockResolvedValue({ ...okRes, sapVerified: false, sapReadBack: { verified: false, reason: 'no RKPF/RESB row' } });
    spy('createTransferRequirement').mockResolvedValue(okTr);
    const { data } = await create();
    expect(data.Status_code).toBe('02');
    expect(await waitForStage('TR_CREATED')).toMatchObject({ Stage: 'TR_CREATED', ReservationNo: RES });
    const mb21 = await cds.db.run(SELECT.one.from(LOGS).where({ ReservationNo: RES, Step: 'MB21', MessageType: 'S' }));
    expect(mb21.MessageText).toMatch(/read-back unavailable/);
  });

  test('read-back mismatch after commit: 500 names the SAP number, attempt keeps it as RESERVATION_CREATED_MISMATCH, re-submit blocked', async () => {
    spy('createReservation').mockRejectedValueOnce(Object.assign(new Error('Reservation 777077 was created in SAP but RKPF/RESB differ from the request: LGORT'), { status: 500, reservationNo: '777077' }));
    await expect(create()).rejects.toMatchObject({ response: { status: 500, data: { error: { message: expect.stringMatching(/Reservation 777077 exists in SAP; open it in the app to import it/) } } } });
    expect((await attempts())[0]).toMatchObject({ Stage: 'RESERVATION_CREATED_MISMATCH', ReservationNo: RES });
    await expect409(create(), /SAP reservation 777077 belongs to that attempt/);
  });

  test('local persistence failure after the SAP commit: 500 names the RSNUM, attempt LOCAL_PERSIST_FAILED, re-submit blocked', async () => {
    spy('createReservation').mockResolvedValue(okRes);
    const trSpy = spy('createTransferRequirement').mockResolvedValue(okTr);
    failTrackInsert.armed = true;
    try {
      await expect(create()).rejects.toMatchObject({ response: { status: 500, data: { error: { message: expect.stringMatching(/Reservation 777077\/0001 was created in SAP but could not be recorded locally \(DB down\)/) } } } });
    } finally {
      failTrackInsert.armed = false;
    }
    expect(trSpy).not.toHaveBeenCalled(); // the TR stage never ran
    expect(await track()).toBeFalsy();
    expect(await waitForStage('LOCAL_PERSIST_FAILED')).toMatchObject({ Stage: 'LOCAL_PERSIST_FAILED', ReservationNo: RES, LastError: 'DB down' });
    await expect409(create(), /LOCAL_PERSIST_FAILED .*SAP reservation 777077 belongs to that attempt/);
  });

  test('TR failure: reservation kept (status 11, exact error), attempt TR_FAILED; retry LB01 creates the TR without a new reservation', async () => {
    const resSpy = spy('createReservation').mockResolvedValue(okRes);
    const trSpy = spy('createTransferRequirement').mockRejectedValueOnce(new Error('L_TR_CREATE: Warehouse movement not active')).mockResolvedValue(okTr);
    spy('writeApplicationLog').mockResolvedValue({ logHandle: '' });
    const { data } = await create();
    expect(data).toMatchObject({ Status_code: '11', ErrorStep: 'LB01', ErrorMessage: expect.stringMatching(/Warehouse movement not active/), TransferRequirement: '' });
    expect(await waitForStage('TR_FAILED')).toMatchObject({ Stage: 'TR_FAILED', ReservationNo: RES, LastError: expect.stringMatching(/Warehouse movement not active/) });
    const { data: retried } = await POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'AUTO' }, auth);
    expect(retried).toMatchObject({ Status_code: '02', TransferRequirement: '0001007077', ErrorMessage: '' });
    expect(resSpy).toHaveBeenCalledTimes(1);
    expect(trSpy).toHaveBeenCalledTimes(2);
  });

  test('identical re-submit of a successful create (same ClientAttemptId) returns the existing row; no second BAPI call', async () => {
    const resSpy = spy('createReservation').mockResolvedValue(okRes);
    spy('createTransferRequirement').mockResolvedValue(okTr);
    await create();
    await waitForStage('TR_CREATED');
    const { data } = await create();
    expect(data).toMatchObject({ ReservationNo: RES, TransferRequirement: '0001007077' });
    expect(resSpy).toHaveBeenCalledTimes(1);
    expect(await attempts()).toHaveLength(1);
  });

  test('concurrent identical submits: exactly one BAPI call, the other gets 409 in progress', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const resSpy = spy('createReservation').mockImplementation(async () => { await gate; return okRes; });
    spy('createTransferRequirement').mockResolvedValue(okTr);
    const first = create();
    await new Promise((r) => setTimeout(r, 150));
    const second = create();
    await expect409(second, /still in progress/);
    release();
    const { data } = await first;
    expect(data.ReservationNo).toBe(RES);
    expect(resSpy).toHaveBeenCalledTimes(1);
  });

  test('already tracked with progress (261 adoption case): tracking row is not reset, 409', async () => {
    await cds.db.run(INSERT.into(TRACK).entries({ ReservationNo: RES, ReservationItem: '0001', MovementType: '311', Plant: '1120', StorageLocation: 'CS01', Material: '1000000045', Quantity: 3, Unit: 'KG', WarehouseNumber: 'W01', TransferRequirement: '0001000001', TransferOrder: '0001000002', Status_code: '04' }));
    spy('createReservation').mockResolvedValue(okRes);
    const trSpy = spy('createTransferRequirement').mockResolvedValue(okTr);
    await expect409(create(), /already tracked with status 04; its tracking record was not changed/);
    expect(await track()).toMatchObject({ Status_code: '04', TransferOrder: '0001000002' });
    expect(trSpy).not.toHaveBeenCalled();
    expect(await waitForStage('RESERVATION_ALREADY_TRACKED')).toMatchObject({ Stage: 'RESERVATION_ALREADY_TRACKED', ReservationNo: RES });
  });

  describe('later stages: TO, confirm, MIGO failures persist their own status and retry resumes there', () => {
    const seed = (extra) => cds.db.run(INSERT.into(TRACK).entries({ ReservationNo: RES, ReservationItem: '0001', MovementType: '311', Plant: '1120', StorageLocation: 'CS01', ReceivingStorageLocation: 'ST02', Material: '1000000045', Quantity: 3, Unit: 'KG', WarehouseNumber: 'W01', ...extra }));

    test('TO failure: status 12 with the error, TR kept; retry resumes at LT04 and never recreates the TR', async () => {
      await seed({ TransferRequirement: '0001007077', Status_code: '02' });
      spy('getTransferRequirement').mockResolvedValue({ success: true, trNumber: '1007077', trNumberRaw: '0001007077', warehouse: 'W01', movement: '311', reservationNo: '777077' });
      const toSpy = spy('createTransferOrderFromTR').mockRejectedValueOnce(new Error('L3 007 storage type search')).mockResolvedValue({ success: true, warehouseNumber: 'W01', toNumber: '1012977', toNumberRaw: '0001012977', status: '03' });
      spy('confirmTransferOrder').mockResolvedValue({ success: true, confirmed: true });
      const trSpy = spy('createTransferRequirement');
      const resSpy = spy('createReservation');
      const { data } = await POST(`${URL}/createTOFromTR`, { ReservationNo: RES, ReservationItem: '0001', WarehouseNumber: 'W01' }, auth);
      expect(data.success).toBe(false);
      expect(await track()).toMatchObject({ Status_code: '12', TransferRequirement: '0001007077', ErrorMessage: expect.stringMatching(/L3 007/) });
      const { data: retried } = await POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'AUTO' }, auth);
      expect(retried).toMatchObject({ Status_code: '04', ProcessStatus: 'TO_CONFIRMED', TransferOrder: '0001012977', TransferRequirement: '0001007077' }); // live 201: ProcessStatus used to stay TR_CREATED
      expect(toSpy).toHaveBeenCalledTimes(2);
      expect(trSpy).not.toHaveBeenCalled();
      expect(resSpy).not.toHaveBeenCalled();
    });

    test('retry LB01 explicitly when a TR already exists is refused (no duplicate TR)', async () => {
      await seed({ TransferRequirement: '0001007077', Status_code: '02' });
      const trSpy = spy('createTransferRequirement');
      await expect(POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'LB01' }, auth))
        .rejects.toMatchObject({ response: { status: 400, data: { error: { message: expect.stringMatching(/Transfer Requirement 1007077 already exists .* retry LT04/) } } } });
      expect(trSpy).not.toHaveBeenCalled();
    });

    // D18 (live 241, 2026-10-19): SAP completed TR W01/0001000885 (LTBK STATU 'E') without any TO after XFELD_WRONG.
    const sapTrClosedNoTo = () => {
      const impl = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'LTBK') return [{ STATU: 'E' }];
        if (table === 'LTAK' || table === 'LTAP') return [];
        throw Object.assign(new Error('node-rfc is not available (test stub)'), { status: 503 });
      });
      spies.push(impl);
      return impl;
    };

    test('D18: TR completed in SAP without a TO -> explicit LB01 creates a new TR (reservation kept), log names the replaced TR', async () => {
      await seed({ TransferRequirement: '0001000885', Status_code: '12', ErrorStep: 'LT04', ErrorMessage: 'XFELD_WRONG: Invalid indicator value passed.' });
      const readSpy = sapTrClosedNoTo();
      const trSpy = spy('createTransferRequirement').mockResolvedValue({ ...okTr, trNumber: '1000890', trNumberRaw: '0001000890' });
      const resSpy = spy('createReservation');
      const toSpy = spy('createTransferOrderFromTR');
      const { data } = await POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'LB01' }, auth);
      expect(data).toMatchObject({ Status_code: '02', TransferRequirement: '0001000890', ErrorMessage: '', ErrorStep: '' });
      expect(trSpy).toHaveBeenCalledTimes(1);
      expect(resSpy).not.toHaveBeenCalled();
      expect(toSpy).not.toHaveBeenCalled();
      expect(readSpy.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['LTBK', 'LTAK'])); // READ-ONLY check happened
      const logs = await cds.db.run(SELECT.from(LOGS).where({ ReservationNo: RES, Step: 'LB01' }));
      expect(logs.map((l) => l.MessageText)).toEqual([expect.stringMatching(/1000890 created .*replaces TR 1000885, completed in SAP without a TO/)]);
    });

    test('D18: AUTO retry on status 12 goes to LB01 (not LT04) when the TR is completed without a TO', async () => {
      await seed({ TransferRequirement: '0001000885', Status_code: '12', ErrorStep: 'LT04' });
      sapTrClosedNoTo();
      const trSpy = spy('createTransferRequirement').mockResolvedValue({ ...okTr, trNumber: '1000890', trNumberRaw: '0001000890' });
      const toSpy = spy('createTransferOrderFromTR');
      const { data } = await POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'AUTO' }, auth);
      expect(data).toMatchObject({ Status_code: '02', TransferRequirement: '0001000890' });
      expect(trSpy).toHaveBeenCalledTimes(1);
      expect(toSpy).not.toHaveBeenCalled();
    });

    test('D18: a completed TR that has a TO is not replaced (LB01 refused, AUTO stays at LT04)', async () => {
      await seed({ TransferRequirement: '0001000885', Status_code: '12', ErrorStep: 'LT04' });
      spies.push(jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01' }];
        if (table === 'LTBK') return [{ STATU: 'E' }];
        if (table === 'LTAK') return [{ TANUM: '0001037367', KQUIT: 'X' }];
        if (table === 'LTAP') return [];
        throw Object.assign(new Error('node-rfc is not available (test stub)'), { status: 503 });
      }));
      const trSpy = spy('createTransferRequirement');
      await expect(POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'LB01' }, auth))
        .rejects.toMatchObject({ response: { status: 400, data: { error: { message: expect.stringMatching(/already exists .* retry LT04/) } } } });
      spy('getTransferRequirement').mockResolvedValue({ success: true, trNumber: '1000885', trNumberRaw: '0001000885', warehouse: 'W01' });
      const toSpy = spy('createTransferOrderFromTR').mockRejectedValue(new Error('TR_COMPLETED'));
      const { data } = await POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'AUTO' }, auth); // failed step: row in status 12
      expect(data).toMatchObject({ Status_code: '12', ErrorStep: 'LT04', ErrorMessage: expect.stringMatching(/TR_COMPLETED/), TransferRequirement: '0001000885' });
      expect(toSpy).toHaveBeenCalledTimes(1);
      expect(trSpy).not.toHaveBeenCalled();
    });

    test('MIGO failure: status 90 with the error, TR/TO kept; retry resumes at MIGO only', async () => {
      await seed({ TransferRequirement: '0001007077', TransferOrder: '0001012977', Status_code: '04' });
      const migoSpy = spy('postGoodsMovement').mockRejectedValueOnce(new Error('Posting period closed')).mockResolvedValue({ success: true, materialDocument: '4900059977', materialDocumentYear: '2026', withdrawnQuantity: 3, remainingQuantity: 0, completelyProcessed: true });
      spy('writeApplicationLog').mockResolvedValue({ logHandle: '' });
      const toSpy = spy('createTransferOrderFromTR');
      const trSpy = spy('createTransferRequirement');
      const { data } = await POST(`${URL}/postMigoGoodsMovement`, { ReservationNo: RES, ReservationItem: '0001', MovementType: '311' }, auth);
      expect(data).toMatchObject({ Status_code: '90', ErrorMessage: expect.stringMatching(/Posting period closed/), TransferOrder: '0001012977' });
      const { data: retried } = await POST(`${URL}/retryStep`, { ReservationNo: RES, ReservationItem: '0001', Step: 'AUTO' }, auth);
      expect(retried).toMatchObject({ Status_code: '05', MaterialDocument: '4900059977' });
      expect(migoSpy).toHaveBeenCalledTimes(2);
      expect(toSpy).not.toHaveBeenCalled();
      expect(trSpy).not.toHaveBeenCalled();
    });
  });

  test('classifyCreateFailure maps error classes to stages', () => {
    expect(classifyCreateFailure({ status: 400 })).toBe('RESERVATION_REJECTED');
    expect(classifyCreateFailure({ status: 503 })).toBe('RESERVATION_REJECTED');
    expect(classifyCreateFailure({ status: 504 })).toBe('RESERVATION_UNKNOWN');
    expect(classifyCreateFailure(new Error('socket hang up'))).toBe('RESERVATION_UNKNOWN');
    expect(classifyCreateFailure({ status: 500, reservationNo: '1' })).toBe('RESERVATION_CREATED_MISMATCH');
    expect(STAGES.UNRESOLVED_STAGES).toEqual(['RESERVATION_UNKNOWN', 'LOCAL_PERSIST_FAILED', 'RESERVATION_CREATED_MISMATCH']);
  });
});
