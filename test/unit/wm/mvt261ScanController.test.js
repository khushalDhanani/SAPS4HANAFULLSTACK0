/**
 * Scan261 controller: the Post flow (confirm -> busy/disabled -> success toast / 409 info+refresh /
 * 422 error / unknown-outcome warning). Controller-level, no OPA5 harness exists in this repo.
 */
let Controller;
const BaseController = { extend: (_name, obj) => { Controller = obj; return obj; } };

const JSONModel = function (initial) {
  let data = Object.assign({}, initial);
  const norm = (p) => (p && p.charAt(0) === '/' ? p.slice(1) : p);
  return {
    setData: (d) => { data = Object.assign({}, d); },
    getData: () => data,
    getProperty: (p) => data[norm(p)],
    setProperty: (p, v) => { data[norm(p)] = v; }
  };
};

const ODataClient = { get: jest.fn(), post: jest.fn() };
const BarcodeScanService = { attachHardwareScanner: jest.fn(), detachHardwareScanner: jest.fn() };
const ScanSession = { total: jest.fn(() => 200), drums: () => 1, deviations: () => 0, units: () => [], state: () => 'Covered' };
const MessageBox = {
  confirm: jest.fn(), information: jest.fn(), error: jest.fn(), warning: jest.fn(), success: jest.fn(),
  Action: { OK: 'OK', CANCEL: 'CANCEL', CLOSE: 'CLOSE' }
};
const MessageToast = { show: jest.fn() };

global.sap = { ui: { define: (_deps, factory) => factory(BaseController, JSONModel, ODataClient, BarcodeScanService, ScanSession, MessageBox, MessageToast) } };
require('../../../app/fiori-app/webapp/modules/wm/mvt261/controller/Scan261.controller');

const flush = () => new Promise((r) => setImmediate(r));
const BASE = '/odata/v4/mvt261';

describe('Scan261.controller post flow', () => {
  let ctrl;
  let model;

  beforeEach(() => {
    jest.clearAllMocks();
    model = new JSONModel({ busy: false, ctx: { Reservation: '512851', ReservationItem: '3', Unit: 'KG', Blocked: false, QuantCount: 0, StorageUnitQuantCount: 0 }, rows: [{ Accepted: true, Batch: 'B1', Quantity: 200 }] });
    ctrl = Object.create(Controller);
    ctrl.getModel = () => model;
    ctrl.getText = (k) => k;
    ctrl.byId = () => null;
    ctrl._args = { reservation: '512851', item: '3' };
    ScanSession.total.mockReturnValue(200);
    ODataClient.get.mockResolvedValue({ Blocked: false, QuantCount: 0, StorageUnitQuantCount: 0 });
  });

  const confirmOk = () => MessageBox.confirm.mock.calls[0][1].onClose('OK');

  it('asks for confirmation first and does not post until the operator confirms', () => {
    ctrl.onPost();
    expect(MessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(ODataClient.post).not.toHaveBeenCalled();
  });

  it('does nothing while a post is already in flight (busy guard)', () => {
    model.setProperty('/busy', true);
    ctrl.onPost();
    expect(MessageBox.confirm).not.toHaveBeenCalled();
  });

  it('F13: blocks a multi-batch scan (error, no confirm, no post)', () => {
    model.setProperty('/rows', [{ Accepted: true, Batch: 'B1', Quantity: 120 }, { Accepted: true, Batch: 'B2', Quantity: 380 }]);
    ctrl.onPost();
    expect(MessageBox.error).toHaveBeenCalledWith('scan261MultiBatch');
    expect(MessageBox.confirm).not.toHaveBeenCalled();
    expect(ODataClient.post).not.toHaveBeenCalled();
  });

  it('F13: a single-batch scan still posts after confirm', () => {
    model.setProperty('/rows', [{ Accepted: true, Batch: 'B1', Quantity: 200 }]);
    ODataClient.post.mockReturnValue(new Promise(() => {}));
    ctrl.onPost();
    confirmOk();
    expect(MessageBox.error).not.toHaveBeenCalled();
    expect(ODataClient.post).toHaveBeenCalled();
  });

  it('on confirm: sets busy during the post and posts the scanned total and batch', async () => {
    let resolvePost;
    ODataClient.post.mockReturnValue(new Promise((res) => { resolvePost = res; }));
    ctrl.onPost();
    confirmOk();
    expect(model.getProperty('/busy')).toBe(true); // disabled while posting
    expect(ODataClient.post).toHaveBeenCalledWith(BASE + '/postGoodsIssue', { reservation: '512851', item: '3', quantity: 200, batch: 'B1' });
    resolvePost({ MaterialDocument: '4900050046', MaterialDocumentYear: '2026' });
    await flush(); await flush();
    expect(model.getProperty('/busy')).toBe(false);
  });

  it('success: shows a toast and reloads the scan context (for the next partial post)', async () => {
    ODataClient.post.mockResolvedValue({ MaterialDocument: '4900050046', MaterialDocumentYear: '2026' });
    ctrl.onPost();
    confirmOk();
    await flush(); await flush();
    expect(MessageToast.show).toHaveBeenCalledWith('scan261PostSuccess');
    expect(ODataClient.get).toHaveBeenCalled(); // _load re-read scanContext
    expect(MessageBox.error).not.toHaveBeenCalled();
  });

  it('409: shows an information dialog whose Refresh action reloads the context', async () => {
    ODataClient.post.mockRejectedValue(Object.assign(new Error('already in progress'), { status: 409 }));
    ctrl.onPost();
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.information).toHaveBeenCalledTimes(1);
    expect(MessageBox.error).not.toHaveBeenCalled();
    const infoOpts = MessageBox.information.mock.calls[0][1];
    expect(infoOpts.actions).toContain('scan261Refresh');
    infoOpts.onClose('scan261Refresh');
    await flush();
    expect(ODataClient.get).toHaveBeenCalled();
  });

  it('422: shows the actionable reason returned by the service', async () => {
    ODataClient.post.mockRejectedValue(Object.assign(new Error('Batch B2 does not match the reservation batch B1'), { status: 422 }));
    ctrl.onPost();
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.error).toHaveBeenCalledWith('Batch B2 does not match the reservation batch B1');
    expect(ODataClient.get).not.toHaveBeenCalled(); // no reload, no blind retry
  });

  it('unknown outcome (no HTTP status: network/timeout): warns and does not offer a blind retry', async () => {
    ODataClient.post.mockRejectedValue(new Error('Failed to fetch')); // no .status
    ctrl.onPost();
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.warning).toHaveBeenCalledWith('scan261PostUnknown');
    expect(ODataClient.get).not.toHaveBeenCalled();
    expect(model.getProperty('/busy')).toBe(false);
  });

  it('A6: a 502 (CAP->SAP timeout) is also the unknown outcome: warning, no error dialog, no retry', async () => {
    ODataClient.post.mockRejectedValue(Object.assign(new Error('… failed: timeout'), { status: 502 }));
    ctrl.onPost();
    confirmOk();
    await flush(); await flush();
    expect(MessageBox.warning).toHaveBeenCalledWith('scan261PostUnknown');
    expect(MessageBox.error).not.toHaveBeenCalled();
    expect(ODataClient.get).not.toHaveBeenCalled();
  });
});
