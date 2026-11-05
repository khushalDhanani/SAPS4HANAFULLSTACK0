'use strict';

/**
 * Integration: what happens to the incompletion fields once the screen sends them. Real CAP HTTP, handler, mappers and BAPI
 * input builder; only RFC is doubled. That SAP accepts CUST_GRP2 this way is NOT proven here: it needs a TESTRUN.
 */

const cds = require('@sap/cds');

const cdsTest = cds.test(__dirname + '/../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { axios } = cdsTest;
const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');

const body = (extra) => ({
    header: { SalesInquiryType: 'ZIN', SalesOrganization: '1000', DistributionChannel: '10', OrganizationDivision: '52', SoldToParty: '10135', TransactionCurrency: 'INR', ...extra },
    items: [{ SalesInquiryItem: '000010', Material: '4000000091', OrderQuantity: 10, OrderQuantityUnit: 'KG', Plant: '1120', NetPriceAmount: 250 }]
});

function stubRfc() {
    const calls = [];
    jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => (table === 'VBAK' ? [{ VBELN: '0001500200', AUART: 'ZIN' }] : []));
    jest.spyOn(RfcClient.prototype, 'session').mockImplementation((fn) => fn(async (fm, params) => {
        calls.push({ fm, params });
        return fm === 'BAPI_INQUIRY_CREATEFROMDATA2' ? { SALESDOCUMENT: '0001500200', RETURN: [] } : {};
    }));
    return calls;
}
const send = (extra) => axios.post('/odata/v4/sales-inquiry/createSalesInquiry', body(extra), { validateStatus: () => true });

describe('Integration: sales inquiry incompletion fields', () => {
    afterEach(() => jest.restoreAllMocks());

    it('tells the form what the BAPI route can carry, without reading SAP', async () => {
        const calls = stubRfc();

        const res = await axios.get('/odata/v4/sales-inquiry/getInquiryCreationCapabilities()', { validateStatus: () => true });

        expect(res.status).toBe(200);
        expect(res.data).toMatchObject({ service: 'BAPI_INQUIRY_CREATEFROMDATA2', Plant: true, CustomerGroup2: true, PortOfLoading: false, PortOfDischarge: false, ContactPerson: false });
        expect(calls).toEqual([]);
    });

    it('sends Customer Group 2 to the BAPI as CUST_GRP2', async () => {
        const calls = stubRfc();

        await send({ CustomerGroup2: 'SEA' });

        const bapi = calls.find((c) => c.fm === 'BAPI_INQUIRY_CREATEFROMDATA2');
        expect(bapi.params.INQUIRY_HEADER_IN.CUST_GRP2).toBe('SEA');
    });

    it.each([['PortOfLoading', 'INMAA'], ['PortOfDischarge', 'ESBCN'], ['ContactPerson', '25641']])('refuses %s with 400 and calls no BAPI, rather than dropping it', async (field, value) => {
        const calls = stubRfc();

        const res = await send({ [field]: value });

        expect(res.status).toBe(400);
        expect(res.data.error.message).toContain(`${field} cannot be sent to SAP`);
        expect(calls).toEqual([]);
    });
});
