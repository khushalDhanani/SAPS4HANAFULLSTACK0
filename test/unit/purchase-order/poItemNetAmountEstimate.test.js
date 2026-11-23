/**
 * Unit Tests for PO Line Net Amount Estimation (Audit Item 11)
 * Validates that PO line item Net Amount calculated in browser is explicitly marked
 * and labeled as an estimate before SAP S/4HANA prices the document.
 */

let PurchaseOrderModel;

function MockJSONModel(data) {
    this._data = JSON.parse(JSON.stringify(data || {}));
    this.getData = function () {
        return this._data;
    };
    this.getProperty = function (path) {
        if (!path) return undefined;
        const clean = path.startsWith("/") ? path.slice(1) : path;
        const parts = clean.split("/");
        let cur = this._data;
        for (const p of parts) {
            if (cur == null) return undefined;
            cur = cur[p];
        }
        return cur;
    };
    this.setProperty = function (path, val) {
        if (!path) return;
        const clean = path.startsWith("/") ? path.slice(1) : path;
        const parts = clean.split("/");
        let cur = this._data;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (cur[p] == null) {
                cur[p] = {};
            }
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = val;
    };
}

const originalSap = global.sap;

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                PurchaseOrderModel = factory(MockJSONModel);
            }
        }
    };

    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');
});

afterAll(() => {
    global.sap = originalSap;
});

describe('Unit: PO Line Net Amount Browser Estimation (Audit 11)', () => {
    it('should initialize initial item with NetAmount 0.00 and NetAmountIsEstimate true', () => {
        const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
        const items = oModel.getProperty('/items');

        expect(items).toHaveLength(1);
        expect(items[0].NetAmount).toBe('0.00');
        expect(items[0].NetAmountIsEstimate).toBe(true);
    });

    it('should initialize newly added items with NetAmountIsEstimate true', () => {
        const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
        PurchaseOrderModel.addItem(oModel, 'TEST_USER');
        const items = oModel.getProperty('/items');

        expect(items).toHaveLength(2);
        expect(items[1].PurchaseOrderItem).toBe('20');
        expect(items[1].NetAmount).toBe('0.00');
        expect(items[1].NetAmountIsEstimate).toBe(true);
    });

    it('should calculate estimated NetAmount from OrderQuantity x NetPriceAmount and set NetAmountIsEstimate true', () => {
        const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
        oModel.setProperty('/items/0/OrderQuantity', '25');
        oModel.setProperty('/items/0/NetPriceAmount', '12.50');

        PurchaseOrderModel.calculateItemNetAmount(oModel, '/items/0');

        expect(oModel.getProperty('/items/0/NetAmount')).toBe('312.50');
        expect(oModel.getProperty('/items/0/NetAmountIsEstimate')).toBe(true);
    });

    it('should handle zero or missing quantities gracefully and keep estimate flag', () => {
        const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
        oModel.setProperty('/items/0/OrderQuantity', '');
        oModel.setProperty('/items/0/NetPriceAmount', '50.00');

        PurchaseOrderModel.calculateItemNetAmount(oModel, '/items/0');

        expect(oModel.getProperty('/items/0/NetAmount')).toBe('0.00');
        expect(oModel.getProperty('/items/0/NetAmountIsEstimate')).toBe(true);
    });

    it('should format decimal amounts to two places', () => {
        const oModel = PurchaseOrderModel.createInitialModel('TEST_USER');
        oModel.setProperty('/items/0/OrderQuantity', '3');
        oModel.setProperty('/items/0/NetPriceAmount', '10.333');

        PurchaseOrderModel.calculateItemNetAmount(oModel, '/items/0');

        expect(oModel.getProperty('/items/0/NetAmount')).toBe('31.00');
        expect(oModel.getProperty('/items/0/NetAmountIsEstimate')).toBe(true);
    });
});
