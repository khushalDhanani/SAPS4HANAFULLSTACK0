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
        error: jest.fn()
    };

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
                        factory(BaseController, FakeJSONModel, MessageBox, MessageToast, function () {});
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
        it('returns correct default creation data for 311', () => {
            const subject = createDetailSubject();
            const defaults = subject._getDefaultCreateData();
            expect(defaults.MovementType).toBe('311');
            expect(defaults.Plant).toBe('1120');
            expect(defaults.StorageLocation).toBe('CS01');
            expect(defaults.ReceivingStorageLocation).toBe('ST02');
            expect(defaults.Quantity).toBe(10);
            expect(defaults.Unit).toBe('KG');
            expect(defaults.WarehouseNumber).toBe('W01');
        });

        it('switches to Movement 201: sets Cost Center default and clears destination locations', () => {
            const subject = createDetailSubject();
            subject.onMovementTypeChange({
                getParameter: (p) => p === 'selectedItem' ? { getKey: () => '201' } : null
            });

            expect(subject._oCreateModel.getProperty('/CostCenter')).toBe('1011201301');
            expect(subject._oCreateModel.getProperty('/ReceivingStorageLocation')).toBe('');
            expect(subject._oCreateModel.getProperty('/ReceivingPlant')).toBe('');
            expect(subject._oCreateModel.getProperty('/AssetNo')).toBe('');
        });

        it('switches to Movement 241: sets Asset & Subnumber defaults and clears Cost Center and SLoc', () => {
            const subject = createDetailSubject();
            subject.onMovementTypeChange({
                getParameter: (p) => p === 'selectedItem' ? { getKey: () => '241' } : null
            });

            expect(subject._oCreateModel.getProperty('/AssetNo')).toBe('000000400092');
            expect(subject._oCreateModel.getProperty('/SubNumber')).toBe('0000');
            expect(subject._oCreateModel.getProperty('/CostCenter')).toBe('');
            expect(subject._oCreateModel.getProperty('/ReceivingStorageLocation')).toBe('');
            expect(subject._oCreateModel.getProperty('/ReceivingPlant')).toBe('');
        });

        it('switches to Movement 301: sets Receiving Plant default and clears SLoc and Cost Center', () => {
            const subject = createDetailSubject();
            subject.onMovementTypeChange({
                getParameter: (p) => p === 'selectedItem' ? { getKey: () => '301' } : null
            });

            expect(subject._oCreateModel.getProperty('/ReceivingPlant')).toBe('1130');
            expect(subject._oCreateModel.getProperty('/ReceivingStorageLocation')).toBe('');
            expect(subject._oCreateModel.getProperty('/CostCenter')).toBe('');
            expect(subject._oCreateModel.getProperty('/AssetNo')).toBe('');
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

            const dataWithAsset = { MovementType: '241', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, AssetNo: '000000400092' };
            expect(subject.validateForm(dataWithAsset)).toBeNull();
        });

        it('validates 311: requires Receiving Storage Location and must differ from Issuing SLoc', () => {
            const dataNoRec = { MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingStorageLocation: '' };
            expect(subject.validateForm(dataNoRec)).toMatch(/Receiving Storage Location is mandatory for Movement Type 311/);

            const dataSameRec = { MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingStorageLocation: 'HS01' };
            expect(subject.validateForm(dataSameRec)).toMatch(/Receiving Storage Location must be different from Issuing Storage Location/);

            const dataValid = { MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingStorageLocation: 'CS01' };
            expect(subject.validateForm(dataValid)).toBeNull();
        });

        it('validates 301: requires Receiving Plant and must differ from Issuing Plant', () => {
            const dataNoPlant = { MovementType: '301', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingPlant: '' };
            expect(subject.validateForm(dataNoPlant)).toMatch(/Receiving Plant is mandatory for Movement Type 301/);

            const dataSamePlant = { MovementType: '301', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingPlant: '1120' };
            expect(subject.validateForm(dataSamePlant)).toMatch(/Receiving Plant must be different from Issuing Plant/);

            const dataValid = { MovementType: '301', Plant: '1120', StorageLocation: 'HS01', Material: '100', Quantity: 5, ReceivingPlant: '1130' };
            expect(subject.validateForm(dataValid)).toBeNull();
        });
    });

    describe('ReservationEntryDetail: Save & Auto-TR Orchestration', () => {
        it('blocks onSave if form validation fails and displays error message', () => {
            const serviceMock = { createReservationEntry: jest.fn() };
            const subject = createDetailSubject(serviceMock);

            subject._oCreateModel.setProperty('/Quantity', 0); // Invalid
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
                expect.stringContaining('Auto-created Transfer Requirement (TR): 0000001842'),
                expect.any(Object)
            );

            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000004921',
                ReservationItem: '0001'
            });
        });

        it('calls createReservationEntry with deferred TR (status 01), shows informative success message with note, and navigates', async () => {
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
            expect(MessageBox.success).toHaveBeenCalledWith(
                expect.stringContaining('Note: TR deferred: restricted under SAP Note 2295840'),
                expect.any(Object)
            );
            expect(routerMock.navTo).toHaveBeenCalledWith('wmReservationEntryDetail', {
                ReservationNo: '0000004922',
                ReservationItem: '0001'
            });
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
    });

    describe('ReservationEntry: Formatters', () => {
        it('formats status codes to readable text, state, and icon', () => {
            expect(detailCtrl.formatStatusText('01')).toBe('Reservation Created');
            expect(detailCtrl.formatStatusText('02')).toBe('TR Auto-Created');
            expect(detailCtrl.formatStatusText('03')).toBe('TO Created');
            expect(detailCtrl.formatStatusText('04')).toBe('TO Confirmed');
            expect(detailCtrl.formatStatusText('05')).toBe('Goods Issue Posted');
            expect(detailCtrl.formatStatusText('99')).toBe('Error');

            expect(detailCtrl.formatStatusState('01')).toBe('Information');
            expect(detailCtrl.formatStatusState('02')).toBe('Warning');
            expect(detailCtrl.formatStatusState('05')).toBe('Success');
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

        it('formats Date ISO string correctly via _formatDateIso', () => {
            const listSubject = Object.create(listCtrl);
            expect(listSubject._formatDateIso(null)).toBe('');
            expect(listSubject._formatDateIso('2026-10-10')).toBe('2026-10-10');
            const d = new Date(2026, 9, 10); // month is 0-indexed, so 9 = October
            expect(listSubject._formatDateIso(d)).toBe('2026-10-10');
        });

        it('handles onSelectionChange: enables retry for status != 05, disables for 05', () => {
            const viewModel = new FakeJSONModel({ hasRetryableSelection: false, selectedEntry: null });
            const listSubject = Object.assign(Object.create(listCtrl), {
                _oViewModel: viewModel
            });

            // Select item with status 02 (in progress / retryable)
            listSubject.onSelectionChange({
                getParameter: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({ ReservationNo: '0000001001', ReservationItem: '0001', Status_code: '02' })
                    })
                })
            });
            expect(viewModel.getProperty('/hasRetryableSelection')).toBe(true);
            expect(viewModel.getProperty('/selectedEntry').ReservationNo).toBe('0000001001');

            // Select item with status 05 (completed / not retryable)
            listSubject.onSelectionChange({
                getParameter: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({ ReservationNo: '0000001002', ReservationItem: '0001', Status_code: '05' })
                    })
                })
            });
            expect(viewModel.getProperty('/hasRetryableSelection')).toBe(false);

            // Deselect / null item
            listSubject.onSelectionChange({ getParameter: () => null });
            expect(viewModel.getProperty('/hasRetryableSelection')).toBe(false);
            expect(viewModel.getProperty('/selectedEntry')).toBeNull();
        });

        it('triggers retryStep on onRetryPress and reloads data', async () => {
            const serviceMock = {
                retryStep: jest.fn().mockResolvedValue({ Status_code: '02', ErrorMessage: '' }),
                getEntries: jest.fn().mockResolvedValue([])
            };
            const viewModel = new FakeJSONModel({
                selectedEntry: { ReservationNo: '0000001001', ReservationItem: '0001', Status_code: '01' },
                hasRetryableSelection: true,
                busy: false
            });
            const listSubject = Object.assign(Object.create(listCtrl), {
                _oService: serviceMock,
                _oViewModel: viewModel,
                loadData: jest.fn()
            });

            listSubject.onRetryPress();
            expect(serviceMock.retryStep).toHaveBeenCalledWith('0000001001', '0001', 'AUTO');
            await Promise.resolve();
            expect(listSubject.loadData).toHaveBeenCalled();
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
            detailSubject._loadDetail = jest.fn();

            detailSubject.onRetryStepPress();
            expect(serviceMock.retryStep).toHaveBeenCalledWith('0000001001', '0001', 'AUTO');
            await Promise.resolve();
            expect(detailSubject._loadDetail).toHaveBeenCalledWith('0000001001', '0001');
        });
    });
});
