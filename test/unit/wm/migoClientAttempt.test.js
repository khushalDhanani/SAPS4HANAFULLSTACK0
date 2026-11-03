'use strict';

// [mock only, not SAP verification] A resend of a partial MIGO must not post twice; the real idempotency check runs inside the request.
const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST } = cds.test(__dirname + '/../../../');
const { SELECT, INSERT, DELETE } = cds.ql;

const TRACK_ENTITY = 'saps4hana.wm.ReservationTrack';
const URL = '/odata/v4/reservation-entry/postMigoGoodsMovement';
const authClerk = { auth: { username: 'test-clerk-1120', password: '' } };
const RES = '0000777301';
const FIRST_DOC = '4900070001';
const NEXT_DOC = '4900070002';
const PID_1 = '11111111-1111-4111-8111-111111111111';
const PID_2 = '22222222-2222-4222-8222-222222222222';
const TR_TO_URL = '/odata/v4/tr-to/postMigoGoodsMovement';
const body = { MovementType: '201', ReservationNo: RES, ReservationItem: '0001', Quantity: 4 };

describe('postMigoGoodsMovement: telling a resend from a further issue', () => {
  let posted;
  let spies;

  /** Stands in for the BAPI: runs the real check, and "SAP" remembers the process ids it has posted. */
  const sapPosts = new Map();
  const postThroughRealCheck = async function (params) {
    const check = await this.checkMigoIdempotency({
      reservationNumber: params.reservationNumber,
      reservationItem: params.reservationItem,
      transferOrder: params.transferOrder,
      processId: params.processId,
      movementType: params.movementType,
      plant: params.plant
    });
    if (check.alreadyPosted) return { success: true, alreadyPosted: true, materialDocument: check.materialDocument, materialDocYear: '2026', businessKey: check.businessKey, status: '05' };
    posted.push(params);
    sapPosts.set(params.processId, NEXT_DOC);
    return { success: true, materialDocument: NEXT_DOC, materialDocYear: '2026', businessKey: check.businessKey, status: '05', stockEffect: 'x' };
  };

  beforeEach(async () => {
    posted = [];
    sapPosts.clear();
    await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
      ReservationNo: RES, ReservationItem: '0001', MovementType: '201', Material: '1000000045', Plant: '1120', StorageLocation: 'CS01',
      Quantity: 10, Unit: 'KG', CostCenter: '1011201301', Status_code: '05', MaterialDocument: FIRST_DOC, MaterialDocYear: '2026',
      WithdrawnQuantity: 4, RemainingQuantity: 6, CompletelyProcessed: false, ProcessId: PID_1, MigoBusinessKey: `RES:777301/1#TO:NONE#PID:${PID_1}`
    }));
    spies = [
      jest.spyOn(ReservationProcessAdapter.prototype, 'checkAuthorization').mockResolvedValue(true),
      jest.spyOn(ReservationProcessAdapter.prototype, 'postGoodsMovement').mockImplementation(postThroughRealCheck),
      jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table, _fields, where) => {
        if (table === 'MATDOC') {
          const bktxt = (String(where[0]).match(/^BKTXT = '(.+)'$/) || [])[1];
          if (bktxt) {
            const hit = [...sapPosts].find(([pid]) => pid.replace(/-/g, '').slice(0, 25) === bktxt);
            return hit ? [{ MBLNR: hit[1], MJAHR: '2026' }] : [];
          }
          return String(where[0]).startsWith('RSNUM') ? [{ MBLNR: FIRST_DOC, MJAHR: '2026' }] : [];
        }
        if (table === 'RESB') return [{ ENMNG: '4.000', KZEAR: '', WERKS: '1120' }];
        if (table === 'LTAP') return [{ WERKS: '1120' }];
        return [];
      })
    ];
  });

  afterEach(async () => {
    spies.forEach((s) => s.mockRestore());
    await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    await cds.db.run(DELETE.from('saps4hana.wm.ReservationLog').where({ ReservationNo: RES }));
  });

  test('a further issue with a new id posts the new quantity', async () => {
    const { data } = await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    expect(posted).toHaveLength(1);
    expect(data.MaterialDocument).toBe(NEXT_DOC);
  });

  test('resending the same id returns the document and posts nothing more', async () => {
    await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    const { data } = await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    expect(posted).toHaveLength(1);
    expect(data.MaterialDocument).toBe(NEXT_DOC);
  });

  test('a resend after the tracking update was lost finds the document through BKTXT', async () => {
    await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    await cds.db.run(cds.ql.UPDATE(TRACK_ENTITY).set({ MaterialDocument: FIRST_DOC, MigoBusinessKey: `RES:777301/1#TO:NONE#PID:${PID_1}`, ProcessId: PID_1 }).where({ ReservationNo: RES }));
    const { data } = await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    expect(posted).toHaveLength(1);
    expect(data.MaterialDocument).toBe(NEXT_DOC);
  });

  test('a further issue without an id is refused before SAP', async () => {
    await expect(POST(URL, body, authClerk)).rejects.toMatchObject({ response: { status: 400, data: { error: { message: expect.stringContaining('ClientAttemptId') } } } });
    expect(ReservationProcessAdapter.prototype.postGoodsMovement).not.toHaveBeenCalled();
    const track = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    expect(track.Status_code).toBe('05');
  });

  test('a failed further issue keeps its own id, so the retry finds its document and not the earlier one', async () => {
    ReservationProcessAdapter.prototype.postGoodsMovement.mockImplementationOnce(async function (params) {
      sapPosts.set(params.processId, NEXT_DOC); // SAP committed, the response was lost
      throw Object.assign(new Error('Gateway timeout'), { status: 504 });
    });
    const { data: failed } = await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    expect(failed.Status_code).toBe('90');

    const { data } = await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    expect(posted).toHaveLength(0);
    expect(data).toMatchObject({ MaterialDocument: NEXT_DOC, Status_code: '05' });
  });

  test('a resend does not count the quantity again when the SAP read-back is unavailable', async () => {
    await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    const first = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    const second = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    expect(Number(second.WithdrawnQuantity)).toBe(Number(first.WithdrawnQuantity));
    expect(Number(second.RemainingQuantity)).toBe(Number(first.RemainingQuantity));
  });

  test('the same id on another item is a different attempt', async () => {
    await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
      ReservationNo: RES, ReservationItem: '0002', MovementType: '201', Material: '1000000045', Plant: '1120', StorageLocation: 'CS01',
      Quantity: 10, Unit: 'KG', CostCenter: '1011201301', Status_code: '03'
    }));
    await POST(URL, { ...body, ClientAttemptId: 'attempt-2' }, authClerk);
    await POST(URL, { ...body, ReservationItem: '0002', ClientAttemptId: 'attempt-2' }, authClerk);
    expect(posted).toHaveLength(2);
    expect(posted[0].processId).not.toBe(posted[1].processId);
  });

  describe('tr-to, the action behind the scan screen', () => {
    test('a further issue with a new ProcessId posts the new quantity', async () => {
      const { data } = await POST(TR_TO_URL, { ...body, ProcessId: PID_2 }, authClerk);
      expect(posted).toHaveLength(1);
      expect(data).toMatchObject({ MaterialDocument: NEXT_DOC, AlreadyPosted: false });
    });

    test('resending the same ProcessId returns the document and posts nothing more', async () => {
      await POST(TR_TO_URL, { ...body, ProcessId: PID_2 }, authClerk);
      const { data } = await POST(TR_TO_URL, { ...body, ProcessId: PID_2 }, authClerk);
      expect(posted).toHaveLength(1);
      expect(data).toMatchObject({ MaterialDocument: NEXT_DOC, AlreadyPosted: true });
    });

    test('a further issue without a ProcessId is refused before SAP', async () => {
      await expect(POST(TR_TO_URL, body, authClerk)).rejects.toMatchObject({ response: { status: 400, data: { error: { message: expect.stringContaining('ProcessId') } } } });
      expect(ReservationProcessAdapter.prototype.postGoodsMovement).not.toHaveBeenCalled();
    });

    test('a new Transfer Order on a row with an earlier document posts, even if an old posted status was left behind', async () => {
      // createTOFromTR has already written the new TO, status 04 and this step's ProcessId.
      await cds.db.run(cds.ql.UPDATE(TRACK_ENTITY).set({ TransferOrder: '1037999', Status_code: '04', ProcessStatus: 'MIGO_POSTED', ProcessId: PID_2 }).where({ ReservationNo: RES }));
      const { data } = await POST(TR_TO_URL, { ...body, TransferOrder: '1037999', ProcessId: PID_2 }, authClerk);
      expect(posted).toHaveLength(1);
      expect(data).toMatchObject({ MaterialDocument: NEXT_DOC, AlreadyPosted: false });
    });
  });
});
