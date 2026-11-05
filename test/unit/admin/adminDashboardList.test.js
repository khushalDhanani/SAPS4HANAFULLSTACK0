'use strict';

const fs = require('fs');
const path = require('path');

const mockODataClient = { get: jest.fn(), post: jest.fn() };
const mockMessageToast = { show: jest.fn() };
const mockMessageBox = { error: jest.fn(), confirm: jest.fn() };
mockMessageBox.Action = { OK: 'OK', CANCEL: 'CANCEL' };

class MockFilter {
    constructor(...args) {
        this.args = args;
    }
}

class MockSorter {
    constructor(path, descending) {
        this.path = path;
        this.descending = descending;
    }
}
const mockAuthService = { hasAnyRole: jest.fn() };

class MockJSONModel {
    constructor(data) {
        this.data = data;
    }

    getProperty(sPath) {
        return sPath.replace(/^\//, '').split('/').reduce((value, key) => value && value[key], this.data);
    }

    setProperty(sPath, value) {
        const aParts = sPath.replace(/^\//, '').split('/');
        const sProperty = aParts.pop();
        const oParent = aParts.reduce((current, key) => current && current[key], this.data);
        oParent[sProperty] = value;
    }
}

const MockBaseController = {
    extend: (sName, oPrototype) => function () {
        Object.assign(this, oPrototype);
    }
};

let DashboardController;
let Logic;
const mockFile = { save: jest.fn() };

beforeAll(() => {
    const encodeXML = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    global.sap = { ui: { define: jest.fn((dependencies, factory) => { Logic = factory(encodeXML); }) } };
    require('../../../app/fiori-app/webapp/modules/admin/user-management/util/UserListLogic.js');
    global.sap.ui.define = jest.fn((dependencies, factory) => {
        DashboardController = factory(
            MockBaseController,
            MockJSONModel,
            mockODataClient,
            mockMessageToast,
            mockAuthService,
            mockMessageBox,
            MockFilter,
            MockSorter,
            { SortOrder: { Ascending: 'Ascending', Descending: 'Descending', None: 'None' } },
            Logic,
            mockFile
        );
    });
    require('../../../app/fiori-app/webapp/controller/Dashboard.controller.js');
});

beforeEach(() => {
    jest.clearAllMocks();
});

function makeController(aUsers, oExtra = {}) {
    const oModel = new MockJSONModel({
        users: aUsers,
        userCount: aUsers.length,
        selectedUser: null,
        filters: Logic.emptyFilters(),
        selection: {},
        bulk: { results: [] },
        undo: { text: '' },
        ...oExtra
    });
    oModel.refresh = jest.fn();
    const controller = new DashboardController();
    const oBinding = { filter: jest.fn(), sort: jest.fn() };
    const mControls = {};
    const fnControl = (sId) => {
        mControls[sId] = mControls[sId] || {
            open: jest.fn(),
            close: jest.fn(),
            setEscapeHandler: jest.fn(),
            setDateValue: jest.fn(),
            setSecondDateValue: jest.fn(),
            getColumns: () => [],
            getItems: () => [],
            getBinding: () => oBinding
        };
        return mControls[sId];
    };
    controller.getView = () => ({ getModel: () => oModel });
    controller.getOwnerComponent = () => null;
    controller.byId = fnControl;
    return { controller, model: oModel, binding: oBinding, control: fnControl };
}

describe('Admin dashboard user list', () => {
    test('shows the approved SAP fields and row actions in the responsive table', () => {
        const sView = fs.readFileSync(
            path.join(__dirname, '../../../app/fiori-app/webapp/view/Dashboard.view.xml'),
            'utf8'
        );
        [
            'adminColFullName',
            'adminColLockStatus',
            'adminColUserType',
            'adminColLastChanged',
            'adminDetailLastChangedBy',
            'adminDetailsUnavailable',
            'press=".onLockUser"',
            'press=".onUnlockUser"'
        ].forEach((sBinding) => expect(sView).toContain(sBinding));
        expect(sView).toContain("'adminView>fullName', 'adminView>/filters/search'");
        expect(sView).not.toContain('text="{i18n>adminDetailValidFrom}"');
        expect(sView).not.toContain('text="{i18n>adminDetailValidTo}"');
        expect(sView).not.toContain('adminView>validFrom');
        expect(sView).not.toContain('adminView>validTo');
        expect(sView).toContain('detailsAvailable} &amp;&amp; !${adminView>isLocked} &amp;&amp; !${adminView>protectedReason}');
        expect(sView).toContain('detailsAvailable} &amp;&amp; ${adminView>isLocked} === true');
    });

    describe('user detail side pane', () => {
        const rowEvent = (sUsername) => ({
            getSource: () => ({ getBindingContext: () => ({ getProperty: () => sUsername }) })
        });

        test('opens from a row in a standard column layout, and the old dialog is gone', () => {
            const webapp = path.join(__dirname, '../../../app/fiori-app/webapp');
            const sView = fs.readFileSync(path.join(webapp, 'view/Dashboard.view.xml'), 'utf8');
            expect(sView).toContain('<f:FlexibleColumnLayout');
            expect(sView).toContain("layout=\"{= ${adminView>/selectedUser} ? 'TwoColumnsBeginExpanded' : 'OneColumn' }\"");
            expect(sView).toContain('fragmentName="saps4hana.fiori.fragment.UserDetailPane"');
            expect(fs.existsSync(path.join(webapp, 'fragment/UserDetailDialog.fragment.xml'))).toBe(false);
        });

        test('row actions drop below the row on a narrow screen instead of being cut off', () => {
            const sView = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/view/Dashboard.view.xml'), 'utf8');
            expect(sView).toContain('<Column hAlign="End" width="16rem" minScreenWidth="Tablet" demandPopin="true">');
        });

        test('every pane text exists in both bundles', () => {
            const webapp = path.join(__dirname, '../../../app/fiori-app/webapp');
            const sFragment = fs.readFileSync(path.join(webapp, 'fragment/UserDetailPane.fragment.xml'), 'utf8');
            const aKeys = [...new Set([...sFragment.matchAll(/i18n>(\w+)/g)].map((m) => m[1]))];
            expect(aKeys.length).toBeGreaterThan(20);
            ['i18n.properties', 'i18n_en.properties'].forEach((sFile) => {
                const sBundle = fs.readFileSync(path.join(webapp, 'i18n', sFile), 'utf8');
                expect(aKeys.filter((sKey) => !new RegExp(`^${sKey}=`, 'm').test(sBundle))).toEqual([]);
            });
        });

        test('a press shows the row user at once, then the SAP detail, and updates the row', async () => {
            const { controller, model } = makeController([{ username: 'ALICE', isLocked: false }]);
            let fnAnswer;
            mockODataClient.get.mockReturnValue(new Promise((resolve) => { fnAnswer = resolve; }));
            model.setProperty('/selectedUser', { username: 'BOB', fullName: 'Bob Old', roles: [] });

            const pLoad = controller.onSelectUser(rowEvent('ALICE'));

            expect(mockODataClient.get).toHaveBeenCalledWith("/odata/v4/user-management/getUserDetail(username='ALICE')");
            expect(model.getProperty('/selectedUser')).toEqual({ username: 'ALICE' });
            expect(model.getProperty('/detailBusy')).toBe(true);

            fnAnswer({ username: 'ALICE', isLocked: true, roles: [{ name: 'Z' }] });
            await pLoad;

            expect(model.getProperty('/selectedUser/roles')).toEqual([{ name: 'Z' }]);
            expect(model.getProperty('/users/0/isLocked')).toBe(true);
            expect(model.getProperty('/detailBusy')).toBe(false);
        });

        test('a failed read shows the error in the pane, and no details or lock state', async () => {
            const { controller, model } = makeController([{ username: 'ALICE', detailsAvailable: true, isLocked: false }]);
            mockODataClient.get.mockRejectedValue(new Error('Read failed'));

            await controller.onSelectUser(rowEvent('ALICE'));

            expect(model.getProperty('/selectedUser')).toEqual({ username: 'ALICE' });
            expect(model.getProperty('/detailError')).toBe('Read failed');
            expect(model.getProperty('/detailBusy')).toBe(false);
            expect(model.getProperty('/users/0/detailsAvailable')).toBe(false);
        });

        test('a slow answer for an earlier user does not replace the current pane', async () => {
            const { controller, model } = makeController([{ username: 'ALICE' }, { username: 'BOB' }]);
            const fnAnswers = {};
            mockODataClient.get.mockImplementation((sUrl) => new Promise((resolve) => {
                fnAnswers[sUrl.includes('ALICE') ? 'ALICE' : 'BOB'] = resolve;
            }));

            const pAlice = controller.onSelectUser(rowEvent('ALICE'));
            const pBob = controller.onSelectUser(rowEvent('BOB'));
            fnAnswers.BOB({ username: 'BOB', fullName: 'Bob', isLocked: false });
            await pBob;
            fnAnswers.ALICE({ username: 'ALICE', fullName: 'Alice', isLocked: false });
            await pAlice;

            expect(model.getProperty('/selectedUser/username')).toBe('BOB');
        });

        test('closing clears the pane, so the table returns to one column', () => {
            const { controller, model } = makeController([]);
            model.setProperty('/selectedUser', { username: 'ALICE' });
            model.setProperty('/detailError', 'Read failed');

            controller.onCloseUserDetail();

            expect(model.getProperty('/selectedUser')).toBeNull();
            expect(model.getProperty('/detailError')).toBe('');
        });

        test('a lock on another row leaves the open pane on its own user', async () => {
            const { controller, model } = makeController([{ username: 'ALICE' }, { username: 'BOB' }]);
            model.setProperty('/selectedUser', { username: 'ALICE', fullName: 'Alice' });
            mockODataClient.post.mockResolvedValue({ message: 'ok' });
            mockODataClient.get.mockResolvedValue({ username: 'BOB', isLocked: true });

            await controller._executeUserAction('/odata/v4/user-management/lockUser', 'BOB', true);

            expect(model.getProperty('/selectedUser/username')).toBe('ALICE');
            expect(model.getProperty('/users/1/isLocked')).toBe(true);
        });

        test('an unconfirmed lock on the open user clears its details and action buttons', async () => {
            const { controller, model } = makeController([{ username: 'ALICE' }]);
            model.setProperty('/selectedUser', { username: 'ALICE', isLocked: false, roles: [] });
            mockODataClient.post.mockResolvedValue({ message: 'ok' });
            mockODataClient.get.mockRejectedValue(new Error('Read failed'));

            await controller._executeUserAction('/odata/v4/user-management/lockUser', 'ALICE', true);

            expect(model.getProperty('/selectedUser')).toEqual({ username: 'ALICE' });
            expect(model.getProperty('/detailError')).toBe('Read failed');
            expect(model.getProperty('/detailBusy')).toBe(false);
        });

        test('the lock button needs a known lock state and an unprotected user', () => {
            const sFragment = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/fragment/UserDetailPane.fragment.xml'), 'utf8');
            expect(sFragment).toContain('visible="{= ${adminView>/selectedUser/isLocked} === false &amp;&amp; !${adminView>/selectedUser/protectedReason} }"');
            expect(sFragment).toContain('visible="{= ${adminView>/selectedUser/isLocked} === true }"');
        });

        test('formats SAP codes and date-times with the dictionary texts', () => {
            const { controller } = makeController([]);

            expect(controller.formatAdminDateTime('20261102', '101500')).toBe('02-11-2026 10:15:00');
            expect(controller.formatAdminDateTime('00000000', '000000')).toBe('-');
            expect(controller.formatAdminValidity('20250101', '99991231')).toBe('01-01-2025 - 31-12-9999');
            expect(controller.formatAdminLockFlag('U')).toBe('Not Locked');
            expect(controller.formatAdminLockFlag('L')).toBe('Locked');
            expect(controller.formatAdminUserType('')).toBe('-');
            expect(controller.formatAdminUserType('Q')).toBe('Q');
        });
    });

    test('sorts ascending first, toggles on the same column, and restarts ascending on another', () => {
        const { controller } = makeController([]);
        const oBinding = { sort: jest.fn() };
        const fnColumn = (sProperty) => ({
            getHeader: () => ({ data: () => sProperty }),
            setSortIndicator: jest.fn()
        });
        const oUsername = fnColumn('username');
        const oActions = fnColumn(null);
        controller.byId = () => ({ getColumns: () => [oUsername, oActions], getBinding: () => oBinding });
        const fnPress = (sProperty) => controller.onSortUsers({ getSource: () => ({ data: () => sProperty }) });

        fnPress('username');
        expect(oBinding.sort).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'username', descending: false }));
        expect(oUsername.setSortIndicator).toHaveBeenLastCalledWith('Ascending');
        expect(oActions.setSortIndicator).toHaveBeenLastCalledWith('None');

        fnPress('username');
        expect(oBinding.sort).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'username', descending: true }));
        expect(oUsername.setSortIndicator).toHaveBeenLastCalledWith('Descending');

        fnPress('userType');
        expect(oBinding.sort).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'userType', descending: false }));
        expect(oUsername.setSortIndicator).toHaveBeenLastCalledWith('None');
    });

    describe('list view', () => {
        const row = (username, extra = {}) => ({ username, fullName: username, detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20260101', lastChangedBy: 'ADMIN', protectedReason: '', selected: false, ...extra });

        test('a load asks for up to the service limit, and counts follow the filters', async () => {
            const { controller, model } = makeController([], { filters: { ...Logic.emptyFilters(), lockStatus: 'locked' } });
            mockODataClient.get.mockResolvedValue({ value: [row('A'), row('B', { isLocked: true })] });

            await controller._loadAdminUsers();

            expect(mockODataClient.get).toHaveBeenCalledWith("/odata/v4/user-management/listUsers(search='',maxRows=1000)");
            expect(model.getProperty('/userCount')).toBe(1);
            expect(model.getProperty('/kpis')).toMatchObject({ total: 2, active: 1, locked: 1 });
            expect(model.getProperty('/listLimitText')).toBe('');
        });

        test('a full page warns that the list may be cut off', async () => {
            const { controller, model } = makeController([]);
            mockODataClient.get.mockResolvedValue({ value: Array.from({ length: 1000 }, (_, i) => row(`U${i}`)) });

            await controller._loadAdminUsers();

            expect(model.getProperty('/listLimitText')).toContain('1000');
        });

        test('a failed load shows the Failed card state and the error text', async () => {
            const { controller, model } = makeController([row('A')]);
            mockODataClient.get.mockRejectedValue(new Error('SAP down'));

            await controller._loadAdminUsers();

            expect(model.getProperty('/kpis').total).toBeNull();
            expect(model.getProperty('/users')).toEqual([]);
            expect(mockMessageToast.show).toHaveBeenCalledWith('SAP down');
        });

        test('a reload keeps the selection, except users that became unselectable', async () => {
            const { controller, model } = makeController([row('A', { selected: true }), row('B', { selected: true })]);
            mockODataClient.get.mockResolvedValue({ value: [row('A'), row('B', { protectedReason: 'type' })] });

            await controller._loadAdminUsers();

            expect(model.getProperty('/users').map((user) => user.selected)).toEqual([true, false]);
        });

        test('a filter deselects rows it hides, so a bulk action only reaches rows on screen', () => {
            const { controller, model } = makeController([row('A', { selected: true }), row('B', { selected: true, isLocked: true })]);

            controller._mergeAdminFilters({ lockStatus: 'locked' });

            expect(model.getProperty('/users').map((user) => user.selected)).toEqual([false, true]);
            expect(model.getProperty('/selection').count).toBe(1);
            expect(model.getProperty('/chips').map((chip) => chip.key)).toEqual(['lockStatus:']);
        });

        test('select all takes filtered selectable rows only', () => {
            const users = [row('A'), row('P', { protectedReason: 'self' }), row('L', { isLocked: true })];
            const { controller, model } = makeController(users, { filters: { ...Logic.emptyFilters(), lockStatus: 'active' } });

            controller.onSelectAllUsers({ getParameter: () => true });

            expect(users.map((user) => user.selected)).toEqual([true, false, false]);
            expect(model.getProperty('/selection')).toMatchObject({ count: 1, canLock: true, canUnlock: false });
        });

        test('search waits for the debounce before filtering', () => {
            jest.useFakeTimers();
            const { controller, model } = makeController([row('A')]);

            controller.onSearchUsersLive({ getParameter: () => 'x' });
            expect(model.getProperty('/filters/search')).toBe('');
            jest.advanceTimersByTime(300);
            expect(model.getProperty('/filters/search')).toBe('x');
            jest.useRealTimers();
        });

        test('export writes the filtered rows in sort order', () => {
            const { controller } = makeController([row('A', { isLocked: true }), row('C'), row('B')], { filters: { ...Logic.emptyFilters(), lockStatus: 'active' } });
            controller._oAdminSort = { property: 'username', descending: true };

            controller.onExportUsers();

            const sCsv = mockFile.save.mock.calls[0][0];
            expect(sCsv.split('\r\n').slice(1).map((line) => line.split(',')[0])).toEqual(['C', 'B']);
        });

        test('the tooltip says why a user cannot be selected', () => {
            const { controller } = makeController([]);
            expect(controller.formatAdminSelectTooltip('A', 'type', true)).toContain('System and Service');
            expect(controller.formatAdminSelectTooltip('A', 'self', true)).toContain('your own user');
            expect(controller.formatAdminSelectTooltip('A', 'connection', true)).toContain('connects to SAP');
            expect(controller.formatAdminSelectTooltip('A', '', false)).toContain('could not be read');
            expect(controller.formatAdminSelectTooltip('A', '', true)).toBe('Select user A');
        });
    });

    describe('bulk lock and unlock', () => {
        const row = (username, extra = {}) => ({ username, fullName: username, detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20260101', lastChangedBy: 'ADMIN', protectedReason: '', selected: true, ...extra });
        /** A stub SAP: posts succeed, except names in `fail`; reads report the state each action left. */
        function stubSap(state = {}, fail = []) {
            mockODataClient.post.mockImplementation(async (url, body) => {
                if (fail.includes(body.username)) {
                    throw Object.assign(new Error('No authorization'), { code: 'SU/001' });
                }
                state[body.username] = url.endsWith('/lockUser');
                return { success: true, status: 'success', messages: [], message: 'done' };
            });
            mockODataClient.get.mockImplementation(async (url) => {
                const username = /username='([^']*)'/.exec(url)[1];
                return { username, isLocked: state[username] === true };
            });
        }
        const open = (controller, action) => {
            controller._openBulkConfirm(action);
            return controller.onConfirmBulk();
        };

        beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
        afterEach(() => jest.useRealTimers());

        test('the confirm dialog previews ten names, and counts the skipped', () => {
            const users = Array.from({ length: 12 }, (_, i) => row(`U${i}`)).concat(row('L', { isLocked: true }));
            const { controller, model, control } = makeController(users);

            controller._openBulkConfirm('lock');

            const bulk = model.getProperty('/bulk');
            expect(control('userBulkConfirmDialog').open).toHaveBeenCalled();
            expect(bulk.run).toHaveLength(12);
            expect(bulk.preview).toContain('U9 and 2 more');
            expect(bulk.preview).not.toContain('U10');
            expect(bulk.skippedText).toContain('1 already');
        });

        test('runs per user with the reason, reads each back, and summarizes', async () => {
            const { controller, model, control } = makeController([row('A'), row('B', { isLocked: true })]);
            stubSap();
            controller._openBulkConfirm('lock');
            model.setProperty('/bulk/reason', 'Left the company');

            await controller.onConfirmBulk();

            expect(mockODataClient.post.mock.calls).toEqual([['/odata/v4/user-management/lockUser', { username: 'A', reason: 'Left the company' }]]);
            expect(model.getProperty('/bulk/summary')).toBe('1 succeeded · 0 failed · 1 skipped');
            expect(control('userBulkProgressDialog').close).toHaveBeenCalled();
            expect(control('userBulkResultDialog').open).toHaveBeenCalled();
            expect(model.getProperty('/users/0/isLocked')).toBe(true);
        });

        test('never runs more than five at once', async () => {
            const { controller } = makeController(Array.from({ length: 12 }, (_, i) => row(`U${i}`)));
            let running = 0;
            let peak = 0;
            mockODataClient.post.mockImplementation(async () => {
                running++;
                peak = Math.max(peak, running);
                await new Promise((resolve) => setImmediate(resolve));
                running--;
                return { status: 'success', messages: [] };
            });
            mockODataClient.get.mockImplementation(async (url) => ({ username: /username='([^']*)'/.exec(url)[1], isLocked: true }));

            await open(controller, 'lock');

            expect(peak).toBe(5);
        });

        test('a failure keeps its BAPI message and its row selected; successes are deselected', async () => {
            const users = [row('OK'), row('BAD')];
            const { controller, model } = makeController(users);
            stubSap({}, ['BAD']);

            await open(controller, 'lock');

            const bad = model.getProperty('/bulk/results').find((r) => r.username === 'BAD');
            expect(bad).toMatchObject({ status: 'error', message: 'No authorization', technical: 'E SU/001: No authorization', state: 'Error' });
            expect(model.getProperty('/users').map((user) => [user.username, user.selected])).toEqual([['OK', false], ['BAD', true]]);
            expect(model.getProperty('/bulk/failed')).toBe(1);
        });

        test('accepted by SAP but with the wrong state afterwards counts as failed', async () => {
            const { controller, model } = makeController([row('A')]);
            mockODataClient.post.mockResolvedValue({ status: 'success', messages: [] });
            mockODataClient.get.mockResolvedValue({ username: 'A', isLocked: false });

            await open(controller, 'lock');

            expect(model.getProperty('/bulk/summary')).toBe('0 succeeded · 1 failed · 0 skipped');
            expect(model.getProperty('/bulk/results')[0].message).toContain('did not confirm');
        });

        test('accepted by SAP with a failed read-back is a warning, and its row becomes unavailable', async () => {
            const { controller, model } = makeController([row('A')]);
            mockODataClient.post.mockResolvedValue({ status: 'success', messages: [] });
            mockODataClient.get.mockRejectedValue(new Error('Read failed'));

            await open(controller, 'lock');

            expect(model.getProperty('/bulk/results')[0].status).toBe('warning');
            expect(model.getProperty('/users/0').detailsAvailable).toBe(false);
        });

        test('a BAPI warning is shown and still counts as succeeded', async () => {
            const { controller, model } = makeController([row('A')]);
            mockODataClient.post.mockResolvedValue({ status: 'warning', messages: [{ type: 'W', id: 'SU', number: '002', message: 'Careful' }] });
            mockODataClient.get.mockResolvedValue({ username: 'A', isLocked: true });

            await open(controller, 'lock');

            expect(model.getProperty('/bulk/results')[0]).toMatchObject({ status: 'warning', message: 'Careful', technical: 'W SU/002: Careful', state: 'Warning' });
            expect(model.getProperty('/bulk/summary')).toBe('1 succeeded · 0 failed · 0 skipped');
        });

        test('cancel stops new calls, and reports the rest as skipped and still selected', async () => {
            const users = Array.from({ length: 8 }, (_, i) => row(`U${i}`));
            const { controller, model } = makeController(users);
            let calls = 0;
            mockODataClient.post.mockImplementation(async () => {
                calls++;
                controller.onCancelBulkRun();
                await new Promise((resolve) => setImmediate(resolve));
                return { status: 'success', messages: [] };
            });
            mockODataClient.get.mockImplementation(async (url) => ({ username: /username='([^']*)'/.exec(url)[1], isLocked: true }));

            await open(controller, 'lock');

            expect(calls).toBeLessThanOrEqual(5);
            const sum = Logic.aggregateResults(model.getProperty('/bulk/results'));
            expect(sum.succeeded + sum.skipped).toBe(8);
            expect(sum.skipped).toBe(8 - calls);
            expect(model.getProperty('/users').filter((user) => user.selected)).toHaveLength(8 - calls);
        });

        test('retry runs only the failed users, with the same action and reason', async () => {
            const { controller, model } = makeController([row('OK'), row('BAD')]);
            stubSap({}, ['BAD']);
            controller._openBulkConfirm('lock');
            model.setProperty('/bulk/reason', 'R');
            await controller.onConfirmBulk();
            mockODataClient.post.mockClear();
            stubSap({ OK: true });

            await controller.onRetryFailedBulk();

            expect(mockODataClient.post.mock.calls).toEqual([['/odata/v4/user-management/lockUser', { username: 'BAD', reason: 'R' }]]);
            expect(model.getProperty('/bulk/summary')).toBe('1 succeeded · 0 failed · 0 skipped');
        });

        test('undo applies the inverse to succeeded users only, once', async () => {
            const { controller, model } = makeController([row('OK'), row('BAD')]);
            stubSap({}, ['BAD']);
            await open(controller, 'lock');
            expect(model.getProperty('/undo/text')).toBe('1 users locked.');
            mockODataClient.post.mockClear();

            await controller.onUndoBulk();

            expect(mockODataClient.post.mock.calls).toEqual([['/odata/v4/user-management/unlockUser', { username: 'OK', reason: 'Undo of a bulk action' }]]);
            expect(model.getProperty('/undo/text')).toBe('');
        });

        test('undo is offered for ten seconds', async () => {
            const { controller, model } = makeController([row('OK')]);
            stubSap();
            await open(controller, 'lock');

            jest.advanceTimersByTime(9999);
            expect(model.getProperty('/undo/text')).not.toBe('');
            jest.advanceTimersByTime(1);
            expect(model.getProperty('/undo/text')).toBe('');
            await expect(controller.onUndoBulk()).resolves.toBeUndefined();
        });

        test('results download as CSV with status and BAPI details', async () => {
            const { controller } = makeController([row('BAD')]);
            stubSap({}, ['BAD']);
            await open(controller, 'lock');

            controller.onDownloadBulkResults();

            const sCsv = mockFile.save.mock.calls[mockFile.save.mock.calls.length - 1][0];
            expect(sCsv).toContain('BAD,error,No authorization,E SU/001: No authorization');
        });
    });

    test('uses the row username for a Lock/Unlock action', () => {
        const { controller } = makeController([{ username: 'ALICE' }]);
        const oEvent = {
            getSource: () => ({
                getBindingContext: () => ({ getProperty: () => 'ALICE' })
            })
        };

        expect(controller._getAdminActionUsername(oEvent)).toBe('ALICE');
    });

    test.each([
        ['Lock', 'onLockUser', '/odata/v4/user-management/lockUser', true],
        ['Unlock', 'onUnlockUser', '/odata/v4/user-management/unlockUser', false]
    ])('asks for confirmation before the row %s action', (_label, sHandler, sUrl, bExpectedLocked) => {
        const { controller } = makeController([{ username: 'ALICE' }]);
        const oEvent = {
            getSource: () => ({
                getBindingContext: () => ({ getProperty: () => 'ALICE' })
            })
        };
        controller._executeUserAction = jest.fn();
        mockMessageBox.confirm.mockImplementationOnce((_message, options) => options.onClose('OK'));

        controller[sHandler](oEvent);

        expect(mockMessageBox.confirm).toHaveBeenCalled();
        expect(controller._executeUserAction).toHaveBeenCalledWith(sUrl, 'ALICE', bExpectedLocked);
    });

    test('formats SAP date fields for display and treats 00000000 as unrestricted', () => {
        const { controller } = makeController([]);

        expect(controller.formatAdminDate('20261104')).toBe('04-11-2026');
        expect(controller.formatAdminDate('00000000')).toBe('-');
        expect(controller.formatAdminDate(null)).toBe('-');
    });

    test('updates the displayed row and reports success only after SAP confirms the lock state', async () => {
        const oUser = { username: 'ALICE', detailsAvailable: true, isLocked: false };
        const { controller, model } = makeController([oUser]);
        const oDetail = {
            username: 'ALICE',
            isLocked: true,
            userType: 'A',
            validFrom: '00000000',
            validTo: '00000000',
            lastChanged: '20261104',
            lastChangedBy: 'ADMIN'
        };
        mockODataClient.post.mockResolvedValue({ message: 'User locked' });
        mockODataClient.get.mockResolvedValue({ value: oDetail });

        await controller._executeUserAction('/odata/v4/user-management/lockUser', 'ALICE', true);

        expect(mockODataClient.post).toHaveBeenCalledWith(
            '/odata/v4/user-management/lockUser',
            { username: 'ALICE' }
        );
        expect(model.getProperty('/users/0')).toMatchObject({
            username: 'ALICE',
            detailsAvailable: true,
            isLocked: true,
            lastChangedBy: 'ADMIN'
        });
        expect(mockMessageToast.show).toHaveBeenCalledWith('User locked');
        expect(mockMessageBox.error).not.toHaveBeenCalled();
    });

    test('marks row status unavailable when SAP accepted an action but its detail read-back fails', async () => {
        const { controller, model } = makeController([
            { username: 'ALICE', detailsAvailable: true, isLocked: false }
        ]);
        mockODataClient.post.mockResolvedValue({ message: 'User locked' });
        mockODataClient.get.mockRejectedValue(new Error('Read failed'));

        await controller._executeUserAction('/odata/v4/user-management/lockUser', 'ALICE', true);

        expect(model.getProperty('/users/0')).toMatchObject({
            detailsAvailable: false,
            isLocked: null
        });
        expect(mockMessageBox.error).toHaveBeenCalledWith('Read failed');
        expect(mockMessageToast.show).not.toHaveBeenCalled();
    });

    test('shows the actual SAP lock state instead of claiming the requested action succeeded', async () => {
        const { controller, model } = makeController([
            { username: 'ALICE', detailsAvailable: true, isLocked: false }
        ]);
        mockODataClient.post.mockResolvedValue({ message: 'User locked' });
        mockODataClient.get.mockResolvedValue({ value: { username: 'ALICE', isLocked: false } });

        await controller._executeUserAction('/odata/v4/user-management/lockUser', 'ALICE', true);

        expect(model.getProperty('/users/0')).toMatchObject({ detailsAvailable: true, isLocked: false });
        expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('SAP did not confirm'));
        expect(mockMessageToast.show).not.toHaveBeenCalled();
    });
});
