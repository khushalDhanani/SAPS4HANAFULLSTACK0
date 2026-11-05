'use strict';

/**
 * Integration: the flag reaches the OData response the detail screen reads. Real CAP HTTP, model, handler and adapter;
 * only the SAP services are doubled. Row values are hand-written.
 */

const cds = require('@sap/cds');

const cdsTest = cds.test(__dirname + '/../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { axios } = cdsTest;
const adapter = require('../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

const connectSap = (itemsRun) => {
    adapter.s4hanaWL = { run: async () => ({ SalesInquiry: '100001', SoldToParty: '10083' }) };
    adapter.s4hanaFS = {
        run: async (q) => (String(q.SELECT.from.ref[0]).includes('C_Inquiryitemfs') ? itemsRun() : { SalesInquiry: '100001', to_SDDocumentPartner: [] })
    };
};
const read = () => axios.get("/odata/v4/sales-inquiry/SalesInquiries('100001')?$expand=to_Items", { validateStatus: () => true });

describe('Integration: READ SalesInquiries by key, as the detail screen sends it', () => {
    const original = { wl: adapter.s4hanaWL, fs: adapter.s4hanaFS };
    afterEach(() => { adapter.s4hanaWL = original.wl; adapter.s4hanaFS = original.fs; });

    it('sends itemsUnavailable true, and no SAP detail, when the items read fails', async () => {
        connectSap(async () => { throw new Error('SECRET_PATH down'); });

        const res = await read();

        expect(res.status).toBe(200);
        expect(res.data.itemsUnavailable).toBe(true);
        expect(res.data.to_Items).toEqual([]);
        expect(JSON.stringify(res.data)).not.toContain('SECRET_PATH');
    });

    it('sends itemsUnavailable false for an inquiry that really has no items', async () => {
        connectSap(async () => []);

        const res = await read();

        expect(res.status).toBe(200);
        expect(res.data.itemsUnavailable).toBe(false);
    });

    it('declares the flag in the metadata, which the screen\'s V4 model needs', async () => {
        const res = await axios.get('/odata/v4/sales-inquiry/$metadata', { validateStatus: () => true });

        expect(res.data).toMatch(/<Property Name="itemsUnavailable" Type="Edm.Boolean"/);
    });
});
