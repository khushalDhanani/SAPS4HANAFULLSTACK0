'use strict';

/**
 * Proves with tests:
 *  1. OpenQty has NO queue deduction across GoodsIssueReservationsClient (getOpenReservations & getReservationItems).
 *  2. QueuedQty property is not exposed on reservation items.
 *  3. An unconfirmed/sending attempt causes the reservation to display as "pending confirmation" in OpenReservations.
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const attempts = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { ATTEMPT_ENTITY } = attempts;
const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueReservationsClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient');

const { DELETE } = cds.ql;

function initService() {
  const handlers = {};
  const srv = { on: jest.fn((event, entity, fn) => {
    if (typeof entity === 'function') {
      handlers[event] = entity;
    } else {
      handlers[`${event}:${entity}`] = fn;
    }
  }) };
  GoodsIssueHandler.init(srv);
  return handlers;
}

describe('OpenQty Calculation & Pending Confirmation Display', () => {
  const handlers = initService();

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
  });

  describe('GoodsIssueReservationsClient: OpenQty calculation has zero queue deduction', () => {
    it('calculates OpenQty strictly as Math.max(0, reqQty - wdnQty) in getOpenReservations', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          // Partially withdrawn item: 100 - 25 = 75 open -> included
          {
            Reservation: '0000100555',
            ReservationItem: '0001',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Plant: '1120',
            StorageLocation: 'CS01',
            Product: 'MAT-NO-QUEUE-01',
            ProductName: 'Material Without Queue',
            ResvnItmRequiredQtyInBaseUnit: '100.000',
            ResvnItmWithdrawnQtyInBaseUnit: '25.000',
            BaseUnit: 'KG'
          },
          // Fully withdrawn item: 50 - 50 = 0 open -> skipped
          {
            Reservation: '0000100556',
            ReservationItem: '0001',
            GoodsMovementType: '261',
            GoodsMovementTypeName: 'GI for order',
            Plant: '1120',
            StorageLocation: 'CS01',
            Product: 'MAT-CLOSED',
            ProductName: 'Fully Withdrawn Material',
            ResvnItmRequiredQtyInBaseUnit: '50.000',
            ResvnItmWithdrawnQtyInBaseUnit: '50.000',
            BaseUnit: 'KG'
          }
        ])
      };

      const client = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const results = await client.getOpenReservations('261', '1120');

      // Only the reservation with OpenQty > 0 is returned
      expect(results).toHaveLength(1);
      const resv = results[0];
      expect(resv.ReservationNo).toBe('0000100555');
      expect(resv.ItemCount).toBe(1);
    });

    it('calculates OpenQty strictly without queue deduction and does NOT expose QueuedQty in getOpenItems', async () => {
      const mockAdapter = {
        _get: jest.fn().mockImplementation((path) => {
          if (path.includes('ReservationDocumentItem')) {
            return Promise.resolve([
              {
                Reservation: '0000100777',
                ReservationItem: '0001',
                GoodsMovementType: '201',
                GoodsMovementTypeName: 'GI for cost center',
                Plant: '1120',
                StorageLocation: 'HS01',
                Product: 'MAT-ITEM-01',
                ProductName: 'Item Without Queue',
                ResvnItmRequiredQtyInBaseUnit: '50.000',
                ResvnItmWithdrawnQtyInBaseUnit: '10.000',
                BaseUnit: 'EA'
              }
            ]);
          }
          return Promise.resolve({});
        }),
        getMaterialPackagingUnits: jest.fn().mockResolvedValue([]),
        getMaterialBatches: jest.fn().mockResolvedValue([]),
        isSerialManaged: jest.fn().mockResolvedValue(false)
      };

      const client = new GoodsIssueReservationsClient({ adapter: mockAdapter });
      const items = await client.getOpenItems(null, '0000100777');

      expect(items).toHaveLength(1);
      const item = items[0];
      // 50 - 10 = 40 without any queue subtraction
      expect(item.OpenQty).toBe(40);
      expect(item.RequiredQty).toBe(50);
      expect(item.WithdrawnQty).toBe(10);
      // QueuedQty column was eliminated from model and mapping
      expect(item.QueuedQty).toBeUndefined();
    });
  });

  describe('GoodsIssueHandler: OpenReservations pending confirmation enrichment', () => {
    it('enriches open reservation with "pending confirmation" when an unconfirmed attempt exists', async () => {
      // Create an unconfirmed attempt in the attempt store
      await attempts.create({
        ReferenceDocument: 'REF-UNCONFIRMED-999',
        MovementType: '261',
        ReservationNo: '100999',
        ReservationItem: '0001',
        Material: 'MAT-TEST',
        Plant: '1120',
        StorageLocation: 'CS01',
        IssueQty: 10,
        Unit: 'KG'
      });
      await attempts.setStatus('REF-UNCONFIRMED-999', 'unconfirmed', {
        LastError: 'Gateway timeout'
      });

      // Mock live SAP reservations return
      jest.spyOn(GoodsIssueAdapter, 'getOpenReservations').mockResolvedValue([
        {
          ReservationNo: '100999',
          OrderNo: '40001',
          Plant: '1120',
          DisplayText: 'Reservation 100999 (MAT-TEST)'
        },
        {
          ReservationNo: '100888',
          OrderNo: '40002',
          Plant: '1120',
          DisplayText: 'Reservation 100888 (MAT-OTHER)'
        }
      ]);

      const req = {
        data: {},
        query: {
          SELECT: {
            where: [{ ref: ['Plant'] }, '=', { val: '1120' }]
          }
        },
        error: jest.fn()
      };

      const results = await handlers['READ:OpenReservations'](req);

      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(2);

      // Reservation with unconfirmed attempt MUST carry pending confirmation flags
      const pendingResv = results.find(r => r.ReservationNo === '100999');
      expect(pendingResv).toBeDefined();
      expect(pendingResv.Status).toBe('pending confirmation');
      expect(pendingResv.StatusText).toBe('pending confirmation');
      expect(pendingResv.StatusState).toBe('Warning');
      expect(pendingResv.PendingConfirmation).toBe(true);
      expect(pendingResv.DisplayText).toContain('pending confirmation');

      // Reservation WITHOUT unconfirmed attempt must NOT have pending confirmation
      const cleanResv = results.find(r => r.ReservationNo === '100888');
      expect(cleanResv).toBeDefined();
      expect(cleanResv.PendingConfirmation).toBeFalsy();
      expect(cleanResv.Status).not.toBe('pending confirmation');
    });
  });
});
