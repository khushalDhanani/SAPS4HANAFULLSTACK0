'use strict';

const salesOrderReader = require('../../../srv/integration/s4hana/sd/sales-inquiry/salesOrderReader');

describe('Unit: salesOrderReader', () => {
    test('getSalesOrderDefaults provides standard Sales Order creation defaults', async () => {
        const mockAdapter = {
            resolver: {
                resolve: jest.fn().mockResolvedValue({
                    orderType: 'ZDOM',
                    salesOrganization: '1000',
                    distributionChannel: '10',
                    division: '52',
                    currency: 'INR'
                })
            }
        };

        const defaults = await salesOrderReader.getSalesOrderDefaults(mockAdapter, { plant: '1120' });
        expect(defaults.SalesOrderType).toBe('ZDOM');
        expect(defaults.SalesOrganization).toBe('1000');
        expect(defaults.DistributionChannel).toBe('10');
        expect(defaults.OrganizationDivision).toBe('52');
        expect(defaults.TransactionCurrency).toBe('INR');
        expect(defaults.derived).toBe(true);
    });

    test('getSalesOrders runs CDS query when s4hanaSO is connected', async () => {
        const mockAdapter = {
            init: jest.fn().mockResolvedValue(),
            s4hanaSO: {
                run: jest.fn().mockImplementation((query) => {
                    const results = [{ SalesOrder: '500001' }];
                    results.$count = 1;
                    return Promise.resolve(results);
                })
            }
        };

        const result = await salesOrderReader.getSalesOrders(mockAdapter, {
            SELECT: { limit: { rows: 10, offset: 0 }, count: true }
        });
        expect(result).toHaveLength(1);
        expect(result[0].SalesOrder).toBe('500001');
        expect(result.$count).toBe(1);
    });

    test('checkATP calls FunctionImport in LORD_ODATA_ORDER_SRV', async () => {
        const mockExecute = jest.fn().mockResolvedValue({
            data: {
                d: {
                    CheckATP: {
                        RequestedQty: '100.000',
                        ConfirmedQty: '80.000',
                        ReqDlvDate: '2026-12-01',
                        CnfDlvDate: '2026-12-05',
                        SalesUnit: 'PC'
                    }
                }
            }
        });

        const mockAdapter = {
            _getDestination: jest.fn().mockResolvedValue({ name: 'S4_TEST' }),
            client: { _execute: mockExecute }
        };

        const atp = await salesOrderReader.checkATP(mockAdapter, '5000461', '10');
        expect(atp.RequestedQty).toBe(100);
        expect(atp.ConfirmedQty).toBe(80);
        expect(atp.ReqDlvDate).toBe('2026-12-01');
        expect(atp.CnfDlvDate).toBe('2026-12-05');
        expect(atp.SalesUnit).toBe('PC');
    });
});
