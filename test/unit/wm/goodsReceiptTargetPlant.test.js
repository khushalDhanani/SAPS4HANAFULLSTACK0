'use strict';

/**
 * GR-03: the plant used for authorization must be the plant SAP holds for the document that is actually
 * posted against, whichever field of the request names it. The Plant sent by the browser proves nothing.
 * Handler with the real adapter; only its SAP reads and the post itself are doubled. [mock only]
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const adapter = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const { ATTEMPT_ENTITY } = require('../../../srv/wm/goods-receipt/GoodsReceiptAttemptStore');
const init = require('../../../srv/wm/goods-receipt/handlers/goodsReceipt.handler');

const handlers = {};
init({ on: (event, a, b) => { handlers[typeof a === 'function' ? event : `${event}_${a}`] = typeof a === 'function' ? a : b; } });

const ADMIN = { id: 'admin', is: (r) => r === 'Admin', attr: {} };
const clerkOf = (plant) => ({ id: 'clerk', is: () => false, attr: { Plant: [plant] } });
const BASE = { Material: 'TG11', Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'KG' };
const PO_ONLY = { ...BASE, StorageUnit: '4500001234', PurchaseOrder: '4500001234', PurchaseOrderItem: '10' };
const DELIVERY_IN_SU_FIELD = { ...BASE, StorageUnit: '180000099', DeliveryDocumentItem: '10' };

const run = async (user, data) => {
  const req = { data: { ...data }, user, reject: jest.fn((code, msg) => ({ code, msg })), headers: {} };
  let thrown;
  try { await handlers.postGoodsReceipt(req); } catch (err) { thrown = err; }
  return { req, thrown, status: thrown ? thrown.status : req.reject.mock.calls[0]?.[0], message: thrown ? thrown.message : req.reject.mock.calls[0]?.[1] };
};

describe('GR-03: plant authorization uses the SAP plant of the posting target', () => {
  let post;
  let poPlant;
  let deliveryPlant;

  beforeEach(async () => {
    await cds.db.run(cds.ql.DELETE.from(ATTEMPT_ENTITY));
    post = jest.spyOn(adapter, 'postGoodsReceipt').mockResolvedValue({ Success: true, MaterialDocument: '5000000042' });
    deliveryPlant = jest.spyOn(adapter, 'readDeliveryPlant').mockResolvedValue('1120');
    jest.spyOn(adapter, '_read101Docs').mockResolvedValue([]);
    poPlant = jest.fn().mockResolvedValue('1120');
    adapter.readPurchaseOrderItemPlant = poPlant;
  });
  afterEach(() => {
    delete adapter.readPurchaseOrderItemPlant;
    jest.restoreAllMocks();
  });

  describe('Purchase Order receipt without an inbound delivery', () => {
    it('refuses a clerk when SAP holds another plant for the Purchase Order item, although the request names their own plant', async () => {
      poPlant.mockResolvedValue('1130');

      const { status, message } = await run(clerkOf('1120'), PO_ONLY);

      expect(status).toBe(403);
      expect(message).toBe("Plant 1130 is outside the authenticated user's plant scope");
      expect(poPlant).toHaveBeenCalledWith('4500001234', '10');
      expect(post).not.toHaveBeenCalled();
    });

    it('posts for a clerk whose plant is the plant SAP holds for the item', async () => {
      const { req, thrown } = await run(clerkOf('1120'), PO_ONLY);

      expect(thrown).toBeUndefined();
      expect(req.reject).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['SAP returns no plant for the item', () => poPlant.mockResolvedValue('')],
      ['the Purchase Order item cannot be read', () => poPlant.mockRejectedValue(Object.assign(new Error('gateway down'), { status: 502 }))]
    ])('does not post when %s', async (_label, arrange) => {
      arrange();

      const { status, message } = await run(clerkOf('1120'), PO_ONLY);

      expect(status).toBe(503);
      expect(message).toContain('NOT posted');
      expect(post).not.toHaveBeenCalled();
    });

    it('checks the SAP plant even when the browser sends the plant of the other site', async () => {
      poPlant.mockResolvedValue('1130');

      const { status } = await run(clerkOf('1130'), { ...PO_ONLY, Plant: '1120' });

      // The request plant is outside the clerk's scope, so it is refused before SAP is asked.
      expect(status).toBe(403);
      expect(post).not.toHaveBeenCalled();
    });

    it('an Admin is not restricted and no plant read is needed', async () => {
      const { req } = await run(ADMIN, PO_ONLY);

      expect(req.reject).not.toHaveBeenCalled();
      expect(poPlant).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledTimes(1);
    });
  });

  describe('inbound delivery number sent in the StorageUnit field', () => {
    it('refuses a clerk when SAP holds another plant for that delivery item', async () => {
      deliveryPlant.mockResolvedValue('1130');

      const { status, message } = await run(clerkOf('1120'), DELIVERY_IN_SU_FIELD);

      expect(status).toBe(403);
      expect(message).toBe("Plant 1130 is outside the authenticated user's plant scope");
      expect(deliveryPlant).toHaveBeenCalledWith('180000099', '10');
      expect(post).not.toHaveBeenCalled();
    });

    it('does not post when the delivery plant cannot be read', async () => {
      deliveryPlant.mockResolvedValue('');

      const { status } = await run(clerkOf('1120'), DELIVERY_IN_SU_FIELD);

      expect(status).toBe(503);
      expect(post).not.toHaveBeenCalled();
    });

    it('posts under the attempt log like any delivery receipt, so a repeat is blocked while unconfirmed', async () => {
      post.mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { outcomeUnknown: true }));

      await run(clerkOf('1120'), DELIVERY_IN_SU_FIELD);
      const second = await run(clerkOf('1120'), DELIVERY_IN_SU_FIELD);

      expect(second.status).toBe(409);
      expect(post).toHaveBeenCalledTimes(1);
    });
  });

  describe('inbound delivery named in DeliveryDocument (unchanged)', () => {
    const WITH_DELIVERY = { ...BASE, DeliveryDocument: '180000003', DeliveryDocumentItem: '10', PurchaseOrder: '4500001234', PurchaseOrderItem: '10' };

    it('is checked against the delivery, not the Purchase Order', async () => {
      deliveryPlant.mockResolvedValue('1130');

      const { status } = await run(clerkOf('1120'), WITH_DELIVERY);

      expect(status).toBe(403);
      expect(deliveryPlant).toHaveBeenCalledWith('180000003', '10');
      expect(poPlant).not.toHaveBeenCalled();
    });
  });

  describe('the posting target is decided in one place', () => {
    const { receiptTarget } = require('../../../srv/integration/s4hana/wm/GoodsReceiptODataPoster');

    it.each([
      ['a delivery', { DeliveryDocument: '180000003', DeliveryDocumentItem: '10', PurchaseOrder: '4500001234' }, { document: '180000003', source: 'INBDELIV', item: '10' }],
      ['a purchase order without a delivery', { PurchaseOrder: '4500001234', PurchaseOrderItem: '20', StorageUnit: '999' }, { document: '4500001234', source: 'PURORD', item: '20' }],
      ['a delivery number in the StorageUnit field', { StorageUnit: '180000099', DeliveryDocumentItem: '10' }, { document: '180000099', source: 'INBDELIV', item: '10' }],
      ['nothing', {}, { document: '', source: 'INBDELIV', item: '' }]
    ])('%s', (_label, payload, expected) => {
      expect(receiptTarget(payload)).toEqual(expected);
    });

    it('the poster sends exactly the target the authorization checked', async () => {
      post.mockRestore();
      const sent = jest.spyOn(adapter, '_post').mockResolvedValue({ MaterialDocument: '5000000042', InboundDelivery: '4500001234' });

      await adapter.postGoodsReceipt({ ...PO_ONLY }).catch(() => {});

      const body = sent.mock.calls[0][1];
      const target = receiptTarget(PO_ONLY);
      expect(JSON.stringify(body)).toContain(`"InboundDelivery":"${target.document}"`);
      expect(JSON.stringify(body)).toContain(`"SourceOfGR":"${target.source}"`);
    });
  });

  describe('reading the plant of a Purchase Order item from SAP', () => {
    const { GoodsReceiptAdapter } = adapter;
    const readerWith = (items) => {
      const real = new GoodsReceiptAdapter();
      real._get = jest.fn().mockResolvedValue({ results: items });
      return real;
    };
    const ITEMS = [{ DeliveryDocumentItem: '000010', Plant: '1120' }, { DeliveryDocumentItem: '000020', Plant: '1130' }];

    beforeEach(() => { delete adapter.readPurchaseOrderItemPlant; });

    it('reads the open items of the order and returns the plant of the exact item', async () => {
      const real = readerWith(ITEMS);

      await expect(real.readPurchaseOrderItemPlant('4500001234', '20')).resolves.toBe('1130');
      expect(real._get).toHaveBeenCalledWith(
        "/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers(InboundDelivery='4500001234',SourceOfGR='PURORD')/Header2Items", '$format=json');
    });

    it('does not fall back to another item when the requested one is not there', async () => {
      await expect(readerWith(ITEMS).readPurchaseOrderItemPlant('4500001234', '30')).resolves.toBe('');
    });

    it.each([["4500001234' or '1'='1", '10'], ['4500001234', '10)/x'], ['', '10']])(
      'never sends a malformed order or item to SAP (%j, %j)', async (order, item) => {
        const real = readerWith(ITEMS);

        await expect(real.readPurchaseOrderItemPlant(order, item)).resolves.toBe('');
        expect(real._get).not.toHaveBeenCalled();
      });

    it('lets a SAP failure surface, so the caller refuses the posting', async () => {
      const real = readerWith(ITEMS);
      real._get.mockRejectedValue(Object.assign(new Error('gateway down'), { status: 502 }));

      await expect(real.readPurchaseOrderItemPlant('4500001234', '10')).rejects.toMatchObject({ status: 502 });
    });
  });
});
