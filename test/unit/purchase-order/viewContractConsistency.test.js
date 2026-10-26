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

    it.each(['model/PurchaseOrderValidator.js', 'model/PurchaseOrderModel.js'])('item field config cellIndex values match the view (%s)', (file) => {
        const src = read(path.join(PO, file));
        const entries = [...src.matchAll(/(\w+): \{ cellIndex: (\d+), label: "([^"]+)"/g)];
        expect(entries.length).toBe(8);
        entries.forEach(([, field, idx]) => expect([field, Number(idx)]).toEqual([field, cellOf(field)]));
    });

    it('every literal item error cellIndex in the validator matches the view', () => {
        const src = read(path.join(PO, 'model/PurchaseOrderValidator.js'));
        const labelToField = {
            'Plant': 'Plant', 'Storage Location': 'StorageLocation', 'Material': 'Material', 'Description': 'PurchaseOrderItemText',
            'Quantity': 'OrderQuantity', 'Unit of Measure': 'UnitOfMeasure', 'Net Price': 'NetPriceAmount', 'Tax Code': 'TaxCode',
            'Item Category': 'PurchaseOrderItemCategory', 'Account Assignment': 'AccountAssignmentCategory'
        };
        const literals = [...src.matchAll(/field: sItemNo \+ " \/ ([^"]+)",[\s\S]{0,300}?cellIndex: (\d+)/g)];
        expect(literals.length).toBeGreaterThanOrEqual(11);
        literals.forEach(([, label, idx]) => {
            expect(labelToField[label]).toBeDefined();
            expect([label, Number(idx)]).toEqual([label, cellOf(labelToField[label])]);
        });
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
