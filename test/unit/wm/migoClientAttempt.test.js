'use strict';

// [mock only, not SAP verification] A resend of a MIGO must not post twice; the real idempotency check runs inside the request.
const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST } = cds.test(__dirname + '/../../../');

const authClerk = { auth: { username: 'test-clerk-1120', password: '' } };
const RES = '0000777301';
const FIRST_DOC = '4900070001';
const NEXT_DOC = '4900070002';
const PID_2 = '22222222-2222-4222-8222-222222222222';
const TR_TO_URL = '/odata/v4/tr-to/postMigoGoodsMovement';
const body = { MovementType: '201', ReservationNo: RES, ReservationItem: '0001', Quantity: 4, Material: '1000000045', Plant: '1120', Unit: 'KG', CostCenter: '1011201301' };

describe('tr-to postMigoGoodsMovement: telling a resend from a further issue', () => {
  let posted;
  let spies;
  let earlierDocument;

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

  beforeEach(() => {
    posted = [];
    sapPosts.clear();
    earlierDocument = false;
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
          return earlierDocument && String(where[0]).startsWith('RSNUM') ? [{ MBLNR: FIRST_DOC, MJAHR: '2026' }] : [];
        }
        if (table === 'RESB') return [{ ENMNG: '4.000', KZEAR: '', WERKS: '1120' }];
        if (table === 'LTAP') return [{ WERKS: '1120' }];
        return [];
      })
    ];
  });

  afterEach(() => spies.forEach((s) => s.mockRestore()));

  test('a first issue posts', async () => {
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

  test('a further issue on an item with an earlier document is refused, because it cannot be told from a repeat', async () => {
    earlierDocument = true;
    const { data } = await POST(TR_TO_URL, { ...body, ProcessId: PID_2 }, authClerk);
    expect(posted).toHaveLength(0);
    expect(data).toMatchObject({ Success: false, MaterialDocument: '', ErrorStep: 'MIGO' });
    expect(data.ErrorMessage).toContain(FIRST_DOC);
  });
});
