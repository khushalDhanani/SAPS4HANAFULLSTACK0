/**
 * READ SalesInquiries by key: real handler and real adapter, faked only at the SAP service boundary (`run`).
 * Entity names come from srv/external/SD_F2370_INQY_WL_SRV.edmx and SD_F2369_INQY_FS_SRV.edmx; the row values are hand-written.
 */
const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const registerSalesInquiryHandlers = require('../../../srv/sd/sales-inquiry/handlers/salesInquiry.handler');

function readHandler() {
    const handlers = {};
    registerSalesInquiryHandlers({
        on: (event, ...args) => { handlers[args.length > 1 ? `${event}:${args[0]}` : event] = args[args.length - 1]; }
    });
    return handlers['READ:SalesInquiries'];
}

const readRequest = (sInquiry) => ({
    query: { SELECT: { from: { ref: ['SalesInquiries'] }, where: [{ ref: ['SalesInquiry'] }, '=', { val: sInquiry }] } },
    error: jest.fn()
});

/** Worklist and factsheet headers answer; items answer or fail as the test asks. */
function connectSap(itemsRun) {
    salesInquiryAdapter.s4hanaWL = { run: async () => ({ SalesInquiry: '100001', SoldToParty: '10083' }) };
    salesInquiryAdapter.s4hanaFS = {
        run: async (q) => (String(q.SELECT.from.ref[0]).includes('C_Inquiryitemfs') ? itemsRun() : { SalesInquiry: '100001', to_SDDocumentPartnerCard: [] })
    };
}

describe('READ SalesInquiries by key', () => {
    test('returns the flat header with the factsheet items as to_Items', async () => {
        connectSap(async () => [{ SalesInquiry: '100001', SalesInquiryItem: '10', NetPriceAmount: 5 }]);

        const result = await readHandler()(readRequest('100001'));

        expect(result.SalesInquiry).toBe('100001');
        expect(result.SoldToParty).toBe('10083');
        expect(result.to_Items).toEqual([{ SalesInquiry: '100001', SalesInquiryItem: '10', NetPriceAmount: '5' }]);
    });

    // Known defect: srv/sd/sales-inquiry/handlers/salesInquiry.handler.js:23-25 copies only the header and items, dropping the
    // itemsUnavailable flag the adapter sets (SalesInquiryAdapter.js:830) and SalesInquiryDetail.view.xml:198 reads.
    test.failing('tells the caller the items are unavailable when the factsheet items read fails', async () => {
        connectSap(async () => { throw new Error('Item Service Timeout'); });

        const result = await readHandler()(readRequest('100001'));

        expect(result.itemsUnavailable).toBe(true);
    });
});
