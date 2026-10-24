'use strict';

const handlerModule = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

function register() {
  const handlers = {};
  handlerModule.init({ on: (name, fn) => { handlers[name] = fn; } });
  return handlers;
}

function request(data) {
  return { data, user: { id: 'TESTER' }, error: jest.fn((status, message) => ({ status, message })) };
}

describe('per-type Goods Issue request movement integrity', () => {
  let handlers;
  let claim;
  let post201;
  let post301;
  let post311;

  beforeEach(() => {
    handlers = register();
    claim = jest.spyOn(GoodsIssueAttemptStore, 'createOrGet');
    post201 = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201');
    post301 = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue301');
    post311 = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue311');
  });

  afterEach(() => jest.restoreAllMocks());

  test.each(['postGoodsIssue201', 'postGoodsIssue301', 'postGoodsIssue311'])(
    '%s rejects a missing request MovementType before attempt claim or SAP adapter',
    async (action) => {
      const req = request({});
      await handlers[action](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('MovementType'));
      expect(claim).not.toHaveBeenCalled();
      expect(post201).not.toHaveBeenCalled();
      expect(post301).not.toHaveBeenCalled();
      expect(post311).not.toHaveBeenCalled();
    }
  );

  test('261 sent to the 201 action is rejected before attempt claim or SAP adapter', async () => {
    const req = request({
      MovementType: '261', CostCenter: '1011201301', Material: 'M1', IssueQty: 1,
      Unit: 'EA', Plant: '1120', StorageLocation: 'CS01'
    });
    await handlers.postGoodsIssue201(req);
    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('MovementType'));
    expect(claim).not.toHaveBeenCalled();
    expect(post201).not.toHaveBeenCalled();
  });
});
