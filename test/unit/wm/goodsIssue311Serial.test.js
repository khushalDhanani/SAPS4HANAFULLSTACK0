/**
 * Movement 311 with serial-managed materials: the serial profile comes from SAP (MARC-SERNP), the
 * reservation item carries the flag to the screen, the handler rejects a wrong serial count before
 * SAP is called (and never queues it), and the mapper emits one to_SerialNumbers entry per unit.
 */

const M311 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue311Mapper');
const GoodsIssueStockUnitClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient');
const GoodsIssueReservationsClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueQueueManager = require('../../../srv/wm/goods-issue/GoodsIssueQueueManager');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');

const item = (p) => p.to_MaterialDocumentItem.results[0];

describe('311 mapper - serial numbers', () => {
  const base = { ReservationNo: '519367', ReservationItem: '0001', Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'RD01', IssueQty: 2, Unit: 'NOS', PostingDate: '2026-10-01', DocumentDate: '2026-10-01' };

  test('one to_SerialNumbers entry per unit, trimmed strings, not padded', () => {
    const p = M311.mapToMaterialDocumentPayload({ ...base, SerialNumbers: [' 110 ', 111] });
    expect(item(p).GoodsMovementType).toBe('311');
    expect(item(p).to_SerialNumbers).toEqual({ results: [{ SerialNumber: '110' }, { SerialNumber: '111' }] });
  });

  test('non-serial item carries no to_SerialNumbers', () => {
    const p = M311.mapToMaterialDocumentPayload({ ...base, SerialNumbers: [] });
    expect(item(p).to_SerialNumbers).toBeUndefined();
  });
});

describe('serial number profile lookup (MARC-SERNP)', () => {
  test('profile present -> serial-managed; numeric material is padded to 18', async () => {
    const rfc = { readTable: jest.fn().mockResolvedValue([{ SERNP: 'ZSN1' }]) };
    const client = new GoodsIssueStockUnitClient({ adapter: {}, rfc });
    await expect(client.isSerialManaged('8000000001', '1120')).resolves.toBe(true);
    expect(rfc.readTable).toHaveBeenCalledWith('MARC', ['SERNP'], ["MATNR = '000000008000000001'", "AND WERKS = '1120'"]);
  });

  test('blank profile or no plant row -> not serial-managed', async () => {
    const blank = new GoodsIssueStockUnitClient({ adapter: {}, rfc: { readTable: jest.fn().mockResolvedValue([{ SERNP: '' }]) } });
    const none = new GoodsIssueStockUnitClient({ adapter: {}, rfc: { readTable: jest.fn().mockResolvedValue([]) } });
    await expect(blank.isSerialManaged('8300000214', '1120')).resolves.toBe(false);
    await expect(none.isSerialManaged('8300000214', '1120')).resolves.toBe(false);
  });
});

describe('GIItems carries IsSerialManaged', () => {
  const rows = ['1', '2'].map((n) => ({
    Reservation: '519367', ReservationItem: n, Product: '8000000001', Plant: '1120', StorageLocation: 'HS01', BaseUnit: 'NOS',
    ResvnItmRequiredQtyInBaseUnit: '2', ResvnItmWithdrawnQtyInBaseUnit: '0', GoodsMovementType: '311'
  }));
  const adapter = (isSerialManaged) => ({
    _get: jest.fn().mockResolvedValue(rows),
    getMaterialPackagingUnits: jest.fn().mockResolvedValue([]),
    getMaterialBatches: jest.fn().mockResolvedValue([]),
    isSerialManaged
  });

  test('flag set from the profile, read once per material/plant', async () => {
    const a = adapter(jest.fn().mockResolvedValue(true));
    const items = await new GoodsIssueReservationsClient({ adapter: a }).getOpenItems('', '519367');
    expect(items.map((i) => i.IsSerialManaged)).toEqual([true, true]);
    expect(a.isSerialManaged).toHaveBeenCalledTimes(1);
  });

  test('unreadable profile -> false, items still returned', async () => {
    const a = adapter(jest.fn().mockRejectedValue(new Error('RFC down')));
    const items = await new GoodsIssueReservationsClient({ adapter: a }).getOpenItems('', '519367');
    expect(items.map((i) => i.IsSerialManaged)).toEqual([false, false]);
  });
});

describe('311 screen model - Complete stays disabled until serials == quantity', () => {
  const GoodsIssue311Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue311Model');
  const open = (IsSerialManaged) => {
    const d = GoodsIssue311Model.getInitialData();
    d.reservationNo = '519367';
    GoodsIssue311Model.applyReservationItem(d, { ReservationItem: '1', Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', Unit: 'NOS', OpenQty: 2, IsSerialManaged });
    d.quantity = 2;
    return d;
  };

  test('serial-managed item: invalid with 0 or 1 serial, valid with 2, all sent in the payload', () => {
    const d = open(true);
    expect(GoodsIssue311Model.validate(d).isValid).toBe(false);
    GoodsIssue311Model.addSerialNumber(d, '110');
    expect(GoodsIssue311Model.validate(d).isValid).toBe(false);
    GoodsIssue311Model.addSerialNumber(d, '111');
    expect(GoodsIssue311Model.validate(d).isValid).toBe(true);
    expect(GoodsIssue311Model.toBackendPayload(d).SerialNumbers).toEqual(['110', '111']);
  });

  test('non-serial item needs no serials', () => {
    const d = open(false);
    expect(GoodsIssue311Model.validate(d).isValid).toBe(true);
    expect(GoodsIssue311Model.toBackendPayload(d).SerialNumbers).toEqual([]);
  });
});

describe('postGoodsIssue311 handler - serial count', () => {
  const handlers = {};
  PerTypeGoodsIssueHandler.init({ on: (event, handler) => { handlers[event] = handler; } });
  const req = (data) => ({ data, user: { id: 'TESTER' }, error: jest.fn() });
  const body = { ReservationNo: '519367', ReservationItem: '0001', Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'RD01', IssueQty: 2, Unit: 'NOS' };
  let post, enqueue, serialManaged;

  beforeEach(() => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', OpenQty: 2 });
    jest.spyOn(GoodsIssueAdapter, 'validateSerialStatus').mockResolvedValue({ valid: true });
    serialManaged = jest.spyOn(GoodsIssueAdapter, 'isSerialManaged').mockResolvedValue(true);
    post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue311').mockResolvedValue({ MaterialDocument: '4900000001', MaterialDocYear: '2026' });
    enqueue = jest.spyOn(GoodsIssueQueueManager, 'enqueue').mockResolvedValue({ QueueReference: 'Q1' });
  });
  afterEach(() => jest.restoreAllMocks());

  test('serial-managed with one serial per unit is posted with all serials', async () => {
    const r = req({ ...body, SerialNumbers: ['110', '111'] });
    const res = await handlers.postGoodsIssue311(r);
    expect(r.error).not.toHaveBeenCalled();
    expect(res.MaterialDocument).toBe('4900000001');
    expect(post.mock.calls[0][0].SerialNumbers).toEqual(['110', '111']);
  });

  test.each([['too few', ['110']], ['none', []]])('serial-managed with %s serials -> 400 before SAP, not queued', async (_label, serials) => {
    const r = req({ ...body, SerialNumbers: serials });
    await handlers.postGoodsIssue311(r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('serial-managed'));
    expect(post).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('non-serial item is posted unchanged without serials', async () => {
    serialManaged.mockResolvedValue(false);
    const r = req({ ...body });
    const res = await handlers.postGoodsIssue311(r);
    expect(r.error).not.toHaveBeenCalled();
    expect(res.MaterialDocument).toBe('4900000001');
    expect(post.mock.calls[0][0].SerialNumbers).toEqual([]);
  });

  test('unreadable serial profile does not block; SAP decides', async () => {
    serialManaged.mockRejectedValue(new Error('RFC down'));
    const r = req({ ...body });
    await handlers.postGoodsIssue311(r);
    expect(r.error).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalled();
  });
});

describe('OpenReservations (301/311 list) carries issuing and receiving storage location', () => {
  const items = [{ Reservation: '519367', ReservationItem: '1', Plant: '1120', StorageLocation: 'HS01', GoodsMovementType: '311', Product: '8000000001', ResvnItmRequiredQtyInBaseUnit: '2', ResvnItmWithdrawnQtyInBaseUnit: '0' }];
  const headers = [{ Reservation: '519367', IssuingOrReceivingPlant: '1120', IssuingOrReceivingStorageLoc: 'CIS1' }];
  const adapter = (headerResult) => ({
    _get: jest.fn((path) => {
      if (path.includes('C_ReservationDocTP_F4839')) return headerResult();
      return Promise.resolve(path.endsWith('/ReservationDocumentItem') ? items : []);
    })
  });

  test('issuing from the item, receiving from the reservation header', async () => {
    const a = adapter(() => Promise.resolve(headers));
    const [r] = await new GoodsIssueReservationsClient({ adapter: a }).getOpenReservations('311');
    expect(r).toMatchObject({ ReservationNo: '519367', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'CIS1' });
    expect(a._get.mock.calls[0][1]).toContain('StorageLocation');
  });

  test('header read failure leaves receiving blank, list still loads', async () => {
    const a = adapter(() => Promise.reject(new Error('HDR down')));
    const [r] = await new GoodsIssueReservationsClient({ adapter: a }).getOpenReservations('311');
    expect(r).toMatchObject({ StorageLocation: 'HS01', ReceivingStorageLocation: '' });
  });

  test('261 list does not read transfer headers', async () => {
    const a = adapter(() => Promise.resolve(headers));
    await new GoodsIssueReservationsClient({ adapter: a }).getOpenReservations('261');
    expect(a._get.mock.calls.some(([p]) => p.includes('C_ReservationDocTP_F4839'))).toBe(false);
  });
});
