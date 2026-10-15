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
        it('returns correct default creation data for 311', () => {
            const subject = createDetailSubject();
            const defaults = subject._getDefaultCreateData();
            expect(defaults.MovementType).toBe('311');
            expect(defaults.Plant).toBe('1120');
            expect(defaults.StorageLocation).toBe('CS01');
            expect(defaults.ReceivingStorageLocation).toBe('ST02');
            expect(defaults.Quantity).toBe(10);
            expect(defaults.Unit).toBe('KG');
            expect(defaults.WarehouseNumber).toBe('');
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

        it('switches to Movement 301: sets Receiving Plant default, defaults Receiving SLoc, and clears Cost Center', () => {
            const subject = createDetailSubject();
            subject.onMovementTypeChange({
                getParameter: (p) => p === 'selectedItem' ? { getKey: () => '301' } : null
            });

            expect(subject._oCreateModel.getProperty('/ReceivingPlant')).toBe('1130');
            expect(subject._oCreateModel.getProperty('/ReceivingStorageLocation')).toBe('ST02');
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
                selectedEntry: initialRecord,
                hasRetryableSelection: true,
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

            // Select the item and trigger retry
            listSubject._oViewModel.setProperty('/selectedEntry', viewModel.getProperty('/entries')[0]);
            await listSubject.onRetryPress();
            expect(serviceMock.retryStep).toHaveBeenCalledWith('0000525870', '0001', 'AUTO');

            // List is refreshed with updated TR
            expect(viewModel.getProperty('/entries')[0].ReservationNo).toBe('0000525870');
            expect(viewModel.getProperty('/entries')[0].TransferRequirement).toBe('0001001840');
            expect(viewModel.getProperty('/entries')[0].Status_code).toBe('02');
        });
    });
});
