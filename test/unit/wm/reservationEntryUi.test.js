/**
 * Unit tests for Reservation Entry UI Controllers and Frontend Services
 * Testing:
 * - Movement-type specific dynamic defaults and field validations (201, 241, 311, 301)
 * - Save orchestration (Reservation + Auto TR creation)
 * - Error handling & validation state
 * - Status badges & description formatters
 * - List search & navigation
 */

const path = require('path');

describe('ReservationEntry UI Controller & Logic Tests', () => {
    let detailCtrl;
    let listCtrl;
    const BaseController = { extend: (name, obj) => { detailCtrl = obj; return obj; } };
    const ListBaseController = { extend: (name, obj) => { listCtrl = obj; return obj; } };

    const MessageToast = { show: jest.fn() };
    const MessageBox = {
        success: jest.fn((msg, opts) => { if (opts && opts.onClose) opts.onClose(); }),
        information: jest.fn((msg, opts) => { if (opts && opts.onClose) opts.onClose(); }),
        error: jest.fn(),
        warning: jest.fn((msg, opts) => { if (opts && opts.onClose) opts.onClose(); }),
        Action: { CLOSE: 'CLOSE' }
    };
    const mockValueHelpService = {
        openValueHelp: jest.fn(),
        applySuggestionFilter: jest.fn()
    };
    const MockFilter = function (path, op, val) { this.path = path; this.op = op; this.val = val; };
    const MockFilterOperator = { EQ: 'EQ', Contains: 'Contains' };

    function FakeJSONModel(initialData) {
        this._data = Object.assign({}, initialData);
        this.setData = function (d) { this._data = Object.assign({}, d); };
        this.getData = function () { return this._data; };
        this.getProperty = function (path) {
            const prop = path.replace(/^\//, '');
            return this._data[prop];
        };
        this.setProperty = function (path, val) {
            const prop = path.replace(/^\//, '');
            this._data[prop] = val;
        };
    }

    function createDetailSubject(serviceMock, routerMock) {
        const models = {};
        const base = Object.create(detailCtrl);
        return Object.assign(base, {
            _oService: serviceMock || { createReservationEntry: jest.fn(), getEntry: jest.fn() },
            _oViewModel: new FakeJSONModel({ isCreate: true, busy: false, errorMessage: '', successMessage: '' }),
            _oCreateModel: new FakeJSONModel(base._getDefaultCreateData()),
            _oDetailModel: new FakeJSONModel({}),
            getView: () => ({
                setModel: (m, name) => { models[name] = m; },
                getModel: (name) => models[name]
            }),
            getRouter: () => routerMock || { navTo: jest.fn() }
        });
    }

    beforeAll(() => {
        global.window = global.window || {};
        global.sap = {
            ui: {
                define: (deps, factory) => {
                    // Check which module is being required
                    if (deps.some(d => d.includes('BaseController'))) {
                        factory(BaseController, FakeJSONModel, MessageBox, MessageToast, function () {}, mockValueHelpService, MockFilter, MockFilterOperator);
                    } else {
                        factory(ListBaseController, FakeJSONModel, MessageToast, function () {});
                    }
                }
            }
        };

        // Load detail controller
        require('../../../app/fiori-app/webapp/modules/wm/reservation-entry/controller/ReservationEntryDetail.controller.js');
        // Load list controller
        require('../../../app/fiori-app/webapp/modules/wm/reservation-entry/controller/ReservationEntryList.controller.js');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('ReservationEntryDetail: Defaults & Movement Type Switching', () => {
        const switchTo = (subject, mvt) => subject.onMovementTypeChange({ getParameter: (p) => p === 'selectedItem' ? { getKey: () => mvt } : null });
        const BUSINESS_FIELDS = ['Plant', 'StorageLocation', 'WarehouseNumber', 'Material', 'MaterialName', 'Quantity', 'Unit', 'Batch', 'ReceivingStorageLocation', 'ReceivingPlant', 'CostCenter', 'AssetNo', 'SubNumber', 'OrderType', 'OrderID'];

        it('D7: the create form carries no master-data defaults (only the first movement type of the select)', () => {
            const subject = createDetailSubject();
            const defaults = subject._getDefaultCreateData();
            expect(defaults.MovementType).toBe('');
            for (const f of BUSINESS_FIELDS) expect(`${f}=${defaults[f]}`).toBe(`${f}=`);
            expect(Object.keys(defaults).sort()).toEqual(['MovementType', ...BUSINESS_FIELDS].sort());
        });

        it.each(['201', '241', '261', '301', '311'])('D7: switching to %s prefills no business value', (mvt) => {
            const subject = createDetailSubject();
            switchTo(subject, mvt);
            expect(subject._oCreateModel.getProperty('/MovementType')).toBe(mvt);
            for (const f of BUSINESS_FIELDS) expect(`${f}=${subject._oCreateModel.getProperty('/' + f)}`).toBe(`${f}=`);
        });

        it('switching movement type clears the fields the new type does not use and keeps the ones it does', () => {
            const subject = createDetailSubject();
            subject._oCreateModel.setProperty('/CostCenter', 'CC1');
            subject._oCreateModel.setProperty('/AssetNo', 'A1');
            subject._oCreateModel.setProperty('/SubNumber', '0001');
            subject._oCreateModel.setProperty('/OrderType', 'OT');
            subject._oCreateModel.setProperty('/OrderID', 'O1');
            subject._oCreateModel.setProperty('/ReceivingPlant', 'P2');
            subject._oCreateModel.setProperty('/ReceivingStorageLocation', 'S2');
            switchTo(subject, '201');
            expect(['CostCenter', 'AssetNo', 'SubNumber', 'OrderType', 'OrderID', 'ReceivingPlant', 'ReceivingStorageLocation'].map((f) => subject._oCreateModel.getProperty('/' + f))).toEqual(['CC1', '', '', '', '', '', '']);
            subject._oCreateModel.setProperty('/ReceivingPlant', 'P2');
            subject._oCreateModel.setProperty('/ReceivingStorageLocation', 'S2');
            switchTo(subject, '301');
            expect(['CostCenter', 'ReceivingPlant', 'ReceivingStorageLocation'].map((f) => subject._oCreateModel.getProperty('/' + f))).toEqual(['', 'P2', 'S2']);
        });

        it('switches to Movement 311: a receiving SLoc equal to the issuing SLoc is cleared, never replaced by a guessed one', () => {
            const subject = createDetailSubject();
            subject._oCreateModel.setProperty('/StorageLocation', 'ST02');
            subject._oCreateModel.setProperty('/ReceivingStorageLocation', 'ST02');
            switchTo(subject, '311');
            expect(subject._oCreateModel.getProperty('/ReceivingStorageLocation')).toBe('');
            subject._oCreateModel.setProperty('/ReceivingStorageLocation', 'HS01');
            switchTo(subject, '311');
            expect(subject._oCreateModel.getProperty('/ReceivingStorageLocation')).toBe('HS01');
        });

        it('D7: the create view and i18n contain no sample master-data placeholders', () => {
            const fs = require('fs');
            const path = require('path');
            const base = path.join(__dirname, '../../../app/fiori-app/webapp');
            const view = fs.readFileSync(path.join(base, 'modules/wm/reservation-entry/view/ReservationEntryDetail.view.xml'), 'utf8');
            expect(view.match(/placeholder="[^{][^"]*"/g) || []).toEqual([]);
            for (const f of ['i18n/i18n.properties', 'i18n/i18n_en.properties']) {
                const bundle = fs.readFileSync(path.join(base, f), 'utf8');
                expect(bundle.match(/^resPlaceholder\w+=.*(e\.g\.|\b1120\b|\bCS01\b|\bST02\b|\bZEMP\b|1011201301|400092|IN26001170).*$/m)).toBeNull();
            }
            const ctrl = fs.readFileSync(path.join(base, 'modules/wm/reservation-entry/controller/ReservationEntryDetail.controller.js'), 'utf8');
            expect(ctrl.match(/1120|CS01|ST02|1130|1000000045|1011201301|400092|ZEMP|Raw Material/g)).toBeNull();
        });
    });

    describe('ReservationEntryDetail: Validations per Movement Type', () => {
        let subject;
        beforeEach(() => {
            subject = createDetailSubject();
        });

        it('rejects missing MovementType', () => {
            const data = { MovementType: '', Plant: '1120', StorageLocation: 'HS01', Material: '1000000045', Quantity: 5 };
            const error = subject.validateForm(data);
            expect(error).toMatch(/Movement Type is required/);
        });

        it('rejects missing Plant or StorageLocation', () => {
            expect(subject.validateForm({ MovementType: '311', Plant: '', StorageLocation: 'HS01', Material: '100', Quantity: 1 }))
                .toMatch(/Plant is required/);
            expect(subject.validateForm({ MovementType: '311', Plant: '1120', StorageLocation: '', Material: '100', Quantity: 1 }))
                .toMatch(/Issuing Storage Location is required/);
        });

        it('rejects zero or negative Quantity', () => {
            expect(subject.validateForm({ MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 0 }))
                .toMatch(/Quantity must be greater than 0/);
            expect(subject.validateForm({ MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: -5 }))
                .toMatch(/Quantity must be greater than 0/);
        });

        it('validates 201: requires Cost Center', () => {
            const dataWithoutCC = { MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, CostCenter: '' };
            expect(subject.validateForm(dataWithoutCC)).toMatch(/Cost Center is mandatory for Movement Type 201/);

            const dataWithCC = { MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, CostCenter: '1011201301' };
            expect(subject.validateForm(dataWithCC)).toBeNull();
        });

        it('validates 241: requires Asset Number', () => {
            const dataWithoutAsset = { MovementType: '241', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, AssetNo: '' };
            expect(subject.validateForm(dataWithoutAsset)).toMatch(/Asset Number is mandatory for Movement Type 241/);

            const dataWithAsset = { MovementType: '241', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, AssetNo: '000000400092', SubNumber: '0000' };
            expect(subject.validateForm(dataWithAsset)).toBeNull();
            expect(subject.validateForm(Object.assign({}, dataWithAsset, { SubNumber: '' }))).toMatch(/Sub-number is mandatory for Movement Type 241/);
        });

        it('validates 311: requires Receiving Storage Location and must differ from Issuing SLoc', () => {
            const dataNoRec = { MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingStorageLocation: '' };
            expect(subject.validateForm(dataNoRec)).toMatch(/Receiving Storage Location is mandatory for Movement Type 311/);

            const dataSameRec = { MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingStorageLocation: 'HS01' };
            expect(subject.validateForm(dataSameRec)).toMatch(/Receiving Storage Location must be different from Issuing Storage Location/);

            const dataValid = { MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingStorageLocation: 'CS01' };
            expect(subject.validateForm(dataValid)).toBeNull();
        });

        it('validates 301: requires Receiving Plant, Receiving SLoc, and Plant must differ from Issuing Plant', () => {
            const dataNoPlant = { MovementType: '301', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingPlant: '', ReceivingStorageLocation: 'CS01' };
            expect(subject.validateForm(dataNoPlant)).toMatch(/Receiving Plant is mandatory for Movement Type 301/);

            const dataSamePlant = { MovementType: '301', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingPlant: '1120', ReceivingStorageLocation: 'CS01' };
            expect(subject.validateForm(dataSamePlant)).toMatch(/Receiving Plant must be different from Issuing Plant/);

            const dataNoSLoc = { MovementType: '301', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingPlant: '1130', ReceivingStorageLocation: '' };
            expect(subject.validateForm(dataNoSLoc)).toMatch(/Receiving Storage Location is mandatory for Movement Type 301/);

            const dataValid = { MovementType: '301', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingPlant: '1130', ReceivingStorageLocation: 'CS01' };
            expect(subject.validateForm(dataValid)).toBeNull();
        });

        it('validates 261: requires Order Type, Internal Order number, and rejects non-261 fields', () => {
            const dataNoOrderType = { MovementType: '261', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, OrderType: '', OrderID: '1007' };
            expect(subject.validateForm(dataNoOrderType)).toMatch(/Order Type is mandatory for Movement Type 261/);

            const dataNoOrderId = { MovementType: '261', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, OrderType: 'ZEMP', OrderID: '' };
            expect(subject.validateForm(dataNoOrderId)).toMatch(/Internal Order number is mandatory for Movement Type 261/);

            const dataWithCC = { MovementType: '261', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, OrderType: 'ZEMP', OrderID: '1007', CostCenter: '1011201301' };
            expect(subject.validateForm(dataWithCC)).toMatch(/Cost Center must be empty for Movement Type 261/);

            const dataWithAsset = { MovementType: '261', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, OrderType: 'ZEMP', OrderID: '1007', AssetNo: '400092' };
            expect(subject.validateForm(dataWithAsset)).toMatch(/Asset must be empty for Movement Type 261/);

            const dataWithRecPlant = { MovementType: '261', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, OrderType: 'ZEMP', OrderID: '1007', ReceivingPlant: '1130' };
            expect(subject.validateForm(dataWithRecPlant)).toMatch(/Receiving Plant must be empty for Movement Type 261/);

            const dataWithRecSLoc = { MovementType: '261', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, OrderType: 'ZEMP', OrderID: '1007', ReceivingStorageLocation: 'ST02' };
            expect(subject.validateForm(dataWithRecSLoc)).toMatch(/Receiving Storage Location must be empty for Movement Type 261/);

            const dataValid = { MovementType: '261', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, OrderType: 'ZEMP', OrderID: '1007' };
            expect(subject.validateForm(dataValid)).toBeNull();
        });
    });

    describe('ReservationEntryDetail: Save & Auto-TR Orchestration', () => {
        it('blocks onSave if form validation fails and displays error message', () => {
            const serviceMock = { createReservationEntry: jest.fn() };
            const subject = createDetailSubject(serviceMock);

            // D7: the form starts empty, so fill the business fields and make only the quantity invalid
            subject._oCreateModel.setData({ MovementType: '311', Plant: '1120', StorageLocation: 'CS01', Material: '100', Unit: 'KG', ReceivingStorageLocation: 'ST02', Quantity: 0 });
            subject.onSave();

            expect(serviceMock.createReservationEntry).not.toHaveBeenCalled();
            expect(subject._oViewModel.getProperty('/errorMessage')).toMatch(/Quantity must be greater than 0/);
        });

        it('calls createReservationEntry, shows success with Auto-TR, and navigates to detail', async () => {
            const serviceMock = {
                createReservationEntry: jest.fn().mockResolvedValue({
                    ReservationNo: '0000004921',
                    ReservationItem: '0001',
                    TransferRequirement: '0000001842',
                    Status_code: '02'
                })
            };
            const routerMock = { navTo: jest.fn() };
            const subject = createDetailSubject(serviceMock, routerMock);

            // Set valid 311 data
            subject._oCreateModel.setData({
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'HS01',
                Material: '1000000045',
                MaterialName: 'Raw Mat 45',
                Quantity: 10,
                Unit: 'NOS',
                ReceivingStorageLocation: 'CS01',
                WarehouseNumber: 'W01'
            });

            await subject.onSave();

            expect(serviceMock.createReservationEntry).toHaveBeenCalledWith(expect.objectContaining({
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'HS01',
                Material: '1000000045',
                Quantity: 10,
                ReceivingStorageLocation: 'CS01'
            }));

            expect(MessageBox.success).toHaveBeenCalledWith(
                'Reservation 4921 created in SAP. Transfer Requirement 1842 created.',
                expect.any(Object)
            );

            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000004921',
                ReservationItem: '0001'
            });
        });

        it('calls createReservationEntry with deferred TR (status 01), shows an information (not success) dialog with the note, and navigates', async () => {
            const serviceMock = {
                createReservationEntry: jest.fn().mockResolvedValue({
                    ReservationNo: '0000004922',
                    ReservationItem: '0001',
                    TransferRequirement: '',
                    Status_code: '01',
                    ErrorMessage: 'TR deferred: restricted under SAP Note 2295840 (use LB01 or deploy ZWM_TR_CREATE)'
                })
            };
            const routerMock = { navTo: jest.fn() };
            const subject = createDetailSubject(serviceMock, routerMock);

            subject._oCreateModel.setData({
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'CS01',
                Material: '1000000045',
                Quantity: 10,
                Unit: 'KG',
                ReceivingStorageLocation: 'ST02',
                WarehouseNumber: 'W01'
            });

            await subject.onSave();

            expect(serviceMock.createReservationEntry).toHaveBeenCalled();
            expect(MessageBox.success).not.toHaveBeenCalled();
            expect(MessageBox.information).toHaveBeenCalledWith(
                'Reservation 4922 created in SAP. No Transfer Requirement yet: TR deferred: restricted under SAP Note 2295840 (use LB01 or deploy ZWM_TR_CREATE)',
                expect.any(Object)
            );
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000004922',
                ReservationItem: '0001'
            });
        });

        it('Step 7.9: status 11 (reservation created, TR failed) is a warning with the retry path, never "Success"', async () => {
            const serviceMock = { createReservationEntry: jest.fn().mockResolvedValue({ ReservationNo: '0000004923', ReservationItem: '0001', TransferRequirement: '', Status_code: '11', ErrorStep: 'LB01', ErrorMessage: 'TR creation failed in SAP backend: no quant' }) };
            const routerMock = { navTo: jest.fn() };
            const subject = createDetailSubject(serviceMock, routerMock);
            subject._oCreateModel.setData({ MovementType: '311', Plant: '1120', StorageLocation: 'CS01', Material: '1000000045', Quantity: 1, Unit: 'KG', ReceivingStorageLocation: 'ST02' });
            await subject.onSave();
            expect(MessageBox.success).not.toHaveBeenCalled();
            expect(MessageBox.warning).toHaveBeenCalledWith(
                'Reservation 4923 was created in SAP, but the Transfer Requirement was NOT created: TR creation failed in SAP backend: no quant Use Retry on the reservation page (step LB01).',
                expect.any(Object)
            );
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', { ReservationNo: '0000004923', ReservationItem: '0001' });
        });

        it('Step 7.9: a replayed request that is already further along is described by its status, not as created', () => {
            const subject = createDetailSubject();
            expect(subject.describeCreateResult({ ReservationNo: '0000004924', Status_code: '05', TransferRequirement: '0000001843' }))
                .toEqual({ kind: 'information', text: "Reservation 4924 is already at status 'Goods Issue Posted'." });
            expect(subject.describeCreateResult({ ReservationNo: '0000004925', Status_code: '12', ErrorMessage: 'L3 007' }))
                .toEqual({ kind: 'warning', text: "Reservation 4925 is already at status 'TO Creation Error' (retryable from the reservation page): L3 007" });
        });

        it('Step 7.9: a backend error that names a reservation keeps the number and offers to open it', async () => {
            const serviceMock = { createReservationEntry: jest.fn().mockRejectedValue(Object.assign(new Error('Reservation 777077/0001 was created in SAP but could not be recorded locally (DB down). Open reservation 777077 in the app to import it; do not create it again.'), { status: 500 })) };
            const routerMock = { navTo: jest.fn() };
            const subject = createDetailSubject(serviceMock, routerMock);
            subject._oCreateModel.setData({ MovementType: '311', Plant: '1120', StorageLocation: 'CS01', Material: '1000000045', Quantity: 1, Unit: 'KG', ReceivingStorageLocation: 'ST02' });
            await subject.onSave();
            expect(subject._oViewModel.getProperty('/errorMessage')).toMatch(/could not be recorded locally/);
            expect(MessageBox.error).toHaveBeenCalledWith(expect.stringContaining('777077'), expect.objectContaining({ actions: ['Open reservation 777077', 'CLOSE'], emphasizedAction: 'Open reservation 777077' }));
            MessageBox.error.mock.calls[0][1].onClose('Open reservation 777077');
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', { ReservationNo: '777077', ReservationItem: '0001' });
            expect(subject.reservationNumberFromError('BAPI_RESERVATION_CREATE1 failed: Deficit of stock')).toBe('');
            expect(subject.reservationNumberFromError('An identical reservation request is still in progress (attempt x). SAP reservation 777078 belongs to that attempt.')).toBe('777078');
        });

        it('Step 7.9: a second click while the first save is in flight does not submit again', async () => {
            let resolveFirst;
            const serviceMock = { createReservationEntry: jest.fn(() => new Promise((r) => { resolveFirst = r; })) };
            const subject = createDetailSubject(serviceMock, { navTo: jest.fn() });
            subject._oCreateModel.setData({ MovementType: '311', Plant: '1120', StorageLocation: 'CS01', Material: '1000000045', Quantity: 1, Unit: 'KG', ReceivingStorageLocation: 'ST02' });
            const first = subject.onSave();
            expect(subject._oViewModel.getProperty('/busy')).toBe(true);
            subject.onSave();
            expect(serviceMock.createReservationEntry).toHaveBeenCalledTimes(1);
            const sAttempt = serviceMock.createReservationEntry.mock.calls[0][0].ClientAttemptId;
            expect(sAttempt).toBeTruthy();
            resolveFirst({ ReservationNo: '0000004926', ReservationItem: '0001', TransferRequirement: '0000001844', Status_code: '02' });
            await first;
            expect(subject._sClientAttemptId).not.toBe(sAttempt); // next submit is a new attempt
        });

        it('Step 7.9: formatStatusRetryable marks exactly the retryable error statuses', () => {
            const subject = createDetailSubject();
            expect(['01', '02', '03', '04', '05', '99'].map(subject.formatStatusRetryable)).toEqual([false, false, false, false, false, false]);
            expect(['11', '12', '13', '90'].map(subject.formatStatusRetryable)).toEqual([true, true, true, true]);
        });

        it('handles backend creation error cleanly with MessageBox.error', async () => {
            const serviceMock = {
                createReservationEntry: jest.fn().mockRejectedValue(new Error('S/4HANA BAPI_RESERVATION_CREATE1 failed: Material locked'))
            };
            const subject = createDetailSubject(serviceMock);

            subject._oCreateModel.setData({
                MovementType: '201',
                Plant: '1120',
                StorageLocation: 'HS01',
                Material: '1000000045',
                Quantity: 10,
                CostCenter: '1011201301'
            });

            await subject.onSave();

            expect(subject._oViewModel.getProperty('/busy')).toBe(false);
            expect(subject._oViewModel.getProperty('/errorMessage')).toMatch(/Material locked/);
            expect(MessageBox.error).toHaveBeenCalledWith(expect.stringContaining('Material locked'));
        });

        it('saves Movement 261 with mandatory OrderType and OrderID in payload', async () => {
            const serviceMock = {
                createReservationEntry: jest.fn().mockResolvedValue({
                    ReservationNo: '0000529261',
                    ReservationItem: '0001',
                    TransferRequirement: '0001000861',
                    Status_code: '02'
                })
            };
            const routerMock = { navTo: jest.fn() };
            const subject = createDetailSubject(serviceMock, routerMock);

            subject._oCreateModel.setData({
                MovementType: '261',
                Plant: '1120',
                StorageLocation: 'CS01',
                Material: '1000000045',
                MaterialName: 'Raw Material 45',
                Quantity: 10,
                Unit: 'KG',
                OrderType: 'ZEMP',
                OrderID: '1007'
            });

            await subject.onSave();

            expect(serviceMock.createReservationEntry).toHaveBeenCalledWith(expect.objectContaining({
                MovementType: '261',
                Plant: '1120',
                StorageLocation: 'CS01',
                Material: '1000000045',
                Quantity: 10,
                Unit: 'KG',
                OrderType: 'ZEMP',
                OrderID: '1007'
            }));
            expect(MessageBox.success).toHaveBeenCalledWith(
                'Reservation 529261 created in SAP. Transfer Requirement 1000861 created.',
                expect.any(Object)
            );
        });

        it('handles onOrderTypeSelect and onInternalOrderSelect in controller', () => {
            const subject = createDetailSubject();
            subject.onOrderTypeSelect({
                getSource: () => ({ getId: () => 'inputOrderType', setValueState: jest.fn() }),
                getParameter: () => ({ getKey: () => 'ZEMP' })
            });
            expect(subject._oCreateModel.getProperty('/OrderType')).toBe('ZEMP');

            subject.onInternalOrderSelect({
                getSource: () => ({ getId: () => 'inputOrderId', setValueState: jest.fn() }),
                getParameter: () => ({ getKey: () => '1007' })
            });
            expect(subject._oCreateModel.getProperty('/OrderID')).toBe('1007');
        });
    });

    describe('ReservationEntry: Formatters', () => {
        it('formats status codes to readable text, state, and icon', () => {
            expect(detailCtrl.formatStatusText('01')).toBe('Reservation Created');
            expect(detailCtrl.formatStatusText('02')).toBe('TR Auto-Created');
            expect(detailCtrl.formatStatusText('03')).toBe('TO Created');
            expect(detailCtrl.formatStatusText('04')).toBe('TO Confirmed');
            expect(detailCtrl.formatStatusText('05')).toBe('Goods Issue Posted');
            expect(detailCtrl.formatStatusText('90')).toBe('Goods Issue Error');
            expect(detailCtrl.formatStatusText('99')).toBe('Cancelled / Reversed');

            expect(detailCtrl.formatStatusState('01')).toBe('Information');
            expect(detailCtrl.formatStatusState('02')).toBe('Warning');
            expect(detailCtrl.formatStatusState('05')).toBe('Success');
            expect(detailCtrl.formatStatusState('90')).toBe('Error');
            expect(detailCtrl.formatStatusState('99')).toBe('Error');

            expect(detailCtrl.formatStatusIcon('01')).toBe('sap-icon://create');
            expect(detailCtrl.formatStatusIcon('02')).toBe('sap-icon://shipping-status');
            expect(detailCtrl.formatStatusIcon('05')).toBe('sap-icon://sys-enter-2');
        });

        it('formats movement type descriptions', () => {
            expect(detailCtrl.formatMovementTypeDesc('311')).toMatch(/Storage Location Transfer/);
            expect(detailCtrl.formatMovementTypeDesc('201')).toMatch(/Cost Center/);
            expect(detailCtrl.formatMovementTypeDesc('241')).toMatch(/Asset/);
            expect(detailCtrl.formatMovementTypeDesc('301')).toMatch(/Plant to Plant/);
        });
    });

    describe('ReservationEntryList: Search & Navigation', () => {
        it('filters entries when search query is entered', () => {
            const all = [
                { ReservationNo: '0000001001', Material: '1000000045', MaterialName: 'Pump', MovementType: '311', TransferRequirement: '101' },
                { ReservationNo: '0000001002', Material: '1000000046', MaterialName: 'Valve', MovementType: '201', TransferRequirement: '102' }
            ];

            const viewModel = new FakeJSONModel({
                allEntries: all,
                entries: all
            });

            const listSubject = Object.assign(Object.create(listCtrl), {
                _oViewModel: viewModel
            });

            // Search by Material Name
            listSubject.onSearchFieldSearch({ getParameter: () => 'Pump' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000001001');

            // Search by Reservation No
            listSubject.onSearchFieldSearch({ getParameter: () => '1002' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000001002');

            // Clear search
            listSubject.onSearchFieldSearch({ getParameter: () => '' });
            expect(viewModel.getProperty('/entries')).toHaveLength(2);
        });

        it('matches reservation number across padded (0000527594) and unpadded (527594) formats', () => {
            const all = [
                { ReservationNo: '527594', Material: '8000006485', MaterialName: 'Condenser', MovementType: '311' },
                { ReservationNo: '0000527595', Material: '8000006485', MaterialName: 'Condenser', MovementType: '311' }
            ];

            const viewModel = new FakeJSONModel({
                allEntries: all,
                entries: all
            });

            const listSubject = Object.assign(Object.create(listCtrl), {
                _oViewModel: viewModel
            });

            // Search with 10-digit padded GUI number
            listSubject.onSearchFieldSearch({ getParameter: () => '0000527594' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('527594');

            // Search with unpadded number
            listSubject.onSearchFieldSearch({ getParameter: () => '527595' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000527595');
        });

        it('navigates to create view on onCreatePress', () => {
            const routerMock = { navTo: jest.fn() };
            const listSubject = Object.assign(Object.create(listCtrl), {
                getOwnerComponent: () => ({ getRouter: () => routerMock })
            });

            listSubject.onCreatePress();
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryCreate');
        });

        it('navigates to detail view on onRowPress', () => {
            const routerMock = { navTo: jest.fn() };
            const listSubject = Object.assign(Object.create(listCtrl), {
                getOwnerComponent: () => ({ getRouter: () => routerMock })
            });

            const fakeEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({ ReservationNo: '0000004900', ReservationItem: '0001' })
                    })
                })
            };

            listSubject.onRowPress(fakeEvent);
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000004900',
                ReservationItem: '0001'
            });
        });

        it('loadData loads all open reservations from SAP (Movement Type + Plant filters only)', async () => {
            const serviceMock = {
                getOpenReservations: jest.fn().mockResolvedValue([
                    { ReservationNo: '0000525868', MovementType: '301', Material: '8000009753', Plant: '1120', ItemCount: 1 }
                ])
            };
            const viewModel = new FakeJSONModel({
                filterMvtType: '', filterPlant: '1120', entries: [], allEntries: [], busy: false
            });
            const listSubject = Object.assign(Object.create(listCtrl), {
                _oService: serviceMock,
                _oViewModel: viewModel
            });

            await listSubject.loadData();

            expect(serviceMock.getOpenReservations).toHaveBeenCalledWith({ MovementType: '', Plant: '1120' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000525868');
            expect(viewModel.getProperty('/busy')).toBe(false);
        });

        it('deduplicates tracked and open reservations across padded and unpadded keys', async () => {
            const serviceMock = {
                getEntries: jest.fn().mockResolvedValue([
                    { ReservationNo: '0000527594', ReservationItem: '0001', MovementType: '311', TransferRequirement: '1000810', Status_code: '02' }
                ]),
                getOpenReservations: jest.fn().mockResolvedValue([
                    { ReservationNo: '527594', ReservationItem: '0001', MovementType: '311', Status_code: '01' },
                    { ReservationNo: '527595', ReservationItem: '0001', MovementType: '311', Status_code: '01' }
                ])
            };

            const viewModel = new FakeJSONModel({
                filterMvtType: '',
                filterPlant: '',
                entries: [],
                allEntries: [],
                busy: false
            });

            const listSubject = Object.assign(Object.create(listCtrl), {
                _oService: serviceMock,
                _oViewModel: viewModel
            });

            await listSubject.loadData();
            const entries = viewModel.getProperty('/entries');
            expect(entries).toHaveLength(2);
            expect(entries[0].ReservationNo).toBe('0000527594');
            expect(entries[0].TransferRequirement).toBe('1000810');
            expect(entries[1].ReservationNo).toBe('0000527595');
        });

        it('loadData strictly filters out non-supported movements like 999 from both tracked and open lists while supporting 261', async () => {
            const serviceMock = {
                getEntries: jest.fn().mockResolvedValue([
                    { ReservationNo: '0000527594', ReservationItem: '0001', MovementType: '311', Status_code: '02' },
                    { ReservationNo: '0000527599', ReservationItem: '0001', MovementType: '999', Status_code: '02' }
                ]),
                getOpenReservations: jest.fn().mockResolvedValue([
                    { ReservationNo: '0000519944', ReservationItem: '0001', MovementType: '999', Status_code: '01' },
                    { ReservationNo: '0000527595', ReservationItem: '0001', MovementType: '201', Status_code: '01' },
                    { ReservationNo: '0000527596', ReservationItem: '0001', MovementType: '241', Status_code: '01' },
                    { ReservationNo: '0000527597', ReservationItem: '0001', MovementType: '301', Status_code: '01' },
                    { ReservationNo: '0000521169', ReservationItem: '0002', MovementType: '261', Status_code: '01' }
                ])
            };

            const viewModel = new FakeJSONModel({
                filterMvtType: '',
                filterPlant: '',
                entries: [],
                allEntries: [],
                busy: false
            });

            const listSubject = Object.assign(Object.create(listCtrl), {
                _oService: serviceMock,
                _oViewModel: viewModel
            });

            await listSubject.loadData();
            const entries = viewModel.getProperty('/entries');
            expect(entries).toHaveLength(5);
            const mvts = entries.map((e) => e.MovementType);
            expect(mvts).toEqual(['311', '201', '241', '301', '261']);
            expect(entries.some((e) => e.MovementType === '999')).toBe(false);
            expect(entries.some((e) => e.MovementType === '261')).toBe(true);
        });

        it('formats Date ISO string correctly via _formatDateIso', () => {
            const listSubject = Object.create(listCtrl);
            expect(listSubject._formatDateIso(null)).toBe('');
            expect(listSubject._formatDateIso('2026-10-10')).toBe('2026-10-10');
            const d = new Date(2026, 9, 10); // month is 0-indexed, so 9 = October
            expect(listSubject._formatDateIso(d)).toBe('2026-10-10');
        });

        it('keeps retry on the detail page and navigates there from the list', () => {
            const navTo = jest.fn();
            const listSubject = Object.assign(Object.create(listCtrl), {
                getOwnerComponent: () => ({ getRouter: () => ({ navTo }) })
            });
            listSubject.onRowPress({ getParameter: () => ({
                getBindingContext: () => ({ getObject: () => ({
                    ReservationNo: '0000001001', ReservationItem: '0001'
                }) })
            }) });
            expect(navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000001001', ReservationItem: '0001'
            });
        });
    });

    describe('Chunk 6: ReservationEntryDetail Retry Step Action', () => {
        it('calls retryStep and reloads detail on onRetryStepPress', async () => {
            const serviceMock = {
                retryStep: jest.fn().mockResolvedValue({ Status_code: '05', ErrorMessage: '' }),
                getEntry: jest.fn().mockResolvedValue({ ReservationNo: '0000001001', Status_code: '05' })
            };
            const detailSubject = createDetailSubject(serviceMock);
            detailSubject._sCurrentResNo = '0000001001';
            detailSubject._sCurrentResItem = '0001';
            detailSubject._oDetailModel.setData({ MovementType: '261' });
            detailSubject._loadDetail = jest.fn();

            detailSubject.onRetryStepPress();
            expect(serviceMock.retryStep).toHaveBeenCalledWith('0000001001', '0001', 'AUTO', '261');
            await Promise.resolve();
            expect(detailSubject._loadDetail).toHaveBeenCalledWith('0000001001', '0001');
        });

        it('_loadDetail falls back to a live SAP read when the reservation is not tracked locally', async () => {
            const serviceMock = {
                getEntry: jest.fn().mockRejectedValue({ message: 'Not Found' }),
                getReservationDetail: jest.fn().mockResolvedValue({
                    ReservationNo: '525869', ReservationItem: '0001', MovementType: '311',
                    Material: '8000009753', Plant: '1120', StorageLocation: 'HS01',
                    Status_code: '01', StatusText: 'Open (not tracked in this app)'
                })
            };
            const detailSubject = createDetailSubject(serviceMock);

            await detailSubject._loadDetail('525869', '0001');

            expect(serviceMock.getEntry).toHaveBeenCalledWith('525869', '0001');
            expect(serviceMock.getReservationDetail).toHaveBeenCalledWith('525869', '0001');
            const oData = detailSubject._oDetailModel.getData();
            expect(oData.ReservationNo).toBe('525869');
            expect(oData.Material).toBe('8000009753');
            expect(oData.Logs).toEqual([]);
            expect(detailSubject._oViewModel.getProperty('/busy')).toBe(false);
        });
    });

    describe('ValueHelp & Selection Options for Material, Plant, and Storage Location', () => {
        let subject;
        beforeEach(() => {
            subject = createDetailSubject();
        });

        it('delegates onSuggest for Material with plant contextual filter to ValueHelpService', () => {
            subject._oCreateModel.setProperty('/Plant', '1120');
            const mockInput = { getId: () => 'inputMaterial' };
            subject.onSuggest({
                getSource: () => mockInput,
                getParameter: (p) => p === 'suggestValue' ? '8000' : null
            });

            expect(mockValueHelpService.applySuggestionFilter).toHaveBeenCalledWith(
                mockInput,
                '8000',
                expect.arrayContaining([expect.objectContaining({ path: 'Plant', op: 'EQ', val: '1120' })])
            );
        });

        it('delegates onSuggest for StorageLocation with plant contextual filter to ValueHelpService', () => {
            subject._oCreateModel.setProperty('/Plant', '1120');
            const mockInput = { getId: () => 'inputStorageLocation' };
            subject.onSuggest({
                getSource: () => mockInput,
                getParameter: (p) => p === 'suggestValue' ? 'HS' : null
            });

            expect(mockValueHelpService.applySuggestionFilter).toHaveBeenCalledWith(
                mockInput,
                'HS',
                expect.arrayContaining([expect.objectContaining({ path: 'Plant', op: 'EQ', val: '1120' })])
            );
        });

        it('delegates onValueHelpRequest for Material to ValueHelpService.openValueHelp', () => {
            subject._oCreateModel.setProperty('/Plant', '1120');
            const mockInput = { getId: () => 'inputMaterial' };
            subject.onValueHelpRequest({ getSource: () => mockInput });

            expect(mockValueHelpService.openValueHelp).toHaveBeenCalledWith(
                expect.any(Object),
                mockInput,
                expect.any(Function),
                expect.arrayContaining([expect.objectContaining({ path: 'Plant', op: 'EQ', val: '1120' })])
            );
        });

        it('delegates onValueHelpRequest for StorageLocation with plant filter to ValueHelpService.openValueHelp', () => {
            subject._oCreateModel.setProperty('/Plant', '1120');
            const mockInput = { getId: () => 'inputStorageLocation' };
            subject.onValueHelpRequest({ getSource: () => mockInput });

            expect(mockValueHelpService.openValueHelp).toHaveBeenCalledWith(
                expect.any(Object),
                mockInput,
                expect.any(Function),
                expect.arrayContaining([expect.objectContaining({ path: 'Plant', op: 'EQ', val: '1120' })])
            );
        });

        it('_handleValueHelpSelected populates Material, MaterialName, and Unit', () => {
            const mockInput = { getId: () => 'inputMaterial', setValueState: jest.fn() };
            subject._handleValueHelpSelected(
                mockInput,
                '000000008000000023',
                null,
                { Material: '000000008000000023', MaterialName: 'Finished Cable Assy', MaterialBaseUnit: 'NOS' }
            );

            expect(subject._oCreateModel.getProperty('/Material')).toBe('000000008000000023');
            expect(subject._oCreateModel.getProperty('/MaterialName')).toBe('Finished Cable Assy');
            expect(subject._oCreateModel.getProperty('/Unit')).toBe('NOS');
            expect(mockInput.setValueState).toHaveBeenCalledWith('None');
        });

        it('_handleValueHelpSelected populates Plant', () => {
            const mockInput = { getId: () => 'inputPlant', setValueState: jest.fn() };
            subject._handleValueHelpSelected(mockInput, '1130', null, { Plant: '1130' });

            expect(subject._oCreateModel.getProperty('/Plant')).toBe('1130');
            expect(mockInput.setValueState).toHaveBeenCalledWith('None');
        });

        it('_handleValueHelpSelected populates StorageLocation and auto-sets Plant if empty', () => {
            subject._oCreateModel.setProperty('/Plant', '');
            const mockInput = { getId: () => 'inputStorageLocation', setValueState: jest.fn() };
            subject._handleValueHelpSelected(mockInput, 'HS01', null, { StorageLocation: 'HS01', Plant: '1120' });

            expect(subject._oCreateModel.getProperty('/StorageLocation')).toBe('HS01');
            expect(subject._oCreateModel.getProperty('/Plant')).toBe('1120');
            expect(mockInput.setValueState).toHaveBeenCalledWith('None');
        });

        it('_handleValueHelpSelected populates CostCenter', () => {
            const mockInput = { getId: () => 'inputCostCenter', setValueState: jest.fn() };
            subject._handleValueHelpSelected(mockInput, '1011201301', null, { CostCenter: '1011201301' });

            expect(subject._oCreateModel.getProperty('/CostCenter')).toBe('1011201301');
            expect(mockInput.setValueState).toHaveBeenCalledWith('None');
        });

        it('_handleValueHelpSelected populates Batch', () => {
            const mockInput = { getId: () => 'inputBatch', setValueState: jest.fn() };
            subject._handleValueHelpSelected(mockInput, 'IN26001170', null, { Batch: 'IN26001170' });

            expect(subject._oCreateModel.getProperty('/Batch')).toBe('IN26001170');
            expect(mockInput.setValueState).toHaveBeenCalledWith('None');
        });

        it('_handleValueHelpSelected populates OrderID and auto-syncs OrderType when present', () => {
            subject._oCreateModel.setProperty('/OrderType', 'ZEMP');
            const mockInput = { getId: () => 'inputOrderId', setValueState: jest.fn() };
            subject._handleValueHelpSelected(mockInput, '1002790', null, { OrderID: '1002790', OrderType: 'ZP01' });

            expect(subject._oCreateModel.getProperty('/OrderID')).toBe('1002790');
            expect(subject._oCreateModel.getProperty('/OrderType')).toBe('ZP01');
            expect(mockInput.setValueState).toHaveBeenCalledWith('None');
        });

        it('_handleValueHelpSelected adjusts ReceivingStorageLocation on Movement 311 when issuing matches receiving', () => {
            subject._oCreateModel.setProperty('/MovementType', '311');
            subject._oCreateModel.setProperty('/ReceivingStorageLocation', 'ST02');
            const mockInput = { getId: () => 'inputStorageLocation', setValueState: jest.fn() };
            subject._handleValueHelpSelected(mockInput, 'ST02', null, { StorageLocation: 'ST02' });

            expect(subject._oCreateModel.getProperty('/StorageLocation')).toBe('ST02');
            expect(subject._oCreateModel.getProperty('/ReceivingStorageLocation')).toBe(''); // cleared, never guessed (D7)
        });

        it('item selection event handlers trigger _handleValueHelpSelected', () => {
            const mockInput = { getId: () => 'inputMaterial', setValueState: jest.fn() };
            const mockItem = {
                getKey: () => '1000000045',
                getText: () => '1000000045',
                getDescription: () => 'Raw Material 45',
                getBindingContext: () => ({
                    getObject: () => ({ Material: '1000000045', MaterialName: 'Raw Material 45', MaterialBaseUnit: 'KG' })
                })
            };

            subject.onMaterialSelect({
                getSource: () => mockInput,
                getParameter: (p) => p === 'selectedItem' ? mockItem : null
            });

            expect(subject._oCreateModel.getProperty('/Material')).toBe('1000000045');
            expect(subject._oCreateModel.getProperty('/MaterialName')).toBe('Raw Material 45');
            expect(subject._oCreateModel.getProperty('/Unit')).toBe('KG');
        });

        it('onInternalOrderValueHelpRequest blocks with warning when OrderType is not selected', () => {
            const subject = createDetailSubject();
            subject._oCreateModel.setProperty('/MovementType', '261');
            subject._oCreateModel.setProperty('/OrderType', '');

            const mockInput = { getId: () => 'inputOrderId', setValueState: jest.fn() };
            subject.onInternalOrderValueHelpRequest({ getSource: () => mockInput });

            expect(MessageBox.warning).toHaveBeenCalledWith(expect.stringContaining('Please select an Order Type'));
            expect(mockValueHelpService.openValueHelp).not.toHaveBeenCalled();
        });

        it('onInternalOrderValueHelpRequest opens value help with OrderType filter when OrderType is selected', () => {
            const subject = createDetailSubject();
            subject._oCreateModel.setProperty('/MovementType', '261');
            subject._oCreateModel.setProperty('/OrderType', 'ZEMP');
            subject._oCreateModel.setProperty('/Plant', '1120');

            const mockInput = { getId: () => 'inputOrderId', setValueState: jest.fn() };
            subject.onInternalOrderValueHelpRequest({ getSource: () => mockInput });

            expect(mockValueHelpService.openValueHelp).toHaveBeenCalled();
            const initialFilters = mockValueHelpService.openValueHelp.mock.calls[0][3];
            expect(initialFilters.some((f) => f.path === 'OrderType' && f.val === 'ZEMP')).toBe(true);
            expect(initialFilters.some((f) => f.path === 'Plant' && f.val === '1120')).toBe(true);
        });

        it('onOrderTypeSelect sets OrderType and clears existing OrderID', () => {
            const subject = createDetailSubject();
            subject._oCreateModel.setProperty('/MovementType', '261');
            subject._oCreateModel.setProperty('/OrderType', '0100');
            subject._oCreateModel.setProperty('/OrderID', '1007');

            const mockInput = { getId: () => 'inputOrderType', setValueState: jest.fn() };
            const mockItem = {
                getKey: () => 'ZEMP',
                getText: () => 'ZEMP'
            };

            subject.onOrderTypeSelect({
                getSource: () => mockInput,
                getParameter: (p) => p === 'selectedItem' ? mockItem : null
            });

            expect(subject._oCreateModel.getProperty('/OrderType')).toBe('ZEMP');
            expect(subject._oCreateModel.getProperty('/OrderID')).toBe('');
        });

        it('onOrderTypeChange updates OrderType and clears existing OrderID on change', () => {
            const subject = createDetailSubject();
            subject._oCreateModel.setProperty('/MovementType', '261');
            subject._oCreateModel.setProperty('/OrderType', 'ZEMP');
            subject._oCreateModel.setProperty('/OrderID', '1007');

            subject.onOrderTypeChange({
                getParameter: (p) => p === 'value' ? '0100' : null
            });

            expect(subject._oCreateModel.getProperty('/OrderType')).toBe('0100');
            expect(subject._oCreateModel.getProperty('/OrderID')).toBe('');
        });

        it('onSuggest for inputOrderId passes OrderType and Plant context filters', () => {
            const subject = createDetailSubject();
            subject._oCreateModel.setProperty('/MovementType', '261');
            subject._oCreateModel.setProperty('/OrderType', 'ZEMP');
            subject._oCreateModel.setProperty('/Plant', '1120');

            const mockInput = { getId: () => 'inputOrderId' };
            subject.onSuggest({
                getSource: () => mockInput,
                getParameter: (p) => p === 'suggestValue' ? '10' : null
            });

            expect(mockValueHelpService.applySuggestionFilter).toHaveBeenCalled();
            const contextFilters = mockValueHelpService.applySuggestionFilter.mock.calls[0][2];
            expect(contextFilters.some((f) => f.path === 'OrderType' && f.val === 'ZEMP')).toBe(true);
            expect(contextFilters.some((f) => f.path === 'Plant' && f.val === '1120')).toBe(true);
        });
    });

    describe('Reservation Entry Remediation & UI Defect Fixes [mock only, not browser verification]', () => {
        it('Defect 6: validateForm rejects whitespace or empty Unit', () => {
            const subject = createDetailSubject();
            const err = subject.validateForm({
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'CS01',
                ReceivingStorageLocation: 'ST02',
                Material: '1000000045',
                Quantity: 10,
                Unit: '   '
            });
            expect(err).toMatch(/Unit of Measure is required/);
        });

        it('Defect 2: onRowPress correctly resolves listItem from Table itemPress event', () => {
            const routerMock = { navTo: jest.fn() };
            const listSubject = Object.assign(Object.create(listCtrl), {
                getOwnerComponent: () => ({ getRouter: () => routerMock })
            });

            const mockListItem = {
                getBindingContext: (modelName) => modelName === 'view' ? {
                    getObject: () => ({ ReservationNo: '0000004812', ReservationItem: '0002' })
                } : null
            };
            const mockTable = {
                getBindingContext: () => null // Table itself has no row context
            };

            // Event fired from Table itemPress: getSource() is Table, getParameter("listItem") is the row
            const mockItemPressEvent = {
                getSource: () => mockTable,
                getParameter: (param) => param === 'listItem' ? mockListItem : null
            };

            listSubject.onRowPress(mockItemPressEvent);
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000004812',
                ReservationItem: '0002'
            });
        });

        it('Defect 3: Detail onNavBack delegates to BaseController history fallback', () => {
            const subject = createDetailSubject();
            let baseNavBackCalledWith = null;
            BaseController.onNavBack = function (fallback) {
                baseNavBackCalledWith = fallback;
            };

            subject.onNavBack();
            expect(baseNavBackCalledWith).toBe('wmReservationEntryList');
        });

        it('Defect 5: _loadDetail sets isTracked=true on tracked reservation and isTracked=false on live fallback', async () => {
            const serviceMock = {
                getEntry: jest.fn().mockResolvedValue({ ReservationNo: '10001', Status_code: '02' }),
                getReservationDetail: jest.fn().mockResolvedValue({ ReservationNo: '20002', Status_code: '01' })
            };
            const subject = createDetailSubject(serviceMock);

            // 1. Tracked reservation
            await subject._loadDetail('10001', '0001');
            expect(subject._oViewModel.getProperty('/isTracked')).toBe(true);
            expect(subject._oDetailModel.getProperty('/ReservationNo')).toBe('10001');

            // 2. Untracked reservation (getEntry rejects, getReservationDetail succeeds)
            serviceMock.getEntry.mockRejectedValueOnce(new Error('404 Not Found'));
            await subject._loadDetail('20002', '0001');
            expect(subject._oViewModel.getProperty('/isTracked')).toBe(false);
            expect(subject._oDetailModel.getProperty('/ReservationNo')).toBe('20002');

            // 3. Blank reservation number handled cleanly without calling service
            await subject._loadDetail('', '');
            expect(subject._oViewModel.getProperty('/isTracked')).toBe(false);
            expect(subject._oViewModel.getProperty('/errorMessage')).toMatch(/Reservation number is required/);
        });

        it('Defect 1: App.controller syncs ShellBar routes and navigates back to list', () => {
            const fs = require('fs');
            const appControllerSrc = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/controller/App.controller.js'), 'utf8');

            // Route matching in _updateShell
            expect(appControllerSrc).toContain('case "wmReservationEntryList":');
            expect(appControllerSrc).toContain('case "wmReservationEntryCreate":');
            expect(appControllerSrc).toContain('case "wmReservationEntryDetail":');

            // Hash handling in _syncInitialShellState
            expect(appControllerSrc).toContain('sHash.indexOf("wm/reservation-entry/create") === 0');
            expect(appControllerSrc).toContain('sHash.indexOf("wm/reservation-entry/") === 0');
            expect(appControllerSrc).toContain('sHash.indexOf("wm/reservation-entry") === 0');

            // Back button handling in onNavButtonPressed
            expect(appControllerSrc).toContain('sRoute === "wmReservationEntryDetail" || sRoute === "wmReservationEntryCreate"');
            expect(appControllerSrc).toContain('this.onNavBack("wmReservationEntryList");');
            expect(appControllerSrc).toContain('sRoute === "wmReservationEntryList"');
        });
    });

    describe('ReservationEntryList: Create & Refresh with ReservationNo and TR No [mock only, not browser verification]', () => {
        it('create -> row appears in list with ReservationNo and TR No filled [mock only, not browser verification]', async () => {
            const createdRecord = {
                ReservationNo: '0000525870',
                ReservationItem: '0001',
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'CS01',
                Material: '1000000045',
                MaterialName: 'Raw Material 45',
                Quantity: 10,
                Unit: 'KG',
                TransferRequirement: '0001001840',
                Status_code: '02'
            };

            const serviceMock = {
                createReservationEntry: jest.fn().mockResolvedValue(createdRecord),
                getEntries: jest.fn().mockResolvedValue([createdRecord]),
                getOpenReservations: jest.fn().mockResolvedValue([])
            };
            const routerMock = { navTo: jest.fn() };

            // 1. Create reservation
            const detailSubject = createDetailSubject(serviceMock, routerMock);
            detailSubject._oCreateModel.setData({
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'CS01',
                Material: '1000000045',
                Quantity: 10,
                Unit: 'KG',
                ReceivingStorageLocation: 'ST02'
            });

            await detailSubject.onSave();
            expect(serviceMock.createReservationEntry).toHaveBeenCalled();
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000525870',
                ReservationItem: '0001'
            });

            // 2. List loads/refreshes
            const viewModel = new FakeJSONModel({
                entries: [],
                allEntries: [],
                filterMvtType: '',
                filterPlant: '',
                busy: false
            });
            const listSubject = Object.assign(Object.create(listCtrl), {
                _oService: serviceMock,
                _oViewModel: viewModel
            });

            await listSubject.loadData();

            const aEntries = viewModel.getProperty('/entries');
            expect(aEntries).toHaveLength(1);
            expect(aEntries[0].ReservationNo).toBe('0000525870');
            expect(aEntries[0].TransferRequirement).toBe('0001001840');
            expect(aEntries[0].Status_code).toBe('02');
        });

        it('TR created later -> column updates on refresh [mock only, not browser verification]', async () => {
            const initialRecord = {
                ReservationNo: '0000525870',
                ReservationItem: '0001',
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'CS01',
                Material: '1000000045',
                TransferRequirement: '',
                Status_code: '11',
                ErrorMessage: 'TR creation failed in SAP backend'
            };

            const updatedRecord = {
                ...initialRecord,
                TransferRequirement: '0001001840',
                Status_code: '02',
                ErrorMessage: ''
            };

            const serviceMock = {
                retryStep: jest.fn().mockResolvedValue(updatedRecord),
                getEntries: jest.fn()
                    .mockResolvedValueOnce([initialRecord])
                    .mockResolvedValueOnce([updatedRecord]),
                getOpenReservations: jest.fn().mockResolvedValue([])
            };

            const viewModel = new FakeJSONModel({
                entries: [],
                allEntries: [],
                filterMvtType: '',
                filterPlant: '',
                busy: false
            });
            const listSubject = Object.assign(Object.create(listCtrl), {
                _oService: serviceMock,
                _oViewModel: viewModel
            });

            // Initial load: TR is empty
            await listSubject.loadData();
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000525870');
            expect(viewModel.getProperty('/entries')[0].TransferRequirement).toBe('');
            expect(viewModel.getProperty('/entries')[0].Status_code).toBe('11');

            // Retry through the active detail page, then refresh the list.
            const detailSubject = createDetailSubject(serviceMock);
            detailSubject._sCurrentResNo = initialRecord.ReservationNo;
            detailSubject._sCurrentResItem = initialRecord.ReservationItem;
            detailSubject._oDetailModel.setData(initialRecord);
            detailSubject._loadDetail = jest.fn();
            detailSubject.onRetryStepPress();
            await Promise.resolve();
            expect(serviceMock.retryStep).toHaveBeenCalledWith('0000525870', '0001', 'AUTO', '311');
            expect(detailSubject._loadDetail).toHaveBeenCalled();
            await listSubject.loadData();

            // List is refreshed with updated TR
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000525870');
            expect(viewModel.getProperty('/entries')[0].TransferRequirement).toBe('0001001840');
            expect(viewModel.getProperty('/entries')[0].Status_code).toBe('02');
        });
    });

    describe('Reservation Listing Consistency & Creator Field', () => {
        it('normalizes material, movement type desc, and captures CreatedByUser across tracked and open lists', async () => {
            const serviceMock = {
                getEntries: jest.fn().mockResolvedValue([
                    {
                        ReservationNo: '0000527594',
                        ReservationItem: '0001',
                        MovementType: '261',
                        Material: '000000000000000062',
                        MaterialName: 'Motor 62',
                        createdBy: 'KHUSHAL',
                        OrderID: '4000123'
                    }
                ]),
                getOpenReservations: jest.fn().mockResolvedValue([
                    {
                        ReservationNo: '527594',
                        ReservationItem: '0001',
                        MovementType: '261',
                        MovementTypeName: 'GI for Order',
                        CreatedByUser: 'KHUSHAL',
                        OrderNo: '4000123'
                    },
                    {
                        ReservationNo: '0000527595',
                        ReservationItem: '0001',
                        MovementType: '311',
                        Material: '000000000000000045',
                        MaterialName: 'Raw Material 45',
                        USNAM: 'RFW12',
                        ItemCount: 2
                    }
                ])
            };

            const viewModel = new FakeJSONModel({
                entries: [],
                allEntries: [],
                busy: false
            });
            const listSubject = Object.assign(Object.create(listCtrl), {
                _oService: serviceMock,
                _oViewModel: viewModel
            });

            await listSubject.loadData();
            const entries = viewModel.getProperty('/entries');
            expect(entries).toHaveLength(2);

            // Tracked entry enriched and material unpadded
            expect(entries[0].ReservationNo).toBe('0000527594');
            expect(entries[0].Material).toBe('62');
            expect(entries[0].MovementTypeName).toBe('GI for Order');
            expect(entries[0].CreatedByUser).toBe('KHUSHAL');
            expect(entries[0].OrderNo).toBe('4000123');

            // Open entry normalized
            expect(entries[1].ReservationNo).toBe('0000527595');
            expect(entries[1].Material).toBe('45');
            expect(entries[1].MovementTypeName).toBe('SLoc to SLoc');
            expect(entries[1].CreatedByUser).toBe('RFW12');
            expect(entries[1].ItemCount).toBe(2);
        });

        it('onSearchFieldSearch matches query across CreatedByUser, OrderNo, and MovementTypeName', () => {
            const viewModel = new FakeJSONModel({
                allEntries: [
                    { ReservationNo: '0000527594', CreatedByUser: 'KHUSHAL', MovementType: '261', MovementTypeName: 'GI for Order', OrderNo: '4000123', Plant: '1120', StorageLocation: 'CS01' },
                    { ReservationNo: '0000527595', CreatedByUser: 'RFW12', MovementType: '311', MovementTypeName: 'SLoc to SLoc', OrderNo: '', Plant: '1120', StorageLocation: '1120' }
                ],
                entries: []
            });
            const listSubject = Object.assign(Object.create(listCtrl), {
                _oViewModel: viewModel
            });

            // Match CreatedByUser
            listSubject.onSearchFieldSearch({ getParameter: () => 'khushal' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000527594');

            // Match MovementTypeName
            listSubject.onSearchFieldSearch({ getParameter: () => 'SLoc' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000527595');

            // Match OrderNo
            listSubject.onSearchFieldSearch({ getParameter: () => '4000123' });
            expect(viewModel.getProperty('/entries')).toHaveLength(1);
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000527594');

            // Empty query resets
            listSubject.onSearchFieldSearch({ getParameter: () => '' });
            expect(viewModel.getProperty('/entries')).toHaveLength(2);
        });

        it('ReservationEntryDetail preserves CreatedByUser on tracked and live detail reads', async () => {
            const serviceMock = {
                getEntry: jest.fn().mockResolvedValue({
                    ReservationNo: '0000527594',
                    ReservationItem: '0001',
                    createdBy: 'KHUSHAL',
                    TransferRequirement: '1000810',
                    TransferOrder: '1000920',
                    MaterialDocument: '50000123'
                }),
                getReservationDetail: jest.fn().mockResolvedValue({
                    ReservationNo: '0000527595',
                    ReservationItem: '0001',
                    CreatedByUser: 'RFW12'
                })
            };

            const detailSubject = createDetailSubject(serviceMock);

            // 1. Tracked entry
            await detailSubject._loadDetail('0000527594', '0001');
            expect(detailSubject._oDetailModel.getProperty('/CreatedByUser')).toBe('KHUSHAL');

            // 2. Untracked entry falling back to live SAP
            serviceMock.getEntry.mockRejectedValueOnce(new Error('Not found'));
            await detailSubject._loadDetail('0000527595', '0001');
            expect(detailSubject._oDetailModel.getProperty('/CreatedByUser')).toBe('RFW12');
        });
    });
});
