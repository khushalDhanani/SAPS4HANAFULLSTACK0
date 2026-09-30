/**
 * Unit Tests for GoodsIssue301Service (Movement 301 plant-to-plant transfer against a Reservation)
 * Live SAP only — no mock/simulation fallback.
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

require('../../../app/fiori-app/webapp/modules/wm/goods-issue/service/GoodsIssue301Service');

describe('GoodsIssue301Service Unit Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('postGoodsIssue', () => {
        it('should reject when payload is missing', async () => {
            await expect(Service.postGoodsIssue(null)).rejects.toThrow('Goods Issue payload is required');
        });

        it('should require reservation number and item', async () => {
            await expect(Service.postGoodsIssue({ IssueQty: 1, Material: 'M1' }))
                .rejects.toThrow('Reservation Number is required for Movement 301');
            await expect(Service.postGoodsIssue({ ReservationNo: '101', IssueQty: 1, Material: 'M1' }))
                .rejects.toThrow('Reservation Item is required for Movement 301');
        });

        it('should reject invalid quantities', async () => {
            await expect(Service.postGoodsIssue({ ReservationNo: '101', ReservationItem: '1', IssueQty: 0, Material: 'M1' }))
                .rejects.toThrow('Quantity must be greater than zero');
        });

        it('should reject when material is missing', async () => {
            await expect(Service.postGoodsIssue({ ReservationNo: '101', ReservationItem: '1', IssueQty: 1, Material: '' }))
                .rejects.toThrow('Material is required');
        });

        it('should assemble the 301 body (uppercased/trimmed) with receiving location and post it', async () => {
            mockODataClient.post.mockResolvedValue({ value: { MaterialDocument: '4900003333' } });

            const result = await Service.postGoodsIssue({
                ReservationNo: ' 101 ',
                ReservationItem: ' 1 ',
                Material: ' mat-1 ',
                Plant: ' 1710 ',
                StorageLocation: ' 0001 ',
                IssueQty: '9',
                Unit: ' ea ',
                Batch: ' b01 ',
                SerialNumbers: ['S1'],
                ReceivingPlant: ' 1720 ',
                ReceivingStorageLocation: ' 0002 '
            });

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/postGoodsIssue301',
                {
                    ReservationNo: '101',
                    ReservationItem: '1',
                    Material: 'MAT-1',
                    Plant: '1710',
                    StorageLocation: '0001',
                    IssueQty: 9,
                    Unit: 'EA',
                    Batch: 'B01',
                    PostingDate: null,
                    DocumentDate: null,
                    SerialNumbers: ['S1'],
                    ReceivingPlant: '1720',
                    ReceivingStorageLocation: '0002'
                }
            );
            expect(result.value.MaterialDocument).toBe('4900003333');
        });

        it('should default optional receiving fields to empty strings', async () => {
            mockODataClient.post.mockResolvedValue({});
            await Service.postGoodsIssue({ ReservationNo: '101', ReservationItem: '1', IssueQty: 1, Material: 'M1' });
            const body = mockODataClient.post.mock.calls[0][1];
            expect(body.ReceivingPlant).toBe('');
            expect(body.ReceivingStorageLocation).toBe('');
            expect(body.SerialNumbers).toEqual([]);
        });

        it('should propagate backend errors', async () => {
            mockODataClient.post.mockRejectedValue(new Error('Gateway down'));
            await expect(Service.postGoodsIssue({ ReservationNo: '101', ReservationItem: '1', IssueQty: 1, Material: 'M1' }))
                .rejects.toThrow('Gateway down');
        });
    });

    describe('reverseGoodsIssue', () => {
        it('should reject when document or year is missing', async () => {
            await expect(Service.reverseGoodsIssue('49', '')).rejects.toThrow('Material Document number and year are required');
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

    describe('fetchOpenReservations', () => {
        it('should query open 301 reservations', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ ReservationNo: '301' }] });
            const result = await Service.fetchOpenReservations();
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/goods-issue/OpenReservations');
            expect(url).toContain('301');
            expect(url).toContain('$top=200');
            expect(result).toEqual([{ ReservationNo: '301' }]);
        });

        it('should propagate backend errors', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));
            await expect(Service.fetchOpenReservations()).rejects.toThrow('Backend offline');
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

    describe('fetchPlants / fetchStorageLocations', () => {
        it('fetchPlants should fetch the receiving plant value help', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ Plant: '1720' }] });
            const result = await Service.fetchPlants();
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining('/odata/v4/purchase-order/PlantVH?$top=50'));
            expect(result).toEqual([{ Plant: '1720' }]);
        });

        it('fetchStorageLocations should filter by plant', async () => {
            mockODataClient.get.mockResolvedValue({ value: [] });
            await Service.fetchStorageLocations('1720');
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/purchase-order/StorageLocationVH');
            expect(url).toContain("Plant eq '1720'");
        });

        it('fetchStorageLocations should tolerate a bare array response', async () => {
            mockODataClient.get.mockResolvedValue([{ StorageLocation: '0002' }]);
            const result = await Service.fetchStorageLocations();
            expect(result).toEqual([{ StorageLocation: '0002' }]);
        });
    });
});
