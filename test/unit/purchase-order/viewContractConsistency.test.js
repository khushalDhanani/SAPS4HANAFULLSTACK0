'use strict';

/**
 * Keeps controller/model constants in sync with the PO XML views:
 * - item error cellIndex values must point at the cell bound to that field (CreatePurchaseOrder.view.xml);
 * - each Status filter option must be labelled exactly as the Status column displays it (PurchaseOrders.view.xml).
 */

const fs = require('fs');
const path = require('path');

const WEBAPP = path.join(__dirname, '../../../app/fiori-app/webapp');
const PO = path.join(WEBAPP, 'modules/mm/purchase-order');
const read = (p) => fs.readFileSync(p, 'utf8');

/** Field bound by each top-level cell of the items table, in cell order. */
function itemCellFields() {
    const xml = read(path.join(PO, 'view/CreatePurchaseOrder.view.xml'));
    const cells = xml.slice(xml.indexOf('<ColumnListItem'));
    const block = cells.slice(cells.indexOf('<cells>') + 7, cells.indexOf('</cells>'));
    const fields = [];
    let depth = 0;
    for (const [tag] of block.matchAll(/<\/?[A-Za-z:]+(?:"[^"]*"|[^>"])*?>/g)) {
        if (tag.startsWith('</')) { depth--; continue; }
        if (depth === 0) {
            const m = tag.match(/(?:value|text)="\{newPO>(\w+)/);
            fields.push(m ? m[1] : null);
        }
        if (!tag.endsWith('/>')) depth++;
    }
    return fields;
}

describe('PO view contract consistency', () => {
    const fields = itemCellFields();
    const cellOf = (field) => fields.indexOf(field);

    it('parses the item cells from the view', () => {
        expect(fields.slice(0, 6)).toEqual(['PurchaseOrderItem', 'PurchaseOrderItemCategory', 'AccountAssignmentCategory', 'Plant', 'StorageLocation', 'Material']);
    });

    it('every PurchaseOrderModel.ITEM_FIELD_CONFIG cellIndex points at the cell bound to that field', () => {
        const prevSap = global.sap;
        let Model;
        global.sap = { ui: { define: (deps, factory) => { Model = factory(function () {}); } } };
        try {
            jest.isolateModules(() => require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel'));
        } finally {
            global.sap = prevSap;
        }
        const entries = Object.entries(Model.ITEM_FIELD_CONFIG);
        expect(entries.map(([field]) => field).sort()).toEqual(['Material', 'NetPriceAmount', 'OrderQuantity', 'Plant', 'PurchaseOrderItemText', 'StorageLocation', 'TaxCode', 'UnitOfMeasure']);
        entries.forEach(([field, conf]) => expect([field, conf.cellIndex]).toEqual([field, cellOf(field)]));
    });

    it.each(['Plant', 'StorageLocation', 'Material', 'OrderQuantity', 'UnitOfMeasure', 'NetPriceAmount', 'TaxCode'])('a backend error targeting items[0].%s focuses the cell bound to that field', (field) => {
        const Validator = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator');
        const res = Validator.applyBackendErrors({ errors: {}, items: [{ errors: {} }] }, { details: [{ message: 'x', target: `items[0].${field}` }] });
        expect(res.errorList[0].cellIndex).toBe(cellOf(field));
    });

    it.each([
        ['Material', 'Material', {}, {}],
        ['Storage Location', 'StorageLocation', {}, {}],
        ['Unit of Measure', 'UnitOfMeasure', {}, {}],
        ['Quantity', 'OrderQuantity', {}, {}],
        ['Net Price', 'NetPriceAmount', {}, { NetPriceAmount: '-1' }],
        ['Tax Code', 'TaxCode', {}, { TaxCode: 'TAX' }],
        ['Description', 'PurchaseOrderItemText', { PurchaseOrderType: 'ZSER' }, {}],
        ['Item Category', 'PurchaseOrderItemCategory', { PurchaseOrderType: 'ZDOM' }, { PurchaseOrderItemCategory: '9' }],
        ['Account Assignment', 'AccountAssignmentCategory', { PurchaseOrderType: 'ZDOM' }, { AccountAssignmentCategory: 'K' }],
        ['Plant', 'Plant', { PurchaseOrderType: 'ZDOM' }, { Plant: '2000' }]
    ])('validateForm focuses the cell bound to the field for a "%s" error', (label, field, header, item) => {
        const Validator = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator');
        const res = Validator.validateForm({ header, items: [{ PurchaseOrderItem: '00010', ...item }] });
        const error = res.errorList.find((e) => e.field === `00010 / ${label}`);
        expect(error.cellIndex).toBe(cellOf(field));
    });

    it('validateForm focuses the Plant cell for a missing item plant', () => {
        const Validator = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderValidator');
        const res = Validator.validateForm({ header: {}, items: [{ PurchaseOrderItem: '00010' }] });
        const plant = res.errorList.find((e) => /\/ Plant$/.test(e.field));
        expect(plant.cellIndex).toBe(cellOf('Plant'));
    });

    it('Status filter options are labelled exactly as the Status column displays them', () => {
        let formatter;
        const prevSap = global.sap;
        global.sap = { ui: { define: (deps, factory) => { formatter = factory({ getDateInstance: () => ({ format: String }) }); } } };
        try {
            jest.isolateModules(() => require('../../../app/fiori-app/webapp/model/formatter'));
        } finally {
            global.sap = prevSap;
        }
        const i18n = Object.fromEntries(read(path.join(WEBAPP, 'i18n/i18n.properties')).split('\n')
            .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
        const view = read(path.join(PO, 'view/PurchaseOrders.view.xml'));
        const select = view.slice(view.indexOf('<Select id="fbStatus"'), view.indexOf('</Select>', view.indexOf('<Select id="fbStatus"')));
        const options = [...select.matchAll(/<core:Item key="([^"]*)" text="\{i18n>(\w+)\}"/g)].filter(([, key]) => key !== '');
        expect(options.length).toBeGreaterThan(0);
        options.forEach(([, key, i18nKey]) => {
            const shown = key === 'Deleted' ? formatter.displayStatus('04', null, false, 'L') : formatter.displayStatus(key, null, false, '');
            expect([key, i18n[i18nKey]]).toEqual([key, shown]);
        });
    });
});
