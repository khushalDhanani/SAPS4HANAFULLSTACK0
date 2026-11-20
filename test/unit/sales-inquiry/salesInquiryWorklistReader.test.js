'use strict';

const worklistReader = require('../../../srv/integration/s4hana/sd/sales-inquiry/salesInquiryWorklistReader');

describe('Unit: salesInquiryWorklistReader', () => {
    test('getInquiries throws 503 when s4hanaWL is not connected', async () => {
        const mockAdapter = {
            init: jest.fn().mockResolvedValue(),
            s4hanaWL: null
        };

        await expect(worklistReader.getInquiries(mockAdapter, {})).rejects.toMatchObject({
            status: 503,
            message: expect.stringContaining('SD_F2370_INQY_WL_SRV is not connected')
        });
    });

    test('getInquiries executes query with ordering and limit, and preserves $count', async () => {
        const mockAdapter = {
            init: jest.fn().mockResolvedValue(),
            s4hanaWL: {
                run: jest.fn().mockImplementation((query) => {
                    expect(query.SELECT.from.ref[0]).toBe('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370');
                    const results = [{ SalesInquiry: '100010' }];
                    results.$count = 1;
                    return Promise.resolve(results);
                })
            }
        };

        const list = await worklistReader.getInquiries(mockAdapter, {
            SELECT: {
                limit: { rows: { val: 10 }, offset: { val: 0 } },
                count: true
            }
        });
        expect(list).toHaveLength(1);
        expect(list[0].SalesInquiry).toBe('100010');
        expect(list.$count).toBe(1);
    });

    test('getSalesMetrics reads live open and total counts', async () => {
        const mockExecute = jest.fn().mockImplementation((dest, req) => {
            if (req.url.includes("OverallSDProcessStatus ne 'C'")) {
                return Promise.resolve({ data: { d: { __count: 12 } } });
            }
            return Promise.resolve({ data: { d: { __count: 45 } } });
        });

        const mockAdapter = {
            _getDestination: jest.fn().mockResolvedValue({ name: 'S4_TEST' }),
            client: { _execute: mockExecute }
        };

        const metrics = await worklistReader.getSalesMetrics(mockAdapter, { entity: 'order' });
        expect(metrics.openOrdersCount).toBe(12);
        expect(metrics.totalOrdersCount).toBe(45);
    });

    test('getInquiryMetrics delegates to getSalesMetrics with entity: inquiry', async () => {
        const mockExecute = jest.fn().mockImplementation((dest, req) => {
            if (req.url.includes("OverallSDProcessStatus ne 'C'")) {
                return Promise.resolve({ data: { d: { __count: 5 } } });
            }
            return Promise.resolve({ data: { d: { __count: 20 } } });
        });

        const mockAdapter = {
            _getDestination: jest.fn().mockResolvedValue({ name: 'S4_TEST' }),
            client: { _execute: mockExecute }
        };

        const metrics = await worklistReader.getInquiryMetrics(mockAdapter);
        expect(metrics.openInquiriesCount).toBe(5);
        expect(metrics.totalInquiriesCount).toBe(20);
    });
});
