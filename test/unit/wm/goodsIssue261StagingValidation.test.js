const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');

describe('Movement 261 SAP WM staging validation', () => {
  const handlers = {};
  const reservationItem = {
    Material: '1000000204',
    Plant: '1120',
    StorageLocation: 'CS01',
    Unit: 'KG',
    RequiredQty: 100,
    WithdrawnQty: 0,
    OpenQty: 100,
    ReservationItemIsFinallyIssued: false,
    ReservationItmIsMarkedForDeltn: false
  };
  const payload = () => ({
    ReservationNo: '18025',
    ReservationItem: '0001',
    Material: '1000000204',
    Plant: '1120',
    StorageLocation: 'CS01',
    IssueQty: 10,
    Unit: 'KG'
  });
  const makeReq = () => ({
    data: payload(),
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
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({
      isVerified: true,
      isStaged: true,
      isStagingRequired: true,
      warehouse: 'W01',
      targetType: 'IP1',
      targetBin: '0000001001',
      stagedQty: 10,
      requiredQty: 10,
      uom: 'KG'
    });
    jest.spyOn(GoodsIssueAdapter, 'isSerialManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900001234',
      MaterialDocYear: '2026',
      Confirmed: true
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test('checks SAP WM staging for the requested item, quantity, and unit before posting', async () => {
    const req = makeReq();
    await handlers.postGoodsIssue261(req);

    expect(GoodsIssueAdapter.checkStagingForReservation).toHaveBeenCalledWith(
      '18025',
      '0001',
      { issueQty: 10, issueUnit: 'KG' }
    );
    expect(GoodsIssueAdapter.postGoodsIssue261).toHaveBeenCalledTimes(1);
    expect(req.error).not.toHaveBeenCalled();
  });

  test('blocks an insufficient staged quantity before SAP posting', async () => {
    GoodsIssueAdapter.checkStagingForReservation.mockResolvedValueOnce({
      isVerified: true,
      isStaged: false,
      error: 'Only 5 of 10 KG staged in IP1/0000001001.'
    });
    const req = makeReq();
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('Only 5 of 10 KG'));
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });

  test('blocks an unresolved staging result before SAP posting', async () => {
    GoodsIssueAdapter.checkStagingForReservation.mockResolvedValueOnce({
      isVerified: false,
      isStaged: false,
      error: 'SAP staging target could not be resolved.'
    });
    const req = makeReq();
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(502, 'SAP staging target could not be resolved.');
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });

  test('blocks SAP staging read failures before SAP posting', async () => {
    GoodsIssueAdapter.checkStagingForReservation.mockRejectedValueOnce(
      Object.assign(new Error('LQUA read failed'), { status: 502 })
    );
    const req = makeReq();
    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(502, expect.stringContaining('LQUA read failed'));
    expect(GoodsIssueAdapter.postGoodsIssue261).not.toHaveBeenCalled();
  });
});
