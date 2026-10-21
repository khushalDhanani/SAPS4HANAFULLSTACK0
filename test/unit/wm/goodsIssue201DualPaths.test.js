/**
 * goodsIssue201DualPaths.test.js
 * Comprehensive regression tests verifying both Movement Type 201 execution paths:
 *   1. Direct 201 (Unplanned Goods Issue to Cost Center)
 *   2. Reservation -> 201 (Planned Goods Issue to Cost Center referencing SAP Reservation)
 *
 * Verifies side-by-side agreement across all 8 mandatory dimensions:
 *   - 1. Authorization (Role-based access, Viewer rejection, Clerk/Manager/Admin allowed)
 *   - 2. Cost Center (Mandatory, 1-10 alphanumeric, reconciliation against reservation, S/4HANA padding)
 *   - 3. Batch (Stock check, uppercase normalization, pinned reservation batch match/rejection)
 *   - 4. Serial (1-to-1 quantity mapping, duplicate rejection, count match)
 *   - 5. Stock (Deficit check, fail-closed on zero or insufficient stock with 422)
 *   - 6. Quantity (Positive numeric validation, reservation open quantity ceiling, deletion/final flags)
 *   - 7. Idempotency (Concurrent lock, in-progress 409 rejection, timeout/502 unconfirmed transition)
 *   - 8. SAP Posting Result (GoodsMovementCode '03', MovementType '201', CostCenter on item, MatDoc result)
 */

const cds = require('@sap/cds');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { mapToMaterialDocumentPayload } = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue201Mapper');

describe('Movement 201 Dual Paths Regression Suite (Direct 201 vs Reservation -> 201)', () => {
  let handlers = {};
  const mockSrv = {
    on: (event, handler) => { handlers[event] = handler; }
  };

  const createReq = (data, user = { id: 'CLERK_USER', roles: ['WarehouseClerk'] }) => {
    const r = {
      data,
      user,
      error: jest.fn((status, msg) => {
        const err = new Error(msg);
        err.status = status;
        throw err;
      }),
      reject: jest.fn((status, msg) => {
        const err = new Error(msg);
        err.status = status;
        throw err;
      })
    };
    return r;
  };

  const DIRECT_PAYLOAD = {
    CostCenter: '1011201301',
    Material: '1000000928',
    Plant: '1120',
    StorageLocation: 'CS01',
    IssueQty: 5,
    Unit: 'KG',
    Batch: 'IN26001170',
    PostingDate: '2026-10-19',
    DocumentDate: '2026-10-19',
    ClientAttemptId: 'ATTEMPT-201-DIRECT-01'
  };

  const RESERVATION_PAYLOAD = {
    ReservationNo: '520888',
    ReservationItem: '0001',
    CostCenter: '1011201301',
    Material: '1000000928',
    Plant: '1120',
    StorageLocation: 'CS01',
    IssueQty: 5,
    Unit: 'KG',
    Batch: 'IN26001170',
    PostingDate: '2026-10-19',
    DocumentDate: '2026-10-19',
    ClientAttemptId: 'ATTEMPT-201-RESV-01'
  };

  const RESERVATION_RECORD = {
    ReservationNo: '520888',
    ReservationItem: '0001',
    Material: '1000000928',
    Plant: '1120',
    StorageLocation: 'CS01',
    Batch: 'IN26001170',
    Unit: 'KG',
    CostCenter: '1011201301',
    MovementType: '201',
    RequiredQty: 10,
    WithdrawnQty: 0,
    OpenQty: 10,
    ReservationItemIsFinallyIssued: false,
    ReservationItmIsMarkedForDeltn: false,
    IsFinallyIssued: false,
    IsDeleted: false
  };

  beforeAll(() => {
    PerTypeGoodsIssueHandler.init(mockSrv);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    GoodsIssueAttemptStore.clearMemoryStore();

    // Default mock setup
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ ...RESERVATION_RECORD });
    jest.spyOn(GoodsIssueAdapter, 'isSerialManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'validateSerialStatus').mockResolvedValue({ valid: true });
    jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({
      StockReadSuccess: true,
      StockSufficient: true,
      AvailableStock: 100
    });
    jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockResolvedValue({
      MaterialDocument: '4900050100',
      MaterialDocYear: '2026',
      Success: true,
      Message: 'Goods issue posted successfully. Material Document: 4900050100/2026'
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. Authorization Agreement
  // =========================================================================
  describe('1. Authorization Agreement', () => {
    const clerkUser = { id: 'CLERK_USER', roles: ['WarehouseClerk'] };
    const managerUser = { id: 'MANAGER_USER', roles: ['WarehouseManager'] };
    const adminUser = { id: 'ADMIN_USER', roles: ['Admin'] };

    test('Direct 201: permits WarehouseClerk, WarehouseManager, Admin; restricts Viewer via CDS', async () => {
      // In CDS layer @requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'] enforces 403 on Viewer.
      const reqClerk = createReq(DIRECT_PAYLOAD, clerkUser);
      const resClerk = await handlers.postGoodsIssue201(reqClerk);
      expect(resClerk.Success).toBe(true);

      const reqMgr = createReq({ ...DIRECT_PAYLOAD, ClientAttemptId: 'DIR-MGR' }, managerUser);
      const resMgr = await handlers.postGoodsIssue201(reqMgr);
      expect(resMgr.Success).toBe(true);

      const reqAdmin = createReq({ ...DIRECT_PAYLOAD, ClientAttemptId: 'DIR-ADM' }, adminUser);
      const resAdmin = await handlers.postGoodsIssue201(reqAdmin);
      expect(resAdmin.Success).toBe(true);

      // Verify CDS action requires Clerk, Manager, Admin and excludes Viewer
      const model = await cds.load('srv/wm/goods-issue/service.cds');
      const actionDef = model.definitions['saps4hana.wm.GoodsIssueService.postGoodsIssue201'];
      expect(actionDef['@requires']).toEqual(['WarehouseClerk', 'WarehouseManager', 'Admin']);
      expect(actionDef['@requires']).not.toContain('Viewer');
    });

    test('Reservation -> 201: shares identical authorization requirements', async () => {
      const reqClerk = createReq(RESERVATION_PAYLOAD, clerkUser);
      const resClerk = await handlers.postGoodsIssue201(reqClerk);
      expect(resClerk.Success).toBe(true);

      const reqMgr = createReq({ ...RESERVATION_PAYLOAD, ClientAttemptId: 'RES-MGR' }, managerUser);
      const resMgr = await handlers.postGoodsIssue201(reqMgr);
      expect(resMgr.Success).toBe(true);

      const reqAdmin = createReq({ ...RESERVATION_PAYLOAD, ClientAttemptId: 'RES-ADM' }, adminUser);
      const resAdmin = await handlers.postGoodsIssue201(reqAdmin);
      expect(resAdmin.Success).toBe(true);
    });
  });

  // =========================================================================
  // 2. Cost Center Agreement
  // =========================================================================
  describe('2. Cost Center Agreement', () => {
    test('Direct 201: rejects missing or blank CostCenter with 400', async () => {
      const reqMissing = createReq({ ...DIRECT_PAYLOAD, CostCenter: '' });
      await expect(handlers.postGoodsIssue201(reqMissing)).rejects.toThrow(/Cost Center is mandatory/i);

      const reqWhitespace = createReq({ ...DIRECT_PAYLOAD, CostCenter: '   ' });
      await expect(handlers.postGoodsIssue201(reqWhitespace)).rejects.toThrow(/Cost Center is mandatory/i);
    });

    test('Direct 201: rejects invalid CostCenter format with 400', async () => {
      const reqInvalid = createReq({ ...DIRECT_PAYLOAD, CostCenter: 'CC#INVALID!' });
      await expect(handlers.postGoodsIssue201(reqInvalid)).rejects.toThrow(/must be 1 to 10 alphanumeric characters/i);

      const reqTooLong = createReq({ ...DIRECT_PAYLOAD, CostCenter: '1234567890123' });
      await expect(handlers.postGoodsIssue201(reqTooLong)).rejects.toThrow(/must be 1 to 10 alphanumeric characters/i);
    });

    test('Reservation -> 201: rejects missing or mismatched CostCenter with 400', async () => {
      // Missing CostCenter
      const reqMissing = createReq({ ...RESERVATION_PAYLOAD, CostCenter: '' });
      await expect(handlers.postGoodsIssue201(reqMissing)).rejects.toThrow(/Cost Center is mandatory/i);

      // Mismatched CostCenter vs reservation
      const reqMismatch = createReq({ ...RESERVATION_PAYLOAD, CostCenter: '9999999999' });
      await expect(handlers.postGoodsIssue201(reqMismatch)).rejects.toThrow(/Submitted values do not match reservation.*Cost Center/i);
    });

    test('Both paths: pad numeric CostCenter to 10 digits for SAP payload in GoodsIssue201Mapper', () => {
      const directPayload = mapToMaterialDocumentPayload({
        ...DIRECT_PAYLOAD,
        CostCenter: '400001'
      });
      expect(directPayload.to_MaterialDocumentItem.results[0].CostCenter).toBe('0000400001');

      const resvPayload = mapToMaterialDocumentPayload({
        ...RESERVATION_PAYLOAD,
        CostCenter: '400001'
      });
      expect(resvPayload.to_MaterialDocumentItem.results[0].CostCenter).toBe('0000400001');
    });
  });

  // =========================================================================
  // 3. Batch Agreement
  // =========================================================================
  describe('3. Batch Agreement', () => {
    test('Direct 201: formats batch in uppercase and passes to adapter', async () => {
      const r = createReq({ ...DIRECT_PAYLOAD, Batch: 'in26001170' });
      await handlers.postGoodsIssue201(r);
      expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledWith(
        expect.objectContaining({ Batch: 'IN26001170' })
      );
    });

    test('Reservation -> 201: enforces pinned batch match; rejects mismatch with 400', async () => {
      // Reservation has pinned Batch: 'IN26001170'
      const reqMismatch = createReq({ ...RESERVATION_PAYLOAD, Batch: 'IN99999999' });
      await expect(handlers.postGoodsIssue201(reqMismatch)).rejects.toThrow(/Submitted values do not match reservation.*Batch/i);
      expect(GoodsIssueAdapter.postGoodsIssue201).not.toHaveBeenCalled();

      // Matching batch passes and is uppercased
      const reqMatch = createReq({ ...RESERVATION_PAYLOAD, Batch: 'in26001170' });
      await handlers.postGoodsIssue201(reqMatch);
      expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledWith(
        expect.objectContaining({ Batch: 'IN26001170' })
      );
    });

    test('Reservation -> 201: when reservation has unassigned batch, allows valid user batch', async () => {
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
        ...RESERVATION_RECORD,
        Batch: '' // no pinned batch
      });

      const r = createReq({ ...RESERVATION_PAYLOAD, Batch: 'BATCH_FREE' });
      const res = await handlers.postGoodsIssue201(r);
      expect(res.Success).toBe(true);
      expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledWith(
        expect.objectContaining({ Batch: 'BATCH_FREE' })
      );
    });
  });

  // =========================================================================
  // 4. Serial Number Agreement
  // =========================================================================
  describe('4. Serial Number Agreement', () => {
    beforeEach(() => {
      jest.spyOn(GoodsIssueAdapter, 'isSerialManaged').mockResolvedValue(true);
    });

    test('Direct 201: enforces 1:1 serial count and unique serial numbers', async () => {
      // IssueQty = 2, only 1 serial provided
      const reqCountMismatch = createReq({
        ...DIRECT_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001']
      });
      await expect(handlers.postGoodsIssue201(reqCountMismatch)).rejects.toThrow(/Material.*is serial-managed.*1 serial number\(s\) supplied for quantity 2/i);

      // Duplicate serials
      const reqDuplicate = createReq({
        ...DIRECT_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001', 'SN001']
      });
      await expect(handlers.postGoodsIssue201(reqDuplicate)).rejects.toThrow(/Duplicate serial numbers detected/i);

      // Valid serials
      const reqValid = createReq({
        ...DIRECT_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001', 'SN002']
      });
      const res = await handlers.postGoodsIssue201(reqValid);
      expect(res.Success).toBe(true);
      expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledWith(
        expect.objectContaining({
          SerialNumbers: ['SN001', 'SN002']
        })
      );
    });

    test('Reservation -> 201: enforces identical 1:1 serial count and unique serial numbers', async () => {
      // IssueQty = 2, only 1 serial provided
      const reqCountMismatch = createReq({
        ...RESERVATION_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001']
      });
      await expect(handlers.postGoodsIssue201(reqCountMismatch)).rejects.toThrow(/Material.*is serial-managed.*1 serial number\(s\) supplied for quantity 2/i);

      // Duplicate serials
      const reqDuplicate = createReq({
        ...RESERVATION_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001', 'SN001']
      });
      await expect(handlers.postGoodsIssue201(reqDuplicate)).rejects.toThrow(/Duplicate serial numbers detected/i);

      // Valid serials
      const reqValid = createReq({
        ...RESERVATION_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001', 'SN002']
      });
      const res = await handlers.postGoodsIssue201(reqValid);
      expect(res.Success).toBe(true);
      expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledWith(
        expect.objectContaining({
          SerialNumbers: ['SN001', 'SN002']
        })
      );
    });

    test('Both paths: format to_SerialNumbers identically in GoodsIssue201Mapper', () => {
      const directPayload = mapToMaterialDocumentPayload({
        ...DIRECT_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001', 'SN002']
      });
      expect(directPayload.to_MaterialDocumentItem.results[0].to_SerialNumbers.results).toEqual([
        { SerialNumber: 'SN001' },
        { SerialNumber: 'SN002' }
      ]);

      const resvPayload = mapToMaterialDocumentPayload({
        ...RESERVATION_PAYLOAD,
        IssueQty: 2,
        SerialNumbers: ['SN001', 'SN002']
      });
      expect(resvPayload.to_MaterialDocumentItem.results[0].to_SerialNumbers.results).toEqual([
        { SerialNumber: 'SN001' },
        { SerialNumber: 'SN002' }
      ]);
    });
  });

  // =========================================================================
  // 5. Stock Agreement
  // =========================================================================
  describe('5. Stock Agreement', () => {
    test('Direct 201: rejects with 422 when stock is insufficient', async () => {
      jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({
        StockReadSuccess: true,
        StockSufficient: false,
        AvailableStock: 2,
        Message: 'Insufficient stock in storage location CS01. Requested: 5, Available: 2'
      });

      const r = createReq(DIRECT_PAYLOAD);
      await expect(handlers.postGoodsIssue201(r)).rejects.toThrow(/Insufficient stock in storage location CS01/i);
      expect(GoodsIssueAdapter.postGoodsIssue201).not.toHaveBeenCalled();
    });

    test('Reservation -> 201: rejects with 422 when stock is insufficient', async () => {
      jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({
        StockReadSuccess: true,
        StockSufficient: false,
        AvailableStock: 2,
        Message: 'Insufficient stock in storage location CS01. Requested: 5, Available: 2'
      });

      const r = createReq(RESERVATION_PAYLOAD);
      await expect(handlers.postGoodsIssue201(r)).rejects.toThrow(/Insufficient stock in storage location CS01/i);
      expect(GoodsIssueAdapter.postGoodsIssue201).not.toHaveBeenCalled();
    });

    test('Both paths: proceed to SAP POST when stock is sufficient', async () => {
      jest.spyOn(GoodsIssueAdapter, 'revalidateStockBeforePosting').mockResolvedValue({
        StockReadSuccess: true,
        StockSufficient: true,
        AvailableStock: 25
      });

      const resDirect = await handlers.postGoodsIssue201(createReq(DIRECT_PAYLOAD));
      expect(resDirect.Success).toBe(true);

      const resResv = await handlers.postGoodsIssue201(createReq({ ...RESERVATION_PAYLOAD, ClientAttemptId: 'ATT-RES-STOCK' }));
      expect(resResv.Success).toBe(true);
    });
  });

  // =========================================================================
  // 6. Quantity Agreement
  // =========================================================================
  describe('6. Quantity Agreement', () => {
    test('Direct 201: rejects zero, negative, or invalid quantity with 400', async () => {
      const reqZero = createReq({ ...DIRECT_PAYLOAD, IssueQty: 0 });
      await expect(handlers.postGoodsIssue201(reqZero)).rejects.toThrow(/IssueQty must be a positive decimal number|Quantity must be greater than zero/i);

      const reqNegative = createReq({ ...DIRECT_PAYLOAD, IssueQty: -2 });
      await expect(handlers.postGoodsIssue201(reqNegative)).rejects.toThrow(/IssueQty must be a positive decimal number|Quantity must be greater than zero/i);
    });

    test('Reservation -> 201: rejects zero or negative quantity with 400', async () => {
      const reqZero = createReq({ ...RESERVATION_PAYLOAD, IssueQty: 0 });
      await expect(handlers.postGoodsIssue201(reqZero)).rejects.toThrow(/IssueQty must be a positive decimal number|Quantity must be greater than zero/i);

      const reqNegative = createReq({ ...RESERVATION_PAYLOAD, IssueQty: -3 });
      await expect(handlers.postGoodsIssue201(reqNegative)).rejects.toThrow(/IssueQty must be a positive decimal number|Quantity must be greater than zero/i);
    });

    test('Reservation -> 201: rejects quantity exceeding open reservation quantity with 422', async () => {
      // Reservation has OpenQty = 10, user asks for 12
      const reqExceed = createReq({ ...RESERVATION_PAYLOAD, IssueQty: 12 });
      await expect(handlers.postGoodsIssue201(reqExceed)).rejects.toThrow(/Issue quantity 12 exceeds the open reservation quantity 10/i);
      expect(GoodsIssueAdapter.postGoodsIssue201).not.toHaveBeenCalled();
    });

    test('Reservation -> 201: rejects deleted or finally-issued reservations with 422', async () => {
      // Deleted item
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValueOnce({
        ...RESERVATION_RECORD,
        IsDeleted: true
      });
      const reqDel = createReq(RESERVATION_PAYLOAD);
      await expect(handlers.postGoodsIssue201(reqDel)).rejects.toThrow(/is marked for deletion in SAP/i);

      // Finally issued item
      jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValueOnce({
        ...RESERVATION_RECORD,
        IsFinallyIssued: true
      });
      const reqFinal = createReq(RESERVATION_PAYLOAD);
      await expect(handlers.postGoodsIssue201(reqFinal)).rejects.toThrow(/is marked as finally issued in SAP/i);
    });
  });

  // =========================================================================
  // 7. Idempotency Agreement
  // =========================================================================
  describe('7. Idempotency Agreement', () => {
    test('Direct 201: protects against concurrent duplicate posting while attempt is in progress', async () => {
      jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockResolvedValueOnce({
        created: false,
        row: {
          ReferenceDocument: 'REF_DIR_201_LOCK',
          MovementType: '201',
          Status: 'sending',
          ClientAttemptId: 'ATTEMPT-201-DIRECT-DUP'
        }
      });

      const r = createReq({
        ...DIRECT_PAYLOAD,
        ClientAttemptId: 'ATTEMPT-201-DIRECT-DUP'
      });
      const res = await handlers.postGoodsIssue201(r);
      expect(res.Success).toBe(false);
      expect(res.ConfirmationStatus).toBe('POSTING');
      expect(GoodsIssueAdapter.postGoodsIssue201).not.toHaveBeenCalled();
    });

    test('Direct 201: replays the existing unplanned attempt before running stock checks again', async () => {
      const request = { ...DIRECT_PAYLOAD, ClientAttemptId: 'ATTEMPT-201-UNPLANNED-REPLAY' };
      const first = await handlers.postGoodsIssue201(createReq(request));
      expect(first.MaterialDocument).toBe('4900050100');
      expect(GoodsIssueAdapter.revalidateStockBeforePosting).toHaveBeenCalledTimes(1);

      GoodsIssueAdapter.revalidateStockBeforePosting.mockResolvedValueOnce({
        StockReadSuccess: true,
        StockSufficient: false,
        Message: 'Stock was consumed after the original post'
      });
      const replay = await handlers.postGoodsIssue201(createReq(request));

      expect(replay.MaterialDocument).toBe(first.MaterialDocument);
      expect(GoodsIssueAdapter.revalidateStockBeforePosting).toHaveBeenCalledTimes(1);
      expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledTimes(1);
    });

    test('Reservation 201: replays the existing attempt before reservation reconciliation', async () => {
      const request = { ...RESERVATION_PAYLOAD, ClientAttemptId: 'ATTEMPT-201-RESV-REPLAY' };
      const first = await handlers.postGoodsIssue201(createReq(request));
      expect(first.MaterialDocument).toBe('4900050100');
      expect(GoodsIssueAdapter.getReservationItemAuthoritative).toHaveBeenCalledTimes(1);

      GoodsIssueAdapter.getReservationItemAuthoritative.mockRejectedValueOnce(new Error('Reservation is now closed'));
      const replay = await handlers.postGoodsIssue201(createReq(request));

      expect(replay.MaterialDocument).toBe(first.MaterialDocument);
      expect(GoodsIssueAdapter.getReservationItemAuthoritative).toHaveBeenCalledTimes(1);
      expect(GoodsIssueAdapter.postGoodsIssue201).toHaveBeenCalledTimes(1);
    });

    test('Reservation -> 201: rejects concurrent submission with 409 while reservation attempt is pending', async () => {
      // Seed pending attempt for reservation 520888 / 0001
      await GoodsIssueAttemptStore.create({
        ReferenceDocument: 'R520888_0001_GEN0',
        ReservationNo: '520888',
        ReservationItem: '0001',
        MovementType: '201',
        Status: 'sending'
      });

      const r = createReq(RESERVATION_PAYLOAD);
      await expect(handlers.postGoodsIssue201(r)).rejects.toThrow(/has a Goods Issue posting attempt pending confirmation, do not post again/i);
      expect(GoodsIssueAdapter.postGoodsIssue201).not.toHaveBeenCalled();
    });

    test('Both paths: mark attempt as unconfirmed on network timeout/504 and fail closed', async () => {
      const timeoutErr = new Error('Gateway Timeout');
      timeoutErr.status = 504;
      timeoutErr.code = 'ETIMEDOUT';
      jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue201').mockRejectedValue(timeoutErr);

      // Direct 201
      const reqDirect = createReq({ ...DIRECT_PAYLOAD, ClientAttemptId: 'ATT-DIR-TIMEOUT' });
      await expect(handlers.postGoodsIssue201(reqDirect)).rejects.toThrow(/Posting outcome unconfirmed/i);

      // Reservation -> 201
      const reqResv = createReq({ ...RESERVATION_PAYLOAD, ClientAttemptId: 'ATT-RES-TIMEOUT' });
      await expect(handlers.postGoodsIssue201(reqResv)).rejects.toThrow(/Posting outcome unconfirmed/i);
    });
  });

  // =========================================================================
  // 8. SAP Posting Result Agreement
  // =========================================================================
  describe('8. SAP Posting Result Agreement', () => {
    test('Direct 201: delivers compliant S/4HANA envelope and returns material document', async () => {
      const r = createReq(DIRECT_PAYLOAD);
      const result = await handlers.postGoodsIssue201(r);

      expect(result).toMatchObject({
        MaterialDocument: '4900050100',
        MaterialDocYear: '2026',
        Success: true,
        Message: expect.stringContaining('4900050100/2026')
      });

      // Verify SAP OData envelope via mapper
      const envelope = mapToMaterialDocumentPayload(DIRECT_PAYLOAD);
      expect(envelope.GoodsMovementCode).toBe('03');
      expect(envelope.to_MaterialDocumentItem.results[0]).toMatchObject({
        GoodsMovementType: '201',
        Material: '1000000928',
        Plant: '1120',
        StorageLocation: 'CS01',
        CostCenter: '1011201301',
        Batch: 'IN26001170',
        QuantityInEntryUnit: '5'
      });
      expect(envelope.to_MaterialDocumentItem.results[0].Reservation).toBeUndefined();
      expect(envelope.MaterialDocumentHeaderText).toBe('GI CC 1011201301');
    });

    test('Reservation -> 201: delivers compliant S/4HANA envelope with reservation link and returns material document', async () => {
      const r = createReq(RESERVATION_PAYLOAD);
      const result = await handlers.postGoodsIssue201(r);

      expect(result).toMatchObject({
        MaterialDocument: '4900050100',
        MaterialDocYear: '2026',
        Success: true,
        Message: expect.stringContaining('4900050100/2026')
      });

      // Verify SAP OData envelope via mapper
      const envelope = mapToMaterialDocumentPayload(RESERVATION_PAYLOAD);
      expect(envelope.GoodsMovementCode).toBe('03');
      expect(envelope.to_MaterialDocumentItem.results[0]).toMatchObject({
        GoodsMovementType: '201',
        Material: '1000000928',
        Plant: '1120',
        StorageLocation: 'CS01',
        CostCenter: '1011201301',
        Batch: 'IN26001170',
        QuantityInEntryUnit: '5',
        Reservation: '520888',
        ReservationItem: '0001'
      });
      expect(envelope.MaterialDocumentHeaderText).toBe('GI CC Resv 520888');
    });
  });
});
