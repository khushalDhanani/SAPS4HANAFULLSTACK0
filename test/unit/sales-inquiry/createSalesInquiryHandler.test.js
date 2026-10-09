jest.mock('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter', () => {
    const mockAdapter = {
        createSalesInquiry: jest.fn(),
        getSalesMetrics: jest.fn(),
        getInquiryMetrics: jest.fn((opts) => mockAdapter.getSalesMetrics({ ...opts, entity: 'inquiry' })),
        getCustomerDefaults: jest.fn(),
        getInquiryCreationCapabilities: jest.fn()
    };
    return mockAdapter;
});

const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const registerSalesInquiryHandlers = require('../../../srv/sd/sales-inquiry/handlers/salesInquiry.handler');

function getAllHandlers() {
    const handlers = {};
    registerSalesInquiryHandlers({ on: (event, ...args) => { handlers[event] = args[args.length - 1]; } });
    return handlers;
}

function handler() {
    return getAllHandlers().createSalesInquiry;
}

describe('Unit: createSalesInquiry handler', () => {
    beforeEach(() => {
        salesInquiryAdapter.createSalesInquiry.mockReset();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    const validPayload = {
        header: {
            SalesInquiryType: 'ZIN',
            SalesOrganization: '1000',
            DistributionChannel: '10',
            OrganizationDivision: '52',
            SoldToParty: '10135',
            TransactionCurrency: 'INR'
        },
        items: [
            {
                SalesInquiryItem: '000010',
                Material: '4000000091',
                OrderQuantity: 10,
                OrderQuantityUnit: 'KG',
                Plant: '1120',
                NetPriceAmount: 250.00
            }
        ]
    };

    test('successfully creates sales inquiry and returns document number', async () => {
        salesInquiryAdapter.createSalesInquiry.mockResolvedValue({
            SalesInquiry: '1000529',
            TotalNetAmount: '2500.00',
            TransactionCurrency: 'INR'
        });

        const req = {
            data: validPayload,
            user: { id: 'alice' },
            error: jest.fn()
        };

        const result = await handler()(req);
        expect(result).toBe('1000529');
        expect(req.error).not.toHaveBeenCalled();
        expect(salesInquiryAdapter.createSalesInquiry).toHaveBeenCalledTimes(1);
    });

    test('rejects with HTTP 502 when SAP returns no SalesInquiry document number', async () => {
        salesInquiryAdapter.createSalesInquiry.mockResolvedValue({
            SalesInquiry: '',
            SalesDocument: '',
            TotalNetAmount: '2500.00'
        });

        const req = {
            data: validPayload,
            user: { id: 'alice' },
            error: jest.fn()
        };

        await handler()(req);
        expect(req.error).toHaveBeenCalledWith(502, expect.stringContaining('no Sales Inquiry document number was returned by SAP'));
    });

    test('rejects invalid payload with HTTP 400', async () => {
        const req = {
            data: { header: null, items: [] },
            user: { id: 'alice' },
            error: jest.fn()
        };

        await handler()(req);
        expect(req.error).toHaveBeenCalledWith(400, expect.any(String));
        expect(salesInquiryAdapter.createSalesInquiry).not.toHaveBeenCalled();
    });

    test('handles total failure at header creation with HTTP 500', async () => {
        salesInquiryAdapter.createSalesInquiry.mockRejectedValue(new Error('Customer 10135 does not exist'));

        const req = {
            data: validPayload,
            user: { id: 'alice' },
            error: jest.fn()
        };

        await handler()(req);
        expect(req.error).toHaveBeenCalledWith(500, expect.stringContaining('Failed to create Sales Inquiry: Customer 10135 does not exist'));
    });

    test('propagates partial creation error with HTTP 502 and document number to prevent duplicate retries', async () => {
        const message = 'Sales Inquiry 1000529 was created in SAP S/4HANA, but adding item 000010 failed: Material blocked. Do not retry: check or complete inquiry 1000529 in SAP.';
        const partialErr = Object.assign(new Error(message), {
            name: 'PartialSalesInquiryError',
            SalesInquiry: '1000529',
            documentNumber: '1000529',
            isPartialCreation: true,
            status: 502
        });
        salesInquiryAdapter.createSalesInquiry.mockRejectedValue(partialErr);

        const req = {
            data: validPayload,
            user: { id: 'alice' },
            error: jest.fn()
        };

        await handler()(req);
        expect(req.error).toHaveBeenCalledWith(502, message);
        expect(req.error).toHaveBeenCalledWith(502, expect.stringContaining('1000529'));
        expect(req.error).toHaveBeenCalledWith(502, expect.stringContaining('Do not retry'));
    });

    describe('getCustomerDefaults', () => {
        test('delegates to adapter and returns defaults', async () => {
            salesInquiryAdapter.getCustomerDefaults.mockResolvedValue({ Customer: '10135', Currency: 'INR' });
            const req = { data: { Customer: '10135', SalesOrganization: '1000', DistributionChannel: '10', Division: '52' }, error: jest.fn() };
            const result = await getAllHandlers().getCustomerDefaults(req);
            expect(result).toEqual({ Customer: '10135', Currency: 'INR' });
            expect(req.error).not.toHaveBeenCalled();
        });

        test('propagates adapter failure via req.error (502) instead of throwing', async () => {
            const err = new Error('C_SoldToValueHelp unavailable'); err.status = 502;
            salesInquiryAdapter.getCustomerDefaults.mockRejectedValue(err);
            const req = { data: { Customer: '10135' }, error: jest.fn() };
            await getAllHandlers().getCustomerDefaults(req);
            expect(req.error).toHaveBeenCalledWith(502, 'C_SoldToValueHelp unavailable');
        });

        test('defaults to HTTP 502 when the adapter error has no status', async () => {
            salesInquiryAdapter.getCustomerDefaults.mockRejectedValue(new Error('RFC unavailable'));
            const req = { data: {}, error: jest.fn() };
            await getAllHandlers().getCustomerDefaults(req);
            expect(req.error).toHaveBeenCalledWith(502, 'RFC unavailable');
        });
    });

    describe('getInquiryCreationCapabilities', () => {
        test('delegates to adapter and returns capabilities', async () => {
            const caps = { ContactPerson: true, Plant: true, service: 'LORD_ODATA_ORDER_SRV' };
            salesInquiryAdapter.getInquiryCreationCapabilities.mockResolvedValue(caps);
            const req = { error: jest.fn() };
            const result = await getAllHandlers().getInquiryCreationCapabilities(req);
            expect(result).toEqual(caps);
            expect(req.error).not.toHaveBeenCalled();
        });

        test('propagates adapter failure via req.error (502) instead of throwing', async () => {
            salesInquiryAdapter.getInquiryCreationCapabilities.mockRejectedValue(new Error('metadata read failed'));
            const req = { error: jest.fn() };
            await getAllHandlers().getInquiryCreationCapabilities(req);
            expect(req.error).toHaveBeenCalledWith(502, 'metadata read failed');
        });
    });

    describe('getSalesInquiryMetrics', () => {
        test('delegates to adapter getInquiryMetrics', async () => {
            const mockMetrics = { openInquiriesCount: 15, totalInquiriesCount: 60, openOrdersCount: 15, totalOrdersCount: 60 };
            salesInquiryAdapter.getSalesMetrics.mockResolvedValue(mockMetrics);

            const allHandlers = getAllHandlers();
            const result = await allHandlers.getSalesInquiryMetrics();

            expect(result).toEqual(mockMetrics);
            expect(salesInquiryAdapter.getSalesMetrics).toHaveBeenCalledWith({ entity: 'inquiry' });
        });

        test('propagates error via req.error on failure', async () => {
            const mockError = new Error('SD_F2370_INQY_WL_SRV unavailable');
            mockError.status = 502;
            salesInquiryAdapter.getSalesMetrics.mockRejectedValue(mockError);

            const mockReq = { error: jest.fn() };
            const allHandlers = getAllHandlers();
            await allHandlers.getSalesInquiryMetrics(mockReq);

            expect(mockReq.error).toHaveBeenCalledWith(502, 'SD_F2370_INQY_WL_SRV unavailable');
        });
    });

    describe('getSalesOrderMetrics', () => {
        test('delegates to adapter with entity inquiry', async () => {
            const mockMetrics = { openOrdersCount: 15, totalOrdersCount: 60 };
            salesInquiryAdapter.getSalesMetrics.mockResolvedValue(mockMetrics);

            const allHandlers = getAllHandlers();
            const result = await allHandlers.getSalesOrderMetrics();

            expect(result).toEqual(mockMetrics);
            expect(salesInquiryAdapter.getSalesMetrics).toHaveBeenCalledWith({ entity: 'inquiry' });
        });

        test('propagates error via req.error on failure', async () => {
            const mockError = new Error('SD_F2370_INQY_WL_SRV unavailable');
            mockError.status = 502;
            salesInquiryAdapter.getSalesMetrics.mockRejectedValue(mockError);

            const mockReq = { error: jest.fn() };
            const allHandlers = getAllHandlers();
            await allHandlers.getSalesOrderMetrics(mockReq);

            expect(mockReq.error).toHaveBeenCalledWith(502, 'SD_F2370_INQY_WL_SRV unavailable');
        });

        test('defaults to HTTP 502 when error status is not provided', async () => {
            const mockError = new Error('Gateway connection refused');
            salesInquiryAdapter.getSalesMetrics.mockRejectedValue(mockError);

            const mockReq = { error: jest.fn() };
            const allHandlers = getAllHandlers();
            await allHandlers.getSalesOrderMetrics(mockReq);

            expect(mockReq.error).toHaveBeenCalledWith(502, 'Gateway connection refused');
        });

        test('throws error when req is not provided on failure', async () => {
            const mockError = new Error('SD_F2370_INQY_WL_SRV unavailable');
            mockError.status = 502;
            salesInquiryAdapter.getSalesMetrics.mockRejectedValue(mockError);

            const allHandlers = getAllHandlers();
            await expect(allHandlers.getSalesOrderMetrics()).rejects.toThrow('SD_F2370_INQY_WL_SRV unavailable');
        });
    });
});
