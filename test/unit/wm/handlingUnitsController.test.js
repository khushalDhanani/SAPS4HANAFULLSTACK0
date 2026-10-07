/**
 * Focused tests for the HandlingUnits controller print/download logic that is pure enough to exercise
 * without a UI5 runtime: the large-job confirmation thresholds (button actions), the row-button -> HU
 * mapping (from the binding context, never a row index), and the /printing busy toggle.
 */
const P = '../../../app/fiori-app/webapp/modules/wm/handling-unit/util/';

// Real Barcode + HuLabelPrinter (prepare() is pure); everything else is mocked.
let Barcode, Printer;
global.window = global.window || {};
global.sap = { ui: { define: (d, f) => { Barcode = f(); }, require: { toUrl: () => '' } } };
require(P + 'Barcode.js');
global.sap.ui.define = (d, f) => { Printer = f(Barcode); };
require(P + 'HuLabelPrinter.js');

// Mocks shared across tests.
const ODataClient = { post: jest.fn(), get: jest.fn() };
const HuLabelPdf = { download: jest.fn(() => Promise.resolve()) };
const HuBatchReader = { read: jest.fn(() => Promise.resolve([])) };
const MessageToast = { show: jest.fn() };
const MBox = { Action: { OK: 'OK', CANCEL: 'CANCEL' }, confirm: jest.fn(), warning: jest.fn(), error: jest.fn() };
const BusyDialog = function () { return { open() {}, close() {}, setText() {}, destroy() {} }; };

// Load the controller, capturing the methods object from BaseController.extend(name, obj).
let ctrl;
const BaseController = { extend: (name, obj) => { ctrl = obj; return obj; } };
global.sap.ui.define = (deps, f) => {
    f(BaseController, function () {}, ODataClient, {}, MessageToast, MBox, BusyDialog, Printer, HuLabelPdf, HuBatchReader);
};
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/controller/HandlingUnits.controller.js');

/** A `this` whose missing members fall through to the real controller methods. */
function subject(overrides) {
    const model = { _d: {}, getProperty(p) { return this._d[p]; }, setProperty(p, v) { this._d[p] = v; } };
    const base = Object.create(ctrl);
    return Object.assign(base, {
        _model: model,
        getModel: () => model,
        getText: (k) => k,
        _labelTexts: () => ({}),
        byId: () => ({ getSelectedItems: () => [], getItems: () => [] })
    }, overrides);
}

function rowButton(huId, extra) {
    let busy = false;
    return Object.assign({
        getBindingContext: () => ({ getObject: () => ({ HandlingUnitExternalID: huId, CreationDateTime: '2026-10-06' }) }),
        setBusyIndicatorDelay() {}, getBusy: () => busy, setBusy: jest.fn((v) => { busy = v; })
    }, extra);
}

beforeEach(() => { jest.clearAllMocks(); });

describe('_confirmCount (button large-job thresholds)', () => {
    it('above the safety limit: warns and only runs on OK', () => {
        const go = jest.fn();
        subject()._confirmCount(600, false, go);
        expect(MBox.warning).toHaveBeenCalled();
        expect(go).not.toHaveBeenCalled();
        MBox.warning.mock.calls[0][1].onClose('OK');
        expect(go).toHaveBeenCalled();
    });
    it('at/under the limit with alwaysConfirm (Print All): asks "Print N?"', () => {
        const go = jest.fn();
        subject()._confirmCount(10, true, go);
        expect(MBox.confirm).toHaveBeenCalled();
        MBox.confirm.mock.calls[0][1].onClose('OK');
        expect(go).toHaveBeenCalled();
    });
    it('at/under the limit without alwaysConfirm (Download Selected): runs straight away', () => {
        const go = jest.fn();
        subject()._confirmCount(10, false, go);
        expect(MBox.confirm).not.toHaveBeenCalled();
        expect(MBox.warning).not.toHaveBeenCalled();
        expect(go).toHaveBeenCalledTimes(1);
    });
    it('does nothing for zero', () => {
        const go = jest.fn();
        subject()._confirmCount(0, true, go);
        expect(go).not.toHaveBeenCalled();
    });
});

describe('_runRowJob (row button -> that row\'s HU, from the binding context)', () => {
    it('reads exactly the row HU and outputs a label for it', async () => {
        ODataClient.post.mockResolvedValue({ Items: [{ HandlingUnitExternalID: 'HU9', MaterialName: 'Pump', SerialNumber: 'S9' }] });
        const out = jest.fn(() => Promise.resolve());
        const btn = rowButton('HU9');
        await subject()._runRowJob(btn, out);
        expect(ODataClient.post).toHaveBeenCalledWith('/odata/v4/handling-unit/labels', { handlingUnitExternalIDs: ['HU9'] });
        expect(out).toHaveBeenCalledTimes(1);
        const labels = out.mock.calls[0][0];
        expect(labels).toEqual([{ huNumber: 'HU9', materialName: 'Pump', createdDate: '06-Oct-2026', srNo: 'S9' }]);
        expect(btn.setBusy).toHaveBeenCalledWith(true);
        expect(btn.setBusy).toHaveBeenLastCalledWith(false);
    });
    it('ignores a second row job while the first is still busy (double-click guard)', async () => {
        ODataClient.post.mockResolvedValue({ Items: [{ HandlingUnitExternalID: 'HU9', MaterialName: 'Pump', SerialNumber: 'S9' }] });
        const out = jest.fn(() => Promise.resolve());
        const btn = rowButton('HU9');
        const s = subject();
        const p1 = s._runRowJob(btn, out);
        const r2 = s._runRowJob(btn, out); // second "click" before the first finished
        expect(r2).toBeUndefined();
        await p1;
        expect(out).toHaveBeenCalledTimes(1);
    });
    it('shows a toast and does not output when the HU has bad data', async () => {
        ODataClient.post.mockResolvedValue({ Items: [{ HandlingUnitExternalID: 'HÜ', MaterialName: 'x' }] }); // non-Code128 id
        const out = jest.fn();
        await subject()._runRowJob(rowButton('HÜ'), out);
        expect(out).not.toHaveBeenCalled();
        expect(MessageToast.show).toHaveBeenCalled();
    });
});

describe('/printing busy flag (disables buttons during a job)', () => {
    it('is set while a bulk job runs and cleared when it finishes', async () => {
        ODataClient.post.mockResolvedValue({ Items: [{ HandlingUnitExternalID: 'HU1', MaterialName: 'Pump', SerialNumber: '' }] });
        const s = subject();
        const out = jest.fn(() => Promise.resolve());
        const p = s._runLabelJob([{ HandlingUnitExternalID: 'HU1', CreationDateTime: '2026-10-06' }], out, 'huPrintSummary');
        expect(s._model.getProperty('/printing')).toBe(true); // set synchronously
        await p;
        expect(s._model.getProperty('/printing')).toBe(false);
        expect(out).toHaveBeenCalledTimes(1);
    });
});
