'use strict';

/**
 * Step 7.8: reservation-creation idempotency. The business key is the SHA-256 of the reservation intent
 * (canonical fields + user). Identical intent -> the same SAP reservation; concurrent identical intents ->
 * exactly one BAPI_RESERVATION_CREATE1; a different quantity / batch / movement -> a different intent.
 * Mock adapter only - no SAP call.
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
const { ReservationAttemptStore, ATTEMPT_ENTITY } = require('../../../srv/wm/reservation-entry/ReservationAttemptStore');

const { POST } = cds.test(__dirname + '/../../../');
const { SELECT, DELETE } = cds.ql;

const TRACK = 'saps4hana.wm.ReservationTrack';
const LOGS = 'saps4hana.wm.ReservationLog';
const auth = { auth: { username: 'carol', password: '' } };
const URL = '/odata/v4/reservation-entry/createReservationEntry';
const body = { MovementType: '311', Plant: '1120', StorageLocation: 'CS01', ReceivingStorageLocation: 'ST02', Material: '1000000045', Quantity: 3, Unit: 'KG' };
const hash = (p, u = 'carol') => ReservationAttemptStore.hash(p, u);

let seq = 0;
const nextRes = () => { seq += 1; const n = String(778000 + seq); return { success: true, reservationNo: n, reservationNoRaw: `0000${n}`, reservationItem: '0001', sapVerified: true, status: '01' }; };
const okTr = { success: true, warehouseNumber: 'W01', trNumber: '1007078', trNumberRaw: '0001007078', trItem: '0001', status: '02' };
const spies = [];
const spy = (m) => { const s = jest.spyOn(ReservationProcessAdapter.prototype, m); spies.push(s); return s; };
const create = (extra = {}, a = auth) => POST(URL, { ...body, ...extra }, a);
const settled = (ps) => Promise.allSettled(ps);
const okCount = (rs) => rs.filter((r) => r.status === 'fulfilled').length;
const conflicts = (rs) => rs.filter((r) => r.status === 'rejected' && r.reason?.response?.status === 409).length;

describe('Step 7.8: business key of a reservation intent', () => {
  test('deterministic: same intent -> same key regardless of case, padding, key order, extra non-business fields', () => {
    const a = hash({ ...body, ClientAttemptId: 'x', WarehouseNumber: 'W01', MaterialName: 'n' });
    const b = hash({ Unit: 'kg', Quantity: '3', Material: '000000001000000045', ReceivingStorageLocation: 'st02', StorageLocation: 'cs01', Plant: '1120', MovementType: '311', Batch: '' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ['quantity', { Quantity: 4 }],
    ['batch', { Batch: 'B1' }],
    ['movement type', { MovementType: '301', ReceivingPlant: '1130' }],
    ['material', { Material: '1000000046' }],
    ['plant', { Plant: '1130' }],
    ['storage location', { StorageLocation: 'HS01' }],
    ['receiving storage location', { ReceivingStorageLocation: 'HS01' }],
    ['account assignment', { CostCenter: '1011201301' }],
    ['unit', { Unit: 'G' }]
  ])('a different %s is a different intent', (_label, diff) => {
    expect(hash({ ...body, ...diff })).not.toBe(hash(body));
  });

  test('a different user is a different intent', () => {
    expect(hash(body, 'carol')).not.toBe(hash(body, 'alice'));
  });
});

describe('Step 7.8: one SAP reservation per intent', () => {
  beforeEach(() => {
    spies.push(jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => {
      if (table === 'T320') return [{ LGNUM: 'W01' }];
      throw Object.assign(new Error('node-rfc is not available (test stub)'), { status: 503 });
    }));
    spies.push(jest.spyOn(ReservationProcessAdapter.prototype, 'checkAuthorization').mockResolvedValue(true));
    spy('createTransferRequirement').mockResolvedValue(okTr);
  });
  afterEach(async () => {
    while (spies.length) spies.pop().mockRestore();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    await cds.db.run(DELETE.from(LOGS).where({ ReservationNo: { like: '0000778%' } }));
    await cds.db.run(DELETE.from(TRACK).where({ ReservationNo: { like: '0000778%' } }));
  });

  test('identical request from another form instance (different ClientAttemptId) -> the existing reservation, one BAPI call', async () => {
    const resSpy = spy('createReservation').mockImplementation(async () => nextRes());
    const first = (await create({ ClientAttemptId: 'form-a' })).data;
    const second = (await create({ ClientAttemptId: 'form-b' })).data;
    expect(second.ReservationNo).toBe(first.ReservationNo);
    expect(resSpy).toHaveBeenCalledTimes(1);
    expect(await cds.db.run(SELECT.from(ATTEMPT_ENTITY))).toHaveLength(1);
  });

  test('Request A and Request B concurrently, no ClientAttemptId -> ONE SAP reservation, the other gets 409', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const resSpy = spy('createReservation').mockImplementation(async () => { await gate; return nextRes(); });
    const a = create();
    await new Promise((r) => setTimeout(r, 150));
    const b = create();
    setTimeout(release, 200);
    const rs = await settled([a, b]);
    expect(okCount(rs)).toBe(1);
    expect(conflicts(rs)).toBe(1);
    expect(resSpy).toHaveBeenCalledTimes(1);
    expect(await cds.db.run(SELECT.from(TRACK).where({ ReservationNo: { like: '0000778%' } }))).toHaveLength(1);
  });

  test('three concurrent identical requests -> one BAPI call, two 409 in-progress, then a replay returns the same reservation', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const resSpy = spy('createReservation').mockImplementation(async () => { await gate; return nextRes(); });
    const a = create();
    await new Promise((r) => setTimeout(r, 150));
    const rest = settled([create(), create()]);
    const rs = await rest;
    expect(conflicts(rs)).toBe(2);
    release();
    const { data: first } = await a;
    const { data: replay } = await create();
    expect(replay.ReservationNo).toBe(first.ReservationNo);
    expect(resSpy).toHaveBeenCalledTimes(1);
  });

  test('concurrent requests with different intents (quantity 3 vs 4) -> two SAP reservations', async () => {
    const resSpy = spy('createReservation').mockImplementation(async () => { await new Promise((r) => setTimeout(r, 100)); return nextRes(); });
    const rs = await settled([create({ Quantity: 3 }), create({ Quantity: 4 })]);
    expect(okCount(rs)).toBe(2);
    expect(resSpy).toHaveBeenCalledTimes(2);
    const nos = rs.map((r) => r.value.data.ReservationNo);
    expect(new Set(nos).size).toBe(2);
  });

  test('different batch is a different intent: both are created', async () => {
    const resSpy = spy('createReservation').mockImplementation(async () => nextRes());
    const x = (await create({ Batch: 'B1' })).data;
    const y = (await create({ Batch: 'B2' })).data;
    expect(x.ReservationNo).not.toBe(y.ReservationNo);
    expect(resSpy).toHaveBeenCalledTimes(2);
  });

  test('failed TR then identical re-submit: no new reservation; retryStep resumes at LB01', async () => {
    const resSpy = spy('createReservation').mockImplementation(async () => nextRes());
    // jest.spyOn on an already spied method returns that spy: re-program the TR stub from beforeEach.
    const trSpy = spy('createTransferRequirement').mockReset().mockRejectedValueOnce(new Error('L_TR_CREATE: no quant')).mockResolvedValue(okTr);
    spy('writeApplicationLog').mockResolvedValue({ logHandle: '' });
    const first = (await create()).data;
    expect(first.Status_code).toBe('11');
    const again = (await create()).data;
    expect(again).toMatchObject({ ReservationNo: first.ReservationNo, Status_code: '11' });
    expect(resSpy).toHaveBeenCalledTimes(1);
    const { data: retried } = await POST('/odata/v4/reservation-entry/retryStep', { ReservationNo: first.ReservationNo, ReservationItem: '0001', Step: 'AUTO' }, auth);
    expect(retried).toMatchObject({ Status_code: '02', TransferRequirement: '0001007078' });
    expect(trSpy).toHaveBeenCalledTimes(2);
    expect(resSpy).toHaveBeenCalledTimes(1);
  });

  test('replay window elapsed: an identical intent is a new reservation again', async () => {
    const resSpy = spy('createReservation').mockImplementation(async () => nextRes());
    await create();
    const old = new Date(Date.now() - ReservationAttemptStore.replayWindowMs() - 1000).toISOString();
    await cds.db.run(cds.ql.UPDATE(ATTEMPT_ENTITY).set({ createdAt: old }));
    const second = (await create()).data;
    expect(resSpy).toHaveBeenCalledTimes(2);
    expect(second.ReservationNo).not.toBe('');
  });
});
