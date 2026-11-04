'use strict';

/**
 * Reservation guards of the per-type Goods Issue actions, run through the real handler and adapter.
 * Only SAP is doubled: the OData read and POST (_get, _post, _getDestination) and RFC_READ_TABLE.
 * Reservation fields follow test/unit/wm/goodsIssueResvPrefill.test.js and the service's $select list; the SAP shape is not proven here.
 */

const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const handlerModule = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');

const handlers = {};
handlerModule.init({ on: (event, fn) => { handlers[event] = fn; } });

const ITEM = {
  Reservation: '519367', ReservationItem: '0001', Product: '8000000001', Plant: '1120', StorageLocation: 'HS01', BaseUnit: 'NOS',
  ResvnItmRequiredQtyInBaseUnit: '2', ResvnItmWithdrawnQtyInBaseUnit: '0', ReservationItemIsFinallyIssued: false, ReservationItmIsMarkedForDeltn: false
};
const BODY = { ReservationNo: '519367', ReservationItem: '0001', Material: '8000000001', Plant: '1120', StorageLocation: 'HS01', IssueQty: 1, Unit: 'NOS' };
const TABLES = {
  T001L: [{ LGORT: 'CIS1' }],
  MARC: [{ WERKS: '1130', SERNP: '', XCHPF: '' }],
  MARD: [{ LGORT: 'HS01', LABST: '100.000' }, { LGORT: 'CIS1', LABST: '100.000' }]
};

describe('per-type Goods Issue reservation guards', () => {
  let post;

  const stubSap = (item, postedMovement = item.GoodsMovementType) => {
    // The open-items read filters on the status flags; the status fallback read does not.
    jest.spyOn(GoodsIssueAdapter, '_get').mockImplementation(async (path, query = '') => {
      if (!path.includes('ReservationDocumentItem')) return [];
      const isOpenRead = decodeURIComponent(query).includes('ReservationItemIsFinallyIssued eq false');
      return isOpenRead && (item.ReservationItemIsFinallyIssued || item.ReservationItmIsMarkedForDeltn) ? [] : [item];
    });
    jest.spyOn(GoodsIssueAdapter, '_getDestination').mockResolvedValue({ name: 'DEST' });
    post = jest.spyOn(GoodsIssueAdapter, '_post').mockResolvedValue({ MaterialDocument: '4900000001', MaterialDocumentYear: '2026' });
    jest.spyOn(GoodsIssueAdapter.rfc, 'readTable').mockImplementation(async (table) => {
      if (table === 'MATDOC') return [{ MBLNR: '4900000001', MJAHR: '2026', BWART: postedMovement }];
      return TABLES[table] || [];
    });
  };
  const request = (data) => ({ data, user: { id: 'TESTER', attr: { Plant: ['1120'] } }, error: jest.fn((status, message) => ({ status, message })) });

  beforeEach(() => GoodsIssueAttemptStore.clearMemoryStore());
  afterEach(() => jest.restoreAllMocks());

  // Known defect: srv/wm/goods-issue/handlers/goodsIssuePerType.handler.js:573,591,628 never pass expectedMovementType, so the guard at :206 cannot fire and a reservation of another movement type is posted.
  test.failing.each([
    ['postGoodsIssue201', '201', '311', { MovementType: '201', CostCenter: '1011101301' }],
    ['postGoodsIssue301', '301', '311', { MovementType: '301', ReceivingPlant: '1130', ReceivingStorageLocation: 'CIS1' }],
    ['postGoodsIssue311', '311', '301', { MovementType: '311', ReceivingStorageLocation: 'CIS1' }]
  ])('%s refuses with 422 a reservation item whose SAP movement type differs (requested %s, reservation %s)', async (action, requested, onReservation, extra) => {
    stubSap({ ...ITEM, GoodsMovementType: onReservation }, requested);
    const req = request({ ...BODY, ...extra });

    await handlers[action](req);

    expect(req.error).toHaveBeenCalledWith(422, `Reservation 519367 item 0001 is not an open Movement Type ${requested} item in SAP. Goods Issue was NOT posted.`);
    expect(post).not.toHaveBeenCalled();
  });

  test('a reservation item SAP reports as finally issued is refused with 422 and not posted', async () => {
    stubSap({ ...ITEM, GoodsMovementType: '311', ReservationItemIsFinallyIssued: true });
    const req = request({ ...BODY, MovementType: '311', ReceivingStorageLocation: 'CIS1' });

    await handlers.postGoodsIssue311(req);

    expect(req.error).toHaveBeenCalledWith(422, 'Reservation 519367 item 0001 is marked as finally issued in SAP. Goods Issue was NOT posted.');
    expect(post).not.toHaveBeenCalled();
  });

  test('a reservation item SAP reports as marked for deletion is refused with 422 and not posted', async () => {
    stubSap({ ...ITEM, GoodsMovementType: '311', ReservationItmIsMarkedForDeltn: true });
    const req = request({ ...BODY, MovementType: '311', ReceivingStorageLocation: 'CIS1' });

    await handlers.postGoodsIssue311(req);

    expect(req.error).toHaveBeenCalledWith(422, 'Reservation 519367 item 0001 is marked for deletion in SAP. Goods Issue was NOT posted.');
    expect(post).not.toHaveBeenCalled();
  });

  test('a reservation item with nothing left to withdraw is refused with 422 and not posted', async () => {
    stubSap({ ...ITEM, GoodsMovementType: '311', ResvnItmWithdrawnQtyInBaseUnit: '2' });
    const req = request({ ...BODY, MovementType: '311', ReceivingStorageLocation: 'CIS1' });

    await handlers.postGoodsIssue311(req);

    expect(req.error).toHaveBeenCalledWith(422, 'Reservation 519367 item 0001 has no open quantity remaining (open quantity is 0, required: 2, withdrawn: 2). Goods Issue was NOT posted.');
    expect(post).not.toHaveBeenCalled();
  });
});
