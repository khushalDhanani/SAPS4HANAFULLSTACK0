'use strict';
/* global window */

/**
 * Tier C round trip: Purchase order create (#/mm/purchase-orders/create → POST
 * /odata/v4/purchase-order/createPurchaseOrder, `returns String` in srv/mm/purchase-order/service.cds).
 * Dry-run by default (stubbed action, write guard on); live mode only via liveWriteGate (flow key "po").
 * Live data file section "po": { header: { PurchaseOrderType, CompanyCode, PurchasingOrganization, PurchasingGroup,
 * Supplier, Currency, PaymentTerms?, IncotermsClassification?, IncotermsLocation1? },
 * item: { Plant, StorageLocation, Material, OrderQuantity, UnitOfMeasure, NetPriceAmount? } } (the optional ones are entered when present;
 * SAP requires net price, payment terms and Incoterms for ZDOM, the screen does not).
 */

const { runRoundTrip } = require('../support/roundTrip');
const { PO_TYPES } = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules');

const first = (rows, what) => {
    if (!rows || !rows.length) throw new Error(`no ${what} returned by the value help`);
    return rows[0];
};

/** Follows the dependencies the create screen validates: doc type rule → company code → purch. org → supplier → plant → material/SLoc. */
async function deriveData(read) {
    const docTypes = await read('purchase-order/DocumentTypeVH', { $filter: "startswith(PurchasingDocumentType,'Z')" });
    // Standard domestic type: other process types (asset, service, stock transfer, ...) need extra account-assignment input
    const docType = first(docTypes.filter((d) => PO_TYPES[d.PurchasingDocumentType] && PO_TYPES[d.PurchasingDocumentType].processType === 'Domestic'),
        'domestic document type with a validation rule').PurchasingDocumentType;
    const rule = PO_TYPES[docType];
    const coCodes = (await read('purchase-order/CompanyCodeVH')).map((c) => c.CompanyCode);
    const companyCode = [rule.defaultCompanyCode, ...rule.allowedCompanyCodes].find((c) => coCodes.includes(c));
    if (!companyCode) throw new Error(`no company code of ${rule.allowedCompanyCodes.join(', ')} in CompanyCodeVH`);
    const orgs = (await read('purchase-order/PurchasingOrgVH', { $filter: `CompanyCode eq '${companyCode}'` })).map((o) => o.PurchasingOrganization);
    const purchOrg = [rule.defaultPurchOrg, ...rule.allowedPurchOrgs].find((o) => orgs.includes(o));
    if (!purchOrg) throw new Error(`no purchasing organization of ${rule.allowedPurchOrgs.join(', ')} for company code ${companyCode}`);
    const purchGroup = first(await read('purchase-order/PurchasingGroupVH', { $filter: "startswith(PurchasingGroup,'1')", $top: 1 }), 'purchasing group').PurchasingGroup;
    const supplierFilter = `CompanyCode eq '${companyCode}'${rule.supplierAccountGroup ? ` and SupplierAccountGroup eq '${rule.supplierAccountGroup}'` : ''}`;
    const supplier = first(await read('purchase-order/SupplierVH', { $filter: supplierFilter, $top: 1 }), `supplier (${supplierFilter})`).Supplier;

    const plants = await read('purchase-order/PlantVH', { $filter: `PurchasingOrganization eq '${purchOrg}' and startswith(Plant,'${rule.allowedPlantPrefix || ''}')` });
    for (const { Plant } of plants) {
        const [material] = await read('purchase-order/MaterialVH', { $filter: `Plant eq '${Plant}'`, $top: 1 });
        const [sloc] = await read('purchase-order/StorageLocationVH', { $filter: `Plant eq '${Plant}'`, $top: 1 });
        if (material && sloc && material.MaterialBaseUnit) {
            return {
                header: { PurchaseOrderType: docType, CompanyCode: companyCode, PurchasingOrganization: purchOrg, PurchasingGroup: purchGroup, Supplier: supplier, Currency: rule.defaultCurrency },
                item: { Plant, StorageLocation: sloc.StorageLocation, Material: material.Material, OrderQuantity: '1', UnitOfMeasure: material.MaterialBaseUnit }
            };
        }
    }
    throw new Error(`no plant of purchasing organization ${purchOrg} has a material and a storage location`);
}

const SPEC = {
    flow: 'po',
    title: 'Purchase order create round trip',
    hash: 'mm/purchase-orders/create',
    route: 'createPurchaseOrder',
    service: '/odata/v4/purchase-order',
    action: 'createPurchaseOrder',
    submit: 'btnSave',
    modelName: 'newPO',
    deriveData,
    liveValues: (data) => ({ header: { ...data.header }, item: { ...data.item } }),
    async fill(ui, v) {
        const h = v.header;
        await ui.enter('inDocType', h.PurchaseOrderType);
        await ui.enter('inCompanyCode', h.CompanyCode);
        await ui.enter('inPurchOrg', h.PurchasingOrganization);
        await ui.enter('inPurchGrp', h.PurchasingGroup);
        await ui.enter('inSupplier', h.Supplier);
        await ui.enter('inCurrency', h.Currency);
        if (h.PaymentTerms) await ui.enter('inPaymentTerms', h.PaymentTerms);
        if (h.IncotermsClassification) await ui.enter('inIncoterms', h.IncotermsClassification);
        if (h.IncotermsLocation1) await ui.enter('inIncotermsLoc', h.IncotermsLocation1);
        const i = v.item;
        await ui.enterItem('poItemsTable', 0, 'Plant', i.Plant);
        await ui.enterItem('poItemsTable', 0, 'StorageLocation', i.StorageLocation);
        await ui.enterItem('poItemsTable', 0, 'Material', i.Material);
        await ui.enterItem('poItemsTable', 0, 'OrderQuantity', i.OrderQuantity);
        await ui.enterItem('poItemsTable', 0, 'UnitOfMeasure', i.UnitOfMeasure);
        if (i.NetPriceAmount) await ui.enterItem('poItemsTable', 0, 'NetPriceAmount', i.NetPriceAmount);
    },
    expectedPayload: (v) => ({ header: v.header, item: v.item }),
    // Controller: MessageToast with the PO number, then navigates back to the list
    async afterSuccess(ui) {
        await ui.page.waitForFunction(() => window.location.hash.replace(/^#\/?/, '') === 'mm/purchase-orders', null, { timeout: 10000 })
            .catch(() => {});
        const hash = await ui.page.evaluate(() => window.location.hash);
        return /^#\/?mm\/purchase-orders$/.test(hash) ? [] : [`expected navigation back to #/mm/purchase-orders, got ${hash}`];
    },
    async readBack(read, docNo) {
        const po = await read(`purchase-order/PurchaseOrders('${encodeURIComponent(docNo)}')`, { $select: 'PurchaseOrder,Supplier,CompanyCode,PurchaseOrderType' });
        return po && po.PurchaseOrder === docNo ? [] : [`PurchaseOrders('${docNo}') read back ${JSON.stringify(po)}`];
    }
};

function roundTripPurchaseOrder(options = {}) {
    return runRoundTrip(SPEC, options);
}

if (require.main === module) {
    roundTripPurchaseOrder().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { roundTripPurchaseOrder, SPEC };
