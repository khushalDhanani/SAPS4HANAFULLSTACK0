/**
 * Opening a goods issue page with ?resv=<number>: everything the reservation supplies is prefilled
 * and read-only, and the server posts the reservation's own values, never the client's.
 */

const fs = require('fs');
const path = require('path');
const W = path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/goods-issue');
const view = (name) => fs.readFileSync(path.join(W, 'view', name), 'utf8');
/** Opening tag of the control with this id. */
const tag = (xml, id) => xml.match(new RegExp(`<\\w+\\s(?:(?!<\\w)[\\s\\S])*?id="${id}"[\\s\\S]*?/>`))[0];

const GoodsIssue311Model = require(path.join(W, 'model/GoodsIssue311Model'));
const GoodsIssue301Model = require(path.join(W, 'model/GoodsIssue301Model'));
const GoodsIssueReservationsClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');

describe('311 prefill from a reservation item', () => {
  const rows = [
    { ReservationNo: '519367', ReservationItem: '1', Material: '8000000001', MaterialDesc: 'Iphone 16, 12GB', Plant: '1120', StorageLocation: 'HS01', ReceivingPlant: '1120', ReceivingStorageLocation: 'CIS1', Unit: 'NOS', OpenQty: 2, Batch: '', IsSerialManaged: true, OrderNo: '' },
    { ReservationNo: '520236', ReservationItem: '0003', Material: '1000001002', MaterialDesc: 'TEST RM', Plant: '1150', StorageLocation: 'CS02', ReceivingPlant: '1150', ReceivingStorageLocation: 'MT01', Unit: 'KG', OpenQty: 12.5, Batch: 'IN26091921', IsSerialManaged: false, OrderNo: '1002741' }
  ];

  test.each(rows)('maps every field the reservation provides ($ReservationNo)', (row) => {
    const d = GoodsIssue311Model.getInitialData();
    d.reservationNo = row.ReservationNo;
    GoodsIssue311Model.applyReservationItem(d, row);
    expect(d).toMatchObject({
      fromReservation: true,
      reservationItem: String(row.ReservationItem).padStart(4, '0'),
      material: row.Material, materialName: row.MaterialDesc, plant: row.Plant, storageLocation: row.StorageLocation,
      receivingPlant: row.ReceivingPlant, receivingStorageLocation: row.ReceivingStorageLocation,
      unit: row.Unit, openQty: row.OpenQty, batch: row.Batch, orderNo: row.OrderNo,
      isSerialManaged: row.IsSerialManaged, isBatchManaged: !!row.Batch,
      isUnitEditable: false, isStorageLocationEditable: false,
      prefilled: { receivingPlant: true, receivingStorageLocation: true, batch: !!row.Batch }
    });
    d.quantity = row.OpenQty;
    expect(GoodsIssue311Model.toBackendPayload(d)).toMatchObject({
      ReservationNo: row.ReservationNo, Material: row.Material, Plant: row.Plant, StorageLocation: row.StorageLocation,
      ReceivingPlant: row.ReceivingPlant, ReceivingStorageLocation: row.ReceivingStorageLocation, Unit: row.Unit, Batch: row.Batch
    });
  });

  test('only what the reservation does not supply stays editable', () => {
    const d = GoodsIssue311Model.getInitialData();
    GoodsIssue311Model.applyReservationItem(d, { ReservationItem: '1', Material: 'M1', Plant: '1120', OpenQty: 1 });
    expect(d.isStorageLocationEditable).toBe(true);
    expect(d.isUnitEditable).toBe(true);
    expect(d.prefilled).toEqual({ receivingPlant: false, receivingStorageLocation: false, batch: false });
  });

  test.each([['311', GoodsIssue311Model], ['301', GoodsIssue301Model]])('%s quantity: partial issue allowed, capped at the open reservation quantity', (_t, Model) => {
    const d = Model.getInitialData();
    Model.applyReservationItem(d, rows[1]);
    d.quantity = 5;
    expect(Model.validate(d).errors.quantity).toBe('');
    d.quantity = 12.501;
    expect(Model.validate(d).errors.quantity).toContain('open reservation quantity');
  });

  test('an empty form (no reservation) keeps everything editable', () => {
    const d = GoodsIssue311Model.getInitialData();
    expect(d.fromReservation).toBe(false);
    expect(d.prefilled).toEqual({});
  });
});

describe('prefilled fields are read-only in the views', () => {
  const v311 = view('GoodsIssue311.view.xml');
  const v301 = view('GoodsIssue301.view.xml');
  const v201 = view('GoodsIssue201.view.xml');

  test('311: material / plant are display-only texts; storage location is an input only when the reservation has none', () => {
    expect(tag(v311, 'txtMaterial311')).toMatch(/^<Text /);
    expect(tag(v311, 'txtPlant311')).toMatch(/^<Text /);
    expect(tag(v311, 'inStorageLocation311')).toContain('visible="{gi311>/isStorageLocationEditable}"');
  });

  test.each([
    ['inReceivingPlant311', 'receivingPlant'], ['inReceivingStorageLocation311', 'receivingStorageLocation'], ['inBatch311', 'batch']
  ])('311: %s is disabled once the reservation supplies it', (id, field) => {
    expect(tag(v311, id)).toContain(`editable="{= !\${gi311>/prefilled/${field}} }"`);
  });

  test('311: reservation number / item cannot be changed once opened from a reservation', () => {
    expect(tag(v311, 'inReservationNo311')).toContain('editable="false"');
    expect(tag(v311, 'inReservationItem311')).toContain('editable="{= !${gi311>/fromReservation} }"');
    expect(tag(v311, 'inUnit311')).toContain('editable="{gi311>/isUnitEditable}"');
  });

  test('301 / 201 follow the same pattern for the fields they prefill', () => {
    expect(tag(v301, 'inBatch301')).toContain('editable="{= !${gi301>/prefilled/batch} }"');
    ['inCostCenter:costCenter', 'inMaterial:material', 'inPlant:plant', 'inStorageLocation:storageLocation'].forEach((pair) => {
      const [id, field] = pair.split(':');
      expect(tag(v201, id)).toContain(`editable="{= !\${gi201>/prefilled/${field}} }"`);
    });
  });
});

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
    const r = req({ ...body, ReceivingPlant: '', ReceivingStorageLocation: '' });
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
    ['postGoodsIssue301', { ReceivingPlant: '1130' }],
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
    const post301 = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue301').mockResolvedValue({});
    const r = req({ ...body, ReceivingPlant: '1130', ReceivingStorageLocation: '', SerialNumbers: ['110'] });
    await handlers.postGoodsIssue301(r);
    expect(r.error).toHaveBeenCalledWith(400, expect.stringContaining('serial-managed'));
    expect(post301).not.toHaveBeenCalled();
  });
});
