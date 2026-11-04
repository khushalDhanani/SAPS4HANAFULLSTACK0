'use strict';

/**
 * Integration: plant scope of the outbound delivery writes. Real CAP HTTP, roles, handlers and adapter.
 * Only SAP is doubled (Cloud SDK and RFC reads), so "no write" is read at the SAP boundary.
 * That LIPS-WERKS holds the plant of an outbound delivery is NOT proven here: it needs a read against SAP.
 */

const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');

const { axios } = cds.test(__dirname + '/../../');
const adapter = require('../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');

const LIPS = {
  '0080000001': ['1120', '1120'],
  '0080000002': ['1130'],
  '0080000003': ['1120', '1130'],
  '0080000004': ['1120', '']
};
const TVSTZ = { 1120: ['WAVG'], 1130: ['WBBB'] };

const SERVICE = '/odata/v4/outbound-delivery';
const call = (user, action, body) => axios.post(`${SERVICE}/${action}`, body, {
  auth: { username: user, password: '' },
  validateStatus: () => true
});

describe('Integration: plant scope on outbound delivery writes', () => {
  const original = { rfc: adapter.rfc, resolver: adapter.businessConfigResolver };
  let posts;
  let rfcReads;

  const stubSap = (rfcDown = false) => {
    posts = [];
    rfcReads = [];
    adapter.clearTvstzCache();
    // The shared resolver is a second source of shipping points, which would hide a TVSTZ outage here.
    adapter.businessConfigResolver = null;
    adapter.rfc = {
      readTable: async (table, _fields, where) => {
        rfcReads.push({ table, where: where[0] });
        if (rfcDown) throw new Error('RFC down');
        if (table === 'LIPS') return (LIPS[where[0].slice(9, 19)] || []).map((WERKS) => ({ WERKS }));
        return (TVSTZ[where[0].slice(9, 13)] || []).map((VSTEL) => ({ VSTEL }));
      }
    };
    jest.spyOn(connectivity, 'getDestination').mockResolvedValue({ url: 'https://s4.example.test', sapClient: '220' });
    jest.spyOn(httpClient, 'executeHttpRequest').mockImplementation(async (_dest, config) => {
      if (config.headers['x-csrf-token'] === 'Fetch') return { status: 200, data: {}, headers: { 'x-csrf-token': 'TOKEN' } };
      if (config.method === 'get') return { status: 200, headers: {}, data: { d: { results: [] } } };
      posts.push(config);
      return { status: 201, headers: {}, data: { d: { OutboundDelivery: '13000526', PostGoodsIssue: { Done: true, ErrorAny: false } } } };
    });
  };

  beforeEach(() => stubSap());
  afterEach(() => {
    jest.restoreAllMocks();
    adapter.rfc = original.rfc;
    adapter.businessConfigResolver = original.resolver;
    adapter.clearTvstzCache();
  });

  describe.each([
    ['postGoodsIssue', 'test-clerk-1120', 'PostGoodsIssue?DeliveryNumber=\'80000001\'', {}],
    ['createBillingDocument', 'test-sales-1120', 'ReferenceSDDocument=\'80000001\'', { BillingDocumentType: 'F2' }]
  ])('%s', (action, user, sapUrl, extra) => {
    const post = (delivery, as = user) => call(as, action, { DeliveryDocument: delivery, ...extra });

    it('posts a delivery whose items are all in the plant of the user', async () => {
      await post('80000001');

      expect(rfcReads).toEqual([{ table: 'LIPS', where: "VBELN = '0080000001'" }]);
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toContain(sapUrl);
    });

    it('refuses with 403 and posts nothing for a delivery of another plant', async () => {
      const res = await post('80000002');

      expect(res.status).toBe(403);
      expect(res.data.error.message).toBe('Plant 1130 is outside the authenticated user\'s plant scope');
      expect(posts).toEqual([]);
    });

    it('refuses with 403 and posts nothing when one item of the delivery is in another plant', async () => {
      const res = await post('80000003');

      expect(res.status).toBe(403);
      expect(posts).toEqual([]);
    });

    it('refuses with 503 and posts nothing when SAP has no item for the delivery', async () => {
      const res = await post('80000099');

      expect(res.status).toBe(503);
      expect(res.data.error.message).toBe('The plant of delivery 80000099 could not be read from SAP; nothing was posted (NOT posted). Try again.');
      expect(posts).toEqual([]);
    });

    it('refuses with 503 and posts nothing when an item has no plant', async () => {
      const res = await post('80000004');

      expect(res.status).toBe(503);
      expect(posts).toEqual([]);
    });

    it('refuses with 503 and posts nothing when the plant cannot be read', async () => {
      stubSap(true);

      const res = await post('80000001');

      expect(res.status).toBe(503);
      expect(posts).toEqual([]);
    });

    it('refuses with 400, reading and posting nothing, for a delivery number that could break the read', async () => {
      const res = await post("80000001' OR VBELN <> '");

      expect(res.status).toBe(400);
      expect(rfcReads).toEqual([]);
      expect(posts).toEqual([]);
    });

    it('does not limit an Admin: another plant is posted with no plant read', async () => {
      await post('80000002', 'khushal');

      expect(rfcReads).toEqual([]);
      expect(posts).toHaveLength(1);
    });
  });

  describe('createOutboundDelivery', () => {
    const create = (user, ShippingPoint) => call(user, 'createOutboundDelivery', { SalesOrder: '5000104', ShippingPoint });

    it('creates from a shipping point of the plant of the user, in any case', async () => {
      const res = await create('test-clerk-1120', 'wavg');

      expect(res.status).toBe(200);
      expect(res.data.value).toBe('13000526');
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toContain('C_DelivWthRefQuickCreate');
    });

    it('refuses with 403 and creates nothing from a shipping point of another plant', async () => {
      const res = await create('test-clerk-1120', 'WBBB');

      expect(res.status).toBe(403);
      expect(res.data.error.message).toBe("Shipping point 'WBBB' is outside user's authorized plants: [1120]. Access denied.");
      expect(posts).toEqual([]);
    });

    it('refuses with 503 and creates nothing when the shipping points cannot be read', async () => {
      stubSap(true);

      const res = await create('test-clerk-1120', 'WAVG');

      expect(res.status).toBe(503);
      expect(res.data.error.message).toBe('The shipping points of plant 1120 could not be read from SAP, so nothing was read or posted. Try again.');
      expect(posts).toEqual([]);
    });

    it('refuses with 403 and creates nothing for a user with no plant', async () => {
      const res = await create('test-clerk-noplant', 'WAVG');

      expect(res.status).toBe(403);
      expect(rfcReads).toEqual([]);
      expect(posts).toEqual([]);
    });

    it('does not limit an Admin: another plant is created with no shipping point read', async () => {
      await create('khushal', 'WBBB');

      expect(rfcReads).toEqual([]);
      expect(posts).toHaveLength(1);
    });
  });

  it('refuses a user with no plant on a delivery, even when SAP names a plant', async () => {
    const res = await call('test-clerk-noplant', 'postGoodsIssue', { DeliveryDocument: '80000001' });

    expect(res.status).toBe(403);
    expect(posts).toEqual([]);
  });
});
