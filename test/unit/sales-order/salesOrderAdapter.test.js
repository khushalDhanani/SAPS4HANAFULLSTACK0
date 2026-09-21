const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

describe('Unit: Sales Order Adapter Integration', () => {
    let adapter;

    beforeEach(() => {
        adapter = new salesInquiryAdapter.SalesInquiryAdapter();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('createSalesOrder via Deep Insert', () => {
        test('constructs atomic OData Deep Insert payload and returns generated document number', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000460',
                        NetValue: '1250.00',
                        Currency: 'INR'
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                PurchaseOrderNumber: 'PO-DEEP-001',
                RequestedDeliveryDate: '2026-09-30',
                TransactionCurrency: 'INR'
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 5,
                    OrderQuantityUnit: 'KG',
                    Plant: '1120',
                    NetPriceAmount: 250.00,
                    RequestedDeliveryDate: '2026-09-30'
                }
            ];

            const result = await adapter.createSalesOrder(header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000460');
            expect(result.SalesDocument).toBe('5000460');
            expect(result.TotalNetAmount).toBe('1250.00');
            expect(result.TransactionCurrency).toBe('INR');

            // Verify single atomic POST was sent to HeaderSet
            expect(mockExecute).toHaveBeenCalledTimes(1);
            const callConfig = mockExecute.mock.calls[0][1];
            expect(callConfig.method).toBe('post');
            expect(callConfig.url).toContain('/HeaderSet');

            // Verify Deep Insert structure
            const payload = callConfig.data;
            expect(payload.SalesOrderTypeCode).toBe('ZDOM');
            expect(payload.SalesOrganization).toBe('1000');
            expect(payload.DistributionChannel).toBe('10');
            expect(payload.Division).toBe('52');
            expect(payload.SoldToPartyID).toBe('10135');
            expect(payload.PurchaseOrderNumber).toBe('PO-DEEP-001');
            expect(payload.RequestedDeliveryDate).toMatch(/^\/Date\(\d+\)\/$/);

            // Verify nested ItemSet
            expect(payload.ItemSet).toHaveLength(1);
            expect(payload.ItemSet[0].MaterialID).toBe('4000000123');
            expect(payload.ItemSet[0].OrderQty).toBe('5.000');
            expect(payload.ItemSet[0].SalesUnit).toBe('KG');
            expect(payload.ItemSet[0].Plant).toBe('1120');
            expect(payload.ItemSet[0].RequestedDeliveryDate).toMatch(/^\/Date\(\d+\)\/$/);

            // Verify nested PriceCondSet inside ItemSet
            expect(payload.ItemSet[0].PriceCondSet).toHaveLength(1);
            expect(payload.ItemSet[0].PriceCondSet[0].CondTypeCode).toBe('ZPR1');
            expect(payload.ItemSet[0].PriceCondSet[0].AmountInternal).toBe('250.00');
            expect(payload.ItemSet[0].PriceCondSet[0].RateUnitExternal).toBe('INR');
        });

        test('leaves PurchaseOrderNumber empty when omitted instead of defaulting to item text or SALES ORDER', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000461',
                        NetValue: '500.00',
                        Currency: 'INR'
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SoldToParty: '10135',
                PurchaseOrderNumber: '',
                PurchaseOrderByCustomer: ''
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    SalesOrderItemText: 'Some Material Text',
                    OrderQuantity: 2,
                    OrderQuantityUnit: 'PC',
                    NetPriceAmount: 250.00
                }
            ];

            const result = await adapter.createSalesOrder(header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000461');
            const callConfig = mockExecute.mock.calls[0][1];
            expect(callConfig.data.PurchaseOrderNumber).toBe('');
        });

        test('propagates SAP error message when Deep Insert fails', async () => {
            const mockExecute = jest.fn().mockRejectedValue({
                response: {
                    status: 400,
                    data: {
                        error: {
                            message: { value: 'Material 4000000091 is not listed for customer 10135' }
                        }
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135'
            };

            await expect(
                adapter.createSalesOrder(header, [], {
                    destination: { url: 'http://sap.mock' },
                    executeHttpRequest: mockExecute
                })
            ).rejects.toThrow('Material 4000000091 is not listed for customer 10135');
        });
    });

    describe('createSalesDocument Routing', () => {
        test('routes ZIN to sequential 3-step POSTs', async () => {
            const mockExecute = jest.fn()
                // Header POST
                .mockResolvedValueOnce({ status: 201, data: { d: { SalesOrderID: '1000530' } } })
                // Item POST
                .mockResolvedValueOnce({ status: 201, data: { d: {} } })
                // Condition POST
                .mockResolvedValueOnce({ status: 201, data: { d: {} } });

            const header = {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135'
            };

            const items = [
                {
                    SalesInquiryItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 1,
                    OrderQuantityUnit: 'PC',
                    NetPriceAmount: 100
                }
            ];

            const result = await adapter.createSalesDocument('ZIN', header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesDocument).toBe('1000530');
            expect(result.SalesInquiry).toBe('1000530');
            // 3 sequential calls
            expect(mockExecute).toHaveBeenCalledTimes(3);
        });

        test('routes ZDOM to single Deep Insert POST', async () => {
            const mockExecute = jest.fn().mockResolvedValueOnce({
                status: 201,
                data: { d: { SalesOrderID: '5000461', NetValue: '500.00', Currency: 'INR' } }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135'
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 2,
                    OrderQuantityUnit: 'KG',
                    Plant: '1120',
                    NetPriceAmount: 250
                }
            ];

            const result = await adapter.createSalesDocument('ZDOM', header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesDocument).toBe('5000461');
            expect(result.SalesOrder).toBe('5000461');
            // Only 1 atomic call
            expect(mockExecute).toHaveBeenCalledTimes(1);
        });
    });

    describe('getSalesOrders and getSalesOrder', () => {
        test('getSalesOrders runs query on s4hanaSO service', async () => {
            const mockRun = jest.fn().mockResolvedValue([{ SalesOrder: '5000455' }]);
            adapter.s4hanaSO = { run: mockRun };

            const result = await adapter.getSalesOrders();
            expect(result).toEqual([{ SalesOrder: '5000455' }]);
            expect(mockRun).toHaveBeenCalled();
        });

        test('getSalesOrders maps query to remote entity C_SalesOrderWl_F1873 and preserves $count', async () => {
            const mockList = [{ SalesOrder: '2500085' }];
            mockList.$count = 894;
            const mockRun = jest.fn().mockResolvedValue(mockList);
            adapter.s4hanaSO = { run: mockRun };

            const incomingQuery = {
                SELECT: {
                    from: { ref: ['SalesOrders'] },
                    columns: [{ ref: ['SalesOrder'] }],
                    orderBy: [{ ref: ['CreationDate'], sort: 'desc' }],
                    limit: { rows: { val: 25 }, offset: { val: 0 } },
                    count: true
                }
            };

            const result = await adapter.getSalesOrders(incomingQuery);
            expect(result).toHaveLength(1);
            expect(result.$count).toBe(894);
            expect(mockRun).toHaveBeenCalled();
            const calledQuery = mockRun.mock.calls[0][0];
            const targetFrom = calledQuery.SELECT.from?.ref?.[0] || calledQuery.SELECT.from;
            expect(targetFrom).toBe('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873');
            expect(calledQuery.SELECT.count).toBe(true);
        });

        test('getSalesOrders HTTP fallback normalizes OData V2 date strings and preserves $count', async () => {
            adapter.s4hanaSO = null;
            const rawV2 = [
                {
                    SalesOrder: '2500085',
                    CreationDate: '/Date(1789948800000)/',
                    SalesOrderDate: '/Date(1789948800000)/',
                    RequestedDeliveryDate: '/Date(1789948800000)/',
                    LastChangeDateTime: '/Date(1789970480693+0000)/'
                }
            ];
            const mockExecute = jest.fn().mockResolvedValue({
                data: {
                    d: {
                        __count: '894',
                        results: rawV2
                    }
                }
            });

            const result = await adapter.getSalesOrders({ SELECT: { count: true } }, { executeHttpRequest: mockExecute });
            expect(result).toHaveLength(1);
            expect(result.$count).toBe(894);
            expect(result[0].CreationDate).toBe('2026-09-21');
            expect(result[0].SalesOrderDate).toBe('2026-09-21');
            expect(result[0].RequestedDeliveryDate).toBe('2026-09-21');
            expect(result[0].LastChangeDateTime).toContain('2026-09-21');
        });

        test('getSalesOrders throws 502 when backend read fails', async () => {
            adapter.s4hanaSO = null;
            const mockExecute = jest.fn().mockRejectedValue(new Error('Network error'));
            await expect(adapter.getSalesOrders(null, { executeHttpRequest: mockExecute })).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Sales orders cannot be read')
            });
        });

        test('getSalesOrder reads single order with item navigation', async () => {
            const mockOrder = { SalesOrder: '5000455', to_SalesDocumentItemWl: [{ SalesDocumentItem: '10' }] };
            const mockRun = jest.fn().mockResolvedValue(mockOrder);
            adapter.s4hanaSO = { run: mockRun };

            const result = await adapter.getSalesOrder('5000455');
            expect(result).toEqual(mockOrder);
            expect(mockRun).toHaveBeenCalled();
        });

        test('getSalesOrderDefaults returns valid order defaults', async () => {
            const defaults = await adapter.getSalesOrderDefaults();
            expect(defaults.SalesOrderType).toBe('ZDOM');
            expect(defaults.SalesOrganization).toBe('1000');
            expect(defaults.DistributionChannel).toBe('10');
            expect(defaults.OrganizationDivision).toBe('52');
            expect(defaults.Plant).toBe('1120');
            expect(defaults.TransactionCurrency).toBe('INR');
            expect(defaults.RequestedDeliveryDate).toBeDefined();
        });
    });
});
