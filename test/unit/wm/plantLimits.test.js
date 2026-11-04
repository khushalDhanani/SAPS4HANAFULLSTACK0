'use strict';

/**
 * A non-Admin may only act on a plant SAP reports for the document, whatever plant the request names. [mock only, not SAP verification]
 */

const GoodsReceiptAdapter = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const initReceipt = require('../../../srv/wm/goods-receipt/handlers/goodsReceipt.handler');

const ADMIN = { is: (r) => r === 'Admin', attr: {} };
const clerk = (plant) => ({ id: `clerk-${plant}`, is: () => false, attr: { Plant: [plant] } });
const collect = (init) => {
  const handlers = {};
  init({ on: (event, a, b) => { handlers[typeof a === 'function' ? event : `${event}_${a}`] = typeof a === 'function' ? a : b; } });
  return handlers;
};
/** The failure a handler reports, whichever way it reports it: throw, req.error or req.reject. */
const outcome = async (handler, data, user) => {
  const failures = [];
  const fail = (status, message) => { failures.push({ status, message }); return { status, message }; };
  try {
    await handler({ data, user, error: jest.fn(fail), reject: jest.fn(fail), headers: {} });
  } catch (err) {
    failures.push({ status: err.status || err.statusCode, message: err.message });
  }
  return failures[0] || null;
};

afterEach(() => jest.restoreAllMocks());

describe('Goods receipt: the plant comes from the delivery in SAP', () => {
  const handlers = collect(initReceipt);
  const DATA = { DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Material: 'TG11', Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'KG', Simulate: true };

  describe.each(['postGoodsReceipt', 'postGoodsReceiptWithStorageUnit'])('%s', (action) => {
    let post;
    beforeEach(() => { post = jest.spyOn(GoodsReceiptAdapter, action).mockResolvedValue({ MaterialDocument: '5000000001' }); });

    it("refuses a clerk who names their own plant on another plant's delivery", async () => {
      jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant').mockResolvedValue('1130');
      const failure = await outcome(handlers[action], DATA, clerk('1120'));
      expect(failure).toMatchObject({ status: 403, message: expect.stringContaining('1130') });
      expect(post).not.toHaveBeenCalled();
    });

    it('fails closed when the delivery plant cannot be read', async () => {
      jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant').mockResolvedValue('');
      const failure = await outcome(handlers[action], DATA, clerk('1120'));
      expect(failure).toMatchObject({ status: 503, message: expect.stringContaining('NOT') });
      expect(post).not.toHaveBeenCalled();
    });

    it('allows a clerk on a delivery of their own plant', async () => {
      jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant').mockResolvedValue('1120');
      expect(await outcome(handlers[action], DATA, clerk('1120'))).toBeNull();
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('does not limit an Admin', async () => {
      const read = jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant');
      expect(await outcome(handlers[action], DATA, ADMIN)).toBeNull();
      expect(read).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledTimes(1);
    });
  });

  it('reads the plant of the delivery item from LIPS', async () => {
    const readTable = jest.fn(async (table) => (table === 'LIPS' ? [{ WERKS: '1130', MEINS: 'KG', VRKME: 'KG', LFIMG: '1.000' }] : []));
    const rfc = GoodsReceiptAdapter.rfc;
    GoodsReceiptAdapter.rfc = { readTable };
    try {
      await expect(GoodsReceiptAdapter.readDeliveryPlant('180000003', '10')).resolves.toBe('1130');
      expect(readTable.mock.calls[0][1]).toContain('WERKS');
    } finally {
      GoodsReceiptAdapter.rfc = rfc;
    }
  });
});
