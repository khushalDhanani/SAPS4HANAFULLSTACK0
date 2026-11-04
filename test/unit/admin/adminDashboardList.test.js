'use strict';

const fs = require('fs');
const path = require('path');

const mockODataClient = { get: jest.fn(), post: jest.fn() };
const mockMessageToast = { show: jest.fn() };
const mockMessageBox = { error: jest.fn(), confirm: jest.fn() };
mockMessageBox.Action = { OK: 'OK', CANCEL: 'CANCEL' };
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
                    { load: jest.fn() },
                    mockMessageBox
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
            'adminColLockStatus',
            'adminColUserType',
            'adminDetailValidFrom',
            'adminDetailValidTo',
            'adminColLastChanged',
            'adminDetailLastChangedBy',
            'adminDetailsUnavailable',
            'press=".onLockUser"',
            'press=".onUnlockUser"'
        ].forEach((sBinding) => expect(sView).toContain(sBinding));
        expect(sView).toContain('detailsAvailable} &amp;&amp; !${adminView>isLocked}');
        expect(sView).toContain('detailsAvailable} &amp;&amp; ${adminView>isLocked} === true');
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
