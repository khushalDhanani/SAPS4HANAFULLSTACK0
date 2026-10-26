'use strict';

let ControllerClass;
class MockJSONModel {
  constructor(data) { this.data = data || {}; }
  setProperty(path, value) {
    const keys = path.replace(/^\//, '').split('/');
    let node = this.data;
    while (keys.length > 1) node = node[keys.shift()] ||= {};
    node[keys[0]] = value;
  }
  getProperty(path) { return path.replace(/^\//, '').split('/').reduce((node, key) => node && node[key], this.data); }
}
const MockBaseController = { extend: (_name, proto) => function Controller() { Object.assign(this, proto); } };
const MockODataClient = { post: jest.fn(), get: jest.fn() };
const MockFragment = {};
const MockMessageToast = { show: jest.fn() };
const MockMessageBox = { error: jest.fn(), confirm: jest.fn() };

beforeAll(() => {
  global.sap = { ui: { define: (_deps, factory) => {
    ControllerClass = factory(MockBaseController, MockJSONModel, MockODataClient, MockFragment, MockMessageToast, MockMessageBox);
  } } };
  require('../../../app/fiori-app/webapp/modules/wm/hu-stock-transfer/controller/HuStockTransferDetail.controller');
});

describe('HU multi-selection cockpit client validation (read-only)', () => {
  let controller;
  let model;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ControllerClass();
    model = new MockJSONModel({
      reservationNo: '10042', reservationItem: '1', maxAllowedQty: 5,
      cockpit: { BaseUnit: 'NOS', OversizeHuSelectionBehavior: 'BLOCK' },
      selectedHus: [], selectionValidation: null
    });
    controller.getModel = (name) => name === 'cockpitView' ? model : null;
    controller.getText = (_key, args, fallback) => String(fallback || '').replace(/\{(\d+)\}/g, (_match, index) => (args || [])[Number(index)] ?? '');
  });

  test('adds multiple validated HUs when quantities remain within stock and open quantity', () => {
    model.setProperty('/validatedUnit', { Valid: true, UnitType: 'Handling Unit (HU)', UnitNumber: 'HU1', AvailableQuantity: 3, BaseUnit: 'NOS' });
    model.setProperty('/transferQty', 3);
    controller.onAddUnitToSelection();
    model.setProperty('/validatedUnit', { Valid: true, UnitType: 'Handling Unit (HU)', UnitNumber: 'HU2', AvailableQuantity: 2, BaseUnit: 'NOS' });
    model.setProperty('/transferQty', 2);
    controller.onAddUnitToSelection();
    expect(model.getProperty('/selectedHus').map((item) => item.TransferQty)).toEqual([3, 2]);
    expect(model.getProperty('/selectionSummary')).toContain('5.000');
  });

  test('blocks an HU whose stock is above the remaining reservation quantity under the default policy', () => {
    model.setProperty('/validatedUnit', { Valid: true, UnitType: 'Handling Unit (HU)', UnitNumber: 'HU1', AvailableQuantity: 6, BaseUnit: 'NOS' });
    model.setProperty('/transferQty', 2);
    controller.onAddUnitToSelection();
    expect(model.getProperty('/selectedHus')).toEqual([]);
    expect(MockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('selection is blocked'));
  });

  test('client rejects selected quantities above open quantity before calling CAP', () => {
    model.setProperty('/selectedHus', [
      { UnitNumber: 'HU1', TransferQty: 3, AvailableQuantity: 3 },
      { UnitNumber: 'HU2', TransferQty: 3, AvailableQuantity: 3 }
    ]);
    controller.onValidateSelectedHus();
    expect(MockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('remaining reservation quantity'));
    expect(MockODataClient.post).not.toHaveBeenCalled();
  });

  test('validates selection through the read-only CAP action, never the posting action', async () => {
    model.setProperty('/selectedHus', [{ UnitNumber: 'HU1', TransferQty: 2, AvailableQuantity: 3 }]);
    MockODataClient.post.mockResolvedValueOnce({ Valid: true, OpenQuantity: 5, SelectedQuantity: 2, Warnings: [] });
    controller.onValidateSelectedHus();
    await Promise.resolve();
    await Promise.resolve();
    expect(MockODataClient.post).toHaveBeenCalledWith('/odata/v4/hu-stock-transfer/validateHuStockTransferSelection', {
      ReservationNo: '10042', ReservationItem: '1', Selections: [{ UnitNumber: 'HU1', TransferQty: 2 }]
    });
    expect(MockODataClient.post.mock.calls[0][0]).not.toContain('executeHuStockTransfer');
    expect(model.getProperty('/selectionValidation').Valid).toBe(true);
  });
});
