/**
 * Opening a goods issue page with ?resv=<number>: everything the reservation supplies is prefilled
 * and read-only, and the server posts the reservation's own values, never the client's.
 */

const GoodsIssueReservationsClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');

describe('reservation items carry the receiving plant / storage location of the reservation header', () => {
  const item = { Reservation: '519367', ReservationItem: '1', Product: '8000000001', Plant: '1120', StorageLocation: 'HS01', BaseUnit: 'NOS', ResvnItmRequiredQtyInBaseUnit: '2', ResvnItmWithdrawnQtyInBaseUnit: '0', GoodsMovementType: '311' };
  const header = { Reservation: '519367', IssuingOrReceivingPlant: '1120', IssuingOrReceivingStorageLoc: 'CIS1' };

  test('GIItems (getOpenItems) for a 311 reservation', async () => {
    const adapter = { _get: jest.fn((p) => Promise.resolve(p.includes('C_ReservationDocTP_F4839') ? header : [item])), getMaterialPackagingUnits: jest.fn().mockResolvedValue([]), getMaterialBatches: jest.fn().mockResolvedValue([]) };
    const [r] = await new GoodsIssueReservationsClient({ adapter }).getOpenItems('', '519367');
    expect(r).toMatchObject({ StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'CIS1' });
  });

  test('authoritative reservation read used by the posting handlers', async () => {
    jest.spyOn(GoodsIssueAdapter.stockUnits, '_readOpenReservationItem').mockResolvedValue({ resvItem: item });
    jest.spyOn(GoodsIssueAdapter.reservations, '_get').mockResolvedValue([header]);
    await expect(GoodsIssueAdapter.getReservationItemAuthoritative('519367', '0001')).resolves.toMatchObject({
      Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'CIS1', MovementType: '311', OpenQty: 2
    });
    jest.restoreAllMocks();
  });

  test('authoritative reservation read fails closed when SAP omits movement type', async () => {
    jest.spyOn(GoodsIssueAdapter.stockUnits, '_readOpenReservationItem').mockResolvedValue({
      resvItem: { ...item, GoodsMovementType: undefined }
    });
    await expect(GoodsIssueAdapter.getReservationItemAuthoritative('519367', '0001'))
      .rejects.toMatchObject({ status: 502 });
    jest.restoreAllMocks();
  });
});

describe('server posts the reservation values, not the client values', () => {
  const handlers = {};
  PerTypeGoodsIssueHandler.init({ on: (event, handler) => { handlers[event] = handler; } });
  const req = (data) => ({ data, user: { id: 'TESTER' }, error: jest.fn() });
  const resv = { Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'CIS1', Batch: '', MovementType: '311', OpenQty: 2 };
  const body = { ReservationNo: '519367', ReservationItem: '0001', Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'CIS1', IssueQty: 2, Unit: 'NOS' };
  let post;

  beforeEach(() => {
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({ ...resv });
    jest.spyOn(GoodsIssueAdapter, 'isSerialManaged').mockResolvedValue(false);
    post = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue311').mockResolvedValue({ MaterialDocument: '4900000001', MaterialDocYear: '2026' });
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['Material', { Material: '8000002951' }],
    ['Plant', { Plant: '1130', ReceivingPlant: '1130' }],
    ['Storage Location', { StorageLocation: 'RD01' }],
    ['Receiving Storage Location', { ReceivingStorageLocation: 'MT01' }]
  ])('311: tampered %s -> 400, not posted', async (label, tamper) => {
    const r = req({ ...body, ...tamper });
    await handlers.postGoodsIssue311(r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining(label));
    expect(post).not.toHaveBeenCalled();
  });

  test('311: values the client left out are taken from the reservation', async () => {
    const r = req({ ...body, ReceivingPlant: '' });
    await handlers.postGoodsIssue311(r);
    expect(r.error).not.toHaveBeenCalled();
    expect(post.mock.calls[0][0]).toMatchObject({ Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'CIS1' });
  });

  test('311: quantity above the open reservation quantity -> 422, not posted', async () => {
    const r = req({ ...body, IssueQty: 3 });
    await handlers.postGoodsIssue311(r);
    expect(r.error).toHaveBeenCalledWith(422, expect.stringContaining('exceeds the open reservation quantity'));
    expect(post).not.toHaveBeenCalled();
  });

  test.each([
    ['postGoodsIssue301', { ReceivingPlant: '1130', ReceivingStorageLocation: 'CS01' }],
    ['postGoodsIssue201', { CostCenter: '1011101301' }]
  ])('%s: tampered material against its reservation -> 400 before anything is posted', async (action, extra) => {
    const posts = ['postGoodsIssue201', 'postGoodsIssue301'].map((m) => jest.spyOn(GoodsIssueAdapter, m).mockResolvedValue({}));
    const r = req({ ReservationNo: '519367', ReservationItem: '0001', Material: '8000002951', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS', ...extra });
    await handlers[action](r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('do not match reservation'));
    posts.forEach((p) => expect(p).not.toHaveBeenCalled());
  });

  test('301: serial-managed material with too few serials -> 400 before SAP', async () => {
    GoodsIssueAdapter.isSerialManaged.mockResolvedValue(true);
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      ...resv, MovementType: '301', ReceivingPlant: '1130', ReceivingStorageLocation: 'CS01'
    });
    const post301 = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue301').mockResolvedValue({});
    const r = req({ ...body, ReceivingPlant: '1130', ReceivingStorageLocation: 'CS01', SerialNumbers: ['110'] });
    await handlers.postGoodsIssue301(r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('serial-managed'));
    expect(post301).not.toHaveBeenCalled();
  });
});
