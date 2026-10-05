/**
 * Phase 5 #3 (handler routing) + #4 (frontend contract).
 *
 * #3 - A per-type action handler enforces ONLY its own type's validation. A 201-shaped payload
 *      (CostCenter, no reservation) sent to postGoodsIssue261 is rejected by 261's own validation
 *      (reservation required) - proving there is no fall-through to 201 logic, and vice-versa.
 * #4 - Each frontend GoodsIssueNNNService posts only to /postGoodsIssueNNN (never the removed
 *      shared /postGoodsIssue endpoint).
 */

const fs = require('fs');
const path = require('path');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');

function fakeService() {
  const handlers = {};
  const srv = {
    on: jest.fn((event, entityOrHandler, handler) => {
      const key = typeof entityOrHandler === 'string' ? `${event}:${entityOrHandler}` : event;
      handlers[key] = typeof entityOrHandler === 'function' ? entityOrHandler : handler;
    })
  };
  PerTypeGoodsIssueHandler.init(srv);
  return handlers;
}

function req(data) {
  return { data, user: { id: 'TESTER' }, error: jest.fn((code, msg) => ({ code, message: msg })) };
}

describe('Phase 5 #3 - handler routing (no cross-type fall-through)', () => {
  const handlers = fakeService();

  test('postGoodsIssue201 rejects a payload with reservation and no CostCenter via 201 validation', async () => {
    const r = req({ ReservationNo: '518023', ReservationItem: '0001', Material: 'M1', Plant: '1130', StorageLocation: 'CS02', IssueQty: 1, Unit: 'EA' });
    await handlers['postGoodsIssue201'](r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('Cost Center'));
  });

  test('postGoodsIssue301 rejects a payload with no reservation via 301 validation', async () => {
    const r = req({ Material: 'M1', Plant: '1130', StorageLocation: 'CS02', IssueQty: 1, Unit: 'EA', ReceivingPlant: '1600' });
    await handlers['postGoodsIssue301'](r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('ReservationNo'));
  });

  describe('postGoodsIssue301 against a reservation with no storage location / receiving plant', () => {
    const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
    const body = { ReservationNo: '519144', ReservationItem: '0001', Material: 'M1', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS' };
    let post;
    beforeEach(() => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: 'M1', Plant: '1120', StorageLocation: '', ReceivingPlant: '', OpenQty: 1 });
      post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue301').mockResolvedValue({ MaterialDocument: '4900000001', MaterialDocYear: '2026' });
    });
    afterEach(() => jest.restoreAllMocks());

    test('blocks the post when neither the request nor the reservation has a receiving plant', async () => {
      const r = req(body);
      await handlers['postGoodsIssue301'](r);
      expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('ReceivingPlant is required'));
      expect(post).not.toHaveBeenCalled();
    });

    test('accepts a user-chosen storage location and receiving plant', async () => {
      const r = req(Object.assign({ ReceivingPlant: '1130' }, body));
      const res = await handlers['postGoodsIssue301'](r);
      expect(r.error).not.toHaveBeenCalled();
      expect(res.MaterialDocument).toBe('4900000001');
    });
  });

  test('all per-type actions are registered (and no shared postGoodsIssue action)', () => {
    expect(typeof handlers['postGoodsIssue201']).toBe('function');
    expect(typeof handlers['postGoodsIssue301']).toBe('function');
    expect(typeof handlers['postGoodsIssue311']).toBe('function');
    expect(handlers['postGoodsIssue261']).toBeUndefined();
    expect(handlers['postGoodsIssue']).toBeUndefined();
  });
});

describe('postGoodsIssue201 direct posting and error classification', () => {
  const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
  const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
  const handlers = fakeService();
  const payload = { CostCenter: '1011101301', Material: '8000009753', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS' };
  let setStatus;

  beforeEach(() => {
    // No database in this suite: the attempt log is stubbed (its own behaviour is covered in goodsIssueAttempt.test.js).
    jest.spyOn(GoodsIssueAttemptStore, 'create').mockResolvedValue({});
    setStatus = jest.spyOn(GoodsIssueAttemptStore, 'setStatus').mockResolvedValue();
    jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({ StockReadSuccess: true, StockSufficient: true });
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    [422, 'Deficit of SL Unrestr. prod. 1 NOS'],
    [403, 'HTTP 403 Forbidden'],
    [504, 'SAP S/4HANA did not confirm the outcome']
  ])('surfaces a %i from the adapter directly', async (status, message) => {
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockRejectedValue(Object.assign(new Error(message), { status }));
    const r = req(payload);
    await handlers['postGoodsIssue201'](r);
    expect(r.error).toHaveBeenCalledWith(status, expect.stringContaining(message));
    expect(setStatus).toHaveBeenCalledWith(expect.stringMatching(/^GI/), expect.stringMatching(/rejected|unconfirmed/), expect.anything());
  });

  test('blocks the posting with 503 when the attempt cannot be recorded', async () => {
    GoodsIssueAttemptStore.create.mockRejectedValue(Object.assign(new Error('no database is bound'), { status: 503 }));
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201');
    const r = req(payload);
    await handlers['postGoodsIssue201'](r);
    expect(r.error).toHaveBeenCalledWith(503, expect.stringContaining('NOT sent to SAP'));
    expect(post).not.toHaveBeenCalled();
    expect(GoodsIssueAdapter.revalidateStockBeforePosting).not.toHaveBeenCalled();
  });

  test('a closed posting period is surfaced as 400 with the SAP text in details', async () => {
    const details = [{ code: 'UNKNOWN', message: 'Posting only possible in periods 2026/06 and 2026/05 in company code 1000' }];
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockRejectedValue(Object.assign(new Error('The posting period for the posting date is closed'), { status: 400, code: 'POSTING_PERIOD_CLOSED', details }));
    const r = req(payload);
    await handlers['postGoodsIssue201'](r);
    expect(r.error).toHaveBeenCalledWith(expect.objectContaining({ status: 400, code: 'POSTING_PERIOD_CLOSED', details }));
    expect(setStatus).toHaveBeenCalledWith(expect.anything(), 'rejected', expect.anything());
  });

  test('surfaces 501 capability-unavailable error directly as 503 and marks attempt rejected', async () => {
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockRejectedValue(Object.assign(new Error('SAP S/4HANA Backend Posting Capability Unavailable'), { status: 501 }));
    const r = req(payload);
    await handlers['postGoodsIssue201'](r);
    expect(r.error).toHaveBeenCalledWith(503, expect.stringContaining('SAP S/4HANA service unreachable or posting capability unavailable'));
    expect(setStatus).toHaveBeenCalledWith(expect.stringMatching(/^GI/), 'rejected', expect.anything());
  });

  test('generates a new reference for every posting attempt', async () => {
    const post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockResolvedValue({ MaterialDocument: '4900055001', MaterialDocYear: '2026', Success: true });
    await handlers['postGoodsIssue201'](req(payload));
    await handlers['postGoodsIssue201'](req(payload));
    expect(post.mock.calls[0][0].ReferenceDocument).not.toBe(post.mock.calls[1][0].ReferenceDocument);
  });
});

describe('Phase 5 #4 - frontend service contract (each posts only to its own action)', () => {
  const FE = path.resolve(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue/service');

  test.each(['201', '301', '311'])('GoodsIssue%sService posts to /postGoodsIssue%s and never the shared endpoint', (type) => {
    const src = fs.readFileSync(path.join(FE, `GoodsIssue${type}Service.js`), 'utf8');
    // The posting call must target the type's own action.
    expect(src).toContain(`/postGoodsIssue${type}`);
    // ...and must NOT post to the removed shared endpoint. (Reversal uses /reverseGoodsIssue, allowed.)
    const postsSharedEndpoint = /post\(\s*BASE_PATH_GI\s*\+\s*["']\/postGoodsIssue["']/.test(src)
      || /["']\/odata\/v4\/goods-issue\/postGoodsIssue["']/.test(src);
    expect(postsSharedEndpoint).toBe(false);
  });
});
