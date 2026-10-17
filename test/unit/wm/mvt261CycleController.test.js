/**
 * Cycle261 controller: the Reverse (262) flow (confirm -> busy -> success toast+reload /
 * 409 info+refresh / 422 error / unknown-outcome warning). Controller-level, no OPA5 in this repo.
 */
let Controller;
const BaseController = { extend: (_name, obj) => { Controller = obj; return obj; } };
const JSONModel = function (initial) {
  let data = Object.assign({}, initial);
  const norm = (p) => (p && p.charAt(0) === '/' ? p.slice(1) : p);
  return { setData: (d) => { data = Object.assign({}, d); }, getData: () => data, getProperty: (p) => data[norm(p)], setProperty: (p, v) => { data[norm(p)] = v; } };
};
const ODataClient = { get: jest.fn(), post: jest.fn() };
const MessageBox = { confirm: jest.fn(), information: jest.fn(), error: jest.fn(), warning: jest.fn(), Action: { OK: 'OK', CANCEL: 'CANCEL', CLOSE: 'CLOSE' } };
const MessageToast = { show: jest.fn() };

global.sap = { ui: { define: (_deps, factory) => factory(BaseController, JSONModel, ODataClient, MessageBox, MessageToast) } };
require('../../../app/fiori-app/webapp/modules/wm/mvt261/controller/Cycle261.controller');

const flush = () => new Promise((r) => setImmediate(r));
const ROW = { MaterialDocument: '4900050046', MaterialDocumentYear: '2026', MaterialDocumentItem: '0001', MovementType: '261', IsReversed: false, Quantity: 200, Unit: 'KG', Batch: 'B1', StorageLocation: 'CS02' };

describe('Cycle261.controller reverse flow', () => {
  let ctrl;
  let model;

  beforeEach(() => {
    jest.clearAllMocks();
    model = new JSONModel({ busy: false, error: '', c: { Reservation: '512851', ReservationItem: '3', Material: 'M', Unit: 'KG', StorageLocation: 'CS02' } });
    ctrl = Object.create(Controller);
    ctrl.getModel = () => model;
    ctrl.getText = (k, args) => (args && args.length ? k + ':' + args.join('|') : k);
    ctrl._args = { reservation: '512851', item: '3' };
    ODataClient.get.mockResolvedValue({ Reservation: '512851', ReservationItem: '3', History: [] });
  });

  const reverseEvent = () => ({ getSource: () => ({ getBindingContext: () => ({ getObject: () => ROW }) }) });
  const confirmOk = () => MessageBox.confirm.mock.calls[0][1].onClose('OK');

  it('confirms first (showing the document) and does not post until confirmed', () => {
    ctrl.onReverse(reverseEvent());
    expect(MessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(MessageBox.confirm.mock.calls[0][0]).toContain('4900050046');
    expect(ODataClient.post).not.toHaveBeenCalled();
  });

  it('does nothing while busy', () => {
    model.setProperty('/busy', true);
    ctrl.onReverse(reverseEvent());
    expect(MessageBox.confirm).not.toHaveBeenCalled();
  });

  it('on confirm: posts the exact document item and sets busy during the call', () => {
    ODataClient.post.mockReturnValue(new Promise(() => {}));
    ctrl.onReverse(reverseEvent());
    confirmOk();
    expect(model.getProperty('/busy')).toBe(true);
    expect(ODataClient.post).toHaveBeenCalledWith('/odata/v4/mvt261/reverse', {
      reservation: '512851', item: '3', materialDocument: '4900050046', materialDocumentYear: '2026', materialDocumentItem: '0001'
    });
  });

  it('success: toast + reload the cycle', async () => {
    ODataClient.post.mockResolvedValue({ MaterialDocument: '4900050099', MaterialDocumentYear: '2026' });
    ctrl.onReverse(reverseEvent());
    confirmOk();
    await flush(); await flush();
    expect(MessageToast.show).toHaveBeenCalledWith(expect.stringContaining('cycle261ReverseSuccess'));
    expect(ODataClient.get).toHaveBeenCalled();
    expect(model.getProperty('/busy')).toBe(false);
  });

  it('409: information dialog whose Refresh action reloads', async () => {
    ODataClient.post.mockRejectedValue(Object.assign(new Error('in progress'), { status: 409 }));
    ctrl.onReverse(reverseEvent());
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.information).toHaveBeenCalledTimes(1);
    MessageBox.information.mock.calls[0][1].onClose('scan261Refresh');
    await flush();
    expect(ODataClient.get).toHaveBeenCalled();
  });

  it('422: actionable error, no reload', async () => {
    ODataClient.post.mockRejectedValue(Object.assign(new Error('is already reversed'), { status: 422 }));
    ctrl.onReverse(reverseEvent());
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.error).toHaveBeenCalledWith('is already reversed');
    expect(ODataClient.get).not.toHaveBeenCalled();
  });

  it('unknown outcome (no status): warning, no blind retry', async () => {
    ODataClient.post.mockRejectedValue(new Error('Failed to fetch'));
    ctrl.onReverse(reverseEvent());
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.warning).toHaveBeenCalledWith('cycle261ReverseUnknown');
    expect(model.getProperty('/busy')).toBe(false);
  });

  it('A6: a 502 (CAP->SAP timeout) is the unknown outcome: warning, no error dialog', async () => {
    ODataClient.post.mockRejectedValue(Object.assign(new Error('… failed: timeout'), { status: 502 }));
    ctrl.onReverse(reverseEvent());
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.warning).toHaveBeenCalledWith('cycle261ReverseUnknown');
    expect(MessageBox.error).not.toHaveBeenCalled();
  });
});
