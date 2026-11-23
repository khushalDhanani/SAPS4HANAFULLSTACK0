// PurchaseOrders controller with the real ValueHelpService. Doubled: the UI5 dialog and input controls.
let Controller;
const dialogs = [];

function PlainFilter(sPath, sOperator, oValue1) {
    this.sPath = sPath;
    this.sOperator = sOperator;
    this.oValue1 = oValue1;
}

function PlainSelectDialog() {
    this.setModel = () => {};
    this.addStyleClass = () => {};
    this.bindAggregation = (sName, oInfo) => { this.bound = { name: sName, path: oInfo.path, filters: oInfo.filters }; };
    this.open = () => { this.opened = true; };
    dialogs.push(this);
}

beforeAll(() => {
    const prevSap = global.sap;
    let ValueHelpService;
    global.sap = {
        ui: {
            define: (deps, factory) => {
                if (deps.includes('sap/m/SelectDialog')) {
                    ValueHelpService = factory(...deps.map((sDep) => ({
                        'sap/ui/model/Filter': PlainFilter,
                        'sap/ui/model/FilterOperator': { EQ: 'EQ', Contains: 'Contains' },
                        'sap/m/SelectDialog': PlainSelectDialog
                    })[sDep] || function () {}));
                } else {
                    const members = {};
                    Controller = factory({ extend: (_sName, oMembers) => { Object.assign(members, oMembers); return function () { Object.assign(this, members); }; } },
                        function () {}, PlainFilter, { EQ: 'EQ', NE: 'NE', Contains: 'Contains' }, function () {}, { SortOrder: {} }, {}, ValueHelpService, {}, {}, {});
                }
            }
        }
    };
    require('../../../app/fiori-app/webapp/service/ValueHelpService');
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/controller/PurchaseOrders.controller');
    global.sap = prevSap;
});

describe('PurchaseOrders filter bar value help with the real ValueHelpService', () => {
    const inputBoundTo = (sPath, sField) => ({
        data: (sKey) => (sKey === 'field' ? sField : null),
        getBinding: (sName) => (sName === 'suggestionItems' ? { getPath: () => sPath, getModel: () => ({}) } : null)
    });
    const filterValues = { fbCompanyCode: '', fbDocType: '' };
    let controller;

    beforeEach(() => {
        dialogs.length = 0;
        filterValues.fbCompanyCode = '';
        filterValues.fbDocType = '';
        controller = new Controller();
        controller.getView = () => ({ getModel: () => null, addDependent: () => {} });
        controller.byId = (sId) => (sId in filterValues ? { getValue: () => filterValues[sId] } : null);
    });

    const openFor = (sPath, sField) => controller.onValueHelpRequest({ getSource: () => inputBoundTo(sPath, sField) });
    const boundFilters = () => dialogs[0].bound.filters.map(f => [f.sPath, f.sOperator, f.oValue1]);

    it('should open a dialog bound to the value help entity of the input', () => {
        openFor('/CurrencyVH', 'Currency');

        expect(dialogs[0].bound).toEqual({ name: 'items', path: '/CurrencyVH', filters: [] });
        expect(dialogs[0].opened).toBe(true);
    });

    it('should restrict the Supplier dialog to the company code in the filter bar', () => {
        filterValues.fbCompanyCode = '1000';

        openFor('/SupplierVH', 'Supplier');

        expect(boundFilters()).toEqual([['CompanyCode', 'EQ', '1000']]);
    });

    it('should restrict the Supplier dialog to account group ZDOM when the filter bar type is ZDOM', () => {
        filterValues.fbDocType = 'ZDOM';

        openFor('/SupplierVH', 'Supplier');

        expect(boundFilters()).toEqual([['SupplierAccountGroup', 'EQ', 'ZDOM']]);
    });

    it('should restrict the Supplier dialog to account group ZINT when the filter bar type is ZSTO', () => {
        filterValues.fbDocType = 'ZSTO';

        openFor('/SupplierVH', 'Supplier');

        expect(boundFilters()).toEqual([['SupplierAccountGroup', 'EQ', 'ZINT']]);
    });
});
