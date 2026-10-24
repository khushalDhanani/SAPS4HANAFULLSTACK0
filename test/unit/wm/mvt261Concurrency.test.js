/**
 * test/unit/wm/mvt261Concurrency.test.js
 * Comprehensive concurrency and failure-mode regression tests for Movement Type 261 Goods Issue:
 *
 * 1. User A (POST 5) vs User B (POST 5) simultaneously:
 *    - Open quantity = 5
 *    - Exactly one valid posting
 *    - No duplicate Goods Issue
 *    - Correct attempt state in GoodsIssueAttemptStore
 *    - Subsequent post refused when open quantity is exhausted
 * 2. Timeout handling (ETIMEDOUT / connection abort -> status 'unconfirmed', blocks duplicate retry)
 * 3. HTTP 502 Bad Gateway (upstream proxy failure -> status 'unconfirmed', blocks blind retry)
 * 4. HTTP 504 Gateway Timeout (SAP timeout -> status 'unconfirmed', blocks blind retry)
 * 5. SAP success + DB status failure (SAP posts doc, DB setStatus fails -> logs critical reconciliation error, returns doc)
 * 6. Client retry dynamics (422 rejection allows reclaim; 502/504 unconfirmed blocks blind retry; not_posted recheck allows reclaim)
 * 7. Double-click prevention (UI busy guard + backend atomic createOrGet claim)
 * 8. Browser refresh dynamics (re-read scanContext after posting shows open quantity 0 and disables post button; 409 dialog refresh action)
 */

const Mvt261Service = require('../../../srv/wm/mvt261/service');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const LOG = require('../../../srv/common/logger')('mvt261-service');

// Controller harness setup for UI concurrency / double-click / refresh tests
let Controller;
const BaseController = { extend: (_name, obj) => { Controller = obj; return obj; } };
const JSONModel = function (initial) {
  let data = Object.assign({}, initial);
  const norm = (p) => (p && p.charAt(0) === '/' ? p.slice(1) : p);
  return {
    setData: (d) => { data = Object.assign({}, d); },
    getData: () => data,
    getProperty: (p) => {
      const parts = norm(p).split('/');
      let curr = data;
      for (const part of parts) {
        if (curr === null || curr === undefined) return undefined;
        curr = curr[part];
      }
      return curr;
    },
    setProperty: (p, v) => {
      const parts = norm(p).split('/');
      if (parts.length === 1) {
        data[parts[0]] = v;
      } else {
        let curr = data;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!curr[parts[i]]) curr[parts[i]] = {};
          curr = curr[parts[i]];
        }
        curr[parts[parts.length - 1]] = v;
      }
    }
  };
};
const ODataClient = { get: jest.fn(), post: jest.fn() };
const BarcodeScanService = { attachHardwareScanner: jest.fn(), detachHardwareScanner: jest.fn() };
const ScanSession = { total: jest.fn(() => 5), drums: () => 1, deviations: () => 0, units: () => [], state: () => 'Covered' };
const MessageBox = {
  confirm: jest.fn(), information: jest.fn(), error: jest.fn(), warning: jest.fn(), success: jest.fn(),
  Action: { OK: 'OK', CANCEL: 'CANCEL', CLOSE: 'CLOSE' }
};
const MessageToast = { show: jest.fn() };

global.sap = { ui: { define: (_deps, factory) => factory(BaseController, JSONModel, ODataClient, BarcodeScanService, ScanSession, MessageBox, MessageToast) } };
delete require.cache[require.resolve('../../../app/fiori-app/webapp/modules/wm/mvt261/controller/Scan261.controller')];
require('../../../app/fiori-app/webapp/modules/wm/mvt261/controller/Scan261.controller');

describe('Movement 261 Concurrency and Edge Case Regression Tests', () => {
  let svc;
  let handlers;

  const req = (data, userId = 'user-a') => ({
    data: { movementType: '261', orderId: '1002707', orderType: 'ZP01', ...data },
    user: { id: userId, is: (r) => r === 'WarehouseClerk' || r === 'Admin' },
    error: jest.fn((status, msg) => {
      const err = new Error(msg);
      err.status = status;
      return err;
    }),
    warn: jest.fn()
  });

  const cycleOf = (over = {}) => ({
    Reservation: '512851',
    ReservationItem: '3',
    ProductionOrder: '1002707',
    OrderType: 'ZP01',
    Material: '1000001001',
    Plant: '1130',
    StorageLocation: 'CS02',
    Unit: 'KG',
    Batch: 'B1',
    OpenQuantity: 5,
    IssuableQuantity: 5,
    OrderStatus: 'REL',
    StagingRequired: false,
    Steps: [
      { Step: 'GoodsIssue', Status: 'open', Reason: '' }
    ],
    ...over
  });

  beforeEach(() => {
    handlers = {};
    svc = new Mvt261Service();
    svc.on = (evt, fn) => { handlers[evt] = fn; };
    GoodsIssueAttemptStore.clearMemoryStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Simultaneous POST: User A (POST 5) vs User B (POST 5)', () => {
    it('when reservation quantity is 5, User A and User B posting simultaneously results in only one SAP post, one 409 rejection, no duplicate GI, and correct attempt state', async () => {
      await svc.init();

      let resolveSapPost;
      const sapPostPromise = new Promise((resolve) => {
        resolveSapPost = resolve;
      });

      // Stub revalidateStock / cycle to return open quantity = 5
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockResolvedValue({
        eligible: true,
        issuableQuantity: 5,
        reason: null,
        source: 'SAP',
        freshCycle: cycleOf({ OpenQuantity: 5 })
      });

      const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
        .mockImplementation(() => sapPostPromise);

      const userAReq = req({ reservation: '512851', item: '3', quantity: 5, batch: 'B1' }, 'user-a');
      const userBReq = req({ reservation: '512851', item: '3', quantity: 5, batch: 'B1' }, 'user-b');

      // Both users submit simultaneously
      const userAPromise = handlers.postGoodsIssue(userAReq);
      // Give p1 microtask tick to register claim in store
      await new Promise((r) => setImmediate(r));
      const userBPromise = handlers.postGoodsIssue(userBReq);

      // User B should be rejected with 409 immediately
      await userBPromise;
      expect(userBReq.error).toHaveBeenCalledWith(409, expect.stringContaining('already in progress'));
      expect(postSpy).toHaveBeenCalledTimes(1);

      // Resolve User A's SAP call
      resolveSapPost({
        MaterialDocument: '4900050046',
        MaterialDocumentYear: '2026',
        Pending: false,
        StorageUnitPostingSemantics: 'OPTION_A_VALIDATION'
      });

      const userAResult = await userAPromise;
      expect(userAReq.error).not.toHaveBeenCalled();
      expect(userAResult).toMatchObject({
        MaterialDocument: '4900050046',
        MaterialDocumentYear: '2026',
        StorageUnitPostingSemantics: 'OPTION_A_VALIDATION'
      });

      // Assert exactly one SAP POST occurred (NO duplicate GI)
      expect(postSpy).toHaveBeenCalledTimes(1);

      // Verify attempt state in store: winning attempt is recorded as 'posted'
      const rows = Array.from(GoodsIssueAttemptStore._memoryStore.values());
      expect(rows).toHaveLength(1);
      expect(rows[0].Status).toBe('posted');
      expect(rows[0].MaterialDocument).toBe('4900050046');
      expect(rows[0].IssueQty).toBe(5);

      // Subsequent post after reservation quantity is exhausted in SAP (OpenQuantity = 0)
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockRejectedValue(
        Object.assign(new Error('Goods issue not possible: Quantity 5 exceeds the open quantity 0 KG'), { status: 422 })
      );

      const subsequentReq = req({ reservation: '512851', item: '3', quantity: 5, batch: 'B1' }, 'user-a');
      await handlers.postGoodsIssue(subsequentReq);
      expect(subsequentReq.error).toHaveBeenCalledWith(422, expect.stringContaining('Quantity 5 exceeds the open quantity 0'));
      expect(postSpy).toHaveBeenCalledTimes(1); // Still exactly 1 call
    });
  });

  describe('2. Network Timeout Handling', () => {
    it('network timeout (ETIMEDOUT / no status) sets attempt status to unconfirmed and blocks duplicate submission with 409', async () => {
      await svc.init();
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockResolvedValue({
        eligible: true,
        issuableQuantity: 5,
        freshCycle: cycleOf()
      });

      const timeoutError = new Error('connect ETIMEDOUT'); // no .status
      jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockRejectedValue(timeoutError);

      const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');
      const r1 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r1);

      expect(r1.error).toHaveBeenCalledWith(500, expect.stringContaining('ETIMEDOUT'));
      expect(statusSpy).toHaveBeenCalledWith(expect.stringMatching(/^GI/), 'unconfirmed', expect.objectContaining({
        LastError: expect.stringContaining('ETIMEDOUT')
      }));

      // Immediate retry while attempt is unconfirmed is blocked with 409
      const r2 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r2);
      expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    });
  });

  describe('3. HTTP 502 Bad Gateway Handling', () => {
    it('502 Bad Gateway marks attempt status as unconfirmed and prevents blind retry', async () => {
      await svc.init();
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockResolvedValue({
        eligible: true,
        issuableQuantity: 5,
        freshCycle: cycleOf()
      });

      const badGatewayError = Object.assign(new Error('Bad Gateway: Cloud Connector unreachable'), { status: 502 });
      jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockRejectedValue(badGatewayError);

      const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');
      const r1 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r1);

      expect(r1.error).toHaveBeenCalledWith(502, expect.stringContaining('Bad Gateway'));
      expect(statusSpy).toHaveBeenCalledWith(expect.stringMatching(/^GI/), 'unconfirmed', expect.objectContaining({
        LastError: expect.stringContaining('Bad Gateway')
      }));

      // Subsequent attempt blocked with 409
      const r2 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r2);
      expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    });
  });

  describe('4. HTTP 504 Gateway Timeout Handling', () => {
    it('504 Gateway Timeout marks attempt status as unconfirmed and prevents duplicate post', async () => {
      await svc.init();
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockResolvedValue({
        eligible: true,
        issuableQuantity: 5,
        freshCycle: cycleOf()
      });

      const gatewayTimeoutError = Object.assign(new Error('Gateway Timeout on SAP backend'), { status: 504 });
      jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockRejectedValue(gatewayTimeoutError);

      const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');
      const r1 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r1);

      expect(r1.error).toHaveBeenCalledWith(504, expect.stringContaining('Gateway Timeout'));
      expect(statusSpy).toHaveBeenCalledWith(expect.stringMatching(/^GI/), 'unconfirmed', expect.objectContaining({
        LastError: expect.stringContaining('Gateway Timeout')
      }));

      // Subsequent attempt blocked with 409
      const r2 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r2);
      expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    });
  });

  describe('5. SAP Success + DB Status Failure', () => {
    it('when SAP POST succeeds but GoodsIssueAttemptStore.setStatus fails, logs critical reconciliation error without swallowing and returns SAP document', async () => {
      await svc.init();
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockResolvedValue({
        eligible: true,
        issuableQuantity: 5,
        freshCycle: cycleOf()
      });

      jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({
        MaterialDocument: '4900050046',
        MaterialDocumentYear: '2026',
        Pending: false,
        StorageUnitPostingSemantics: 'OPTION_A_VALIDATION'
      });

      const logSpy = jest.spyOn(LOG, 'error').mockImplementation(() => {});
      jest.spyOn(GoodsIssueAttemptStore, 'setStatus').mockRejectedValueOnce(new Error('DB connection pool exhausted'));

      const r = req({ reservation: '512851', item: '3', quantity: 5 });
      const res = await handlers.postGoodsIssue(r);

      // Must log critical reconciliation error
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Critical reconciliation error: failed to persist attempt status 'posted'"),
        expect.stringContaining('DB connection pool exhausted'),
        expect.anything()
      );

      // Must NOT fail the request to client since SAP has committed the material document
      expect(r.error).not.toHaveBeenCalled();
      expect(res).toMatchObject({
        MaterialDocument: '4900050046',
        MaterialDocumentYear: '2026'
      });
    });
  });

  describe('6. Client Retry Dynamics', () => {
    it('definite SAP rejection (422) allows re-claim and retry under new generation', async () => {
      await svc.init();
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockResolvedValue({
        eligible: true,
        issuableQuantity: 5,
        freshCycle: cycleOf()
      });

      const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
        .mockRejectedValueOnce(Object.assign(new Error('Staging shortfall of 2 KG'), { status: 422 }))
        .mockResolvedValueOnce({
          MaterialDocument: '4900050046',
          MaterialDocumentYear: '2026',
          Pending: false
        });

      // 1. Initial attempt fails with 422
      const r1 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r1);
      expect(r1.error).toHaveBeenCalledWith(422, 'Staging shortfall of 2 KG');

      // 2. Retry succeeds under new generation suffix
      const r2 = req({ reservation: '512851', item: '3', quantity: 5 });
      const res = await handlers.postGoodsIssue(r2);
      expect(r2.error).not.toHaveBeenCalled();
      expect(res).toMatchObject({ MaterialDocument: '4900050046' });
      expect(postSpy).toHaveBeenCalledTimes(2);
    });

    it('after administrative reconciliation confirms not_posted, retry reclaims key and posts successfully', async () => {
      await svc.init();
      jest.spyOn(Mvt261Adapter.prototype, 'revalidateStock').mockResolvedValue({
        eligible: true,
        issuableQuantity: 5,
        freshCycle: cycleOf()
      });

      const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
        .mockRejectedValueOnce(Object.assign(new Error('502 Bad Gateway'), { status: 502 }))
        .mockResolvedValueOnce({
          MaterialDocument: '4900050048',
          MaterialDocumentYear: '2026',
          Pending: false
        });

      // 1. Initial post fails with 502 -> status becomes unconfirmed
      const r1 = req({ reservation: '512851', item: '3', quantity: 5 });
      await handlers.postGoodsIssue(r1);

      // Verify unconfirmed
      const rows = Array.from(GoodsIssueAttemptStore._memoryStore.values());
      expect(rows[0].Status).toBe('unconfirmed');

      // 2. Admin reconciliation checks SAP and verifies no doc was created -> marks not_posted
      await GoodsIssueAttemptStore.setStatus(rows[0].ReferenceDocument, 'not_posted');

      // 3. User retries -> re-claims key under new generation and posts
      const r2 = req({ reservation: '512851', item: '3', quantity: 5 });
      const res = await handlers.postGoodsIssue(r2);
      expect(r2.error).not.toHaveBeenCalled();
      expect(res).toMatchObject({ MaterialDocument: '4900050048' });
      expect(postSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('7. Double-Click & UI Busy Protection', () => {
    it('controller sets busy flag immediately upon POST and ignores rapid second click', async () => {
      const model = new JSONModel({
        busy: false,
        ctx: { Reservation: '512851', ReservationItem: '3', Unit: 'KG', Blocked: false, StockEligibility: { eligible: true } },
        rows: [{ Accepted: true, Batch: 'B1', Quantity: 5, StorageUnit: '1000000001' }]
      });
      const ctrl = Object.create(Controller);
      ctrl.getModel = () => model;
      ctrl.getText = (k) => k;
      ctrl.byId = () => null;
      ctrl._args = { reservation: '512851', item: '3' };

      // First click: triggers confirmation
      ctrl.onPost();
      expect(MessageBox.confirm).toHaveBeenCalledTimes(1);

      // Confirm is accepted -> _doPost is called, sets busy = true
      let resolvePost;
      ODataClient.post.mockReturnValue(new Promise((res) => { resolvePost = res; }));
      MessageBox.confirm.mock.calls[0][1].onClose('OK');
      expect(model.getProperty('/busy')).toBe(true);

      // Rapid second click while in flight: MUST BE IGNORED
      ctrl.onPost();
      expect(MessageBox.confirm).toHaveBeenCalledTimes(1); // Not called again!
      expect(ODataClient.post).toHaveBeenCalledTimes(1); // Not called again!

      // Resolve the post
      resolvePost({ MaterialDocument: '4900050046', MaterialDocumentYear: '2026' });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(model.getProperty('/busy')).toBe(false);
    });
  });

  describe('8. Browser Refresh Dynamics', () => {
    it('refreshing after posting reloads scanContext with OpenQuantity 0, Blocked true, and disables post button', async () => {
      const model = new JSONModel({
        busy: false,
        ctx: null,
        rows: []
      });
      const ctrl = Object.create(Controller);
      ctrl.getModel = () => model;
      ctrl.getText = (k) => k;
      ctrl.byId = () => null;
      ctrl._args = { reservation: '512851', item: '3' };

      // Browser refresh triggers _load() querying scanContext
      ODataClient.get.mockResolvedValueOnce({
        Reservation: '512851',
        ReservationItem: '3',
        OpenQuantity: 0,
        Blocked: true,
        BlockReason: 'no open quantity remaining',
        StockEligibility: {
          eligible: false,
          reason: 'No open quantity remaining'
        },
        Units: []
      });

      await ctrl._load();
      await new Promise((r) => setImmediate(r));

      // Assert model loaded fresh context
      expect(model.getProperty('/ctx/OpenQuantity')).toBe(0);
      expect(model.getProperty('/ctx/Blocked')).toBe(true);
      expect(model.getProperty('/ctx/BlockReason')).toBe('no open quantity remaining');

      // Operator attempts to post -> blocked immediately
      ctrl.onPost();
      expect(MessageBox.confirm).not.toHaveBeenCalled();
      expect(ODataClient.post).not.toHaveBeenCalled();
    });

    it('409 information dialog offers Refresh action that reloads live SAP scanContext', async () => {
      const model = new JSONModel({
        busy: false,
        ctx: { Reservation: '512851', ReservationItem: '3', Unit: 'KG', Blocked: false, StockEligibility: { eligible: true } },
        rows: [{ Accepted: true, Batch: 'B1', Quantity: 5 }]
      });
      const ctrl = Object.create(Controller);
      ctrl.getModel = () => model;
      ctrl.getText = (k) => k;
      ctrl.byId = () => null;
      ctrl._args = { reservation: '512851', item: '3' };

      // Post receives 409
      ODataClient.post.mockRejectedValue(Object.assign(new Error('in progress'), { status: 409 }));
      ctrl.onPost();
      MessageBox.confirm.mock.calls[0][1].onClose('OK');
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(MessageBox.information).toHaveBeenCalledTimes(1);
      const infoOpts = MessageBox.information.mock.calls[0][1];
      expect(infoOpts.actions).toContain('scan261Refresh');

      // Operator clicks Refresh on dialog -> triggers _load
      ODataClient.get.mockResolvedValueOnce({
        Reservation: '512851',
        ReservationItem: '3',
        OpenQuantity: 0,
        Blocked: true
      });
      infoOpts.onClose('scan261Refresh');
      await new Promise((r) => setImmediate(r));

      expect(ODataClient.get).toHaveBeenCalledWith('/odata/v4/mvt261/scanContext(reservation=\'512851\',item=\'3\')');
    });
  });
});
