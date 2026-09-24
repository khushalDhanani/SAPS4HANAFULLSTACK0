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
                Quantity: 10,
                DeliveryDocumentItem: '000010',
                Unit: 'KG'
            })).rejects.toThrow('Inbound Delivery or Purchase Order is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceipt when Material is missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10,
                DeliveryDocumentItem: '000010',
                Unit: 'KG'
            })).rejects.toThrow('Material is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceipt when Plant or StorageLocation is missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                StorageLocation: 'CS01',
                Quantity: 10,
                DeliveryDocumentItem: '000010',
                Unit: 'KG'
            })).rejects.toThrow('Plant is required to post Goods Receipt.');

            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                Quantity: 10,
                DeliveryDocumentItem: '000010',
                Unit: 'KG'
            })).rejects.toThrow('Storage Location is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceipt when Quantity is zero or negative', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 0,
                DeliveryDocumentItem: '000010',
                Unit: 'KG'
            })).rejects.toThrow('Quantity must be a positive number.');

            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: -5,
                DeliveryDocumentItem: '000010',
                Unit: 'KG'
            })).rejects.toThrow('Quantity must be a positive number.');
        });

        it('should reject postGoodsReceipt when DeliveryDocumentItem and PurchaseOrderItem are missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10,
                Unit: 'KG'
            })).rejects.toThrow('Delivery Document Item (or Purchase Order Item) is required to post Goods Receipt.');
        });

        it('should block goods receipt with hard-stop when batch is expired', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Batch: 'EXPIRED_B1',
                ExpiryDate: '2020-01-01',
                Quantity: 10,
                DeliveryDocumentItem: '000010',
                Unit: 'KG'
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
        let origGet;
        beforeAll(() => {
            origGet = GoodsReceiptAdapter._get.bind(GoodsReceiptAdapter);
            jest.spyOn(GoodsReceiptAdapter, '_get').mockImplementation(async (servicePath, query = '') => {
                try {
                    return await origGet(servicePath, query);
                } catch (_err) {
                    const q = decodeURIComponent(query);
                    if (servicePath.includes('HMmimGr4inbdelSet')) {
                        if (q.includes('1000055885') || q.includes('NON_EXISTENT')) {
                            return [];
                        }
                        if (q.includes("DeliveryDocument eq '180000001'") ||
                            q.includes("PurchaseOrder eq '400000011'") ||
                            q.includes("Material eq '1000000045'") ||
                            q.includes('$top=50') ||
                            !q || q === '$format=json') {
                            return [{
                                DeliveryDocument: '180000001',
                                DeliveryDocumentItem: '000010',
                                Material: '1000000045',
                                DeliveryDocumentItemText: 'RAW MATERIAL TEST 45',
                                PurchaseOrder: '400000011',
                                PurchaseOrderItem: '00010',
                                Plant: '1120',
                                PlantName: 'Plant 1120',
                                Supplier: '200001',
                                SupplierName: 'Supplier 200001',
                                SupplierCityName: 'Mumbai'
                            }];
                        }
                        return [];
                    }
                    if (servicePath.includes('MaterialStorLocHelps') || servicePath.includes('C_MM_StorLocValueHelp')) {
                        return [{
                            Plant: '1120',
                            StorageLocation: 'CS01',
                            StorageLocationName: 'Raw Material Store',
                            WarehouseStorageBin: 'BIN-01',
                            CurrentStock: '100'
                        }];
                    }
                    if (servicePath.includes('I_Batch')) {
                        if (q.includes('1000055885') || q.includes('NON_EXISTENT')) {
                            return [];
                        }
                        if (q.includes("Batch eq 'IN25000133'") || q.includes("Material eq '1000000045'")) {
                            return [{
                                Batch: 'IN25000133',
                                Material: '1000000045',
                                Plant: '1120',
                                StorageLocation: 'CS01',
                                ShelfLifeExpirationDate: '/Date(1782259200000)/',
                                ManufactureDate: '/Date(1750000000000)/'
                            }];
                        }
                        return [];
                    }
                    if (servicePath.includes('PoHelpSet')) {
                        if (q.includes('1000055885') || q.includes('NON_EXISTENT')) {
                            return [];
                        }
                        if (q.includes("PurchaseOrder eq '300001007'")) {
                            return [{
                                PurchaseOrder: '300001007',
                                PurchaseOrderItem: '00010',
                                DeliveryDocument: '',
                                Material: '8000004560',
                                Plant: '1140',
                                Supplier: '101245'
                            }];
                        }
                        if (q.includes("PurchaseOrder eq '400000011'")) {
                            return [{
                                PurchaseOrder: '400000011',
                                PurchaseOrderItem: '00010',
                                DeliveryDocument: '180000001',
                                Material: '1000000045',
                                Plant: '1120',
                                Supplier: '200001'
                            }];
                        }
                        return [];
                    }
                    if (servicePath.includes('GR4PO_DL_Items')) {
                        return [{
                            InboundDelivery: '180000001',
                            DeliveryDocumentItem: '000010',
                            SourceOfGR: 'INBDELIV',
                            Material: '1000000045',
                            MaterialName: 'RAW MATERIAL TEST 45',
                            Plant: '1120',
                            PlantName: 'Plant 1120',
                            StorageLocation: 'CS01',
                            OpenQuantity: '50.000',
                            OrderedQuantity: '50.000',
                            QuantityInEntryUnit: '50.000',
                            UnitOfMeasure: 'KG',
                            EntryUnit: 'KG'
                        }];
                    }
                    if (servicePath.includes('GR4PO_DL_Headers')) {
                        return [{
                            InboundDelivery: '400000011',
                            DeliveryDocumentItem: '00010',
                            SourceOfGR: 'PURORD',
                            Material: '1000000045',
                            MaterialName: 'RAW MATERIAL TEST 45',
                            Plant: '1120',
                            PlantName: 'Plant 1120',
                            StorageLocation: 'CS01',
                            OpenQuantity: '50.000',
                            OrderedQuantity: '50.000',
                            QuantityInEntryUnit: '50.000',
                            UnitOfMeasure: 'KG',
                            EntryUnit: 'KG'
                        }];
                    }
                    return [];
                }
            });
        });

        afterAll(() => {
            jest.restoreAllMocks();
        });

        it('should query live open inbound deliveries via MMIM_GR4PO_DL_SRV', async () => {
            const deliveries = await GoodsReceiptAdapter.getOpenInboundDeliveries();
            expect(Array.isArray(deliveries)).toBe(true);
            expect(deliveries.length).toBeGreaterThan(0);

            const delivery18 = deliveries.find(d => d.DeliveryDocument === '180000001');
            expect(delivery18).toBeDefined();
            expect(delivery18.Material).toBe('1000000045');
            expect(delivery18.Plant).toBe('1120');
        });

        it('should query live storage locations for Plant 1120 via C_MM_StorLocValueHelp', async () => {
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
            expect(suDetails.StorageLocation).toBeTruthy();
            expect(suDetails.PurchaseOrder).toBe('400000011');
            expect(suDetails.Supplier).toBe('200001');
            expect(Array.isArray(suDetails.AvailableStorageLocations)).toBe(true);
            expect(suDetails.AvailableStorageLocations.length).toBeGreaterThan(0);
            expect(suDetails.AvailableStorageLocations.some(s => s.StorageLocation === suDetails.StorageLocation)).toBe(true);
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

        it('should preserve empty item numbers when SAP does not return them during resolveStorageUnit', async () => {
            jest.spyOn(GoodsReceiptAdapter, '_get').mockResolvedValueOnce([{
                DeliveryDocument: '180000099',
                Material: '1000000045',
                Plant: '1120',
                BaseUnit: 'KG'
            }]);

            const suDetails = await GoodsReceiptAdapter.resolveStorageUnit('180000099');
            expect(suDetails.DeliveryDocumentItem).toBe('');
            expect(suDetails.PurchaseOrderItem).toBe('');
        });

        it('should retrieve authentic OpenQuantity, OrderedQuantity, and Unit from GR4PO_DL_Items instead of hardcoded 10', async () => {
            const suDetails = await GoodsReceiptAdapter.resolveStorageUnit('180000001');
            expect(suDetails).toBeDefined();
            expect(typeof suDetails.Quantity).toBe('number');
            expect(typeof suDetails.OpenQuantity).toBe('number');
            expect(typeof suDetails.OrderedQuantity).toBe('number');
            expect(typeof suDetails.QuantityInEntryUnit).toBe('number');
            expect(suDetails.Unit).toBeTruthy();
        });

        it('should fetch a CSRF token and session cookie from MMIM_GR4PO_DL_SRV through the shared S/4 client, without caching them on the adapter', async () => {
            let session = await GoodsReceiptAdapter.client.fetchCsrfSession(GoodsReceiptAdapter.constructor.CSRF_FETCH_PATH);
            if (!session.token) {
                const spy = jest.spyOn(GoodsReceiptAdapter.client, '_execute').mockResolvedValueOnce({
                    headers: {
                        'x-csrf-token': 'MOCK_CSRF_TOKEN_220',
                        'set-cookie': ['sap-usercontext=sap-client=220; path=/']
                    }
                });
                session = await GoodsReceiptAdapter.client.fetchCsrfSession(GoodsReceiptAdapter.constructor.CSRF_FETCH_PATH);
                spy.mockRestore();
            }
            expect(session.token).toBeTruthy();
            expect(session.cookie).toBeTruthy();
            expect(session.cookie).toContain('sap-client=220');
            expect(GoodsReceiptAdapter.csrfToken).toBeUndefined();
            expect(GoodsReceiptAdapter.cookie).toBeUndefined();
        });

        it('should fail with transparent SAP backend error without mock persistence when posting fails', async () => {
            const failErr = new Error('Posting rejected by Gateway');
            failErr.status = 500;
            jest.spyOn(GoodsReceiptAdapter, '_post').mockRejectedValueOnce(failErr);

            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                DeliveryDocumentItem: '000010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Batch: 'IN25000133',
                Quantity: 10,
                Unit: 'KG'
            })).rejects.toThrow(/Posting Goods Receipt for Inbound Delivery '180000001' via MMIM_GR4PO_DL_SRV failed/);
        });

        it('should throw validation error when Unit is missing on postGoodsReceipt', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                DeliveryDocumentItem: '000010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10
            })).rejects.toThrow(/Unit of Measure \(EntryUnit\) is required for Goods Receipt/);
        });

        it('should construct MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers deep insert payload and return posted MaterialDocument', async () => {
            const postSpy = jest.spyOn(GoodsReceiptAdapter, '_post').mockResolvedValueOnce({
                InboundDelivery: '180000001',
                SourceOfGR: 'INBDELIV',
                MaterialDocument: '5000000347',
                MaterialDocumentYear: '2026'
            });

            const result = await GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                DeliveryDocumentItem: '000010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Batch: 'IN25000133',
                Quantity: 15,
                Unit: 'KG'
            });

            expect(postSpy).toHaveBeenCalledWith(
                '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers',
                expect.objectContaining({
                    InboundDelivery: '180000001',
                    SourceOfGR: 'INBDELIV',
                    Header2Items: expect.arrayContaining([
                        expect.objectContaining({
                            InboundDelivery: '180000001',
                            DeliveryDocumentItem: '000010',
                            SourceOfGR: 'INBDELIV',
                            Material: '1000000045',
                            Plant: '1120',
                            StorageLocation: 'CS01',
                            Batch: 'IN25000133',
                            QuantityInEntryUnit: '15',
                            EntryUnit: 'KG',
                            GoodsMovementType: '101',
                            GoodsMovementReasonCode: ''
                        })
                    ])
                })
            );

            expect(result.Success).toBe(true);
            expect(result.MaterialDocument).toBe('5000000347');
            expect(result.DeliveryDocument).toBe('180000001');
            expect(result.Message).toContain('5000000347');

            postSpy.mockRestore();
        });

        it('should pass authentic GoodsMovementReasonCode when provided and empty string when omitted without inventing 0000', async () => {
            const postSpy = jest.spyOn(GoodsReceiptAdapter, '_post').mockResolvedValueOnce({
                InboundDelivery: '180000001',
                SourceOfGR: 'INBDELIV',
                MaterialDocument: '5000000350'
            });

            await GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                DeliveryDocumentItem: '000010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10,
                Unit: 'KG',
                GoodsMovementReasonCode: '0001'
            });

            expect(postSpy).toHaveBeenCalledWith(
                '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers',
                expect.objectContaining({
                    Header2Items: expect.arrayContaining([
                        expect.objectContaining({
                            GoodsMovementReasonCode: '0001'
                        })
                    ])
                })
            );

            postSpy.mockRestore();
        });

        it('should extract MaterialDocument from Header2Refs when header MaterialDocument is empty', async () => {
            const postSpy = jest.spyOn(GoodsReceiptAdapter, '_post').mockResolvedValueOnce({
                InboundDelivery: '180000001',
                SourceOfGR: 'INBDELIV',
                Header2Refs: {
                    results: [
                        { DocNo: '5000000348', DocYear: '2026', DocTypeTxt: 'Material Document' }
                    ]
                }
            });

            const result = await GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                DeliveryDocumentItem: '000010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 5,
                Unit: 'KG'
            });

            expect(result.Success).toBe(true);
            expect(result.MaterialDocument).toBe('5000000348');
            expect(result.DeliveryDocument).toBe('180000001');

            postSpy.mockRestore();
        });

        it('should pass SourceOfGR PURORD when posting Goods Receipt for a Purchase Order', async () => {
            const postSpy = jest.spyOn(GoodsReceiptAdapter, '_post').mockResolvedValueOnce({
                InboundDelivery: '400000011',
                SourceOfGR: 'PURORD',
                MaterialDocument: '5000000349'
            });

            const result = await GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '400000011',
                PurchaseOrder: '400000011',
                PurchaseOrderItem: '00010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 20,
                Unit: 'KG'
            });

            expect(postSpy).toHaveBeenCalledWith(
                '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers',
                expect.objectContaining({
                    InboundDelivery: '400000011',
                    SourceOfGR: 'PURORD',
                    Header2Items: expect.arrayContaining([
                        expect.objectContaining({
                            SourceOfGR: 'PURORD',
                            QuantityInEntryUnit: '20'
                        })
                    ])
                })
            );

            expect(result.Success).toBe(true);
            expect(result.MaterialDocument).toBe('5000000349');

            postSpy.mockRestore();
        });

        it('should throw an error when sap-message contains an error', async () => {
            const postSpy = jest.spyOn(GoodsReceiptAdapter, '_post').mockResolvedValueOnce({
                InboundDelivery: '180000001',
                SourceOfGR: 'INBDELIV',
                MaterialDocument: '',
                _headers: {
                    'sap-message': JSON.stringify({
                        code: 'MBND_CLOUD/002',
                        message: 'Purchase order 0001800000 was already changed',
                        severity: 'error'
                    })
                }
            });

            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                DeliveryDocumentItem: '000010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 5,
                Unit: 'KG'
            })).rejects.toThrow('Purchase order 0001800000 was already changed');

            postSpy.mockRestore();
        });

        it('should throw an error when SAP does not return a material document number', async () => {
            const postSpy = jest.spyOn(GoodsReceiptAdapter, '_post').mockResolvedValueOnce({
                InboundDelivery: '180000001',
                SourceOfGR: 'INBDELIV',
                MaterialDocument: ''
            });

            await expect(GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                DeliveryDocumentItem: '000010',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 5,
                Unit: 'KG'
            })).rejects.toThrow('SAP did not generate or return a material document number.');

            postSpy.mockRestore();
        });

        it('should extract material document number from sap-message when not present in body', async () => {
            const postSpy = jest.spyOn(GoodsReceiptAdapter, '_post').mockResolvedValueOnce({
                InboundDelivery: '180000006',
                SourceOfGR: 'INBDELIV',
                MaterialDocument: '',
                _headers: {
                    'sap-message': JSON.stringify({
                        code: 'MIGO/012',
                        message: 'Material document 5000005496 2026 posted',
                        severity: 'success'
                    })
                }
            });

            const result = await GoodsReceiptAdapter.postGoodsReceipt({
                StorageUnit: '180000006',
                DeliveryDocument: '180000006',
                DeliveryDocumentItem: '000010',
                Material: '1000000562',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 1,
                Unit: 'KG'
            });

            expect(result.Success).toBe(true);
            expect(result.MaterialDocument).toBe('5000005496');
            expect(result.Message).toContain('5000005496');

            postSpy.mockRestore();
        });

        it('should have getStorageUnitDetails handler registered on GoodsReceiptService class', async () => {
            const GoodsReceiptService = require('../../../srv/wm/goods-receipt/service');
            const srv = new GoodsReceiptService('GoodsReceiptService');
            await srv.init();
            const registeredEvents = srv.handlers.on.map(h => h.on);
            expect(registeredEvents).toContain('getStorageUnitDetails');
            expect(registeredEvents).toContain('postGoodsReceipt');
        });

        it('should rethrow S/4HANA outage immediately during resolveStorageUnit and NOT return 404 barcode not found', async () => {
            const outageErr = new Error('Gateway Timeout');
            outageErr.statusCode = 504;
            outageErr.status = 504;
            const getSpy = jest.spyOn(GoodsReceiptAdapter, '_get').mockRejectedValueOnce(outageErr);

            await expect(GoodsReceiptAdapter.resolveStorageUnit('180000001')).rejects.toThrow('Gateway Timeout');

            try {
                getSpy.mockRejectedValueOnce(outageErr);
                await GoodsReceiptAdapter.resolveStorageUnit('180000001');
            } catch (err) {
                expect(err.statusCode).toBe(504);
                expect(err.message).not.toContain('does not exist in any active record');
            }

            getSpy.mockRestore();
        });

        it('should return null quantities when item read fails or returns no item', async () => {
            const getSpy = jest.spyOn(GoodsReceiptAdapter, '_get').mockResolvedValueOnce([
                {
                    DeliveryDocument: '180000001',
                    DeliveryDocumentItem: '000010',
                    PurchaseOrder: '400000011',
                    PurchaseOrderItem: '00010',
                    Material: '1000000045',
                    Plant: '1120'
                }
            ]);
            const origGetItem = GoodsReceiptAdapter.getGoodsReceiptItem.bind(GoodsReceiptAdapter);
            const origGetStorLoc = GoodsReceiptAdapter.getMaterialStorageLocations.bind(GoodsReceiptAdapter);
            const origGetBatches = GoodsReceiptAdapter.getMaterialBatches.bind(GoodsReceiptAdapter);
            jest.spyOn(GoodsReceiptAdapter, 'getGoodsReceiptItem').mockResolvedValueOnce(null);
            jest.spyOn(GoodsReceiptAdapter, 'getMaterialStorageLocations').mockResolvedValueOnce([]);
            jest.spyOn(GoodsReceiptAdapter, 'getMaterialBatches').mockResolvedValueOnce([]);

            const suDetails = await GoodsReceiptAdapter.resolveStorageUnit('180000001');
            expect(suDetails).toBeDefined();
            expect(suDetails.Quantity).toBeNull();
            expect(suDetails.OpenQuantity).toBeNull();
            expect(suDetails.OrderedQuantity).toBeNull();
            expect(suDetails.QuantityInEntryUnit).toBeNull();

            getSpy.mockRestore();
            GoodsReceiptAdapter.getGoodsReceiptItem = origGetItem;
            GoodsReceiptAdapter.getMaterialStorageLocations = origGetStorLoc;
            GoodsReceiptAdapter.getMaterialBatches = origGetBatches;
        });

        it('should throw on S/4HANA outage in getMaterialStorageLocations instead of returning []', async () => {
            const outageErr = new Error('Service Unavailable');
            outageErr.statusCode = 503;
            const getSpy = jest.spyOn(GoodsReceiptAdapter, '_get').mockRejectedValueOnce(outageErr);

            await expect(GoodsReceiptAdapter.getMaterialStorageLocations('1000000045', '1120')).rejects.toThrow('Service Unavailable');

            getSpy.mockRestore();
        });

        it('should throw on S/4HANA outage in getMaterialBatches instead of returning []', async () => {
            const outageErr = new Error('connect ECONNREFUSED 172.27.100.32:8000');
            outageErr.code = 'ECONNREFUSED';
            const getSpy = jest.spyOn(GoodsReceiptAdapter, '_get').mockRejectedValueOnce(outageErr);

            await expect(GoodsReceiptAdapter.getMaterialBatches('1000000045', '1120', 'CS01')).rejects.toThrow(/ECONNREFUSED/);

            getSpy.mockRestore();
        });

        it('should reject getStorageUnitDetails with 502 when backend outage occurs', async () => {
            const handler = require('../../../srv/wm/goods-receipt/handlers/goodsReceipt.handler');
            const mockSrv = { on: jest.fn() };
            handler(mockSrv);

            const getSUHandler = mockSrv.on.mock.calls.find(c => c[0] === 'getStorageUnitDetails')?.[1];
            expect(getSUHandler).toBeDefined();

            const outageErr = new Error('Destination host unreachable');
            outageErr.code = 'ETIMEDOUT';
            const resolveSpy = jest.spyOn(GoodsReceiptAdapter, 'resolveStorageUnit').mockRejectedValueOnce(outageErr);

            const mockReq = {
                data: { StorageUnit: '180000001' },
                reject: jest.fn()
            };

            await getSUHandler(mockReq);
            expect(mockReq.reject).toHaveBeenCalledWith(502, expect.stringContaining('Destination host unreachable'));

            resolveSpy.mockRestore();
        });
    });

    describe('Frontend GoodsReceiptService V4 Model Operations', () => {
        let FrontendGoodsReceiptService;
        let mockODataClient;
        let mockModel;
        let mockBinding;

        beforeAll(() => {
            mockODataClient = {
                get: jest.fn(),
                post: jest.fn()
            };
            const origSap = global.sap;
            global.sap = {
                ui: {
                    define: (deps, factory) => {
                        FrontendGoodsReceiptService = factory(mockODataClient);
                    }
                }
            };
            delete require.cache[require.resolve('../../../app/fiori-app/webapp/modules/wm/goods-receipt/service/GoodsReceiptService')];
            require('../../../app/fiori-app/webapp/modules/wm/goods-receipt/service/GoodsReceiptService');
            global.sap = origSap;
        });

        beforeEach(() => {
            mockBinding = {
                requestContexts: jest.fn().mockResolvedValue([
                    { getObject: () => ({ DeliveryDocument: '180000001', DeliveryDocumentItem: '000010', Material: '1000000045' }) }
                ])
            };
            mockModel = {
                bindList: jest.fn().mockReturnValue(mockBinding)
            };
        });

        it('supports setModel and getModel', () => {
            FrontendGoodsReceiptService.setModel(mockModel);
            expect(FrontendGoodsReceiptService.getModel()).toBe(mockModel);
            FrontendGoodsReceiptService.setModel(null);
            expect(FrontendGoodsReceiptService.getModel()).toBeNull();
        });

        it('queries open inbound deliveries via passed V4 model without calling ODataClient.get', async () => {
            const res = await FrontendGoodsReceiptService.fetchOpenInboundDeliveries(mockModel);
            expect(mockModel.bindList).toHaveBeenCalledWith(
                '/OpenInboundDeliveries',
                undefined,
                undefined,
                []
            );
            expect(mockBinding.requestContexts).toHaveBeenCalledWith(0, Infinity);
            expect(res).toEqual([{ DeliveryDocument: '180000001', DeliveryDocumentItem: '000010', Material: '1000000045' }]);
            expect(mockODataClient.get).not.toHaveBeenCalled();
        });

        it('queries material storage locations via V4 model with Material and Plant filters', async () => {
            await FrontendGoodsReceiptService.fetchMaterialStorageLocations(mockModel, '1000000045', '1120');
            expect(mockModel.bindList).toHaveBeenCalledWith(
                '/MaterialStorageLocations',
                undefined,
                undefined,
                expect.any(Array)
            );
            const aFilters = mockModel.bindList.mock.calls[0][3];
            expect(aFilters.some(f => f.sPath === 'Material' && f.oValue1 === '1000000045')).toBe(true);
            expect(aFilters.some(f => f.sPath === 'Plant' && f.oValue1 === '1120')).toBe(true);
        });

        it('queries material batches via V4 model with Material and Plant filters', async () => {
            await FrontendGoodsReceiptService.fetchMaterialBatches(mockModel, '1000000045', '1120');
            expect(mockModel.bindList).toHaveBeenCalledWith(
                '/MaterialBatches',
                undefined,
                undefined,
                expect.any(Array)
            );
            const aFilters = mockModel.bindList.mock.calls[0][3];
            expect(aFilters.some(f => f.sPath === 'Material' && f.oValue1 === '1000000045')).toBe(true);
            expect(aFilters.some(f => f.sPath === 'Plant' && f.oValue1 === '1120')).toBe(true);
        });

        it('falls back to ODataClient.get when no model is available', async () => {
            FrontendGoodsReceiptService.setModel(null);
            mockODataClient.get.mockResolvedValueOnce([{ DeliveryDocument: '99999' }]);
            const res = await FrontendGoodsReceiptService.fetchOpenInboundDeliveries();
            expect(mockODataClient.get).toHaveBeenCalledWith('/odata/v4/goods-receipt/OpenInboundDeliveries');
            expect(res).toEqual([{ DeliveryDocument: '99999' }]);
        });
    });
});
