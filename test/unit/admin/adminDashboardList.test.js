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

beforeAll(() => {
    global.sap = {
        ui: {
            define: jest.fn((dependencies, factory) => {
                DashboardController = factory(
                    MockBaseController,
                    MockJSONModel,
                    mockODataClient,
                    mockMessageToast,
                    mockAuthService,
                    mockMessageBox,
                    MockFilter,
                    { EQ: 'EQ' },
                    MockSorter,
                    { SortOrder: { Ascending: 'Ascending', Descending: 'Descending', None: 'None' } }
                );
            })
        }
    };
    require('../../../app/fiori-app/webapp/controller/Dashboard.controller.js');
});

beforeEach(() => {
    jest.clearAllMocks();
});

function makeController(aUsers) {
    const oModel = new MockJSONModel({
        users: aUsers,
        userCount: aUsers.length,
        selectedUser: null
    });
    const controller = new DashboardController();
    controller.getView = () => ({ getModel: () => oModel });
    controller.getOwnerComponent = () => null;
    return { controller, model: oModel };
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
        expect(sView).toContain('text="{adminView>fullName}"');
        expect(sView).not.toContain('text="{i18n>adminDetailValidFrom}"');
        expect(sView).not.toContain('text="{i18n>adminDetailValidTo}"');
        expect(sView).not.toContain('adminView>validFrom');
        expect(sView).not.toContain('adminView>validTo');
        expect(sView).toContain('detailsAvailable} &amp;&amp; !${adminView>isLocked}');
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

        test('the lock button needs a known lock state', () => {
            const sFragment = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/fragment/UserDetailPane.fragment.xml'), 'utf8');
            expect(sFragment).toContain('visible="{= ${adminView>/selectedUser/isLocked} === false }"');
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

    test('keeps search, filter and refresh in the table toolbar and removes the old section copies', () => {
        const sView = fs.readFileSync(
            path.join(__dirname, '../../../app/fiori-app/webapp/view/Dashboard.view.xml'),
            'utf8'
        );
        const sToolbar = sView.slice(sView.indexOf('id="adminUsersTable"')).match(/<OverflowToolbar>[\s\S]*?<\/OverflowToolbar>/)[0];
        ['id="adminLockStatusFilter"', 'id="adminUserSearchField"', 'id="btnRefreshUsers"'].forEach((sId) => {
            expect(sToolbar).toContain(sId);
            expect(sView.split(sId)).toHaveLength(2);
        });
        expect(sView).not.toContain('dashboardWelcomePrefix');
        expect(sView).not.toContain('auth>/user/username');
    });

    test.each([
        ['active', [['detailsAvailable', 'EQ', true], ['isLocked', 'EQ', false]]],
        ['locked', [['detailsAvailable', 'EQ', true], ['isLocked', 'EQ', true]]],
        ['unavailable', [['detailsAvailable', 'EQ', false]]]
    ])('filters the bound rows by the %s lock status', (sKey, aExpected) => {
        const { controller } = makeController([]);
        const oBinding = { filter: jest.fn() };
        controller.byId = () => ({ getBinding: () => oBinding });

        controller.onFilterUsersByLockStatus({ getSource: () => ({ getSelectedKey: () => sKey }) });

        const oFilter = oBinding.filter.mock.calls[0][0];
        expect(oFilter.args[0].and).toBe(true);
        expect(oFilter.args[0].filters.map((f) => f.args)).toEqual(aExpected);
    });

    test('clears the filter when All is selected', () => {
        const { controller } = makeController([]);
        const oBinding = { filter: jest.fn() };
        controller.byId = () => ({ getBinding: () => oBinding });

        controller.onFilterUsersByLockStatus({ getSource: () => ({ getSelectedKey: () => '' }) });

        expect(oBinding.filter).toHaveBeenCalledWith([]);
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

    test('shows the filtered row count in the toolbar', () => {
        const { controller, model } = makeController([{ username: 'ALICE' }, { username: 'BOB' }]);

        controller.onAdminUsersUpdated({ getParameter: (sName) => (sName === 'total' ? 1 : undefined) });

        expect(model.getProperty('/userCount')).toBe(1);
    });

    test('takes the count after a load from the filtered binding, not the rows SAP returned', async () => {
        const { controller, model } = makeController([]);
        controller.byId = () => ({ getBinding: () => ({ getLength: () => 1 }) });
        mockODataClient.get.mockResolvedValue({ value: [{ username: 'ALICE' }, { username: 'BOB' }] });

        await controller._loadAdminUsers('');

        expect(model.getProperty('/users')).toHaveLength(2);
        expect(model.getProperty('/userCount')).toBe(1);
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
