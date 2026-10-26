'use strict';

/**
 * Tier C round trip: Sales order create (#/sd/sales-orders/create → POST
 * /odata/v4/sales-order/createSalesOrder, `returns String` in srv/sd/sales-order/service.cds).
 * Dry-run by default (stubbed action, write guard on); live mode only via liveWriteGate (flow key "salesOrder").
 * Live data file section "salesOrder": { header: { SalesOrderType, SalesOrganization, DistributionChannel,
 * OrganizationDivision, SoldToParty, TransactionCurrency, PaymentTerms, ContactPerson },
 * item: { Material, OrderQuantity, OrderQuantityUnit, Plant } }.
 */

const { runRoundTrip } = require('../support/roundTrip');
const { inspectScreen } = require('../support/screenCheck');

const SVC = 'sales-order';

/** Header from the screen's defaults function; sold-to = a customer with a contact person, maintained for the sales area. */
async function deriveData(read) {
    const d = await read(`${SVC}/getSalesOrderDefaults()`);
    let party = null;
    const tried = new Set();
    for (const cp of await read(`${SVC}/ContactPersonVH`, { $top: 50 })) {
        if (!cp.Customer || tried.has(cp.Customer) || tried.size >= 15) continue;
        tried.add(cp.Customer);
        const c = await read(`${SVC}/getCustomerDefaults(Customer='${cp.Customer}',SalesOrganization='${d.SalesOrganization}',DistributionChannel='${d.DistributionChannel}',Division='${d.OrganizationDivision}')`);
        if (c && c.validForSalesArea !== false) { party = { customer: cp.Customer, contact: cp.ContactPerson, paymentTerms: c.PaymentTerms }; break; }
    }
    if (!party) throw new Error(`none of ${tried.size} customers with a contact person is maintained for sales area ${d.SalesOrganization}/${d.DistributionChannel}/${d.OrganizationDivision}`);
    const paymentTerms = party.paymentTerms || (await read(`${SVC}/PaymentTermsVH`, { $top: 1 }))[0].PaymentTerms;

    // Sellable material from the screen's MaterialVH, at a plant it is extended to (material-plant value help);
    // the screen's default plant is preferred when the material is extended there
    for (const vh of await read(`${SVC}/MaterialVH`, { $top: 20 })) {
        if (!vh.MaterialBaseUnit) continue;
        const plants = (await read('purchase-order/MaterialVH', { $filter: `Material eq '${vh.Material}'`, $top: 20 })).map((r) => r.Plant);
        const plant = plants.includes(d.Plant) ? d.Plant : plants[0];
        if (plant) {
            return {
                header: {
                    SalesOrderType: d.SalesOrderType, SalesOrganization: d.SalesOrganization, DistributionChannel: d.DistributionChannel,
                    OrganizationDivision: d.OrganizationDivision, SoldToParty: party.customer, TransactionCurrency: d.TransactionCurrency,
                    PaymentTerms: paymentTerms, ContactPerson: party.contact
                },
                item: { Material: vh.Material, OrderQuantity: '1', OrderQuantityUnit: vh.MaterialBaseUnit, Plant: plant }
            };
        }
    }
    throw new Error(`none of the first 20 ${SVC}/MaterialVH materials is extended to a plant`);
}

const SPEC = {
    flow: 'salesOrder',
    title: 'Sales order create round trip',
    hash: 'sd/sales-orders/create',
    route: 'createSalesOrder',
    service: '/odata/v4/sales-order',
    action: 'createSalesOrder',
    submit: 'btnSaveOrder',
    modelName: 'newOrder',
    deriveData,
    liveValues: (data) => ({ header: { ...data.header }, item: { ...data.item } }),
    async fill(ui, v) {
        const h = v.header;
        await ui.enter('inOrderType', h.SalesOrderType);
        await ui.enter('inSalesOrg', h.SalesOrganization);
        await ui.enter('inDistChannel', h.DistributionChannel);
        await ui.enter('inDivision', h.OrganizationDivision);
        await ui.enter('inSoldToParty', h.SoldToParty);
        await ui.enter('inCurrency', h.TransactionCurrency);
        await ui.enter('inPaymentTerms', h.PaymentTerms);
        await ui.enter('inContactPerson', h.ContactPerson);
        const i = v.item;
        await ui.enterItem('orderItemsTable', 0, 'Material', i.Material);
        await ui.enterItem('orderItemsTable', 0, 'OrderQuantity', i.OrderQuantity);
        await ui.enterItem('orderItemsTable', 0, 'OrderQuantityUnit', i.OrderQuantityUnit);
        await ui.enterItem('orderItemsTable', 0, 'Plant', i.Plant);
    },
    expectedPayload: (v) => ({ header: v.header, item: v.item }),
    // Controller: MessageBox.success "Sales Order <n> ..." with Create Another / Worklist / Close; Close → list
    async afterSuccess(ui) {
        await ui.messageBoxButton('Close');
        const screen = await inspectScreen(ui.page);
        return screen.route === 'salesOrders' ? [] : [`after Close expected route salesOrders, got ${screen.route} (hash "${screen.hash}")`];
    },
    async readBack(read, docNo) {
        const doc = await read(`${SVC}/SalesOrders('${encodeURIComponent(docNo)}')`, { $select: 'SalesOrder,SoldToParty,SalesOrderType' });
        return doc && doc.SalesOrder === docNo ? [] : [`SalesOrders('${docNo}') read back ${JSON.stringify(doc)}`];
    }
};

function roundTripSalesOrder(options = {}) {
    return runRoundTrip(SPEC, options);
}

if (require.main === module) {
    roundTripSalesOrder().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { roundTripSalesOrder, SPEC };
