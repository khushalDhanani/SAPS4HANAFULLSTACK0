jest.mock('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter', () => ({
    createSalesQuoteFromInquiry: jest.fn()
}));

const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const registerSalesInquiryHandlers = require('../../../srv/sd/sales-inquiry/handlers/salesInquiry.handler');

function handler() {
    const handlers = {};
    registerSalesInquiryHandlers({ on: (event, ...args) => { handlers[event] = args[args.length - 1]; } });
    return handlers.createSalesQuote;
}

describe('Unit: createSalesQuote handler', () => {
    beforeEach(() => {
        salesInquiryAdapter.createSalesQuoteFromInquiry.mockReset();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    test('is enabled and passes the dialog values to the adapter', async () => {
        salesInquiryAdapter.createSalesQuoteFromInquiry.mockResolvedValue({ SalesQuote: '2000500' });
        const req = { data: { SalesInquiry: '1000540', SalesQuotationType: 'ZQT', BindingPeriodValidityEndDate: '2026-10-14' }, user: { id: 'alice' }, error: jest.fn() };

        await expect(handler()(req)).resolves.toBe('2000500');
        expect(req.error).not.toHaveBeenCalled();
        expect(salesInquiryAdapter.createSalesQuoteFromInquiry).toHaveBeenCalledWith('1000540', expect.objectContaining({
            SalesQuotationType: 'ZQT', BindingPeriodValidityEndDate: '2026-10-14'
        }));
    });

    test('shows an SAP business rejection with SAP wording and HTTP 400', async () => {
        const message = 'Inquiry 1000540 is incomplete in SAP and cannot be converted to a Sales Quotation. Complete the inquiry in VA22 before creating the quotation.';
        salesInquiryAdapter.createSalesQuoteFromInquiry.mockRejectedValue(Object.assign(new Error(message), { status: 400, sapCode: 'SLS_LORD/166' }));
        const req = { data: { SalesInquiry: '1000540', SalesQuotationType: 'ZQT' }, user: { id: 'alice' }, error: jest.fn() };

        await handler()(req);
        expect(req.error).toHaveBeenCalledWith(400, message);
    });

    test('passes an unconfirmed SAP outcome ("verify in SAP, do not retry") to the UI unchanged', async () => {
        const message = "SAP lost the quotation session (HTTP 400 \"Session not found\") at step 'SaveChanges' for inquiry 1000536. Do not retry: check in SAP whether a quotation was created from inquiry 1000536 before trying again.";
        const err = Object.assign(new Error(message), { name: 'SapQuotationError', status: 502, sapCode: 'ICF_SESSION_NOT_FOUND' });
        salesInquiryAdapter.createSalesQuoteFromInquiry.mockRejectedValue(err);
        const req = { data: { SalesInquiry: '1000536', SalesQuotationType: 'ZQT' }, user: { id: 'alice' }, error: jest.fn() };

        await handler()(req);
        expect(req.error).toHaveBeenCalledWith(502, message);
        expect(salesInquiryAdapter.createSalesQuoteFromInquiry).toHaveBeenCalledTimes(1);
    });
});
