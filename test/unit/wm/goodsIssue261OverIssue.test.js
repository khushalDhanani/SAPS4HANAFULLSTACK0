const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');

describe('Chunks 1–3 — Reservation, Context, and Batch Validation (Movement 261)', () => {
  const handlers = {};
  PerTypeGoodsIssueHandler.init({
    on: (event, handler) => {
      handlers[event] = handler;
    }
  });

  const makeReq = (data) => ({
    data,
    user: { id: 'CLERK_TEST' },
    error: jest.fn((status, msg) => {
      const err = new Error(msg);
      err.status = status;
      return err;
    })
  });

  beforeEach(() => {
    jest.spyOn(GoodsIssueAdapter, 'validateBatchForPosting').mockResolvedValue({ valid: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Acceptance: if SAP open quantity is 40 and client sends 41, return validation error and do not call SAP posting API', async () => {
    // Authoritative SAP reservation item: required 100, withdrawn 60 -> OpenQty = 40
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01',
      Unit: 'KG',
      RequiredQty: 100,
      WithdrawnQty: 60,
      OpenQty: 40,
      ReservationItemIsFinallyIssued: false,
      ReservationItmIsMarkedForDeltn: false
    });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 41, // 41 > 40: over-issue
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    // Must return validation error (422)
    expect(req.error).toHaveBeenCalledWith(
      422,
      expect.stringContaining('Issue quantity 41 exceeds the open reservation quantity 40 for reservation 18025 item 0001')
    );
    // Must NOT call SAP posting API
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('Never trust UI OpenQty: client passes OpenQty 100 in payload, but SAP open quantity is 40 and client sends 41 -> rejected before posting', async () => {
    // Authoritative SAP item has 40 open
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01',
      Unit: 'KG',
      RequiredQty: 100,
      WithdrawnQty: 60,
      OpenQty: 40,
      ReservationItemIsFinallyIssued: false,
      ReservationItmIsMarkedForDeltn: false
    });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 41,
      OpenQty: 100, // Stale/tampered client value
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).toHaveBeenCalledWith(
      422,
      expect.stringContaining('Issue quantity 41 exceeds the open reservation quantity 40')
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('Valid issue: client sends 40 when SAP open quantity is 40 -> validation passes and calls SAP posting API', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01',
      Unit: 'KG',
      RequiredQty: 100,
      WithdrawnQty: 60,
      OpenQty: 40,
      ReservationItemIsFinallyIssued: false,
      ReservationItmIsMarkedForDeltn: false
    });
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900001234',
      MaterialDocYear: '2026',
      Confirmed: true
    });

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 40, // Exactly equals open quantity
      Unit: 'KG'
    });

    const result = await handlers['postGoodsIssue261'](req);

    expect(req.error).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalled();
    expect(result).toMatchObject({
      MaterialDocument: '4900001234',
      MaterialDocYear: '2026'
    });
  });

  test.each([
    ['Material', '1000000999'],
    ['Plant', '1130'],
    ['StorageLocation', 'HS01']
  ])('Rejects a submitted %s that conflicts with the SAP reservation item', async (field, value) => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      RequiredQty: 100,
      WithdrawnQty: 60,
      OpenQty: 40,
      ReservationItemIsFinallyIssued: false,
      ReservationItmIsMarkedForDeltn: false
    });
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      [field]: value,
      IssueQty: 10,
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      expect.stringContaining(`${field === 'StorageLocation' ? 'Storage Location' : field} (submitted ${value}, reservation`)
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('Uses SAP reservation material, plant, and storage location when the client omits them', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01',
      RequiredQty: 100,
      WithdrawnQty: 60,
      OpenQty: 40,
      ReservationItemIsFinallyIssued: false,
      ReservationItmIsMarkedForDeltn: false
    });
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900001234',
      MaterialDocYear: '2026',
      Confirmed: true
    });
    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      IssueQty: 10,
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01'
    }));
  });

  test('Zero remaining open quantity: SAP RequiredQty equals WithdrawnQty -> rejects with validation error', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01',
      Unit: 'KG',
      RequiredQty: 50,
      WithdrawnQty: 50,
      OpenQty: 0,
      ReservationItemIsFinallyIssued: false,
      ReservationItmIsMarkedForDeltn: false
    });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 1,
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).toHaveBeenCalledWith(
      422,
      expect.stringContaining('has no open quantity remaining (open quantity is 0')
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('SAP status flag: Reservation item marked as finally issued in SAP -> rejects with validation error', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01',
      Unit: 'KG',
      RequiredQty: 100,
      WithdrawnQty: 50,
      OpenQty: 0,
      ReservationItemIsFinallyIssued: true,
      ReservationItmIsMarkedForDeltn: false
    });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 10,
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).toHaveBeenCalledWith(
      422,
      expect.stringContaining('is marked as finally issued in SAP')
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('SAP status flag: Reservation item marked for deletion in SAP -> rejects with validation error', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      Batch: 'BATCH01',
      Unit: 'KG',
      RequiredQty: 100,
      WithdrawnQty: 0,
      OpenQty: 0,
      ReservationItemIsFinallyIssued: false,
      ReservationItmIsMarkedForDeltn: true
    });

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 10,
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).toHaveBeenCalledWith(
      422,
      expect.stringContaining('is marked for deletion in SAP')
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('Unverifiable reservation: SAP 404 (not found) blocks posting and fails closed', async () => {
    const sapNotFound = new Error('Reservation 18025 item 0001 not found or already completed in SAP.');
    sapNotFound.status = 404;
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockRejectedValue(sapNotFound);

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 10,
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).toHaveBeenCalledWith(
      404,
      expect.stringContaining('not found or already completed in SAP')
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('Unverifiable reservation: SAP 502 (network failure) blocks posting and fails closed', async () => {
    const sapOutage = new Error('SAP connection failure while reading reservation 18025 item 0001');
    sapOutage.status = 502;
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockRejectedValue(sapOutage);

    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');

    const req = makeReq({
      ReservationNo: '18025',
      ReservationItem: '0001',
      Material: '1000000204',
      Plant: '1120',
      StorageLocation: 'CS01',
      IssueQty: 10,
      Unit: 'KG'
    });

    await handlers['postGoodsIssue261'](req);

    expect(req.error).toHaveBeenCalledWith(
      502,
      expect.stringContaining('SAP connection failure while reading reservation 18025 item 0001')
    );
    expect(postSpy).not.toHaveBeenCalled();
  });
});
