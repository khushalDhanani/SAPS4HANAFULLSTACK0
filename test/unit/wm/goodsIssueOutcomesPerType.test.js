'use strict';

const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

// [mock only, not SAP verification]
describe('post261 reference lookup after an unknown outcome', () => {
  const saved = process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
    else process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = saved;
  });

  it('keeps the unknown outcome when the lookup itself fails with a 4xx', async () => {
    process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = '0';
    const client = new GoodsIssuePostingClient({ adapter: { _getDestination: jest.fn(), _post: jest.fn(), _get: jest.fn() } });
    jest.spyOn(client, '_assert261CapabilityReady').mockResolvedValue();
    jest.spyOn(client, '_preflightPosting').mockResolvedValue();
    jest.spyOn(client, '_submitMaterialDocument')
      .mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    jest.spyOn(client, 'findPostedByReference')
      .mockRejectedValue(Object.assign(new Error('Not authorized for lookup'), { status: 403 }));

    await expect(client.post261({
      MovementType: '261', ValidatedMovementType: '261', ReservationNo: '512851', ReservationItem: '3',
      Material: 'M1', Plant: '1130', StorageLocation: 'CS02', IssueQty: 5, Unit: 'KG',
      OrderNo: '1002707', OrderType: 'ZP01', ReferenceDocument: 'GIABC0'
    })).rejects.toMatchObject({ status: 504, code: 'GI_POSTING_OUTCOME_UNKNOWN' });
  });
});

// SAP is stubbed at the adapter transport (_post/_get); the error objects are hand-written, so the SAP side is not proven.
describe('Posting outcome classification through post261', () => {
  const POSTS = [
    ['261', 'post261', { OrderNo: '1002707', OrderType: 'ZP01' }]
  ];
  const payload = (type, extra) => ({
    MovementType: type, ValidatedMovementType: type, ReservationNo: '520001', ReservationItem: '1', Material: '8000000023',
    Plant: '1120', StorageLocation: 'HS01', IssueQty: 5, Unit: 'KG', PostingDate: '2026-10-24', ...extra
  });
  const clientRejecting = (err, get = async () => []) => {
    const client = new GoodsIssuePostingClient({
      adapter: { _getDestination: async () => ({ name: 'S4HANA' }), _post: async () => { throw err; }, _get: get }
    });
    client._assert261CapabilityReady = async () => ({ ready: true, movementType: '261' });
    return client;
  };

  describe.each(POSTS)('Movement %s', (type, method, extra) => {
    it('a 422 SAP rejection reaches the caller unchanged', async () => {
      const err = Object.assign(new Error('Deficit of BA Unrestricted-use stock'), { status: 422 });
      await expect(clientRejecting(err)[method](payload(type, extra))).rejects.toBe(err);
    });

    it('a refused connection means never posted: 501 naming this movement', async () => {
      const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { status: 502, code: 'ECONNREFUSED' });
      await expect(clientRejecting(err)[method](payload(type, extra))).rejects.toMatchObject({
        status: 501,
        message: expect.stringContaining(`Backend Posting Capability Unavailable on Gateway client 220 for single-item movement ${type}.`)
      });
    });

    it('a plain 403 says NOT posted and points to SU53 for this movement', async () => {
      const err = Object.assign(new Error('Forbidden'), { status: 403 });
      const rejected = await clientRejecting(err)[method](payload(type, extra)).catch((e) => e);
      expect(rejected.status).toBe(403);
      expect(rejected.message).toContain(`SAP refused the single-item movement ${type} (authorization or CSRF token). It was NOT posted; check SU53`);
    });

    it('a timeout without a reference is an unknown outcome that warns not to post again', async () => {
      const err = Object.assign(new Error('timeout of 30000ms exceeded'), { status: 502, code: 'ECONNABORTED' });
      const rejected = await clientRejecting(err)[method](payload(type, extra)).catch((e) => e);
      expect(rejected.status).toBe(504);
      expect(rejected.code).toBe('GI_POSTING_OUTCOME_UNKNOWN');
      expect(rejected.message).toContain(`did not confirm the outcome of the single-item movement ${type}`);
      expect(rejected.message).toContain('The goods issue may or may not have been posted. Outcome is unconfirmed; do not post again.');
    });
  });

});
