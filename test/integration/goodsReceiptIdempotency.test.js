'use strict';

/**
 * Integration: Goods Receipt idempotency key over real CAP HTTP (service definition, handler, attempt store).
 * Only SAP is doubled, at the adapter. [mock only, not SAP verification]
 */

const cds = require('@sap/cds');

const cdsTest = cds.test(__dirname + '/../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { axios } = cdsTest;
const adapter = require('../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const { ATTEMPT_ENTITY } = require('../../srv/wm/goods-receipt/GoodsReceiptAttemptStore');

const post = (body) => axios.post('/odata/v4/goods-receipt/postGoodsReceiptWithStorageUnit', body, { validateStatus: () => true });
const BODY = {
  StorageUnit: '180000077', DeliveryDocument: '180000077', DeliveryDocumentItem: '10', Material: 'TG11',
  Plant: '1120', StorageLocation: 'HS01', Quantity: 4, Unit: 'KG'
};

describe('Integration: Goods Receipt IdempotencyKey over HTTP', () => {
  let sapPost;

  beforeEach(async () => {
    await cds.db.run(cds.ql.DELETE.from(ATTEMPT_ENTITY));
    jest.spyOn(adapter, 'readDeliveryPlant').mockResolvedValue('1120');
    jest.spyOn(adapter, '_read101Docs').mockResolvedValue([]);
    sapPost = jest.spyOn(adapter, 'postGoodsReceiptWithStorageUnit').mockResolvedValue({
      Success: true, Message: 'Goods Receipt posted', MaterialDocument: '5000000777', MaterialDocumentYear: '2026',
      DeliveryDocument: '180000077', StorageUnit: '180000077', Quantity: 4, Unit: 'KG'
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('accepts the key, and a repeat with the same key returns the same document without a second SAP post', async () => {
    const first = await post({ ...BODY, IdempotencyKey: 'f3b0c1d2-0000-4000-8000-000000000001' });
    const repeat = await post({ ...BODY, IdempotencyKey: 'f3b0c1d2-0000-4000-8000-000000000001' });

    expect(first.status).toBe(200);
    expect(first.data.MaterialDocument).toBe('5000000777');
    expect(repeat.status).toBe(200);
    expect(repeat.data).toMatchObject({ Success: true, MaterialDocument: '5000000777' });
    expect(repeat.data.Message).toContain('not posted again');
    expect(sapPost).toHaveBeenCalledTimes(1);
  });

  it('a new key posts a further partial receipt', async () => {
    await post({ ...BODY, IdempotencyKey: 'f3b0c1d2-0000-4000-8000-000000000001' });
    const second = await post({ ...BODY, IdempotencyKey: 'f3b0c1d2-0000-4000-8000-000000000002' });

    expect(second.status).toBe(200);
    expect(sapPost).toHaveBeenCalledTimes(2);
  });

  it('a repeat with a changed quantity is refused with 409', async () => {
    await post({ ...BODY, IdempotencyKey: 'f3b0c1d2-0000-4000-8000-000000000001' });
    const changed = await post({ ...BODY, Quantity: 9, IdempotencyKey: 'f3b0c1d2-0000-4000-8000-000000000001' });

    expect(changed.status).toBe(409);
    expect(changed.data.error.message).toContain('already posted');
    expect(sapPost).toHaveBeenCalledTimes(1);
  });

  it('a request without a key still works', async () => {
    const res = await post(BODY);

    expect(res.status).toBe(200);
    expect(sapPost).toHaveBeenCalledTimes(1);
  });
});
