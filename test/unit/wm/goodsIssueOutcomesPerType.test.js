'use strict';

const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');

describe('User-Facing Posting Outcome Messages Per Movement Type (201, 301, 311)', () => {
  const movementTypes = [
    { type: '201', name: 'Goods Issue to Cost Center' },
    { type: '301', name: 'Plant-to-Plant Stock Transfer' },
    { type: '311', name: 'Storage Location Stock Transfer' }
  ];

  movementTypes.forEach(({ type, name }) => {
    describe(`Movement Type ${type} (${name})`, () => {
      let client;
      let mockAdapter;

      beforeEach(() => {
        mockAdapter = {
          _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
          _post: jest.fn(),
          _get: jest.fn()
        };
        client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      });

      // -------------------------------------------------------------
      // 1. REJECTED: SAP business rejection (e.g. 400 / 422, deficit of stock)
      // -------------------------------------------------------------
      it(`[${type}] rejected: surfaces authentic SAP business rejection message`, async () => {
        const businessErr = Object.assign(
          new Error(`Deficit of BA Unrestricted-use stock for Movement ${type}`),
          { status: 422 }
        );
        const classified = client._reclassifyPostingError(null, businessErr, name);

        expect(classified.status).toBe(422);
        expect(classified.message).toContain(`Deficit of BA Unrestricted-use stock for Movement ${type}`);
        // Business rejections are definitive and must never report unconfirmed outcome
        expect(classified.message).not.toContain('Outcome is unconfirmed');
      });

      // -------------------------------------------------------------
      // 2. NEVER REACHED: Outage, inactive service, refused connection
      // -------------------------------------------------------------
      it(`[${type}] never reached: informs user that posting was not made and capability is unavailable`, async () => {
        const unreachableErr = Object.assign(
          new Error('connect ECONNREFUSED 10.0.0.1:443'),
          { status: 502, code: 'ECONNREFUSED' }
        );
        const classified = client._reclassifyPostingError(null, unreachableErr, name);

        expect(classified.status).toBe(501);
        expect(classified.message).toContain('Backend Posting Capability Unavailable');
        expect(classified.message).toContain(name);
        expect(classified.message).not.toContain('Outcome is unconfirmed');
      });

      // -------------------------------------------------------------
      // 3. PLAIN 403: Authorization failure pointing to SU53
      // -------------------------------------------------------------
      it(`[${type}] plain 403: surfaces authorization failure pointing to transaction SU53`, async () => {
        const authErr = Object.assign(new Error('Forbidden'), { status: 403 });
        const classified = client._reclassifyPostingError(null, authErr, name);

        expect(classified.status).toBe(403);
        expect(classified.message).toContain('SU53');
        expect(classified.message).toContain(name);
        expect(classified.message).toContain('NOT posted');
      });

      // -------------------------------------------------------------
      // 4. UNKNOWN OUTCOME: Timeout, reset, hangup
      // MUST state that it may have posted and not to post again!
      // -------------------------------------------------------------
      it(`[${type}] unknown outcome: explicitly warns the document may have posted and NOT to post again`, async () => {
        const timeoutErr = Object.assign(
          new Error('timeout of 30000ms exceeded'),
          { status: 502, code: 'ECONNABORTED' }
        );
        const classified = client._reclassifyPostingError(null, timeoutErr, name);

        expect(classified.status).toBe(504);
        expect(classified.code).toBe('GI_POSTING_OUTCOME_UNKNOWN');

        // Requirement: Must state it may have posted and not to post again
        expect(classified.message).toMatch(/may (or may not )?have been posted/i);
        expect(classified.message).toContain('do not post again');
        expect(classified.message).toContain(name);
      });
    });
  });
});
