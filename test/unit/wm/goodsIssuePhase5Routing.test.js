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

  test('postGoodsIssue261 rejects a 201-shaped payload (CostCenter, no reservation) via 261 validation', async () => {
    const r = req({ CostCenter: '1011202902', Material: 'M1', Plant: '1130', StorageLocation: 'CS01', IssueQty: 1, Unit: 'EA' });
    await handlers['postGoodsIssue261'](r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('ReservationNo'));
  });

  test('postGoodsIssue201 rejects a 261-shaped payload (reservation, no CostCenter) via 201 validation', async () => {
    const r = req({ ReservationNo: '518023', ReservationItem: '0001', Material: 'M1', Plant: '1130', StorageLocation: 'CS02', IssueQty: 1, Unit: 'EA' });
    await handlers['postGoodsIssue201'](r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('Cost Center'));
  });

  test('postGoodsIssue301 rejects a payload with no reservation via 301 validation', async () => {
    const r = req({ Material: 'M1', Plant: '1130', StorageLocation: 'CS02', IssueQty: 1, Unit: 'EA', ReceivingPlant: '1600' });
    await handlers['postGoodsIssue301'](r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('ReservationNo'));
  });

  test('all four per-type actions are registered (and no shared postGoodsIssue action)', () => {
    expect(typeof handlers['postGoodsIssue201']).toBe('function');
    expect(typeof handlers['postGoodsIssue261']).toBe('function');
    expect(typeof handlers['postGoodsIssue301']).toBe('function');
    expect(typeof handlers['postGoodsIssue311']).toBe('function');
    expect(handlers['postGoodsIssue']).toBeUndefined();
  });
});

describe('Phase 5 #4 - frontend service contract (each posts only to its own action)', () => {
  const FE = path.resolve(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue/service');

  test.each(['201', '261', '301', '311'])('GoodsIssue%sService posts to /postGoodsIssue%s and never the shared endpoint', (type) => {
    const src = fs.readFileSync(path.join(FE, `GoodsIssue${type}Service.js`), 'utf8');
    // The posting call must target the type's own action.
    expect(src).toContain(`/postGoodsIssue${type}`);
    // ...and must NOT post to the removed shared endpoint. (Reversal uses /reverseGoodsIssue, allowed.)
    const postsSharedEndpoint = /post\(\s*BASE_PATH_GI\s*\+\s*["']\/postGoodsIssue["']/.test(src)
      || /["']\/odata\/v4\/goods-issue\/postGoodsIssue["']/.test(src);
    expect(postsSharedEndpoint).toBe(false);
  });
});
