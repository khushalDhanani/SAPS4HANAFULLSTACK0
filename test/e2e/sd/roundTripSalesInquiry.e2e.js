'use strict';

/**
 * Tier C round trip: Sales inquiry create (#/sd/sales-inquiries/create → POST
 * /odata/v4/sales-inquiry/createSalesInquiry, `returns String` in srv/sd/sales-inquiry/service.cds).
 * Dry-run by default (stubbed action, write guard on); live mode only via liveWriteGate (flow key "salesInquiry").
 * Live data file section "salesInquiry": { header: { SalesInquiryType, SalesOrganization, DistributionChannel,
 * OrganizationDivision, SoldToParty, TransactionCurrency }, item: { Material, OrderQuantity, OrderQuantityUnit, Plant } }.
 */

const { runRoundTrip } = require('../support/roundTrip');
const { inspectScreen } = require('../support/screenCheck');

const SVC = 'sales-inquiry';

/** Header from the screen's own defaults function; sold-to must be maintained for that sales area (UI blocks it otherwise). */
async function deriveData(read) {
    const caps = await read(`${SVC}/getInquiryCreationCapabilities()`);
    const extra = ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson'].filter((f) => caps[f]);
    if (extra.length) throw new Error(`SAP now requires ${extra.join(', ')} on the inquiry; extend this suite to derive them`);
    const d = await read(`${SVC}/getSalesInquiryDefaults()`);
    const area = { SalesOrganization: d.SalesOrganization, DistributionChannel: d.DistributionChannel, Division: d.OrganizationDivision };

    let soldTo = null;
    for (const { Customer } of await read(`${SVC}/SoldToPartyVH`, { $top: 25 })) {
        const c = await read(`${SVC}/getCustomerDefaults(Customer='${Customer}',SalesOrganization='${area.SalesOrganization}',DistributionChannel='${area.DistributionChannel}',Division='${area.Division}')`);
        if (c && c.validForSalesArea !== false) { soldTo = Customer; break; }
    }
    if (!soldTo) throw new Error(`none of the first 25 sold-to parties is maintained for sales area ${Object.values(area).join('/')}`);

    // Plant: one the material is extended to (material-plant value help), offered by the screen's PlantVH
    for (const m of await read(`${SVC}/MaterialVH`, { $top: 10 })) {
        if (!m.MaterialBaseUnit) continue;
        const ext = await read('purchase-order/MaterialVH', { $filter: `Material eq '${m.Material}'`, $top: 5 });
        for (const { Plant } of ext) {
            if ((await read(`${SVC}/PlantVH`, { $filter: `Plant eq '${Plant}'`, $top: 1 })).length) {
                return {
                    header: {
                        SalesInquiryType: d.SalesInquiryType, SalesOrganization: d.SalesOrganization, DistributionChannel: d.DistributionChannel,
                        OrganizationDivision: d.OrganizationDivision, SoldToParty: soldTo, TransactionCurrency: d.TransactionCurrency
                    },
                    item: { Material: m.Material, OrderQuantity: '1', OrderQuantityUnit: m.MaterialBaseUnit, Plant }
                };
            }
        }
    }
    throw new Error('none of the first 10 materials is extended to a plant offered by PlantVH');
}

const SPEC = {
    flow: 'salesInquiry',
    title: 'Sales inquiry create round trip',
    hash: 'sd/sales-inquiries/create',
    route: 'createSalesInquiry',
    service: '/odata/v4/sales-inquiry',
    action: 'createSalesInquiry',
    submit: 'btnSaveInquiry',
    modelName: 'newInquiry',
    deriveData,
    liveValues: (data) => ({ header: { ...data.header }, item: { ...data.item } }),
    async fill(ui, v) {
        const h = v.header;
        await ui.enter('inInquiryType', h.SalesInquiryType);
        await ui.enter('inSalesOrg', h.SalesOrganization);
        await ui.enter('inDistChannel', h.DistributionChannel);
        await ui.enter('inDivision', h.OrganizationDivision);
        await ui.enter('inSoldToParty', h.SoldToParty);
        await ui.enter('inCurrency', h.TransactionCurrency);
        const i = v.item;
        await ui.enterItem('inquiryItemsTable', 0, 'Material', i.Material);
        await ui.enterItem('inquiryItemsTable', 0, 'OrderQuantity', i.OrderQuantity);
        await ui.enterItem('inquiryItemsTable', 0, 'OrderQuantityUnit', i.OrderQuantityUnit);
        await ui.enterItem('inquiryItemsTable', 0, 'Plant', i.Plant);
    },
    expectedPayload: (v) => ({ header: v.header, item: v.item }),
    // Controller: MessageBox.success "Sales Inquiry <n> ..." with Display Inquiry / Create Another / Close; Close → list
    async afterSuccess(ui) {
        await ui.messageBoxButton('Close');
        const screen = await inspectScreen(ui.page);
        return screen.route === 'salesInquiries' ? [] : [`after Close expected route salesInquiries, got ${screen.route} (hash "${screen.hash}")`];
    },
    async readBack(read, docNo) {
        const doc = await read(`${SVC}/SalesInquiries('${encodeURIComponent(docNo)}')`, { $select: 'SalesInquiry,SoldToParty,SalesInquiryType' });
        return doc && doc.SalesInquiry === docNo ? [] : [`SalesInquiries('${docNo}') read back ${JSON.stringify(doc)}`];
    }
};

function roundTripSalesInquiry(options = {}) {
    return runRoundTrip(SPEC, options);
}

if (require.main === module) {
    roundTripSalesInquiry().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { roundTripSalesInquiry, SPEC };
