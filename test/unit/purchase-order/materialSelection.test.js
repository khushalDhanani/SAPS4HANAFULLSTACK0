let PurchaseOrderModel;
let PurchaseOrderService;
let ValueHelpService;

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

function MockFilter(path, operator, val1, val2) {
    this.sPath = path;
    this.sOperator = operator;
    this.oValue1 = val1;
    this.oValue2 = val2;
}

const MockFilterOperator = {
    Contains: "Contains",
    EQ: "EQ",
    BT: "BT"
};

function MockSelectDialog() {}
function MockStandardListItem() {}

const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

const originalSap = global.sap;

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                if (deps.includes("sap/ui/model/json/JSONModel")) {
                    PurchaseOrderModel = factory(MockJSONModel);
                } else if (deps.includes("saps4hana/fiori/service/ODataClient")) {
                    PurchaseOrderService = factory(mockODataClient);
                } else if (deps.includes("sap/m/SelectDialog")) {
                    ValueHelpService = factory(MockFilter, MockFilterOperator, MockSelectDialog, MockStandardListItem);
                }
            }
        }
    };

    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderModel');
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService');
    require('../../../app/fiori-app/webapp/service/ValueHelpService');
});

afterAll(() => {
    global.sap = originalSap;
});

const { mapToS4Payload } = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderMapper');

describe('Purchase Order Material Selection Flow', () => {

    describe('PurchaseOrderModel.applyMaterialDefaults', () => {
        it('should populate Material, description, UnitOfMeasure, MaterialGroup and default Plant', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            oModel.setProperty('/items/0/errors/Material', { state: 'Error', text: 'Material required' });
            oModel.setProperty('/items/0/errors/UnitOfMeasure', { state: 'Error', text: 'Unit required' });

            const s4MasterData = {
                Material: '1000000003',
                MaterialName: 'Polypropylene Resin',
                MaterialBaseUnit: 'KG',
                MaterialGroup: 'RM',
                Plant: '1110'
            };

            const report = PurchaseOrderModel.applyMaterialDefaults(oModel, 0, s4MasterData, true);

            expect(report.Material).toBe('1000000003');
            expect(report.PurchaseOrderItemText).toBe('Polypropylene Resin');
            expect(report.UnitOfMeasure).toBe('KG');
            expect(report.MaterialGroup).toBe('RM');
            expect(report.Plant).toBe('1110');

            expect(oModel.getProperty('/items/0/Material')).toBe('1000000003');
            expect(oModel.getProperty('/items/0/PurchaseOrderItemText')).toBe('Polypropylene Resin');
            expect(oModel.getProperty('/items/0/UnitOfMeasure')).toBe('KG');
            expect(oModel.getProperty('/items/0/MaterialGroup')).toBe('RM');
            expect(oModel.getProperty('/items/0/Plant')).toBe('1110');
            expect(oModel.getProperty('/items/0/errors/Material/state')).toBe('None');
            expect(oModel.getProperty('/items/0/errors/UnitOfMeasure/state')).toBe('None');
        });

        it('should update description when changing material with bForce=true', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            // Previously had Material A
            oModel.setProperty('/items/0/Material', '1000000003');
            oModel.setProperty('/items/0/PurchaseOrderItemText', 'Old Material Description');
            oModel.setProperty('/items/0/UnitOfMeasure', 'KG');

            // User selects Material B
            const newMasterData = {
                Material: '1000000007',
                MaterialName: 'Meso-erythritol',
                MaterialBaseUnit: 'TO',
                MaterialGroup: '280',
                Plant: '1120'
            };

            const report = PurchaseOrderModel.applyMaterialDefaults(oModel, '/items/0', newMasterData, true);

            expect(report.Material).toBe('1000000007');
            expect(report.PurchaseOrderItemText).toBe('Meso-erythritol');
            expect(report.UnitOfMeasure).toBe('TO');
            expect(report.MaterialGroup).toBe('280');
            expect(oModel.getProperty('/items/0/PurchaseOrderItemText')).toBe('Meso-erythritol');
            expect(oModel.getProperty('/items/0/UnitOfMeasure')).toBe('TO');
            expect(oModel.getProperty('/items/0/MaterialGroup')).toBe('280');
        });

        it('should not overwrite row Plant if Plant was already specified by the user', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            oModel.setProperty('/items/0/Plant', '2100');

            const masterData = {
                Material: 'TG11',
                MaterialName: 'Trading Goods 11',
                MaterialBaseUnit: 'PC',
                Plant: '1010'
            };

            const report = PurchaseOrderModel.applyMaterialDefaults(oModel, 0, masterData, true);

            expect(oModel.getProperty('/items/0/Plant')).toBe('2100');
            expect(report.Plant).toBeUndefined();
        });

        it('should support Material_Text alias as fallback for description', () => {
            const oModel = PurchaseOrderModel.createInitialModel('TESTUSER');
            const masterData = {
                Material: '4000001',
                Material_Text: 'Chemical Reagent',
                MaterialBaseUnit: 'L'
            };

            const report = PurchaseOrderModel.applyMaterialDefaults(oModel, 0, masterData, true);

            expect(report.PurchaseOrderItemText).toBe('Chemical Reagent');
            expect(oModel.getProperty('/items/0/PurchaseOrderItemText')).toBe('Chemical Reagent');
        });
    });

    describe('ValueHelpService Configuration for /MaterialVH', () => {
        it('should configure MaterialName as primary description and Material_Text as alternative', () => {
            const conf = ValueHelpService.getConfig('/MaterialVH');
            expect(conf).toBeDefined();
            expect(conf.key).toBe('Material');
            expect(conf.desc).toBe('MaterialName');
            expect(conf.descAlt).toBe('Material_Text');
            expect(conf.info).toBe('MaterialBaseUnit');
        });

        it('should merge Plant context filter when applySuggestionFilter is called with context', () => {
            const filterCalls = [];
            const mockBinding = {
                getPath: () => '/MaterialVH',
                filter: (aFilters) => { filterCalls.push(aFilters); }
            };
            const mockInput = {
                getBinding: (sName) => (sName === 'suggestionItems' ? mockBinding : null)
            };

            const plantFilter = { sPath: 'Plant', sOperator: 'EQ', oValue1: '1110' };
            ValueHelpService.applySuggestionFilter(mockInput, 'Resin', [plantFilter]);

            expect(filterCalls.length).toBe(1);
            const appliedFilters = filterCalls[0];
            expect(appliedFilters.length).toBe(2); // 1 search filter + 1 context filter
            expect(appliedFilters[1]).toBe(plantFilter);
        });
    });

    describe('PurchaseOrderService.getMaterialDetails', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should return null for empty material input', async () => {
            const result = await PurchaseOrderService.getMaterialDetails('');
            expect(result).toBeNull();
        });

        it('should query MaterialVH with plant filter when sPlant is provided', async () => {
            mockODataClient.get.mockResolvedValueOnce({
                value: [{
                    Material: '1000000003',
                    Plant: '1120',
                    MaterialName: 'test material plant 1120',
                    MaterialBaseUnit: 'KG',
                    MaterialGroup: '103'
                }]
            });

            const result = await PurchaseOrderService.getMaterialDetails('1000000003', '1120');

            expect(mockODataClient.get).toHaveBeenCalledTimes(1);
            expect(mockODataClient.get.mock.calls[0][0]).toContain('Plant eq \'1120\'');
            expect(result).toBeDefined();
            expect(result.Plant).toBe('1120');
            expect(result.MaterialName).toBe('test material plant 1120');
        });

        it('should fallback to query without plant if specific plant record is not found', async () => {
            mockODataClient.get
                .mockResolvedValueOnce({ value: [] }) // first call with plant returns empty
                .mockResolvedValueOnce({
                    value: [{
                        Material: '1000000003',
                        Plant: '1110',
                        MaterialName: 'test material plant 1110',
                        MaterialBaseUnit: 'KG'
                    }]
                }); // fallback call

            const result = await PurchaseOrderService.getMaterialDetails('1000000003', '9999');

            expect(mockODataClient.get).toHaveBeenCalledTimes(2);
            expect(result).toBeDefined();
            expect(result.Material).toBe('1000000003');
            expect(result.Plant).toBe('1110');
        });
    });

    describe('PurchaseOrderMapper with PurchaseOrderItemText', () => {
        it('should include PurchaseOrderItemText in to_PurchaseOrderItemTP payload', () => {
            const header = {
                PurchaseOrderType: 'NB',
                CompanyCode: '1010',
                PurchasingOrganization: '1010',
                PurchasingGroup: '001',
                Supplier: '10300001',
                Currency: 'EUR'
            };

            const items = [{
                PurchaseOrderItem: '10',
                Material: '1000000003',
                PurchaseOrderItemText: 'Polypropylene Resin Master',
                Plant: '1110',
                StorageLocation: '101A',
                OrderQuantity: '50',
                UnitOfMeasure: 'KG',
                NetPriceAmount: '12.50',
                MaterialGroup: 'RM'
            }];

            const payload = mapToS4Payload(header, items);

            expect(payload.to_PurchaseOrderItemTP).toBeDefined();
            expect(payload.to_PurchaseOrderItemTP.length).toBe(1);
            const poItem = payload.to_PurchaseOrderItemTP[0];
            expect(poItem.Material).toBe('1000000003');
            expect(poItem.PurchaseOrderItemText).toBe('Polypropylene Resin Master');
            expect(poItem.MaterialGroup).toBe('RM');
            expect(poItem.PurchaseOrderQuantityUnit).toBe('KG');
            expect(poItem.Plant).toBe('1110');
        });
    });
});
