const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');

describe('Movement 261 SAP serial validation', () => {
  const handlers = {};
  const reservationItem = {
    Material: '8000009753',
    Plant: '1120',
    StorageLocation: 'HS01',
    Unit: 'EA',
    RequiredQty: 10,
    WithdrawnQty: 0,
    OpenQty: 10,
    ReservationItemIsFinallyIssued: false,
    ReservationItmIsMarkedForDeltn: false
  };
  const payload = (overrides = {}) => ({
    ReservationNo: '519367',
    ReservationItem: '0001',
    Material: '8000009753',
    Plant: '1120',
    StorageLocation: 'HS01',
    IssueQty: 2,
    Unit: 'EA',
    SerialNumbers: ['MACBOOK-004', 'MACBOOK-005'],
    ...overrides
  });
  const makeReq = (data) => ({
    data,
    user: { id: 'TESTER' },
    error: jest.fn((status, message) => {
      const err = new Error(message);
      err.status = status;
      return err;
    })
  });

  PerTypeGoodsIssueHandler.init({ on: (event, handler) => { handlers[event] = handler; } });

  beforeEach(() => {
    GoodsIssueAttemptStore.clearMemoryStore();
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(reservationItem);
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isStaged: true });
    jest.spyOn(GoodsIssueAdapter, 'isSerialManaged').mockResolvedValue(true);
    jest.spyOn(GoodsIssueAdapter, 'validateSerialStatus').mockResolvedValue({ valid: true });
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900001234',
      MaterialDocYear: '2026',
      Confirmed: true
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('serial-managed reservation posts only after exact count and SAP status verification', async () => {
    const req = makeReq(payload());
    await handlers.postGoodsIssue261(req);

    expect(GoodsIssueAdapter.isSerialManaged).toHaveBeenCalledWith('8000009753', '1120');
    expect(GoodsIssueAdapter.validateSerialStatus).toHaveBeenCalledWith(
      '8000009753', '1120', 'HS01', ['MACBOOK-004', 'MACBOOK-005']
    );
    expect(GoodsIssueAdapter.postGoodsIssue261).toHaveBeenCalledTimes(1);
    expect(req.error).not.toHaveBeenCalled();
  });

  test.each([
    ['no serials', []],
    ['too few serials', ['MACBOOK-004']]
  ])('serial-managed material rejects %s before status lookup or SAP posting', async (_label, serialNumbers) => {
    const req = makeReq(payload({ SerialNumbers: serialNumbers }));
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('serial-managed'));
    expect(GoodsIssueAdapter.validateSerialStatus).not.toHaveBeenCalled();
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });

  test('unavailable SAP serial profile blocks posting', async () => {
    GoodsIssueAdapter.isSerialManaged.mockRejectedValueOnce(new Error('SAP profile read failed'));
    const req = makeReq(payload());
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(502, expect.stringContaining('could not be verified'));
    expect(GoodsIssueAdapter.validateSerialStatus).not.toHaveBeenCalled();
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });

  test('serial status rejection blocks posting', async () => {
    const statusError = Object.assign(new Error('Serial belongs to another material.'), { status: 409 });
    GoodsIssueAdapter.validateSerialStatus.mockRejectedValueOnce(statusError);
    const req = makeReq(payload());
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(409, 'Serial belongs to another material.');
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });

  test('a serial validator result without valid=true blocks posting', async () => {
    GoodsIssueAdapter.validateSerialStatus.mockResolvedValueOnce({ valid: false });
    const req = makeReq(payload());
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('did not confirm'));
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });

  test('missing serial status validator blocks supplied serials', async () => {
    GoodsIssueAdapter.validateSerialStatus = undefined;
    const req = makeReq(payload());
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(503, expect.stringContaining('serial status verification is unavailable'));
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });
});
