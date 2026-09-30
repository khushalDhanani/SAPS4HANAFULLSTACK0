/**
 * Unit Tests for GoodsIssue261Service (Movement 261 Goods Issue against a Reservation/Order)
 * Live SAP only — no injected placeholder orders, no mock/simulation fallback.
 */

let Service;
const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            Service = factory(mockODataClient);
        }
    }
};

require('../../../app/fiori-app/webapp/modules/wm/goods-issue/service/GoodsIssue261Service');

describe('GoodsIssue261Service Unit Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('postGoodsIssue', () => {
        it('should reject when payload is missing', async () => {
            await expect(Service.postGoodsIssue(null)).rejects.toThrow('Goods Issue payload is required');
        });

        it('should reject when neither reservation nor order is given', async () => {
            await expect(Service.postGoodsIssue({ IssueQty: 1, Material: 'M1' }))
                .rejects.toThrow('Either Reservation Number or Order Number is required');
        });

        it('should require a reservation item when a reservation number is given', async () => {
            await expect(Service.postGoodsIssue({ ReservationNo: '101', IssueQty: 1, Material: 'M1' }))
                .rejects.toThrow('Reservation Item is required');
        });

        it('should reject invalid quantities', async () => {
            await expect(Service.postGoodsIssue({ OrderNo: '1000611', IssueQty: 0, Material: 'M1' }))
                .rejects.toThrow('Quantity must be greater than zero');
        });

        it('should reject when material is missing', async () => {
            await expect(Service.postGoodsIssue({ OrderNo: '1000611', IssueQty: 1, Material: '' }))
                .rejects.toThrow('Material is required');
        });

        it('should assemble the 261 body (reservation path) and post it', async () => {
            mockODataClient.post.mockResolvedValue({ value: { MaterialDocument: '4900002222' } });

            const result = await Service.postGoodsIssue({
                ReservationNo: ' 101 ',
                ReservationItem: ' 1 ',
                Material: ' mat-1 ',
                Plant: ' 1710 ',
                StorageLocation: ' 0001 ',
                IssueQty: '7',
                Unit: ' ea ',
                Batch: ' b01 ',
                SerialNumbers: ['S1']
            });

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/postGoodsIssue261',
                {
                    ReservationNo: '101',
                    ReservationItem: '1',
                    OrderNo: '',
                    Material: 'MAT-1',
                    Plant: '1710',
                    StorageLocation: '0001',
                    IssueQty: 7,
                    Unit: 'EA',
                    Batch: 'B01',
                    PostingDate: null,
                    DocumentDate: null,
                    SerialNumbers: ['S1']
                }
            );
            expect(result.value.MaterialDocument).toBe('4900002222');
        });

        it('should accept the order path (OrderID) without a reservation', async () => {
            mockODataClient.post.mockResolvedValue({});
            await Service.postGoodsIssue({ OrderID: '1000611', IssueQty: 2, Material: 'M1' });
            const body = mockODataClient.post.mock.calls[0][1];
            expect(body.OrderNo).toBe('1000611');
            expect(body.ReservationNo).toBe('');
            expect(body.SerialNumbers).toEqual([]);
        });

        it('should propagate backend errors', async () => {
            mockODataClient.post.mockRejectedValue(new Error('Gateway down'));
            await expect(Service.postGoodsIssue({ OrderNo: '1', IssueQty: 1, Material: 'M1' }))
                .rejects.toThrow('Gateway down');
        });
    });

    describe('fetchOpenReservations', () => {
        it('should query open 261 reservations', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ ReservationNo: '201' }] });
            const result = await Service.fetchOpenReservations();
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/goods-issue/OpenReservations');
            expect(url).toContain('261');
            expect(url).toContain('$top=200');
            expect(result).toEqual([{ ReservationNo: '201' }]);
        });

        it('should propagate backend errors', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));
            await expect(Service.fetchOpenReservations()).rejects.toThrow('Backend offline');
        });
    });

    describe('fetchDistinctOrders (live-only, no placeholder orders)', () => {
        it('should derive distinct orders solely from live reservations', async () => {
            mockODataClient.get.mockResolvedValue({ value: [
                { OrderNo: '1000611', Plant: '1710', DisplayText: 'Order A' },
                { OrderNo: '1000611', Plant: '1710' },
                { OrderID: '1000608', Plant: '1720' },
                { OrderNo: '', Plant: '1710' }
            ] });

            const result = await Service.fetchDistinctOrders();

            expect(result).toHaveLength(2);
            const orders = result.map(function (o) { return o.OrderNo; });
            expect(orders).toContain('1000611');
            expect(orders).toContain('1000608');
            expect(result.find(function (o) { return o.OrderNo === '1000611'; }).Description).toBe('Order A');
        });

        it('should return an empty list when there are no live reservations (no injected 2000611/2000608)', async () => {
            mockODataClient.get.mockResolvedValue({ value: [] });
            const result = await Service.fetchDistinctOrders();
            expect(result).toEqual([]);
            const orders = result.map(function (o) { return o.OrderNo; });
            expect(orders).not.toContain('2000611');
            expect(orders).not.toContain('2000608');
        });

        it('should propagate errors (no fake-data fallback)', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));
            await expect(Service.fetchDistinctOrders()).rejects.toThrow('Backend offline');
        });
    });

    describe('reverseGoodsIssue', () => {
        it('should reject when document or year is missing', async () => {
            await expect(Service.reverseGoodsIssue('', '2026')).rejects.toThrow('Material Document number and year are required');
        });

        it('should post the reversal body with defaults', async () => {
            mockODataClient.post.mockResolvedValue({});
            await Service.reverseGoodsIssue(' 49 ', ' 2026 ');
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/reverseGoodsIssue',
                { MaterialDocument: '49', MaterialDocYear: '2026', PostingDate: null, ReversalReason: '01' }
            );
        });

        it('should propagate backend errors', async () => {
            mockODataClient.post.mockRejectedValue(new Error('Reversal failed'));
            await expect(Service.reverseGoodsIssue('49', '2026')).rejects.toThrow('Reversal failed');
        });
    });

    describe('fetchReservationItems', () => {
        it('should resolve an empty list when no reservation number is given', async () => {
            await expect(Service.fetchReservationItems('')).resolves.toEqual([]);
            expect(mockODataClient.get).not.toHaveBeenCalled();
        });

        it('should query GIItems filtered by reservation number', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ ReservationItem: '1' }] });
            const result = await Service.fetchReservationItems('101');
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/goods-issue/GIItems');
            expect(url).toContain('101');
            expect(result).toEqual([{ ReservationItem: '1' }]);
        });

        it('should propagate backend errors', async () => {
            mockODataClient.get.mockRejectedValue(new Error('GIItems down'));
            await expect(Service.fetchReservationItems('101')).rejects.toThrow('GIItems down');
        });
    });

    describe('fetchStockUnitsForItem / resolveScanUnit', () => {
        it('fetchStockUnitsForItem should build the function-import URL', async () => {
            mockODataClient.get.mockResolvedValue({ StockUnits: [] });
            await Service.fetchStockUnitsForItem('101', '1');
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/goods-issue/getStockUnitsForItem');
            expect(url).toContain("reservationNo='101'");
            expect(url).toContain("reservationItem='1'");
        });

        it('resolveScanUnit should build the function-import URL', async () => {
            mockODataClient.get.mockResolvedValue({ SuExists: true });
            await Service.resolveScanUnit('BC1', '101', '1');
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/goods-issue/resolveStockUnit');
            expect(url).toContain("suBarcode='BC1'");
            expect(url).toContain("reservationNo='101'");
        });
    });

    describe('fetchMaterialDetails', () => {
        it('should resolve null when no material given', async () => {
            await expect(Service.fetchMaterialDetails('')).resolves.toBeNull();
        });

        it('should fetch material metadata without plant', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ MaterialName: 'Steel', MaterialBaseUnit: 'KG' }] });
            const result = await Service.fetchMaterialDetails('MAT-1');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining("/odata/v4/purchase-order/MaterialVH?$filter=Material eq 'MAT-1'"));
            expect(result.unit).toBe('KG');
            expect(result.isBatchManaged).toBe(false);
        });

        it('should aggregate batch stock when a plant is given', async () => {
            mockODataClient.get
                .mockResolvedValueOnce({ value: [{ MaterialName: 'Steel', MaterialBaseUnit: 'KG' }] })
                .mockResolvedValueOnce({ value: [{ AvailableStock: 4 }, { AvailableStock: 6 }] });
            const result = await Service.fetchMaterialDetails('MAT-1', '1710');
            expect(result.isBatchManaged).toBe(true);
            expect(result.availableStock).toBe(10);
        });
    });
});
