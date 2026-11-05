'use strict';

const { realBlockSubmit } = require('../helpers/realBlockSubmit');

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
const MockMessageBox = { error: jest.fn(), confirm: jest.fn(), success: jest.fn(), Action: { OK: 'OK', CANCEL: 'CANCEL' } };

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
    controller.blockSubmitIfNotConfirmed = realBlockSubmit();
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

  test('requires server validation before showing the posting confirmation', () => {
    model.setProperty('/selectedHus', [{ UnitNumber: 'HU1', TransferQty: 1 }]);
    controller.onPostSelectedHus();
    expect(MockMessageBox.error).toHaveBeenCalledWith('Validate the selection before posting.');
    expect(MockMessageBox.confirm).not.toHaveBeenCalled();
    expect(MockODataClient.post).not.toHaveBeenCalled();
  });

  test('cancellation leaves SAP untouched and confirmation sends the selected HUs', () => {
    model.setProperty('/selectedHus', [{ UnitNumber: 'HU1', TransferQty: 1 }]);
    model.setProperty('/selectionValidation', { Valid: true });
    controller._executePostSelection = jest.fn();
    controller.onPostSelectedHus();
    const dialog = MockMessageBox.confirm.mock.calls[0][1];
    dialog.onClose('CANCEL');
    expect(controller._executePostSelection).not.toHaveBeenCalled();
    dialog.onClose('OK');
    expect(controller._executePostSelection).toHaveBeenCalledWith([{ UnitNumber: 'HU1', TransferQty: 1 }]);
  });

  test.each([true, false])('renders posted document numbers and clears validation on success=%s', async (success) => {
    controller.loadCockpitDetail = jest.fn();
    model.setProperty('/selectionValidation', { Valid: true });
    MockODataClient.post.mockResolvedValue({ Success: success, Message: 'result', Items: [
      { UnitNumber: 'HU1', Success: true, MaterialDocument: '4900012345', MaterialDocYear: '2026' },
      ...(success ? [] : [{ UnitNumber: 'HU2', Success: false, Message: 'read-back failed' }])
    ] });
    controller._executePostSelection([{ UnitNumber: 'HU1', TransferQty: '1' }]);
    await new Promise(setImmediate);
    expect(MockODataClient.post).toHaveBeenCalledWith('/odata/v4/hu-stock-transfer/executeHuStockTransferSelection', {
      ReservationNo: '10042', ReservationItem: '1', Selections: [{ UnitNumber: 'HU1', TransferQty: 1 }], ClientAttemptId: expect.any(String)
    });
    expect(model.getProperty('/busy')).toBe(false);
    expect(model.getProperty('/selectionValidation')).toBeNull();
    expect(success ? MockMessageBox.success : MockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('4900012345 / 2026'), expect.any(Object));
    expect(controller.loadCockpitDetail).toHaveBeenCalledTimes(success ? 0 : 1);
  });

  describe('after an answer that does not confirm the posting', () => {
    const flush = () => new Promise(setImmediate);
    const notConfirmed = 'Stock transfer outcome is NOT confirmed in SAP (timeout). Check it in SAP before trying again.';
    const attemptIds = () => MockODataClient.post.mock.calls.map(([, body]) => body.ClientAttemptId);

    beforeEach(() => {
      controller.loadCockpitDetail = jest.fn();
      controller.getRouter = () => ({ navTo: jest.fn() });
      controller.byId = jest.fn();
    });

    test('single post: shows the warning and turns Post off, and a second press sends nothing', async () => {
      model.setProperty('/scanUnitNumber', 'HU1');
      model.setProperty('/validatedUnit', { Valid: true, UnitNumber: 'HU1' });
      model.setProperty('/transferQty', 1);
      MockODataClient.post.mockRejectedValue(new Error(notConfirmed));

      controller._executePost('10042', '1', 'HU1', 1, true);
      await flush();

      expect(model.getProperty('/submitBlocked')).toBe(true);
      expect(MockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('NOT confirmed'));

      controller.onPostTransfer();

      expect(MockMessageBox.confirm).not.toHaveBeenCalled();
      expect(MockODataClient.post).toHaveBeenCalledTimes(1);
    });

    test('selection post: an unconfirmed HU in the answer turns Post off', async () => {
      MockODataClient.post.mockResolvedValue({ Success: false, Message: 'stopped', Items: [{ UnitNumber: 'HU1', Success: false, Message: notConfirmed }] });

      controller._executePostSelection([{ UnitNumber: 'HU1', TransferQty: 1 }]);
      await flush();

      expect(model.getProperty('/submitBlocked')).toBe(true);

      model.setProperty('/selectedHus', [{ UnitNumber: 'HU1', TransferQty: 1 }]);
      model.setProperty('/selectionValidation', { Valid: true });
      controller.onPostSelectedHus();

      expect(MockMessageBox.confirm).not.toHaveBeenCalled();
    });

    test('a resend after a lost connection keeps the same attempt ID, and a success starts a new one', async () => {
      MockODataClient.post.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({ MaterialDocument: '4900012345', MaterialDocYear: '2026' });

      controller._executePost('10042', '1', 'HU1', 1, true);
      await flush();
      expect(model.getProperty('/submitBlocked')).toBeFalsy();
      controller._executePost('10042', '1', 'HU1', 1, true);
      await flush();
      controller._executePost('10042', '1', 'HU1', 1, true);
      await flush();

      const [first, resend, further] = attemptIds();
      expect(resend).toBe(first);
      expect(further).not.toBe(first);
    });

    test('a different unit or quantity gets its own attempt ID', async () => {
      MockODataClient.post.mockRejectedValue(new Error('connection lost'));

      controller._executePost('10042', '1', 'HU1', 1, true);
      await flush();
      controller._executePost('10042', '1', 'HU1', 2, true);
      await flush();

      const [first, other] = attemptIds();
      expect(other).not.toBe(first);
    });
  });

  test('releases busy state and displays transport failure', async () => {
    MockODataClient.post.mockRejectedValue(new Error('connection lost'));
    controller._executePostSelection([{ UnitNumber: 'HU1', TransferQty: 1 }]);
    await new Promise(setImmediate);
    expect(model.getProperty('/busy')).toBe(false);
    expect(MockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });

});
