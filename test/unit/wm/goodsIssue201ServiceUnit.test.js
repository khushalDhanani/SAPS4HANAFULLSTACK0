/**
 * Unit Tests for GoodsIssue201Service (Movement 201 Goods Issue to Cost Center)
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

require('../../../app/fiori-app/webapp/modules/wm/goods-issue/service/GoodsIssue201Service');

describe('GoodsIssue201Service Unit Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('postGoodsIssue', () => {
        it('should reject when payload is missing', async () => {
            await expect(Service.postGoodsIssue(null)).rejects.toThrow('Goods Issue payload is required');
        });

        it('should reject invalid quantities', async () => {
            await expect(Service.postGoodsIssue({ IssueQty: 0 })).rejects.toThrow('Quantity must be greater than zero');
            await expect(Service.postGoodsIssue({ IssueQty: -3 })).rejects.toThrow('Quantity must be greater than zero');
            await expect(Service.postGoodsIssue({ IssueQty: 'abc' })).rejects.toThrow('Quantity must be greater than zero');
        });

        it('should reject when cost center is missing', async () => {
            await expect(Service.postGoodsIssue({ IssueQty: 5, CostCenter: '' })).rejects.toThrow('Cost Center is required');
        });

        it('should reject when material is missing', async () => {
            await expect(Service.postGoodsIssue({ IssueQty: 5, CostCenter: 'CC1', Material: '' }))
                .rejects.toThrow('Material is required');
        });

        it('should assemble the 201 body (uppercased/trimmed) and post it', async () => {
            mockODataClient.post.mockResolvedValue({ value: { MaterialDocument: '4900001234' } });

            const result = await Service.postGoodsIssue({
                CostCenter: ' cc-100 ',
                Material: ' mat-1 ',
                Plant: ' 1710 ',
                StorageLocation: ' 0001 ',
                IssueQty: '12',
                Unit: ' ea ',
                Batch: ' b01 ',
                PostingDate: '2026-09-30',
                DocumentDate: '2026-09-30',
                SerialNumbers: ['S1', 'S2'],
                ReservationNo: ' 101 ',
                ReservationItem: ' 1 '
            });

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/postGoodsIssue201',
                {
                    CostCenter: 'CC-100',
                    Material: 'MAT-1',
                    Plant: '1710',
                    StorageLocation: '0001',
                    IssueQty: 12,
                    Unit: 'EA',
                    Batch: 'B01',
                    PostingDate: '2026-09-30',
                    DocumentDate: '2026-09-30',
                    SerialNumbers: ['S1', 'S2'],
                    ReservationNo: '101',
                    ReservationItem: '1'
                }
            );
            expect(result.value.MaterialDocument).toBe('4900001234');
        });

        it('should default optional fields and empty serials', async () => {
            mockODataClient.post.mockResolvedValue({});
            await Service.postGoodsIssue({ CostCenter: 'CC1', Material: 'M1', IssueQty: 1 });
            const body = mockODataClient.post.mock.calls[0][1];
            expect(body.Batch).toBe('');
            expect(body.PostingDate).toBeNull();
            expect(body.SerialNumbers).toEqual([]);
            expect(body.ReservationNo).toBe('');
            expect(body.ReservationItem).toBe('');
        });

        it('should propagate backend errors (no mock fallback)', async () => {
            mockODataClient.post.mockRejectedValue(new Error('Gateway down'));
            await expect(Service.postGoodsIssue({ CostCenter: 'CC1', Material: 'M1', IssueQty: 1 }))
                .rejects.toThrow('Gateway down');
        });
    });

    describe('reverseGoodsIssue', () => {
        it('should reject when document or year is missing', async () => {
            await expect(Service.reverseGoodsIssue('', '2026')).rejects.toThrow('Material Document number and year are required');
            await expect(Service.reverseGoodsIssue('4900001234', '')).rejects.toThrow('Material Document number and year are required');
        });

        it('should post the reversal body with defaults', async () => {
            mockODataClient.post.mockResolvedValue({ value: { Reversed: true } });
            await Service.reverseGoodsIssue(' 4900001234 ', ' 2026 ');
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/reverseGoodsIssue',
                { MaterialDocument: '4900001234', MaterialDocYear: '2026', PostingDate: null, ReversalReason: '01' }
            );
        });

        it('should use the provided posting date and reversal reason', async () => {
            mockODataClient.post.mockResolvedValue({});
            await Service.reverseGoodsIssue('49', '2026', '2026-09-30', '02');
            const body = mockODataClient.post.mock.calls[0][1];
            expect(body.PostingDate).toBe('2026-09-30');
            expect(body.ReversalReason).toBe('02');
        });

        it('should propagate backend errors', async () => {
            mockODataClient.post.mockRejectedValue(new Error('Reversal failed'));
            await expect(Service.reverseGoodsIssue('49', '2026')).rejects.toThrow('Reversal failed');
        });
    });

    describe('fetchMaterialDetails', () => {
        it('should resolve null when no material given', async () => {
            await expect(Service.fetchMaterialDetails('')).resolves.toBeNull();
            expect(mockODataClient.get).not.toHaveBeenCalled();
        });

        it('should fetch material metadata without plant', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ MaterialName: 'Steel Bar', MaterialBaseUnit: 'KG' }] });
            const result = await Service.fetchMaterialDetails('MAT-1');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining("/odata/v4/purchase-order/MaterialVH?$filter=Material eq 'MAT-1'")
            );
            expect(mockODataClient.get.mock.calls[0][0]).toContain('$top=1');
            expect(result).toEqual({
                material: 'MAT-1',
                materialName: 'Steel Bar',
                unit: 'KG',
                isBatchManaged: false,
                availableStock: null,
                batches: []
            });
        });

        it('should aggregate batch stock when a plant is given', async () => {
            mockODataClient.get
                .mockResolvedValueOnce({ value: [{ MaterialName: 'Steel', MaterialBaseUnit: 'KG' }] })
                .mockResolvedValueOnce({ value: [{ AvailableStock: 10 }, { AvailableStock: 5 }] });

            const result = await Service.fetchMaterialDetails('MAT-1', '1710');

            expect(mockODataClient.get).toHaveBeenNthCalledWith(1,
                expect.stringContaining("Material eq 'MAT-1' and Plant eq '1710'"));
            expect(mockODataClient.get.mock.calls[1][0]).toContain('/odata/v4/goods-issue/MaterialBatches');
            expect(result.isBatchManaged).toBe(true);
            expect(result.availableStock).toBe(15);
            expect(result.batches).toHaveLength(2);
        });

        it('should fall back gracefully when the batch query fails', async () => {
            mockODataClient.get
                .mockResolvedValueOnce({ value: [{ MaterialName: 'Steel', MaterialBaseUnit: 'KG' }] })
                .mockRejectedValueOnce(new Error('no batches'));

            const result = await Service.fetchMaterialDetails('MAT-1', '1710');
            expect(result.isBatchManaged).toBe(false);
            expect(result.availableStock).toBeNull();
            expect(result.batches).toEqual([]);
        });

        it('should query live stock via revalidateStock for non-batch materials', async () => {
            mockODataClient.get
                .mockResolvedValueOnce({ value: [{ MaterialName: 'Safety Shoes', MaterialBaseUnit: 'NOS' }] })
                .mockResolvedValueOnce({ value: [] }) // no batches
                .mockResolvedValueOnce({ CurrentStock: 10, BaseUnit: 'NOS', StockReadSuccess: true }); // revalidateStock

            const result = await Service.fetchMaterialDetails('8000002212', '1120', 'HS01');
            expect(result.isBatchManaged).toBe(false);
            expect(result.availableStock).toBe(10);
            expect(result.unit).toBe('NOS');
            expect(mockODataClient.get.mock.calls[2][0]).toContain('/odata/v4/goods-issue/revalidateStock');
            expect(mockODataClient.get.mock.calls[2][0]).toContain("storageLocation='HS01'");
        });

        it('should propagate an error from the material query', async () => {
            mockODataClient.get.mockRejectedValue(new Error('MaterialVH down'));
            await expect(Service.fetchMaterialDetails('MAT-1')).rejects.toThrow('MaterialVH down');
        });
    });

    describe('fetchCostCenters / fetchCostCenterDetails / fetchPlants / fetchStorageLocations', () => {
        it('fetchCostCenterDetails should query CostCenterVH for specific cost center', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ CostCenter: '1011201601', CostCenterName: 'Electrical' }] });
            const result = await Service.fetchCostCenterDetails('1011201601');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining("/odata/v4/purchase-order/CostCenterVH?$filter=CostCenter eq '1011201601'&$top=1")
            );
            expect(result.CostCenterName).toBe('Electrical');
        });

        it('fetchCostCenterDetails should return null when cost center is empty', async () => {
            const result = await Service.fetchCostCenterDetails('');
            expect(result).toBeNull();
        });

        it('fetchCostCenters should build a plain URL and unwrap value', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ CostCenter: 'CC1' }] });
            const result = await Service.fetchCostCenters();
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining('/odata/v4/purchase-order/CostCenterVH?$top=50'));
            expect(result).toEqual([{ CostCenter: 'CC1' }]);
        });

        it('fetchCostCenters should add a contains filter when searching', async () => {
            mockODataClient.get.mockResolvedValue({ value: [] });
            await Service.fetchCostCenters('admin');
            expect(mockODataClient.get.mock.calls[0][0]).toContain("contains(CostCenter, 'admin')");
        });

        it('fetchPlants should fetch the plant value help', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ Plant: '1710' }] });
            const result = await Service.fetchPlants();
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining('/odata/v4/purchase-order/PlantVH?$top=50'));
            expect(result).toEqual([{ Plant: '1710' }]);
        });

        it('fetchStorageLocations should filter by plant', async () => {
            mockODataClient.get.mockResolvedValue({ value: [] });
            await Service.fetchStorageLocations('1710');
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/purchase-order/StorageLocationVH');
            expect(url).toContain("Plant eq '1710'");
        });

        it('fetchStorageLocations should tolerate a bare array response', async () => {
            mockODataClient.get.mockResolvedValue([{ StorageLocation: '0001' }]);
            const result = await Service.fetchStorageLocations();
            expect(result).toEqual([{ StorageLocation: '0001' }]);
        });
    });

    describe('fetchPendingReservations', () => {
        it('should query open 201 reservations', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ ReservationNo: '101' }] });
            const result = await Service.fetchPendingReservations();
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/goods-issue/OpenReservations');
            expect(url).toContain("MovementType eq '201'");
            expect(url).toContain('$top=200');
            expect(result).toEqual([{ ReservationNo: '101' }]);
        });

        it('should add a plant filter when provided', async () => {
            mockODataClient.get.mockResolvedValue({ value: [] });
            await Service.fetchPendingReservations('1710');
            expect(mockODataClient.get.mock.calls[0][0]).toContain("Plant eq '1710'");
        });

        it('should propagate backend errors', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));
            await expect(Service.fetchPendingReservations()).rejects.toThrow('Backend offline');
        });
    });

    describe('fetchReservationItems', () => {
        it('should query GIItems filtered by reservation number', async () => {
            mockODataClient.get.mockResolvedValue({ value: [{ ReservationItem: '1' }] });
            const result = await Service.fetchReservationItems('101');
            const url = mockODataClient.get.mock.calls[0][0];
            expect(url).toContain('/odata/v4/goods-issue/GIItems');
            expect(url).toContain("ReservationNo eq '101'");
            expect(result).toEqual([{ ReservationItem: '1' }]);
        });

        it('should propagate backend errors', async () => {
            mockODataClient.get.mockRejectedValue(new Error('GIItems down'));
            await expect(Service.fetchReservationItems('101')).rejects.toThrow('GIItems down');
        });
    });
});
