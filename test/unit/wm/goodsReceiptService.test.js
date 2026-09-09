const GoodsReceiptAdapter = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');

describe('GoodsReceiptService & GoodsReceiptAdapter Unit & Integration Tests', () => {

    describe('Input Validation & Error Handling', () => {

        it('should reject resolveStorageUnit when StorageUnit parameter is missing or empty', async () => {
            await expect(GoodsReceiptAdapter.resolveStorageUnit('')).rejects.toThrow(
                'Storage Unit Number is required.'
            );
            await expect(GoodsReceiptAdapter.resolveStorageUnit(null)).rejects.toThrow(
                'Storage Unit Number is required.'
            );
        });

        it('should reject postGoodsReceipt when StorageUnit and DeliveryDocument are missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10
            })).rejects.toThrow('Storage Unit / Inbound Delivery is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceipt when Material is missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10
            })).rejects.toThrow('Material is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceipt when Plant or StorageLocation is missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                StorageLocation: 'CS01',
                Quantity: 10
            })).rejects.toThrow('Plant is required to post Goods Receipt.');

            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                Quantity: 10
            })).rejects.toThrow('Storage Location is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceipt when Quantity is zero or negative', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 0
            })).rejects.toThrow('Quantity must be a positive number.');

            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: -5
            })).rejects.toThrow('Quantity must be a positive number.');
        });

        it('should block goods receipt with hard-stop when batch is expired', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Batch: 'EXPIRED_B1',
                ExpiryDate: '2020-01-01',
                Quantity: 10
            })).rejects.toThrow(/Expired Batch Blocked/);
        });
    });

    describe('Domain Logic & Helper Methods', () => {

        it('should correctly classify SLED statuses in _enrichBatchStatus helper', () => {
            // No SLED
            const noDate = GoodsReceiptAdapter._enrichBatchStatus(null);
            expect(noDate.StatusState).toBe('None');
            expect(noDate.StatusText).toBe('NO SLED');

            // Expired Date (past)
            const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
            const expired = GoodsReceiptAdapter._enrichBatchStatus(pastDate);
            expect(expired.StatusState).toBe('Error');
            expect(expired.StatusText).toBe('EXPIRED');
            expect(expired.DaysToExpiry).toBeLessThan(0);

            // Expiring soon (within 30 days)
            const soonDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
            const expiringSoon = GoodsReceiptAdapter._enrichBatchStatus(soonDate);
            expect(expiringSoon.StatusState).toBe('Warning');
            expect(expiringSoon.StatusText).toBe('EXPIRING SOON');

            // Valid Date (> 30 days)
            const farDate = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
            const valid = GoodsReceiptAdapter._enrichBatchStatus(farDate);
            expect(valid.StatusState).toBe('Success');
            expect(valid.StatusText).toBe('VALID');
        });

        it('should correctly parse and format dates in _formatDate helper', () => {
            expect(GoodsReceiptAdapter._formatDate(null)).toBe('');
            expect(GoodsReceiptAdapter._formatDate('')).toBe('');

            const epochOData = '/Date(1782259200000)/';
            const formatted = GoodsReceiptAdapter._formatDate(epochOData);
            expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('Verified Real SAP S/4HANA Integration Tests (Client 220)', () => {

        it('should query live open inbound deliveries via MMIM_GR4PO_DL_SRV', async () => {
            const deliveries = await GoodsReceiptAdapter.getOpenInboundDeliveries();
            expect(Array.isArray(deliveries)).toBe(true);
            expect(deliveries.length).toBeGreaterThan(0);

            const delivery18 = deliveries.find(d => d.DeliveryDocument === '180000001');
            expect(delivery18).toBeDefined();
            expect(delivery18.Material).toBe('1000000045');
            expect(delivery18.Plant).toBe('1120');
        });

        it('should query live storage locations for Material 1000000045 via MMIM_MATERIAL_DATA_SRV', async () => {
            const slocs = await GoodsReceiptAdapter.getMaterialStorageLocations('1000000045', '1120');
            expect(Array.isArray(slocs)).toBe(true);
            expect(slocs.length).toBeGreaterThan(0);

            const cs01 = slocs.find(s => s.StorageLocation === 'CS01');
            expect(cs01).toBeDefined();
            expect(cs01.StorageLocationName).toContain('Raw Material');
        });

        it('should query live batches for Material 1000000045 via LO_BM_BATCH_SRV', async () => {
            const batches = await GoodsReceiptAdapter.getMaterialBatches('1000000045', '1120', 'CS01');
            expect(Array.isArray(batches)).toBe(true);
            // Batches should be sorted by FEFO
            for (let i = 0; i < batches.length - 1; i++) {
                if (batches[i].ExpiryDate && batches[i + 1].ExpiryDate) {
                    expect(new Date(batches[i].ExpiryDate) <= new Date(batches[i + 1].ExpiryDate)).toBe(true);
                }
            }
        });

        it('should resolve Inbound Delivery 180000001 with correct type and parameters', async () => {
            const suDetails = await GoodsReceiptAdapter.resolveStorageUnit('180000001');
            expect(suDetails).toBeDefined();
            expect(suDetails.ScannedBarcode).toBe('180000001');
            expect(suDetails.ScannedType).toBe('INBOUND_DELIVERY');
            expect(suDetails.ScannedTypeLabel).toBe('Inbound Delivery');
            expect(suDetails.StorageUnit).toBe('180000001');
            expect(suDetails.DeliveryDocument).toBe('180000001');
            expect(suDetails.Material).toBe('1000000045');
            expect(suDetails.Plant).toBe('1120');
            expect(suDetails.PurchaseOrder).toBe('400000011');
            expect(suDetails.Supplier).toBe('200001');
            expect(Array.isArray(suDetails.AvailableStorageLocations)).toBe(true);
            expect(suDetails.AvailableStorageLocations.length).toBeGreaterThan(0);
        });

        it('should resolve Purchase Order barcode 400000011 and link to open delivery', async () => {
            const poDetails = await GoodsReceiptAdapter.resolveStorageUnit('400000011');
            expect(poDetails).toBeDefined();
            expect(poDetails.ScannedBarcode).toBe('400000011');
            expect(poDetails.ScannedType).toBe('PURCHASE_ORDER');
            expect(poDetails.ScannedTypeLabel).toBe('Purchase Order');
            expect(poDetails.PurchaseOrder).toBe('400000011');
            expect(poDetails.Material).toBe('1000000045');
            expect(poDetails.DeliveryDocument).toBe('180000001');
        });

        it('should resolve Batch barcode IN25000133 and auto-link material and delivery', async () => {
            const batchDetails = await GoodsReceiptAdapter.resolveStorageUnit('IN25000133');
            expect(batchDetails).toBeDefined();
            expect(batchDetails.ScannedBarcode).toBe('IN25000133');
            expect(batchDetails.ScannedType).toBe('BATCH');
            expect(batchDetails.ScannedTypeLabel).toBe('Batch');
            expect(batchDetails.Batch).toBe('IN25000133');
            expect(batchDetails.Material).toBe('1000000045');
            expect(batchDetails.ExpiryDate).toBeTruthy();
            expect(batchDetails.DeliveryDocument).toBe('180000001');
        });

        it('should resolve Material barcode 1000000045 to open delivery and parameters', async () => {
            const matDetails = await GoodsReceiptAdapter.resolveStorageUnit('1000000045');
            expect(matDetails).toBeDefined();
            expect(matDetails.ScannedBarcode).toBe('1000000045');
            expect(matDetails.ScannedType).toBe('MATERIAL');
            expect(matDetails.ScannedTypeLabel).toBe('Material / Product');
            expect(matDetails.Material).toBe('1000000045');
            expect(matDetails.DeliveryDocument).toBe('180000001');
        });

        it('should throw clear validation error with evaluated types breakdown when barcode is not found', async () => {
            await expect(GoodsReceiptAdapter.resolveStorageUnit('1000055885')).rejects.toThrow(
                /evaluated across active Inbound Deliveries, Purchase Orders, Materials, Batches, and Storage Units/
            );

            await expect(GoodsReceiptAdapter.resolveStorageUnit('NON_EXISTENT_SU_999999')).rejects.toThrow(
                /evaluated across active Inbound Deliveries, Purchase Orders, Materials, Batches, and Storage Units/
            );
        });

        it('should resolve Purchase Order barcode 300001007 via PoHelpSet fallback', async () => {
            const poDetails = await GoodsReceiptAdapter.resolveStorageUnit('300001007');
            expect(poDetails).toBeDefined();
            expect(poDetails.ScannedBarcode).toBe('300001007');
            expect(poDetails.ScannedType).toBe('PURCHASE_ORDER');
            expect(poDetails.PurchaseOrder).toBe('300001007');
            expect(poDetails.Material).toBe('8000004560');
            expect(poDetails.Plant).toBe('1140');
            expect(poDetails.Supplier).toBe('101245');
        });

        it('should successfully fetch CSRF token and cookie from MMIM_GR4PO_DL_SRV', async () => {
            await GoodsReceiptAdapter._fetchCsrfToken();
            expect(GoodsReceiptAdapter.csrfToken).toBeTruthy();
            expect(GoodsReceiptAdapter.cookie).toBeTruthy();
            expect(GoodsReceiptAdapter.cookie).toContain('sap-client=220');
        });

        it('should fail with transparent SAP backend error without mock persistence when posting fails', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Batch: 'IN25000133',
                Quantity: 10
            })).rejects.toThrow(/SAP S\/4HANA Backend Posting Capability Error/);
        });

        it('should have getStorageUnitDetails handler registered on GoodsReceiptService class', async () => {
            const GoodsReceiptService = require('../../../srv/wm/goods-receipt/service');
            const srv = new GoodsReceiptService('GoodsReceiptService');
            await srv.init();
            const registeredEvents = srv.handlers.on.map(h => h.on);
            expect(registeredEvents).toContain('getStorageUnitDetails');
            expect(registeredEvents).toContain('postGoodsReceipt');
        });
    });
});
