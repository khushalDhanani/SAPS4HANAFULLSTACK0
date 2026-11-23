// CreatePurchaseOrder controller with the real PurchaseOrderModel, PurchaseOrderService and shared ODataClient reader.
// Doubled: HTTP (ODataClient.get), the UI5 OData V4 model (bindList) and UI5 controls.
// Rows are hand-written from fields in srv/mm/purchase-order/service.cds; they prove our handling, not what SAP returns.
function PlainJSONModel(data) {
    this.data = JSON.parse(JSON.stringify(data || {}));
    this.getData = () => this.data;
    this.getProperty = (sPath) => sPath.split('/').filter(Boolean).reduce((cur, key) => (cur == null ? undefined : cur[key]), this.data);
    this.setProperty = (sPath, value) => {
        const keys = sPath.split('/').filter(Boolean);
        const last = keys.pop();
        const target = keys.reduce((cur, key) => { cur[key] = cur[key] == null ? {} : cur[key]; return cur[key]; }, this.data);
        target[last] = value;
    };
}

function PlainFilter(sPath, sOperator, oValue1) {
    this.sPath = sPath;
    this.sOperator = sOperator;
    this.oValue1 = oValue1;
}

const http = { get: null };
const toast = { show: () => {} };
const messageBox = { error: jest.fn() };
const busy = { show: () => {}, hide: () => {} };
const flush = () => new Promise(resolve => setImmediate(resolve));

let Controller;
let PurchaseOrderModel;

beforeAll(() => {
    const httpClient = { get: (sUrl) => http.get(sUrl), post: (sUrl, oBody) => http.post(sUrl, oBody) };
    require('vm').runInNewContext(require('fs').readFileSync(
        require('path').resolve(__dirname, '../../../app/fiori-app/webapp/service/ODataClient.js'), 'utf8'), {
        sap: { ui: { define: (_deps, factory) => { httpClient.readEntitySet = factory({}).readEntitySet; } } }
    });

    const prevSap = global.sap;
    let PurchaseOrderService;
    global.sap = {
        ui: {
            define: (deps, factory) => {
                if (deps.includes('sap/ui/model/json/JSONModel')) {
                    PurchaseOrderModel = factory(PlainJSONModel);
                } else if (deps.includes('saps4hana/fiori/service/ODataClient')) {
                    PurchaseOrderService = factory(httpClient, PlainFilter, { EQ: 'EQ' });
                } else {
                    Controller = factory({ extend: (_sName, oMembers) => oMembers }, messageBox, toast, function () {}, function () {}, busy, PlainFilter,
                        { EQ: 'EQ', StartsWith: 'StartsWith' }, PurchaseOrderModel, {}, PurchaseOrderService);
                }
            }
        }
    };
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService');
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/controller/CreatePurchaseOrder.controller');
    global.sap = prevSap;
});

describe('CreatePurchaseOrder controller with the real service', () => {
    let controller;
    let oModel;
    let reads;
    let httpUrls;

    const oDataModel = {
        bindList: (sPath, _ctx, _sorters, aFilters) => ({
            requestContexts: (_start, iLength) => {
                reads.push({ path: sPath, filters: aFilters.map(f => [f.sPath, f.sOperator, f.oValue1]), length: iLength });
                return Promise.resolve([{ getObject: () => ({ Material: 'MAT01', MaterialBaseUnit: 'EA', MaterialGroup: 'L001' }) }]);
            }
        })
    };

    beforeEach(() => {
        reads = [];
        httpUrls = [];
        oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
        controller = Object.create(Controller);
        controller.getView = () => ({ getModel: (sName) => (sName === 'newPO' ? oModel : null) });
        controller.getModel = (sName) => (sName ? null : oDataModel);
        controller.byId = () => null;
        controller.getText = (_sKey, _aArgs, sFallback) => sFallback;
        http.get = async (sUrl) => {
            httpUrls.push(sUrl);
            return { Currency: 'INR', PaymentTerms: '0001', IncotermsClassification: 'EXW', IncotermsLocation1: 'MUMBAI', derived: true, source: 'from last PO', lastPurchaseOrder: '300000001' };
        };
    });

    it('should do nothing on Create once submit was turned off after a not-confirmed answer', () => {
        const validate = jest.spyOn(PurchaseOrderModel, 'validateForm');
        oModel.setProperty('/submitBlocked', true);

        controller.onCreatePress();

        expect(validate).not.toHaveBeenCalled();
        validate.mockRestore();
    });

    it('should warn and turn submit off when SAP did not confirm the order, and keep it off', async () => {
        const text = 'SAP did not answer this request, so the result is NOT confirmed: it may have been saved. Check it in SAP before trying again.';
        const validate = jest.spyOn(PurchaseOrderModel, 'validateForm').mockReturnValue({ isValid: true });
        http.post = jest.fn().mockRejectedValue(new Error(text));
        controller.blockSubmitIfNotConfirmed = require('../helpers/realBlockSubmit').realBlockSubmit();
        messageBox.error.mockClear();

        controller.onCreatePress();
        await flush();

        expect(oModel.getProperty('/submitBlocked')).toBe(true);
        expect(messageBox.error.mock.calls[0][0]).toContain(text);
        expect(messageBox.error.mock.calls[0][0]).toContain('Create is turned off');

        controller.onCreatePress();

        expect(http.post).toHaveBeenCalledTimes(1);
        validate.mockRestore();
    });

    const supplierInput = { getBindingContext: () => null, getBindingPath: () => 'Supplier' };
    const rowContext = { getPath: () => '/items/0', getProperty: () => '' };

    it('should ask the server for the supplier defaults when a supplier is selected from the value help', async () => {
        controller._handleValueHelpSelected(supplierInput, '100102', {}, { CompanyCode: '1000' });
        await flush();

        expect(httpUrls).toEqual(["/odata/v4/purchase-order/getSupplierDefaults(Supplier='100102',CompanyCode='1000',PurchasingOrganization='')"]);
    });

    it('should put the returned supplier defaults on the header', async () => {
        controller._handleValueHelpSelected(supplierInput, '100102', {}, { CompanyCode: '1000' });
        await flush();

        expect(oModel.getProperty('/header/Currency')).toBe('INR');
        expect(oModel.getProperty('/header/PaymentTerms')).toBe('0001');
        expect(oModel.getProperty('/header/IncotermsClassification')).toBe('EXW');
        expect(oModel.getProperty('/header/IncotermsLocation1')).toBe('MUMBAI');
    });

    it('should read a suggested material through the OData model of the view, filtered by the row plant', async () => {
        oModel.setProperty('/items/0/Plant', '1120');
        controller.onItemMaterialSelect({
            getSource: () => ({ getBindingContext: () => rowContext }),
            getParameter: () => ({ getKey: () => 'MAT01', getText: () => 'MAT01', getBindingContext: () => null })
        });
        await flush();

        expect(reads).toEqual([{ path: '/MaterialVH', filters: [['Material', 'EQ', 'MAT01'], ['Plant', 'EQ', '1120']], length: 1 }]);
    });

    it('should put the unit and group of a suggested material on the row', async () => {
        controller.onItemMaterialSelect({
            getSource: () => ({ getBindingContext: () => rowContext }),
            getParameter: () => ({ getKey: () => 'MAT01', getText: () => 'MAT01', getBindingContext: () => null })
        });
        await flush();

        expect(oModel.getProperty('/items/0/UnitOfMeasure')).toBe('EA');
        expect(oModel.getProperty('/items/0/MaterialGroup')).toBe('L001');
    });

    it('should read a value-help material through the OData model of the view and fill the row', async () => {
        const materialInput = { data: (sKey) => (sKey === 'field' ? 'Material' : null), getBindingContext: () => rowContext };

        controller._handleValueHelpSelected(materialInput, 'MAT01', null, null);
        await flush();

        expect(reads).toEqual([{ path: '/MaterialVH', filters: [['Material', 'EQ', 'MAT01']], length: 1 }]);
        expect(oModel.getProperty('/items/0/UnitOfMeasure')).toBe('EA');
    });
});
