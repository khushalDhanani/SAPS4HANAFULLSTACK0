/**
 * Dashboard Movement-Type KPI Cards — Unit Tests
 *
 * KPI aggregation, caching and validation are covered in test/unit/wm/goodsIssueDashboardClient.test.js.
 */

'use strict';

const GoodsIssueDashboardClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueDashboardClient');

describe('Unit: GoodsIssueDashboardClient — dashboard metadata', () => {
    test('returns LastUpdated timestamp', async () => {
        const client = new GoodsIssueDashboardClient({
            rfc: { readTable: jest.fn().mockResolvedValue([]) },
            client: { getText: jest.fn().mockResolvedValue('0') },
            reservationsClient: { getOpenReservations: jest.fn().mockResolvedValue([]) }
        });

        const data = await client.getDashboardData({ days: 30, forceRefresh: true });

        expect(data.LastUpdated).toBeDefined();
        expect(new Date(data.LastUpdated).getTime()).not.toBeNaN();
    });
});
