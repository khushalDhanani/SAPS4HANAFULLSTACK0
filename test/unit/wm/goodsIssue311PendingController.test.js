/**
 * Unit Tests for GoodsIssue311Pending Controller (Movement 311 Open Transfers)
 */

let PendingController;

class MockJSONModel {
    constructor(data) {
        this.data = JSON.parse(JSON.stringify(data || {}));
    }
    setData(data) {
        this.data = JSON.parse(JSON.stringify(data || {}));
    }
    getData() {
        return this.data;
    }
    getProperty(path) {
        const parts = path.replace(/^\//, '').split('/');
        let curr = this.data;
        for (const p of parts) {
            if (curr === undefined || curr === null) return undefined;
            curr = curr[p];
        }
        return curr;
    }
    setProperty(path, val) {
        const parts = path.replace(/^\//, '').split('/');
        let curr = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!curr[p]) curr[p] = {};
            curr = curr[p];
        }
        curr[parts[parts.length - 1]] = val;
    }
}

const mockService = {
    fetchOpenReservations: jest.fn()
};

const mockRoute = { attachPatternMatched: jest.fn() };
const mockRouter = {
    getRoute: jest.fn().mockReturnValue(mockRoute),
    navTo: jest.fn()
};

const mockBaseController = {
    extend: (name, proto) => {
        function Controller() {
            Object.assign(this, proto);
            this.models = {};
            this.getView = () => ({
                getModel: (n) => this.models[n],
                setModel: (m, n) => { this.models[n] = m; }
            });
            this.getModel = (n) => this.models[n] || null;
            this.setModel = (m, n) => { this.models[n] = m; };
            this.getRouter = () => mockRouter;
            this.getText = (key, args) => (args ? key + ':' + args.join(',') : key);
        }
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            PendingController = factory(mockBaseController, MockJSONModel, mockService);
        }
    }
};

require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue311Pending.controller');

const flush = () => new Promise(function (r) { setImmediate(r); });

function makeRouteEvent(query) {
    return {
        getParameter: (p) => (p === 'arguments' ? { '?query': query } : undefined)
    };
}

function makeRowEvent(resv, useListItem) {
    const oCtx = {
        getProperty: (prop) => (prop === 'ReservationNo' ? resv : undefined)
    };
    const oItem = { getBindingContext: (m) => (m === 'gi311p' ? oCtx : null) };
    return {
        getParameter: (p) => (p === 'listItem' && useListItem ? oItem : undefined),
        getSource: () => (useListItem ? null : oItem)
    };
}

describe('GoodsIssue311Pending Controller Unit Tests', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRouter.getRoute.mockReturnValue(mockRoute);
        mockService.fetchOpenReservations.mockResolvedValue([]);
        controller = new PendingController();
        controller.onInit();
    });

    describe('onInit', () => {
        it('should initialize the gi311p model with defaults', () => {
            const model = controller.getModel('gi311p');
            expect(model).toBeDefined();
            expect(model.getProperty('/items')).toEqual([]);
            expect(model.getProperty('/busy')).toBe(false);
            expect(model.getProperty('/error')).toBe('');
            expect(model.getProperty('/resultState')).toBe('None');
            expect(model.getProperty('/resultText')).toBe('');
        });

        it('should register the route pattern listener for wmGoodsIssue311Pending', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmGoodsIssue311Pending');
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(
                controller._onRouteMatched, controller
            );
        });

        it('should handle null router gracefully onInit', () => {
            const noRouterCtrl = new PendingController();
            noRouterCtrl.getRouter = () => null;
            expect(() => noRouterCtrl.onInit()).not.toThrow();
        });
    });

    describe('_onRouteMatched / _loadPending', () => {
        it('should load open 311 reservations from GoodsIssue311Service', async () => {
            const aItems = [
                { ReservationNo: '0000000301', Material: 'MAT-301', IssuingStorageLocation: '1121', ReceivingStorageLocation: 'HS02' },
                { ReservationNo: '0000000302', Material: 'MAT-302', IssuingStorageLocation: '1121', ReceivingStorageLocation: 'RD01' }
            ];
            mockService.fetchOpenReservations.mockResolvedValue(aItems);

            await controller._onRouteMatched(makeRouteEvent(null));
            await flush();

            expect(mockService.fetchOpenReservations).toHaveBeenCalled();
            const model = controller.getModel('gi311p');
            expect(model.getProperty('/items')).toHaveLength(2);
            expect(model.getProperty('/items')).toEqual(aItems);
            expect(model.getProperty('/busy')).toBe(false);
        });

        it('should tolerate non-array service responses', async () => {
            mockService.fetchOpenReservations.mockResolvedValue(null);
            await controller._onRouteMatched(makeRouteEvent(null));
            await flush();
            expect(controller.getModel('gi311p').getProperty('/items')).toEqual([]);
        });

        it('should filter out just-completed reservation and show Success result when material doc posted', async () => {
            const aItems = [
                { ReservationNo: '0000000301', Material: 'MAT-1' },
                { ReservationNo: '0000000302', Material: 'MAT-2' }
            ];
            mockService.fetchOpenReservations.mockResolvedValue(aItems);

            await controller._onRouteMatched(makeRouteEvent({
                resv: '0000000301', doc: '4900005678', year: '2026'
            }));
            await flush();

            const model = controller.getModel('gi311p');
            expect(model.getProperty('/items')).toHaveLength(1);
            expect(model.getProperty('/items')[0].ReservationNo).toBe('0000000302');
            expect(model.getProperty('/resultState')).toBe('Success');
            expect(model.getProperty('/resultText')).toContain('4900005678');
            expect(model.getProperty('/resultText')).toContain('0000000301');
        });

        it('should show queued Warning result when transfer was queued without material document', async () => {
            mockService.fetchOpenReservations.mockResolvedValue([
                { ReservationNo: '0000000301', Material: 'MAT-1' }
            ]);

            await controller._onRouteMatched(makeRouteEvent({
                resv: '0000000301', queued: 'Q-311-99'
            }));
            await flush();

            const model = controller.getModel('gi311p');
            expect(model.getProperty('/items')).toHaveLength(0);
            expect(model.getProperty('/resultState')).toBe('Warning');
            expect(model.getProperty('/resultText')).toContain('Q-311-99');
            expect(model.getProperty('/resultText')).toContain('0000000301');
        });

        it('should surface backend errors and clear items', async () => {
            mockService.fetchOpenReservations.mockRejectedValue(new Error('Gateway transfer service error'));

            await controller._onRouteMatched(makeRouteEvent(null));
            await flush();

            const model = controller.getModel('gi311p');
            expect(model.getProperty('/items')).toEqual([]);
            expect(model.getProperty('/error')).toBe('Gateway transfer service error');
            expect(model.getProperty('/busy')).toBe(false);
        });

        it('should use default error message if error has no message property', async () => {
            mockService.fetchOpenReservations.mockRejectedValue({});

            await controller._onRouteMatched(makeRouteEvent(null));
            await flush();

            const model = controller.getModel('gi311p');
            expect(model.getProperty('/error')).toBe('gi311OpenTransfersLoadError');
            expect(model.getProperty('/busy')).toBe(false);
        });
    });

    describe('onCloseResult / onRefresh', () => {
        it('should clear result banner state and text in onCloseResult', () => {
            const model = controller.getModel('gi311p');
            model.setProperty('/resultState', 'Success');
            model.setProperty('/resultText', 'Transfer Completed');
            controller.onCloseResult();
            expect(model.getProperty('/resultState')).toBe('None');
            expect(model.getProperty('/resultText')).toBe('');
        });

        it('should reload open transfers on onRefresh', async () => {
            mockService.fetchOpenReservations.mockClear();
            mockService.fetchOpenReservations.mockResolvedValue([{ ReservationNo: '0000000305' }]);
            await controller.onRefresh();
            await flush();
            expect(mockService.fetchOpenReservations).toHaveBeenCalled();
            expect(controller.getModel('gi311p').getProperty('/items')).toHaveLength(1);
        });
    });

    describe('onOpenReservation (row click navigation)', () => {
        it('should navigate to wmGoodsIssue311 with reservation query parameter using listItem parameter', () => {
            controller.onOpenReservation(makeRowEvent('0000000301', true));
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue311', {
                '?query': { resv: '0000000301' }
            });
        });

        it('should navigate using getSource() when listItem parameter is absent', () => {
            controller.onOpenReservation(makeRowEvent('0000000302', false));
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue311', {
                '?query': { resv: '0000000302' }
            });
        });

        it('should do nothing if binding context is missing', () => {
            const evt = {
                getParameter: () => ({ getBindingContext: () => null }),
                getSource: () => null
            };
            controller.onOpenReservation(evt);
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });

        it('should do nothing if reservation number is falsy', () => {
            controller.onOpenReservation(makeRowEvent('', true));
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });
    });

    describe('onNavBack', () => {
        it('should navigate back to dashboard', () => {
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard');
        });
    });
});
