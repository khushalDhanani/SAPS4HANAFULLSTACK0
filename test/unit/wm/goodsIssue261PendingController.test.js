/**
 * Unit Tests for GoodsIssue261Pending Controller (261 open production/order reservations)
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

require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue261Pending.controller');

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
    const oItem = { getBindingContext: (m) => (m === 'gi261p' ? oCtx : null) };
    return {
        getParameter: (p) => (p === 'listItem' && useListItem ? oItem : undefined),
        getSource: () => (useListItem ? null : oItem)
    };
}

describe('GoodsIssue261Pending Controller Unit Tests', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRouter.getRoute.mockReturnValue(mockRoute);
        mockService.fetchOpenReservations.mockResolvedValue([]);
        controller = new PendingController();
        controller.onInit();
    });

    describe('onInit', () => {
        it('should initialize the gi261p model with defaults', () => {
            const model = controller.getModel('gi261p');
            expect(model).toBeDefined();
            expect(model.getProperty('/items')).toEqual([]);
            expect(model.getProperty('/busy')).toBe(false);
            expect(model.getProperty('/error')).toBe('');
            expect(model.getProperty('/resultState')).toBe('None');
            expect(model.getProperty('/resultText')).toBe('');
        });

        it('should register the route pattern listener', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmGoodsIssue261Pending');
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(
                controller._onRouteMatched, controller
            );
        });
    });

    describe('_onRouteMatched / _loadPending', () => {
        it('should load open reservations from the service', async () => {
            const aItems = [
                { ReservationNo: '0000000201', OrderNo: '1000611' },
                { ReservationNo: '0000000202', OrderNo: '1000608' }
            ];
            mockService.fetchOpenReservations.mockResolvedValue(aItems);

            await controller._onRouteMatched(makeRouteEvent(null)); await flush();

            expect(mockService.fetchOpenReservations).toHaveBeenCalled();
            const model = controller.getModel('gi261p');
            expect(model.getProperty('/items')).toHaveLength(2);
            expect(model.getProperty('/busy')).toBe(false);
        });

        it('should tolerate a non-array service response', async () => {
            mockService.fetchOpenReservations.mockResolvedValue(undefined);
            await controller._onRouteMatched(makeRouteEvent(null)); await flush();
            expect(controller.getModel('gi261p').getProperty('/items')).toEqual([]);
        });

        it('should filter out a just-completed reservation with no remaining items and show posted result', async () => {
            const aItems = [
                { ReservationNo: '0000000201', ItemCount: 1 },
                { ReservationNo: '0000000202', ItemCount: 1 }
            ];
            mockService.fetchOpenReservations.mockResolvedValue(aItems);

            await controller._onRouteMatched(makeRouteEvent({
                resv: '0000000201', doc: '4900009999', year: '2026'
            })); await flush();

            const model = controller.getModel('gi261p');
            expect(model.getProperty('/items')).toHaveLength(1);
            expect(model.getProperty('/items')[0].ReservationNo).toBe('0000000202');
            expect(model.getProperty('/resultState')).toBe('Success');
            expect(model.getProperty('/resultText')).toContain('4900009999');
        });

        it('should keep a just-posted reservation listed when it still has further open items', async () => {
            const aItems = [
                { ReservationNo: '0000480960', ItemCount: 6 },
                { ReservationNo: '0000000202', ItemCount: 1 }
            ];
            mockService.fetchOpenReservations.mockResolvedValue(aItems);

            await controller._onRouteMatched(makeRouteEvent({
                resv: '0000480960', item: '0001', doc: '4900010000', year: '2026'
            })); await flush();

            const model = controller.getModel('gi261p');
            expect(model.getProperty('/items')).toHaveLength(2);
            expect(model.getProperty('/items')[0].ReservationNo).toBe('0000480960');
            expect(model.getProperty('/resultState')).toBe('Success');
            expect(model.getProperty('/resultText')).toContain('4900010000');
        });

        it('should hide a just-posted reservation whose fresh read shows only the posted item (commit lag)', async () => {
            const aItems = [
                { ReservationNo: '0000480960', ItemCount: 1 }
            ];
            mockService.fetchOpenReservations.mockResolvedValue(aItems);

            await controller._onRouteMatched(makeRouteEvent({
                resv: '0000480960', item: '0006', doc: '4900010001', year: '2026'
            })); await flush();

            const model = controller.getModel('gi261p');
            expect(model.getProperty('/items')).toHaveLength(0);
            expect(model.getProperty('/resultState')).toBe('Success');
        });
        // Queue tests removed — dispatch queue eliminated; direct posting only.

        it('should surface backend errors and clear the list', async () => {
            mockService.fetchOpenReservations.mockRejectedValue(new Error('Backend offline'));

            await controller._onRouteMatched(makeRouteEvent(null)); await flush();

            const model = controller.getModel('gi261p');
            expect(model.getProperty('/items')).toEqual([]);
            expect(model.getProperty('/error')).toBe('Backend offline');
            expect(model.getProperty('/busy')).toBe(false);
        });
    });

    describe('onCloseResult / onRefresh', () => {
        it('onCloseResult should clear the result banner', () => {
            const model = controller.getModel('gi261p');
            model.setProperty('/resultState', 'Success');
            model.setProperty('/resultText', 'done');
            controller.onCloseResult();
            expect(model.getProperty('/resultState')).toBe('None');
            expect(model.getProperty('/resultText')).toBe('');
        });

        it('onRefresh should reload open reservations', async () => {
            mockService.fetchOpenReservations.mockClear();
            mockService.fetchOpenReservations.mockResolvedValue([{ ReservationNo: '1' }]);
            await controller.onRefresh(); await flush();
            expect(mockService.fetchOpenReservations).toHaveBeenCalled();
        });
    });

    describe('onOpenReservation (row press navigation)', () => {
        it('should navigate to wmGoodsIssue261 with the reservation query param (listItem)', () => {
            controller.onOpenReservation(makeRowEvent('0000000201', true));
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue261', {
                '?query': { resv: '0000000201' }
            });
        });

        it('should navigate using getSource() when no listItem param', () => {
            controller.onOpenReservation(makeRowEvent('0000000202', false));
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue261', {
                '?query': { resv: '0000000202' }
            });
        });

        it('should do nothing when no binding context', () => {
            const evt = {
                getParameter: () => ({ getBindingContext: () => null }),
                getSource: () => null
            };
            controller.onOpenReservation(evt);
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });

        it('should do nothing when reservation number is empty', () => {
            controller.onOpenReservation(makeRowEvent('', true));
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });
    });

    describe('onNavBack', () => {
        it('should navigate back to the dashboard', () => {
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard');
        });
    });
});
