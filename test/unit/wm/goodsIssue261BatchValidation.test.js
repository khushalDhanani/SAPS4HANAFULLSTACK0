const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueBatchesClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueBatchesClient');
const GoodsIssueStockUnitClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');

const reservationItem = (overrides = {}) => ({
  Material: '1000000204',
  Plant: '1120',
  StorageLocation: 'CS01',
  MovementType: '261',
  Batch: '',
  Unit: 'KG',
  RequiredQty: 100,
  WithdrawnQty: 0,
  OpenQty: 100,
  ReservationItemIsFinallyIssued: false,
  ReservationItmIsMarkedForDeltn: false,
  ...overrides
});

const payload = (overrides = {}) => ({
  ReservationNo: '18025',
  ReservationItem: '0001',
  Material: '1000000204',
  Plant: '1120',
  StorageLocation: 'CS01',
  IssueQty: 10,
  Unit: 'KG',
  ...overrides
});

describe('Movement 261 SAP batch validation', () => {
  const handlers = {};

  PerTypeGoodsIssueHandler.init({
    on: (event, handler) => {
      handlers[event] = handler;
    }
  });

  const makeReq = (data) => ({
    data,
    user: { id: 'CLERK_TEST' },
    error: jest.fn((status, message) => {
      const err = new Error(message);
      err.status = status;
      return err;
    })
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    GoodsIssueAttemptStore.clearMemoryStore();
  });

  test('requires a batch when SAP material master marks the material batch-managed', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(reservationItem());
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(true);
    const validateSpy = jest.spyOn(GoodsIssueAdapter, 'validateBatchForPosting');
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = makeReq(payload());

    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      expect.stringContaining('is batch-managed in plant 1120; Batch is required')
    );
    expect(validateSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('rejects a reservation SAP identifies as a non-261 movement item', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative')
      .mockResolvedValue(reservationItem({ MovementType: '201' }));
    const batchSpy = jest.spyOn(GoodsIssueAdapter, 'isBatchManaged');
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = makeReq(payload());

    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('not an open Movement Type 261 item'));
    expect(batchSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('rejects a client batch that conflicts with the SAP reservation batch', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(
      reservationItem({ Batch: 'SAPBATCH' })
    );
    const validateSpy = jest.spyOn(GoodsIssueAdapter, 'validateBatchForPosting');
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = makeReq(payload({ Batch: 'OTHER' }));

    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(
      400,
      expect.stringContaining('Batch (submitted OTHER, reservation SAPBATCH)')
    );
    expect(validateSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('uses and validates the batch assigned to the SAP reservation item', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(
      reservationItem({ Batch: 'SAPBATCH' })
    );
    const managedSpy = jest.spyOn(GoodsIssueAdapter, 'isBatchManaged');
    const validateSpy = jest.spyOn(GoodsIssueAdapter, 'validateBatchForPosting')
      .mockResolvedValue({ valid: true });
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900001234',
      MaterialDocYear: '2026',
      Confirmed: true
    });
    const req = makeReq(payload());

    await handlers.postGoodsIssue261(req);

    expect(managedSpy).not.toHaveBeenCalled();
    expect(validateSpy).toHaveBeenCalledWith('1000000204', '1120', 'CS01', 'SAPBATCH', 10, 'KG');
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ Batch: 'SAPBATCH' }));
    expect(req.error).not.toHaveBeenCalled();
  });

  test('allows a batch-managed reservation only after its selected SAP batch and stock validate', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(reservationItem());
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(true);
    const validateSpy = jest.spyOn(GoodsIssueAdapter, 'validateBatchForPosting')
      .mockResolvedValue({ valid: true, availableStock: 25, requiredBaseQty: 10, stockUnit: 'KG' });
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, isStaged: true });
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      MaterialDocument: '4900001234',
      MaterialDocYear: '2026',
      Confirmed: true
    });
    const req = makeReq(payload({ Batch: 'BATCH01' }));

    await handlers.postGoodsIssue261(req);

    expect(GoodsIssueAdapter.isBatchManaged).not.toHaveBeenCalled();
    expect(validateSpy).toHaveBeenCalledWith('1000000204', '1120', 'CS01', 'BATCH01', 10, 'KG');
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ Batch: 'BATCH01' }));
    expect(req.error).not.toHaveBeenCalled();
  });

  test.each([
    [{ valid: false, status: 422, reason: 'batch expired or not usable' }, 422],
    [new Error('SAP batch stock could not be read'), 502]
  ])('blocks posting when SAP batch validation is not successful', async (validationResult, expectedStatus) => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue(reservationItem());
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(true);
    const validateSpy = jest.spyOn(GoodsIssueAdapter, 'validateBatchForPosting');
    if (validationResult instanceof Error) {
      validationResult.status = expectedStatus;
      validateSpy.mockRejectedValue(validationResult);
    } else {
      validateSpy.mockResolvedValue(validationResult);
    }
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = makeReq(payload({ Batch: 'BATCH01' }));

    await handlers.postGoodsIssue261(req);

    expect(req.error).toHaveBeenCalledWith(expectedStatus, expect.any(String));
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('detects material or plant batch-management indicators from SAP MARA and MARC', async () => {
    const rfc = {
      readTable: jest.fn()
        .mockResolvedValueOnce([{ XCHPF: '' }])
        .mockResolvedValueOnce([{ XCHPF: 'X' }])
    };
    const client = new GoodsIssueStockUnitClient({ adapter: {}, rfc });

    await expect(client.isBatchManaged('1000000204', '1120')).resolves.toBe(true);
    expect(rfc.readTable).toHaveBeenNthCalledWith(
      1,
      'MARA',
      ['XCHPF'],
      ["MATNR = '000000001000000204'"]
    );
    expect(rfc.readTable).toHaveBeenNthCalledWith(
      2,
      'MARC',
      ['XCHPF'],
      ["MATNR = '000000001000000204'", "AND WERKS = '1120'"]
    );
  });

  test('does not classify a material as unmanaged if SAP master flags cannot be read', async () => {
    const client = new GoodsIssueStockUnitClient({
      adapter: {},
      rfc: { readTable: jest.fn().mockResolvedValue([]) }
    });

    await expect(client.isBatchManaged('1000000204', '1120')).rejects.toMatchObject({ status: 502 });
  });
});

describe('SAP batch stock validation for posting', () => {
  const batch = (overrides = {}) => ({
    Material: '1000000204',
    Plant: '1120',
    StorageLocation: 'CS01',
    Batch: 'BATCH01',
    Unit: 'KG',
    AvailableStock: 25,
    IsSelectable: true,
    StatusState: 'Success',
    StatusText: 'VALID',
    ...overrides
  });

  const makeClient = (items, units = []) => {
    const client = new GoodsIssueBatchesClient({ adapter: {} });
    jest.spyOn(client, 'getMaterialBatches').mockResolvedValue(items);
    jest.spyOn(client, 'getMaterialPackagingUnits').mockResolvedValue(units);
    return client;
  };

  test('requires an exact batch with enough stock in the requested storage location', async () => {
    const client = makeClient([batch()]);

    await expect(client.validateBatchForPosting('1000000204', '1120', 'CS01', 'BATCH01', 10, 'KG'))
      .resolves.toMatchObject({ valid: true, availableStock: 25, requiredBaseQty: 10, stockUnit: 'KG' });
    await expect(client.validateBatchForPosting('1000000204', '1120', 'HS01', 'BATCH01', 10, 'KG'))
      .resolves.toMatchObject({ valid: false, status: 422 });
    await expect(client.validateBatchForPosting('1000000204', '1120', 'CS01', 'UNKNOWN', 10, 'KG'))
      .resolves.toMatchObject({ valid: false, status: 422 });
  });

  test('rejects insufficient or unknown batch stock', async () => {
    const insufficient = makeClient([batch({ AvailableStock: 4 })]);
    await expect(insufficient.validateBatchForPosting('1000000204', '1120', 'CS01', 'BATCH01', 10, 'KG'))
      .resolves.toMatchObject({ valid: false, status: 422, reason: expect.stringContaining('4 KG available') });

    const unknown = makeClient([batch({ AvailableStock: null })]);
    await expect(unknown.validateBatchForPosting('1000000204', '1120', 'CS01', 'BATCH01', 10, 'KG'))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('could not be verified') });
  });

  test('converts requested quantity to the SAP batch stock unit before comparing availability', async () => {
    const client = makeClient(
      [batch()],
      [
        { Unit: 'G', FactorToBase: 0.001, IsBaseUnit: false },
        { Unit: 'KG', FactorToBase: 1, IsBaseUnit: true }
      ]
    );

    await expect(client.validateBatchForPosting('1000000204', '1120', 'CS01', 'BATCH01', 10000, 'G'))
      .resolves.toMatchObject({ valid: true, availableStock: 25, requiredBaseQty: 10, stockUnit: 'KG' });
  });

  test('rejects expired/restricted batch candidates and missing unit conversion', async () => {
    const unusable = makeClient([batch({ IsSelectable: false })]);
    await expect(unusable.validateBatchForPosting('1000000204', '1120', 'CS01', 'BATCH01', 1, 'KG'))
      .resolves.toMatchObject({ valid: false, status: 422 });

    const noConversion = makeClient([batch()], []);
    await expect(noConversion.validateBatchForPosting('1000000204', '1120', 'CS01', 'BATCH01', 1, 'G'))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining('cannot verify conversion') });
  });

  test('rejects an expired SAP batch-master SLED date even when unrestricted stock is positive', async () => {
    const adapter = {
      _get: jest.fn((path) => {
        if (path.includes('I_Batch')) {
          return Promise.resolve([{
            Batch: 'EXPIRED01',
            ShelfLifeExpirationDate: '/Date(1577836800000)/',
            Plant: '1120'
          }]);
        }
        if (path.includes('MaterialMultiStockByDates')) {
          return Promise.resolve([{
            Batch: 'EXPIRED01',
            CurrentStock: '25',
            BaseUnit: 'KG',
            StorageLocation: 'CS01'
          }]);
        }
        return Promise.resolve([]);
      }),
      _enrichBatchStatus: (date) => GoodsIssueAdapter._enrichBatchStatus(date),
      _formatDate: (date) => GoodsIssueAdapter._formatDate(date)
    };
    const client = new GoodsIssueBatchesClient({ adapter });

    await expect(client.validateBatchForPosting('1000000204', '1120', 'CS01', 'EXPIRED01', 1, 'KG'))
      .resolves.toMatchObject({ valid: false, status: 422, reason: expect.stringContaining('expired') });
  });

  test('does not count special stock or stock segments as available batch stock', async () => {
    const adapter = {
      _get: jest.fn((path) => {
        if (path.includes('I_Batch')) {
          return Promise.resolve([
            { Batch: 'GENERAL', ShelfLifeExpirationDate: '/Date(1893456000000)/', Plant: '1120' },
            { Batch: 'SPECIAL', ShelfLifeExpirationDate: '/Date(1893456000000)/', Plant: '1120' }
          ]);
        }
        if (path.includes('MaterialMultiStockByDates')) {
          return Promise.resolve([
            { Batch: 'GENERAL', CurrentStock: '8', BaseUnit: 'KG', StorageLocation: 'CS01' },
            { Batch: 'SPECIAL', CurrentStock: '999', BaseUnit: 'KG', StorageLocation: 'CS01', InventorySpecialStockType: 'E' }
          ]);
        }
        return Promise.resolve([]);
      }),
      _enrichBatchStatus: (date) => GoodsIssueAdapter._enrichBatchStatus(date),
      _formatDate: (date) => GoodsIssueAdapter._formatDate(date)
    };
    const client = new GoodsIssueBatchesClient({ adapter });

    const candidates = await client.getMaterialBatches('1000000204', '1120', 'CS01');

    expect(candidates.find((item) => item.Batch === 'GENERAL')).toMatchObject({
      AvailableStock: 8,
      IsSelectable: true
    });
    expect(candidates.find((item) => item.Batch === 'SPECIAL')).toMatchObject({
      AvailableStock: 0,
      IsSelectable: false
    });
  });
});
