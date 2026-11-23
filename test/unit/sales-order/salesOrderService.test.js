jest.mock('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter', () => ({
    createSalesOrder: jest.fn(),
    getSalesOrders: jest.fn(),
    getSalesOrder: jest.fn(),
    getCustomerDefaults: jest.fn(),
    getSalesOrderDefaults: jest.fn(),
    getSalesMetrics: jest.fn(),
    readSoData: jest.fn()
}));

const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const registerSalesOrderHandlers = require('../../../srv/sd/sales-order/handlers/salesOrder.handler');

function createMockService() {
    const handlers = {};
    const mockSrv = {
        on: (event, entity, handlerFn) => {
            if (!handlerFn) {
                handlers[event] = entity;
            } else {
                handlers[`${event}_${entity}`] = handlerFn;
            }
        }
    };
    registerSalesOrderHandlers(mockSrv);
    return handlers;
}

describe('Unit: SalesOrderService Handler', () => {
    let handlers;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        handlers = createMockService();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const validOrderPayload = {
        header: {
            SalesOrderType: 'ZDOM',
            SalesOrganization: '1000',
            DistributionChannel: '10',
            OrganizationDivision: '52',
            SoldToParty: '10135',
            PurchaseOrderNumber: 'PO-TEST-123',
            RequestedDeliveryDate: '2026-09-25',
            TransactionCurrency: 'INR'
        },
        items: [
            {
                SalesOrderItem: '000010',
                Material: '4000000123',
                SalesOrderItemText: 'NODG-NEW',
                OrderQuantity: 5,
                OrderQuantityUnit: 'KG',
                Plant: '1120',
                NetPriceAmount: 250.00,
                RequestedDeliveryDate: '2026-09-25'
            }
        ]
    };

    describe('action: createSalesOrder', () => {
        test('returns the trimmed SAP document number', async () => {
            salesInquiryAdapter.createSalesOrder.mockResolvedValue({ SalesOrder: ' 5000459 ' });

            const req = { data: validOrderPayload, user: { id: 'salesrep1' }, error: jest.fn() };

            await expect(handlers.createSalesOrder(req)).resolves.toBe('5000459');
            expect(req.error).not.toHaveBeenCalled();
        });

        test('sends the validated, normalized and mapped payload to the adapter', async () => {
            salesInquiryAdapter.createSalesOrder.mockResolvedValue({ SalesOrder: '5000459' });

            await handlers.createSalesOrder({ data: validOrderPayload, user: { id: 'salesrep1' }, error: jest.fn() });

            expect(salesInquiryAdapter.createSalesOrder).toHaveBeenCalledTimes(1);
            const [header, items, options] = salesInquiryAdapter.createSalesOrder.mock.calls[0];
            expect(header).toMatchObject({
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                PurchaseOrderNumber: 'PO-TEST-123',
                RequestedDeliveryDate: '2026-09-25',
                TransactionCurrency: 'INR'
            });
            // 5 x 250.00 = 1250.00, formatted by the mapper as 3 and 2 decimals
            expect(items).toEqual([{
                SalesOrderItem: '000010',
                SalesInquiryItem: '000010',
                Material: '4000000123',
                SalesOrderItemText: 'NODG-NEW',
                OrderQuantity: '5.000',
                OrderQuantityUnit: 'KG',
                NetPriceAmount: '250.00',
                NetAmount: '1250.00',
                TransactionCurrency: 'INR',
                RequestedDeliveryDate: '2026-09-25',
                Plant: '1120'
            }]);
            expect(options).toEqual({ user: 'salesrep1' });
        });

        test('rejects with HTTP 502 when SAP returns no SalesOrder document number', async () => {
            salesInquiryAdapter.createSalesOrder.mockResolvedValue({
                SalesOrder: '',
                SalesDocument: '',
                TotalNetAmount: '1250.00'
            });

            const req = {
                data: validOrderPayload,
                user: { id: 'salesrep1' },
                error: jest.fn()
            };

            await handlers.createSalesOrder(req);
            expect(req.error).toHaveBeenCalledWith(502, expect.stringContaining('no Sales Order document number was returned by SAP'));
        });

        test('rejects invalid payload missing SoldToParty with HTTP 400', async () => {
            const invalidPayload = {
                header: {
                    SalesOrderType: 'ZDOM',
                    SalesOrganization: '1000',
                    DistributionChannel: '10',
                    OrganizationDivision: '52',
                    SoldToParty: ''
                },
                items: validOrderPayload.items
            };

            const req = {
                data: invalidPayload,
                user: { id: 'salesrep1' },
                error: jest.fn()
            };

            await handlers.createSalesOrder(req);
            expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Sold-to Party is required'));
            expect(salesInquiryAdapter.createSalesOrder).not.toHaveBeenCalled();
        });

        test('rejects invalid payload with empty items array with HTTP 400', async () => {
            const req = {
                data: {
                    header: validOrderPayload.header,
                    items: []
                },
                user: { id: 'salesrep1' },
                error: jest.fn()
            };

            await handlers.createSalesOrder(req);
            expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('At least one order item is required'));
            expect(salesInquiryAdapter.createSalesOrder).not.toHaveBeenCalled();
        });

        test('rejects invalid item quantity <= 0 with HTTP 400', async () => {
            const req = {
                data: {
                    header: validOrderPayload.header,
                    items: [{ ...validOrderPayload.items[0], OrderQuantity: 0 }]
                },
                user: { id: 'salesrep1' },
                error: jest.fn()
            };

            await handlers.createSalesOrder(req);
            expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('Quantity must be greater than 0'));
            expect(salesInquiryAdapter.createSalesOrder).not.toHaveBeenCalled();
        });

        test('handles adapter error during creation with HTTP 500', async () => {
            salesInquiryAdapter.createSalesOrder.mockRejectedValue(new Error('SAP communication timeout'));

            const req = {
                data: validOrderPayload,
                user: { id: 'salesrep1' },
                error: jest.fn()
            };

            await handlers.createSalesOrder(req);
            expect(req.error).toHaveBeenCalledWith(500, expect.stringContaining('Failed to create Sales Order: SAP communication timeout'));
        });

        test('signals a created-but-unverified order with a dedicated code so the UI never re-submits it', async () => {
            const err = new Error("Sales Order 5000999 created, but read-back verification failed: Payment Terms expected 'PT11' but found 'PT01'");
            err.status = 502;
            err.SalesOrder = '5000999';
            salesInquiryAdapter.createSalesOrder.mockRejectedValue(err);

            const req = {
                data: validOrderPayload,
                user: { id: 'salesrep1' },
                error: jest.fn()
            };

            await handlers.createSalesOrder(req);
            expect(req.error).toHaveBeenCalledWith(expect.objectContaining({
                status: 502,
                code: 'SALES_ORDER_CREATED_VERIFICATION_FAILED',
                message: expect.stringContaining('5000999')
            }));
        });
    });

    describe('READ: SalesOrders', () => {
        test('reads single sales order by key', async () => {
            const mockOrder = { SalesOrder: '5000455', SoldToParty: '10135', TotalNetAmount: '250.00' };
            salesInquiryAdapter.getSalesOrder.mockResolvedValue(mockOrder);

            const req = {
                query: {
                    SELECT: {
                        from: { ref: ['SalesOrders'] },
                        where: [{ ref: ['SalesOrder'] }, '=', { val: '5000455' }]
                    }
                },
                error: jest.fn()
            };

            const result = await handlers.READ_SalesOrders(req);
            expect(result).toEqual(mockOrder);
            expect(salesInquiryAdapter.getSalesOrder).toHaveBeenCalledWith('5000455');
        });

        test('returns 404 when single sales order is not found', async () => {
            salesInquiryAdapter.getSalesOrder.mockResolvedValue(null);

            const req = {
                query: {
                    SELECT: {
                        from: { ref: ['SalesOrders'] },
                        where: [{ ref: ['SalesOrder'] }, '=', { val: '9999999' }]
                    }
                },
                error: jest.fn()
            };

            await handlers.READ_SalesOrders(req);
            expect(req.error).toHaveBeenCalledWith(404, expect.stringContaining('Sales Order 9999999 not found'));
        });

        test('reads sales order list from worklist', async () => {
            const mockList = [
                { SalesOrder: '5000455', SoldToParty: '10135' },
                { SalesOrder: '5000456', SoldToParty: '10135' }
            ];
            salesInquiryAdapter.getSalesOrders.mockResolvedValue(mockList);

            const req = {
                query: { SELECT: { from: { ref: ['SalesOrders'] } } },
                error: jest.fn()
            };

            const result = await handlers.READ_SalesOrders(req);
            expect(result).toEqual(mockList);
            expect(salesInquiryAdapter.getSalesOrders).toHaveBeenCalledWith(req.query);
        });
    });

    describe('functions: Defaults & Metrics', () => {
        test('getCustomerDefaults delegates to adapter', async () => {
            const mockDefaults = { Customer: '10135', CustomerName: 'Divi', Currency: 'INR' };
            salesInquiryAdapter.getCustomerDefaults.mockResolvedValue(mockDefaults);

            const req = {
                data: { Customer: '10135', SalesOrganization: '1000', DistributionChannel: '10', Division: '52' }
            };

            const result = await handlers.getCustomerDefaults(req);
            expect(result).toEqual(mockDefaults);
            expect(salesInquiryAdapter.getCustomerDefaults).toHaveBeenCalledWith('10135', '1000', '10', '52');
        });

        test('getCustomerDefaults returns the adapter error with its status instead of a generic 500', async () => {
            const err = new Error('Customer master read failed');
            err.status = 503;
            salesInquiryAdapter.getCustomerDefaults.mockRejectedValue(err);

            const req = { data: { Customer: '10135' }, error: jest.fn() };
            await handlers.getCustomerDefaults(req);
            expect(req.error).toHaveBeenCalledWith(503, 'Customer master read failed');
        });

        test('getSalesOrderMetrics asks for order metrics: no entity option, unlike the inquiry service', async () => {
            salesInquiryAdapter.getSalesMetrics.mockResolvedValue({ openOrdersCount: 42, totalOrdersCount: 887 });

            await handlers.getSalesOrderMetrics();

            expect(salesInquiryAdapter.getSalesMetrics).toHaveBeenCalledWith();
        });

        test('getSalesOrderMetrics propagates error instead of returning silent zero counts', async () => {
            const mockError = new Error('SD_F1873_SO_WL_SRV unavailable');
            mockError.status = 502;
            salesInquiryAdapter.getSalesMetrics.mockRejectedValue(mockError);

            const mockReq = { error: jest.fn() };
            await handlers.getSalesOrderMetrics(mockReq);

            expect(mockReq.error).toHaveBeenCalledWith(502, 'SD_F1873_SO_WL_SRV unavailable');
        });

        test('getSalesOrderMetrics defaults to HTTP 502 when error status is not provided', async () => {
            const mockError = new Error('Network timeout connecting to S/4HANA');
            salesInquiryAdapter.getSalesMetrics.mockRejectedValue(mockError);

            const mockReq = { error: jest.fn() };
            await handlers.getSalesOrderMetrics(mockReq);

            expect(mockReq.error).toHaveBeenCalledWith(502, 'Network timeout connecting to S/4HANA');
        });

        test('getSalesOrderMetrics throws error when req is not provided on failure', async () => {
            const mockError = new Error('SD_F1873_SO_WL_SRV unavailable');
            mockError.status = 502;
            salesInquiryAdapter.getSalesMetrics.mockRejectedValue(mockError);

            await expect(handlers.getSalesOrderMetrics()).rejects.toThrow('SD_F1873_SO_WL_SRV unavailable');
        });
    });
});
