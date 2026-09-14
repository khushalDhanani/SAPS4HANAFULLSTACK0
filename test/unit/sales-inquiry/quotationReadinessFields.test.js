/**
 * Quotation-readiness fields on Sales Inquiry creation.
 *
 * SAP (incompletion procedure Z1, partner ZP, item procedure Z2) refuses to reference an inquiry
 * from a quotation until Customer Group 2, Port of Loading, Port of Discharge, a Contact Person and
 * the item Plant are filled. The standard LORD_ODATA_ORDER_SRV can carry only Plant; the other four
 * are sent exactly when the live $metadata exposes them (SAP-side extension), never invented.
 */
const { validateCreateSalesInquiryPayload } = require('../../../srv/sd/sales-inquiry/validation/salesInquiry.validation');
const { normalizeSalesInquiryData } = require('../../../srv/sd/sales-inquiry/mapping/salesInquiry.mapper');
const { mapToS4InquiryPayload } = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');
const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

const BASE_HEADER = { SalesInquiryType: 'ZIN', SalesOrganization: '1000', DistributionChannel: '10', OrganizationDivision: '52', SoldToParty: '10003' };
const BASE_ITEM = { Material: '4000000033', OrderQuantity: 100, OrderQuantityUnit: 'KG' };

/** Minimal LORD_ODATA_ORDER_SRV $metadata; `extended` adds the agreed extension properties. */
function leanOrderMetadata(extended) {
    const ext = extended
        ? '<Property Name="CustomerGroup2" Type="Edm.String" MaxLength="3"/><Property Name="PortOfLoading" Type="Edm.String" MaxLength="50"/>'
          + '<Property Name="PortOfDischarge" Type="Edm.String" MaxLength="50"/><Property Name="ContactPerson" Type="Edm.String" MaxLength="10"/>'
        : '';
    return '<edmx:Edmx><Schema>'
        + '<EntityType Name="HeaderPartner" sap:content-version="1"><Property Name="SalesOrderID" Type="Edm.String"/><Property Name="CustomerID" Type="Edm.String"/></EntityType>'
        + `<EntityType Name="Header" sap:content-version="1"><Property Name="SalesOrderID" Type="Edm.String"/><Property Name="SoldToPartyID" Type="Edm.String"/>${ext}</EntityType>`
        + '<EntityType Name="Item" sap:content-version="1"><Property Name="SalesOrderID" Type="Edm.String"/><Property Name="ItemID" Type="Edm.String"/><Property Name="Plant" Type="Edm.String" MaxLength="4"/></EntityType>'
        + '</Schema></edmx:Edmx>';
}

/** Scripted Lean Order service keyed by URL; records every call. */
function fakeLeanOrder({ extended = false, metadataFails = false } = {}) {
    const calls = [];
    const execute = jest.fn(async (destination, request) => {
        calls.push(request);
        if (request.url.endsWith('/$metadata')) {
            if (metadataFails) throw new Error('metadata unavailable');
            return { status: 200, headers: {}, data: leanOrderMetadata(extended) };
        }
        if (request.url.endsWith('/HeaderSet')) return { status: 201, data: { d: { SalesOrderID: '1000600', NetValue: '0.00', Currency: 'INR' } } };
        if (request.url.endsWith('/ItemSet')) return { status: 201, data: { d: { SalesOrderID: '1000600', ItemID: request.data.ItemID } } };
        if (request.url.endsWith('/PriceCondSet')) return { status: 201, data: { d: {} } };
        throw new Error(`unexpected ${request.method} ${request.url}`);
    });
    return { execute, calls };
}

describe('Unit: quotation-readiness fields - validation and mapping', () => {
    test('validation accepts the fields within SAP lengths and rejects oversize or non-numeric values', () => {
        const ok = validateCreateSalesInquiryPayload({
            header: { ...BASE_HEADER, CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'BARCELONA', ContactPerson: '24789' },
            items: [{ ...BASE_ITEM, Plant: '1120' }]
        });
        expect(ok.isValid).toBe(true);

        const bad = validateCreateSalesInquiryPayload({
            header: { ...BASE_HEADER, CustomerGroup2: 'SEAX', PortOfLoading: 'x'.repeat(51), ContactPerson: 'KUMAR' },
            items: [{ ...BASE_ITEM, Plant: '11200' }]
        });
        expect(bad.isValid).toBe(false);
        expect(bad.errors.map(e => e.field).sort()).toEqual(['ContactPerson', 'CustomerGroup2', 'Plant', 'PortOfLoading']);
    });

    test('normalisation passes the fields through (codes upper-cased) and never defaults them', () => {
        const { header, items } = normalizeSalesInquiryData({
            header: { ...BASE_HEADER, CustomerGroup2: 'sea ', PortOfLoading: ' Nhava Sheva ', PortOfDischarge: 'Barcelona', ContactPerson: ' 24789' },
            items: [{ ...BASE_ITEM, Plant: '1120' }, BASE_ITEM]
        });
        expect(header).toMatchObject({ CustomerGroup2: 'SEA', PortOfLoading: 'Nhava Sheva', PortOfDischarge: 'Barcelona', ContactPerson: '24789' });
        expect(items[0].Plant).toBe('1120');
        expect(items[1].Plant).toBe('');

        const empty = normalizeSalesInquiryData({ header: BASE_HEADER, items: [BASE_ITEM] }).header;
        expect(empty).toMatchObject({ CustomerGroup2: '', PortOfLoading: '', PortOfDischarge: '', ContactPerson: '' });
    });

    test('S/4 payload mapping carries the fields only when present', () => {
        const withValues = mapToS4InquiryPayload(
            { ...BASE_HEADER, CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'OSAKA', ContactPerson: '24789' },
            [{ ...BASE_ITEM, Plant: '1600' }]
        );
        expect(withValues.header).toMatchObject({ CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'OSAKA', ContactPerson: '24789' });
        expect(withValues.items[0].Plant).toBe('1600');

        const without = mapToS4InquiryPayload(BASE_HEADER, [BASE_ITEM]);
        ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson'].forEach(f => expect(without.header).not.toHaveProperty(f));
        expect(without.items[0]).not.toHaveProperty('Plant');
    });
});

describe('Unit: quotation-readiness fields - SAP inquiry creation (LORD_ODATA_ORDER_SRV)', () => {
    const destination = { url: 'http://s4' };

    beforeEach(() => {
        salesInquiryAdapter._leanOrderFields = null;
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(salesInquiryAdapter, 'resolveMaterial').mockImplementation(async m => m);
    });
    afterEach(() => jest.restoreAllMocks());

    test('Plant is sent on the item; without extension values no $metadata is read (unchanged call sequence)', async () => {
        const { execute, calls } = fakeLeanOrder();

        const res = await salesInquiryAdapter.createSalesInquiry(BASE_HEADER, [{ ...BASE_ITEM, Plant: '1120' }], { destination, executeHttpRequest: execute });

        expect(res.SalesInquiry).toBe('1000600');
        expect(res.notTransmitted).toEqual([]);
        expect(calls.map(c => c.url.split('/').pop())).toEqual(['HeaderSet', 'ItemSet']);
        expect(calls[1].data.Plant).toBe('1120');
    });

    test('extension values are NOT sent while the service lacks the fields; the gap is reported, creation still succeeds', async () => {
        const { execute, calls } = fakeLeanOrder({ extended: false });
        const header = { ...BASE_HEADER, CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'OSAKA', ContactPerson: '24789' };

        const res = await salesInquiryAdapter.createSalesInquiry(header, [BASE_ITEM], { destination, executeHttpRequest: execute });

        expect(res.SalesInquiry).toBe('1000600');
        expect(res.notTransmitted).toEqual(['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson']);
        const headerPost = calls.find(c => c.url.endsWith('/HeaderSet'));
        ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson'].forEach(f => expect(headerPost.data).not.toHaveProperty(f));
        expect(calls.filter(c => c.url.endsWith('/$metadata'))).toHaveLength(1);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('has no field for CustomerGroup2, PortOfLoading, PortOfDischarge, ContactPerson'));
    });

    test('once the service is extended the values are sent unchanged in the header POST', async () => {
        const { execute, calls } = fakeLeanOrder({ extended: true });
        const header = { ...BASE_HEADER, CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'OSAKA', ContactPerson: '24789' };

        const res = await salesInquiryAdapter.createSalesInquiry(header, [BASE_ITEM], { destination, executeHttpRequest: execute });

        expect(res.notTransmitted).toEqual([]);
        const headerPost = calls.find(c => c.url.endsWith('/HeaderSet'));
        expect(headerPost.data).toMatchObject({ CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'OSAKA', ContactPerson: '24789' });
    });

    test('$metadata is read once per process and reused', async () => {
        const { execute, calls } = fakeLeanOrder({ extended: true });
        const header = { ...BASE_HEADER, CustomerGroup2: 'SEA' };
        await salesInquiryAdapter.createSalesInquiry(header, [BASE_ITEM], { destination, executeHttpRequest: execute });
        await salesInquiryAdapter.createSalesInquiry(header, [BASE_ITEM], { destination, executeHttpRequest: execute });
        expect(calls.filter(c => c.url.endsWith('/$metadata'))).toHaveLength(1);
    });

    test('an unreadable $metadata never blocks inquiry creation; values are reported as not transmitted', async () => {
        const { execute } = fakeLeanOrder({ metadataFails: true });
        const res = await salesInquiryAdapter.createSalesInquiry({ ...BASE_HEADER, CustomerGroup2: 'SEA' }, [BASE_ITEM], { destination, executeHttpRequest: execute });
        expect(res.SalesInquiry).toBe('1000600');
        expect(res.notTransmitted).toEqual(['CustomerGroup2']);
    });

    test('getInquiryCreationCapabilities reflects the live service: standard = Plant only, extended = all', async () => {
        const standard = fakeLeanOrder({ extended: false });
        await expect(salesInquiryAdapter.getInquiryCreationCapabilities({ destination, executeHttpRequest: standard.execute })).resolves.toEqual({
            service: 'LORD_ODATA_ORDER_SRV', CustomerGroup2: false, PortOfLoading: false, PortOfDischarge: false, ContactPerson: false, Plant: true
        });

        salesInquiryAdapter._leanOrderFields = null;
        const extended = fakeLeanOrder({ extended: true });
        await expect(salesInquiryAdapter.getInquiryCreationCapabilities({ destination, executeHttpRequest: extended.execute })).resolves.toEqual({
            service: 'LORD_ODATA_ORDER_SRV', CustomerGroup2: true, PortOfLoading: true, PortOfDischarge: true, ContactPerson: true, Plant: true
        });
    });
});

describe('Unit: quotation-readiness fields - Create Inquiry screen model', () => {
    let SalesInquiryModel;

    function MockJSONModel(data) {
        this._data = JSON.parse(JSON.stringify(data || {}));
        const walk = (path, create) => {
            const parts = path.replace(/^\//, '').split('/');
            let cur = this._data;
            for (let i = 0; i < parts.length - 1; i++) {
                if (cur[parts[i]] == null) { if (!create) return [null, null]; cur[parts[i]] = {}; }
                cur = cur[parts[i]];
            }
            return [cur, parts[parts.length - 1]];
        };
        this.getData = () => this._data;
        this.getProperty = (path) => { const [o, k] = walk(path, false); return o ? o[k] : undefined; };
        this.setProperty = (path, v) => { const [o, k] = walk(path, true); o[k] = v; };
    }

    beforeAll(() => {
        global.sap = { ui: { define: (deps, factory) => { SalesInquiryModel = factory(MockJSONModel); } } };
        jest.isolateModules(() => require('../../../app/fiori-app/webapp/modules/sd/sales-inquiry/model/SalesInquiryModel'));
    });

    const filledModel = () => {
        const m = SalesInquiryModel.createInitialModel('alice');
        Object.assign(m.getProperty('/header'), { SoldToParty: '10003', CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'OSAKA', ContactPerson: '24789' });
        Object.assign(m.getProperty('/items')[0], { Material: '4000000033', OrderQuantity: 100, OrderQuantityUnit: 'KG', Plant: '1120' });
        return m;
    };

    test('new documents start with the fields empty and no capability assumed', () => {
        const m = SalesInquiryModel.createInitialModel('alice');
        expect(m.getProperty('/header')).toMatchObject({ CustomerGroup2: '', PortOfLoading: '', PortOfDischarge: '', ContactPerson: '' });
        expect(m.getProperty('/items')[0].Plant).toBe('');
        expect(m.getProperty('/capabilities')).toEqual({ CustomerGroup2: false, PortOfLoading: false, PortOfDischarge: false, ContactPerson: false, Plant: false });
    });

    test('applyCapabilities: unsupported fields produce the VA22 notice; fully supported produces none', () => {
        const m = SalesInquiryModel.createInitialModel('alice');
        SalesInquiryModel.applyCapabilities(m, { Plant: true });
        expect(m.getProperty('/showReadinessNotice')).toBe(true);
        expect(m.getProperty('/readinessNotice')).toContain('does not yet accept: Customer Group 2, Port of Loading, Port of Discharge, Contact Person.');
        expect(m.getProperty('/readinessNotice')).toContain('VA22');

        SalesInquiryModel.applyCapabilities(m, { CustomerGroup2: true, PortOfLoading: true, PortOfDischarge: true, ContactPerson: true, Plant: true });
        expect(m.getProperty('/showReadinessNotice')).toBe(false);
    });

    test('validateForm requires a field only when the SAP service can accept it', () => {
        const m = SalesInquiryModel.createInitialModel('alice');
        m.setProperty('/header/SoldToParty', '10003');
        Object.assign(m.getProperty('/items')[0], { Material: '4000000033', OrderQuantity: 1, OrderQuantityUnit: 'KG' });

        SalesInquiryModel.applyCapabilities(m, { Plant: false });
        expect(SalesInquiryModel.validateForm(m)).toBe(true);

        SalesInquiryModel.applyCapabilities(m, { CustomerGroup2: true, ContactPerson: true, Plant: true });
        expect(SalesInquiryModel.validateForm(m)).toBe(false);
        expect(m.getProperty('/errorList').map(e => e.field).sort()).toEqual(['ContactPerson', 'CustomerGroup2', 'Plant']);
        expect(m.getProperty('/items')[0].errors.Plant.text).toBe('Plant is required by SAP for a quotation');
    });

    test('getQuotationReadinessGaps mirrors the SAP incompletion log regardless of capability', () => {
        const m = SalesInquiryModel.createInitialModel('alice');
        SalesInquiryModel.applyCapabilities(m, { Plant: true });
        const gaps = SalesInquiryModel.getQuotationReadinessGaps(m);
        expect(gaps.map(g => g.title)).toEqual(['Customer Group 2 is missing', 'Port of Loading is missing', 'Port of Discharge is missing', 'Contact Person is missing', 'Plant is missing']);
        expect(gaps[0].subtitle).toContain('maintain in VA22');
        expect(gaps[4].subtitle).toBe('Item 1: Required by SAP for a quotation');
        expect(m.getProperty('/readinessGaps')).toHaveLength(5);

        expect(SalesInquiryModel.getQuotationReadinessGaps(filledModel())).toEqual([]);
    });

    test('buildPayload includes the fields when filled and omits them when empty', () => {
        const withValues = SalesInquiryModel.buildPayload(filledModel());
        expect(withValues.header).toMatchObject({ CustomerGroup2: 'SEA', PortOfLoading: 'NHAVA SHEVA', PortOfDischarge: 'OSAKA', ContactPerson: '24789' });
        expect(withValues.items[0].Plant).toBe('1120');

        const empty = SalesInquiryModel.buildPayload(SalesInquiryModel.createInitialModel('alice'));
        ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson'].forEach(f => expect(empty.header).not.toHaveProperty(f));
        expect(empty.items[0]).not.toHaveProperty('Plant');
    });
});
