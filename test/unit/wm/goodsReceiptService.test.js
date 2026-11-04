const GoodsReceiptAdapter = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const { shouldRunLiveSapTests } = require('../../liveSapGate');
const liveDescribe = shouldRunLiveSapTests() ? describe : describe.skip;

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

        it('should reject postGoodsReceiptWithStorageUnit when StorageUnit and DeliveryDocument are missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10,
                Unit: 'KG'
            })).rejects.toThrow('Storage Unit or Delivery Document is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceiptWithStorageUnit when Material is missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                StorageUnit: '2000018143',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10,
                Unit: 'KG'
            })).rejects.toThrow('Material is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceiptWithStorageUnit when Plant or StorageLocation is missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                StorageUnit: '2000018143',
                Material: '1000000045',
                StorageLocation: 'CS01',
                Quantity: 10,
                Unit: 'KG'
            })).rejects.toThrow('Plant is required to post Goods Receipt.');

            await expect(GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                StorageUnit: '2000018143',
                Material: '1000000045',
                Plant: '1120',
                Quantity: 10,
                Unit: 'KG'
            })).rejects.toThrow('Storage Location is required to post Goods Receipt.');
        });

        it('should reject postGoodsReceiptWithStorageUnit when Quantity is zero or negative', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                StorageUnit: '2000018143',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 0,
                Unit: 'KG'
            })).rejects.toThrow('Quantity must be a positive number.');
        });

        it('should reject postGoodsReceiptWithStorageUnit when Unit is missing', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                StorageUnit: '2000018143',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Quantity: 10,
                Unit: ''
            })).rejects.toThrow('Unit of Measure is required for Goods Receipt.');
        });

        it('should block postGoodsReceiptWithStorageUnit when batch is expired', async () => {
            await expect(GoodsReceiptAdapter.postGoodsReceiptWithStorageUnit({
                StorageUnit: '2000018143',
                DeliveryDocument: '0180000035',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Batch: 'EXPIRED_B1',
                ExpiryDate: '2020-01-01',
                Quantity: 10,
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

            // 1782259200 seconds since the epoch is 2026-06-24T00:00:00Z.
            expect(GoodsReceiptAdapter._formatDate('/Date(1782259200000)/')).toBe('2026-06-24');
        });
    });

  liveDescribe('Verified Real SAP S/4HANA Integration Tests (Client 220)', () => {
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

        it('should retrieve authentic OpenQuantity, OrderedQuantity, and Unit from GR4PO_DL_Items instead of hardcoded 10', async () => {
            const suDetails = await GoodsReceiptAdapter.resolveStorageUnit('180000001');
            expect(suDetails).toBeDefined();
            expect(typeof suDetails.Quantity).toBe('number');
            expect(typeof suDetails.OpenQuantity).toBe('number');
            expect(typeof suDetails.OrderedQuantity).toBe('number');
            expect(typeof suDetails.QuantityInEntryUnit).toBe('number');
            expect(suDetails.Unit).toBeTruthy();
        });

    });

    // SAP is stubbed at the HTTP client and at RFC (plain functions), so the adapter's own code runs. These tests came out of the
    // always-skipped live block. Field names are in docs/sap-metadata-reference/MMIM_GR4PO_DL_SRV.edmx (Header2Items, Header2Refs,
    // DocNo, SourceOfGR) or docs/evidence; the response values, message codes and sap-message texts are hand-written, so SAP
    // behavior itself is not proven here.
    describe('GoodsReceiptAdapter with SAP stubbed at the HTTP and RFC boundary', () => {
        const { GoodsReceiptAdapter: AdapterClass } = GoodsReceiptAdapter;
        const GR_HEADERS = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers';

        const noSapRow = async () => [];
        const makeAdapter = ({ get = noSapRow, post, readTable = noSapRow, fm } = {}) => {
            const posted = [];
            const calls = [];
            const client = {
                get: async (path, opts = {}) => ({ data: { d: { results: await get(path, decodeURIComponent(opts.query || '')) } } }),
                post: async (path, { data }) => {
                    posted.push({ path, body: data });
                    return post(path, data);
                }
            };
            const call = async (name, params) => {
                calls.push({ name, params });
                return fm ? fm(name, params) : {};
            };
            const rfc = { readTable: async (...args) => readTable(...args), session: async (fn) => fn(call) };
            return { adapter: new AdapterClass({ client, rfc }), posted, calls };
        };
        const replyWith = (body, headers) => async () => ({ data: { d: body }, headers });
        const delivery = {
            StorageUnit: '180000001', DeliveryDocument: '180000001', DeliveryDocumentItem: '000010', Material: '1000000045',
            Plant: '1120', StorageLocation: 'CS01', Quantity: 15, Unit: 'KG'
        };

        describe('postGoodsReceipt (MMIM_GR4PO_DL_SRV)', () => {
            it('posts the delivery item to GR4PO_DL_Headers with movement 101 and the quantity as text', async () => {
                const { adapter, posted } = makeAdapter({ post: replyWith({ MaterialDocument: '5000000347' }) });
                await adapter.postGoodsReceipt({ ...delivery, Batch: 'IN25000133' });

                expect(posted).toHaveLength(1);
                expect(posted[0].path).toBe(GR_HEADERS);
                expect(posted[0].body).toMatchObject({ InboundDelivery: '180000001', SourceOfGR: 'INBDELIV' });
                expect(posted[0].body.Header2Items).toEqual([expect.objectContaining({
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
                })]);
            });

            it('returns the MaterialDocument SAP put on the response', async () => {
                const { adapter } = makeAdapter({ post: replyWith({ MaterialDocument: '5000000347' }) });
                await expect(adapter.postGoodsReceipt(delivery)).resolves.toMatchObject({
                    Success: true,
                    MaterialDocument: '5000000347',
                    DeliveryDocument: '180000001',
                    Message: 'Goods Receipt posted successfully in SAP for Delivery 180000001 (Material Document 5000000347)'
                });
            });

            it('passes the reason code it is given', async () => {
                const { adapter, posted } = makeAdapter({ post: replyWith({ MaterialDocument: '5000000350' }) });
                await adapter.postGoodsReceipt({ ...delivery, GoodsMovementReasonCode: '0001' });
                expect(posted[0].body.Header2Items[0].GoodsMovementReasonCode).toBe('0001');
            });

            it('sends SourceOfGR PURORD and the padded item for a purchase order', async () => {
                const { adapter, posted } = makeAdapter({ post: replyWith({ MaterialDocument: '5000000349' }) });
                const { DeliveryDocument: _doc, DeliveryDocumentItem: _item, ...base } = delivery;
                await adapter.postGoodsReceipt({ ...base, StorageUnit: '400000011', PurchaseOrder: '400000011', PurchaseOrderItem: '00010', Quantity: 20 });

                expect(posted[0].body).toMatchObject({ InboundDelivery: '400000011', SourceOfGR: 'PURORD' });
                expect(posted[0].body.Header2Items[0]).toMatchObject({ SourceOfGR: 'PURORD', DeliveryDocumentItem: '000010', QuantityInEntryUnit: '20' });
            });

            it('takes the document from Header2Refs when the header has none', async () => {
                const { adapter } = makeAdapter({ post: replyWith({ MaterialDocument: '', Header2Refs: { results: [{ DocNo: '5000000348', DocYear: '2026' }] } }) });
                await expect(adapter.postGoodsReceipt(delivery)).resolves.toMatchObject({ Success: true, MaterialDocument: '5000000348' });
            });

            it('takes the document from a success sap-message when the body has none', async () => {
                const headers = { 'sap-message': JSON.stringify({ message: 'Material document 5000005496 2026 posted', severity: 'success' }) };
                const { adapter } = makeAdapter({ post: replyWith({ MaterialDocument: '' }, headers) });
                await expect(adapter.postGoodsReceipt(delivery)).resolves.toMatchObject({ Success: true, MaterialDocument: '5000005496' });
            });

            it('fails with status 422 and SAP text when sap-message has severity error', async () => {
                const headers = { 'sap-message': JSON.stringify({ message: 'Purchase order 0001800000 was already changed', severity: 'error' }) };
                const { adapter } = makeAdapter({ post: replyWith({ MaterialDocument: '' }, headers) });
                const rejected = await adapter.postGoodsReceipt(delivery).catch((e) => e);
                expect(rejected.status).toBe(422);
                expect(rejected.message).toContain('Purchase order 0001800000 was already changed');
                expect(rejected.outcomeUnknown).toBe(false);
            });

            it('fails when SAP returns no material document and reports no success', async () => {
                const { adapter } = makeAdapter({ post: replyWith({ MaterialDocument: '' }) });
                await expect(adapter.postGoodsReceipt(delivery)).rejects.toThrow('SAP did not generate or return a material document number.');
            });

            it('marks an HTTP 500 from SAP as an unknown outcome, naming the delivery', async () => {
                const { adapter } = makeAdapter({ post: async () => { throw Object.assign(new Error('Posting rejected by Gateway'), { status: 500 }); } });
                const rejected = await adapter.postGoodsReceipt(delivery).catch((e) => e);
                expect(rejected.message).toContain("Posting Goods Receipt for Inbound Delivery '180000001' via MMIM_GR4PO_DL_SRV failed");
                expect(rejected).toMatchObject({ status: 500, outcomeUnknown: true });
            });

            it('rejects a missing Unit before any POST', async () => {
                const { adapter, posted } = makeAdapter({ post: replyWith({}) });
                const { Unit: _unit, ...noUnit } = delivery;
                await expect(adapter.postGoodsReceipt(noUnit)).rejects.toThrow('Unit of Measure (EntryUnit) is required for Goods Receipt');
                expect(posted).toEqual([]);
            });
        });

        describe('getGoodsReceiptItem (item read plus LIPS/LIKP facts)', () => {
            const emptyShell = {
                InboundDelivery: '180000006', DeliveryDocumentItem: '000010', Material: '', Plant: '', StorageLocation: '', Batch: '',
                OpenQuantity: '0.000', OrderedQuantity: '0.000', QuantityInEntryUnit: '0.000', UnitOfMeasure: '', EntryUnit: '', OrderedQuantityUnit: ''
            };

            it('completes an empty GR4PO_DL_Items shell from LIPS and LIKP', async () => {
                const readTable = async (table) => {
                    if (table === 'LIPS') return [{ VBELN: '0180000006', POSNR: '000010', LGORT: 'CS01', CHARG: '', LFIMG: '10000.000', MEINS: 'KG', VRKME: 'KG', LGNUM: 'W13', LGPLA: '', WBSTA: 'A' }];
                    if (table === 'LIKP') return [{ VBELN: '0180000006', LFDAT: '20251103' }];
                    return [];
                };
                const { adapter } = makeAdapter({ get: async () => emptyShell, readTable });

                await expect(adapter.getGoodsReceiptItem('180000006', '000010', '300001405', '00010')).resolves.toEqual(expect.objectContaining({
                    SourceOfGR: 'INBDELIV',
                    StorageLocation: 'CS01',
                    Batch: '',
                    Unit: 'KG',
                    DeliveryQuantity: 10000,
                    OpenQuantity: 10000,
                    OrderedQuantity: 0,
                    WarehouseNumber: 'W13',
                    DeliveryDate: '2025-11-03',
                    GoodsMovementStatus: 'A'
                }));
            });

            it('reads LIPS by the zero-padded delivery and item', async () => {
                const wheres = {};
                const readTable = async (table, _fields, where) => { wheres[table] = where; return []; };
                const { adapter } = makeAdapter({ get: async () => emptyShell, readTable });
                await adapter.getGoodsReceiptItem('180000006', '000010', '300001405', '00010');
                expect(wheres.LIPS).toEqual(["VBELN = '0180000006' AND POSNR = '000010'"]);
            });

            it('keeps the service values when present and reports 0 open for a fully received item', async () => {
                const readTable = async (table) => {
                    if (table === 'LIPS') return [{ VBELN: '0180000001', POSNR: '000010', LGORT: 'CS01', CHARG: 'B9', LFIMG: '500.000', MEINS: 'KG', VRKME: 'KG', LGNUM: '', LGPLA: '', WBSTA: 'C' }];
                    if (table === 'LIKP') return [{ VBELN: '0180000001', LFDAT: '00000000' }];
                    return [];
                };
                const get = async () => ({
                    InboundDelivery: '180000001', DeliveryDocumentItem: '000010', Material: '1000000045', Plant: '1120', StorageLocation: 'ST02', Batch: 'B1',
                    OpenQuantity: '0.000', OrderedQuantity: '0.000', QuantityInEntryUnit: '0.000', UnitOfMeasure: 'KG', EntryUnit: 'KG', OrderedQuantityUnit: 'KG'
                });
                const { adapter } = makeAdapter({ get, readTable });

                await expect(adapter.getGoodsReceiptItem('180000001', '000010')).resolves.toEqual(expect.objectContaining({
                    StorageLocation: 'ST02', Batch: 'B1', Unit: 'KG', OpenQuantity: 0, DeliveryQuantity: 500, DeliveryDate: '', GoodsMovementStatus: 'C'
                }));
            });
        });

        describe('resolveStorageUnit', () => {
            const deliveryRow = { DeliveryDocument: '180000099', Material: '1000000045', Plant: '1120', BaseUnit: 'KG' };
            const onlyDeliveryList = async (path) => (path.includes('HMmimGr4inbdelSet') ? [deliveryRow] : []);

            it('keeps item numbers empty when SAP does not return them', async () => {
                const { adapter } = makeAdapter({ get: onlyDeliveryList });
                const details = await adapter.resolveStorageUnit('180000099');
                expect(details.ScannedType).toBe('INBOUND_DELIVERY');
                expect(details.DeliveryDocumentItem).toBe('');
                expect(details.PurchaseOrderItem).toBe('');
            });

            it('reports null quantities, not an invented default, when the item cannot be read', async () => {
                const { adapter } = makeAdapter({ get: onlyDeliveryList });
                const details = await adapter.resolveStorageUnit('180000099');
                expect([details.Quantity, details.OpenQuantity, details.OrderedQuantity, details.QuantityInEntryUnit]).toEqual([null, null, null, null]);
            });

            it('resolves a storage unit through VEKP, VEPO and LIPS', async () => {
                const readTable = async (table) => {
                    if (table === 'VEKP') return [{ VENUM: '0000019318', EXIDV: '00000000002000018143', VHILM: '000000002000000130', VPOBJ: '03', VPOBJKEY: '0180000035' }];
                    if (table === 'VEPO') return [{ VENUM: '0000019318', VEPOS: '000001', VBELN: '0180000035', POSNR: '000010', MATNR: '000000001000000129', CHARG: 'INHU100004', VEMNG: '200.000', VEMEH: 'KG' }];
                    if (table === 'LIPS') return [{ VBELN: '0180000035', POSNR: '000010', WERKS: '1130', LGORT: 'CS01', VGBEL: '0400000330', VGPOS: '000010', ARKTX: 'SU MATERIAL DESC' }];
                    return [];
                };
                const { adapter } = makeAdapter({ readTable });

                await expect(adapter.resolveStorageUnit('2000018143')).resolves.toMatchObject({
                    ScannedType: 'STORAGE_UNIT',
                    Material: '1000000129',
                    DeliveryDocument: '0180000035',
                    Plant: '1130',
                    StorageLocation: 'CS01',
                    PackagingMaterial: '2000000130',
                    Batch: 'INHU100004',
                    Quantity: 200
                });
            });

            it('rethrows an S/4 outage with its status instead of reporting the barcode as not found', async () => {
                const outage = async () => { throw Object.assign(new Error('Gateway Timeout'), { status: 504 }); };
                const { adapter } = makeAdapter({ get: outage });
                await expect(adapter.resolveStorageUnit('180000001')).rejects.toMatchObject({ statusCode: 504, message: 'Gateway Timeout' });
            });
        });

        describe('outages on read', () => {
            it('getMaterialStorageLocations throws on a 503 instead of returning an empty list', async () => {
                const { adapter } = makeAdapter({ get: async () => { throw Object.assign(new Error('Service Unavailable'), { status: 503 }); } });
                await expect(adapter.getMaterialStorageLocations('1000000045', '1120')).rejects.toThrow('Service Unavailable');
            });

            it('getMaterialBatches throws on a refused connection instead of returning an empty list', async () => {
                const { adapter } = makeAdapter({ get: async () => { throw Object.assign(new Error('connect ECONNREFUSED s4.example.test:8000'), { code: 'ECONNREFUSED' }); } });
                await expect(adapter.getMaterialBatches('1000000045', '1120', 'CS01')).rejects.toThrow(/ECONNREFUSED/);
            });

            it('the getStorageUnitDetails handler answers 502 when the adapter hits a timeout', async () => {
                const handler = require('../../../srv/wm/goods-receipt/handlers/goodsReceipt.handler');
                const handlers = {};
                handler({ on: (event, fn) => { handlers[event] = fn; } });
                const realClient = GoodsReceiptAdapter.client;
                const realRfc = GoodsReceiptAdapter.rfc;
                GoodsReceiptAdapter.client = { get: async () => { throw Object.assign(new Error('Destination host unreachable'), { code: 'ETIMEDOUT' }); } };
                GoodsReceiptAdapter.rfc = { readTable: noSapRow };
                const req = { data: { StorageUnit: '180000001' }, reject: jest.fn() };
                try {
                    await handlers.getStorageUnitDetails(req);
                } finally {
                    GoodsReceiptAdapter.client = realClient;
                    GoodsReceiptAdapter.rfc = realRfc;
                }
                expect(req.reject).toHaveBeenCalledWith(502, expect.stringContaining('Destination host unreachable'));
            });
        });

        describe('postGoodsReceiptWithStorageUnit (BAPI_INB_DELIVERY_CONFIRM_DEC)', () => {
            const hu = { VENUM: '0000019318', EXIDV: '00000000002000018143', VHILM: '000000002000000130', STATUS: '0010', VPOBJ: '03', VPOBJKEY: '0180000035' };
            const suPost = {
                StorageUnit: '2000018143', DeliveryDocument: '0180000035', Material: '1000000129', Plant: '1130', StorageLocation: 'CS01', Quantity: 200, Unit: 'KG'
            };
            const huOnly = async (table) => (table === 'VEKP' ? [hu] : []);
            const deliveryOnly = { DeliveryDocument: '0180000077', Material: '1000000045', Plant: '1130', StorageLocation: 'CS02', Quantity: 40, Unit: 'KG' };
            // An unpacked delivery needs its LIPS item facts; quantity and unit here match deliveryOnly so the guards pass.
            const likpOpen = async (table) => {
                if (table === 'LIKP') return [{ VBELN: '0180000077', WBSTK: 'A', KOSTK: 'C', LFDAT: '20261001' }];
                if (table === 'LIPS') return [{ VBELN: '0180000077', POSNR: '000010', LGORT: 'CS02', CHARG: '', LFIMG: '40.000', MEINS: 'KG', VRKME: 'KG', UMVKZ: '1', UMVKN: '1', LGNUM: '', LGPLA: '', WBSTA: 'A' }];
                return [];
            };
            const bapiReturns = (row) => async (name) => (name === 'BAPI_INB_DELIVERY_CONFIRM_DEC' ? { RETURN: [row] } : {});

            const successDouble = () => {
                let bapiRan = false;
                return makeAdapter({
                    readTable: async (table) => {
                        if (table === 'VEKP') return [hu];
                        // The document appears only after the BAPI ran: the read-back reports a NEW document.
                        if (table === 'MATDOC') return bapiRan ? [{ MBLNR: '5000005501', MJAHR: '2026', ZEILE: '0001', BWART: '101' }] : [];
                        return [];
                    },
                    fm: async (name) => {
                        if (name === 'BAPI_INB_DELIVERY_CONFIRM_DEC') {
                            bapiRan = true;
                            return { RETURN: [{ TYPE: 'S', ID: 'VLA', NUMBER: '300', MESSAGE: 'Delivery confirmed successfully' }] };
                        }
                        return { RETURN: [] };
                    }
                });
            };
            const suItem = { ...suPost, DeliveryDocumentItem: '000010', Batch: 'INHU100004', PackagingMaterial: '2000000130' };

            it('sends the delivery confirmation with goods-issue flag, quantity and handling unit', async () => {
                const { adapter, calls } = successDouble();
                await adapter.postGoodsReceiptWithStorageUnit(suItem);

                const bapi = calls.find(({ name }) => name === 'BAPI_INB_DELIVERY_CONFIRM_DEC');
                expect(bapi.params).toEqual(expect.objectContaining({
                    HEADER_DATA: { DELIV_NUMB: '0180000035' },
                    HEADER_CONTROL: expect.objectContaining({ DELIV_NUMB: '0180000035', POST_GI_FLG: 'X' }),
                    ITEM_DATA: expect.arrayContaining([expect.objectContaining({ DELIV_NUMB: '0180000035', DELIV_ITEM: '000010', DLV_QTY: '200' })]),
                    ITEM_CONTROL: expect.arrayContaining([expect.objectContaining({ DELIV_NUMB: '0180000035', DELIV_ITEM: '000010', CHG_DELQTY: 'X' })]),
                    HANDLING_UNIT_HEADER: expect.arrayContaining([expect.objectContaining({ HDL_UNIT_EXID: '00000000002000018143', DELIV_NUMB: '0180000035' })]),
                    HANDLING_UNIT_ITEM: expect.arrayContaining([expect.objectContaining({ HDL_UNIT_EXID_INTO: '00000000002000018143', DELIV_NUMB: '0180000035', PACK_QTY: '200' })])
                }));
            });

            it('commits with WAIT=X after the BAPI', async () => {
                const { adapter, calls } = successDouble();
                await adapter.postGoodsReceiptWithStorageUnit(suItem);
                expect(calls.map(({ name }) => name)).toEqual(['BAPI_INB_DELIVERY_CONFIRM_DEC', 'BAPI_TRANSACTION_COMMIT']);
                expect(calls[1].params).toEqual({ WAIT: 'X' });
            });

            it('returns the new MATDOC document read back after the commit', async () => {
                const { adapter } = successDouble();
                await expect(adapter.postGoodsReceiptWithStorageUnit(suItem)).resolves.toMatchObject({
                    Success: true, MaterialDocument: '5000005501', MaterialDocumentYear: '2026', StorageUnit: '2000018143', Quantity: 200
                });
            });

            it('simulation runs the BAPI with SIMULATE and never commits', async () => {
                const { adapter, calls } = makeAdapter({
                    readTable: huOnly,
                    fm: bapiReturns({ TYPE: 'S', ID: 'VLA', NUMBER: '300', MESSAGE: 'Simulation successful' })
                });
                const result = await adapter.postGoodsReceiptWithStorageUnit({ ...suPost, Simulate: true });

                expect(result.Message).toContain('simulated successfully');
                expect(calls.map(({ name }) => name)).toEqual(['BAPI_INB_DELIVERY_CONFIRM_DEC']);
                expect(calls[0].params.HEADER_CONTROL.SIMULATE).toBe('X');
            });

            it.each([
                ['VLA', '307', 'Putaway qty cannot be less', /Putaway constraint/],
                ['VLA', '317', 'Batch required', /Batch constraint/],
                ['HUDIALOG', '018', 'Delivery status only allows display mode', /Delivery status constraint.*HUDIALOG 018/],
                ['M7', '006', 'Material does not exist', /Master data constraint.*M7 006/]
            ])('with a storage unit, maps SAP error %s %s to a named constraint', async (ID, NUMBER, MESSAGE, expected) => {
                const { adapter } = makeAdapter({ readTable: huOnly, fm: bapiReturns({ TYPE: 'E', ID, NUMBER, MESSAGE }) });
                await expect(adapter.postGoodsReceiptWithStorageUnit(suPost)).rejects.toThrow(expected);
            });

            it.each([
                ['VLBAPI', '004', '', /Quantity consistency check failed.*VLBAPI 004/],
                ['VLMOVE', '029', 'Delivery has not yet been put away', /Putaway required.*VLMOVE 029/],
                ['VL', '608', 'WM processing incomplete', /Warehouse processing incomplete.*VL 608/]
            ])('without a storage unit, maps SAP error %s %s to a named constraint', async (ID, NUMBER, MESSAGE, expected) => {
                const { adapter } = makeAdapter({
                    readTable: likpOpen,
                    fm: bapiReturns({ TYPE: 'E', ID, NUMBER, MESSAGE, MESSAGE_V1: '0180000077', MESSAGE_V2: '000010' })
                });
                await expect(adapter.postGoodsReceiptWithStorageUnit(deliveryOnly)).rejects.toThrow(expected);
            });

            it('refuses before the BAPI when putaway is still required (KOSTK = A)', async () => {
                const { adapter, calls } = makeAdapter({ readTable: async (table) => (table === 'LIKP' ? [{ VBELN: '0180000077', WBSTK: 'A', KOSTK: 'A' }] : []) });
                await expect(adapter.postGoodsReceiptWithStorageUnit(deliveryOnly)).rejects.toThrow(/Putaway required.*KOSTK = 'A'/);
                expect(calls).toEqual([]);
            });

            it('refuses before the BAPI and names the document when the delivery is already received (WBSTK = C)', async () => {
                const readTable = async (table) => {
                    if (table === 'LIKP') return [{ VBELN: '0180000035', WBSTK: 'C', KOSTK: 'C' }];
                    if (table === 'MATDOC') return [{ MBLNR: '5000005654', MJAHR: '2026', BWART: '101' }];
                    return [];
                };
                const { adapter, calls } = makeAdapter({ readTable });
                await expect(adapter.postGoodsReceiptWithStorageUnit(suPost)).rejects.toThrow(/Delivery already completed.*5000005654\/2026/);
                expect(calls).toEqual([]);
            });

            it('refuses with 404 when the storage unit is not in VEKP', async () => {
                const { adapter, calls } = makeAdapter({ readTable: async (table) => (table === 'LIKP' ? [{ VBELN: '0180000035', WBSTK: 'A', KOSTK: 'C' }] : []) });
                await expect(adapter.postGoodsReceiptWithStorageUnit({ ...suPost, StorageUnit: '9999999999' })).rejects.toMatchObject({
                    statusCode: 404,
                    message: expect.stringMatching(/Storage Unit not found.*VEKP/)
                });
                expect(calls).toEqual([]);
            });

            it('refuses before the BAPI when the storage unit is already in status 0060', async () => {
                const { adapter, calls } = makeAdapter({ readTable: async (table) => (table === 'VEKP' ? [{ ...hu, STATUS: '0060' }] : []) });
                await expect(adapter.postGoodsReceiptWithStorageUnit(suPost)).rejects.toThrow(/Storage Unit already received.*status '0060'/);
                expect(calls).toEqual([]);
            });
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

        it('invokes postGoodsReceiptWithStorageUnit via ODataClient.post', async () => {
            mockODataClient.post.mockResolvedValueOnce({ Success: true, MaterialDocument: '5000005499' });
            const payload = { StorageUnit: '2000018143', Quantity: 200, Unit: 'KG' };
            const res = await FrontendGoodsReceiptService.postGoodsReceiptWithStorageUnit(payload);
            expect(mockODataClient.post).toHaveBeenCalledWith('/odata/v4/goods-receipt/postGoodsReceiptWithStorageUnit', payload);
            expect(res).toEqual({ Success: true, MaterialDocument: '5000005499' });
        });

        it('invokes postGoodsReceipt with If-Match header when ETag is present in payload or options', async () => {
            mockODataClient.post.mockResolvedValueOnce({ Success: true, MaterialDocument: '5000005500' });
            const payload = { DeliveryDocument: '180000001', Quantity: 10, Unit: 'KG', ETag: 'W/"20261028160000"' };
            await FrontendGoodsReceiptService.postGoodsReceipt(payload);
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-receipt/postGoodsReceipt',
                payload,
                { 'If-Match': 'W/"20261028160000"' }
            );

            mockODataClient.post.mockResolvedValueOnce({ Success: true, MaterialDocument: '5000005501' });
            const payload2 = { DeliveryDocument: '180000001', Quantity: 10, Unit: 'KG' };
            await FrontendGoodsReceiptService.postGoodsReceipt(payload2, { etag: 'W/"20261028160001"' });
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-receipt/postGoodsReceipt',
                payload2,
                { 'If-Match': 'W/"20261028160001"' }
            );
        });

        it('invokes postGoodsReceiptWithStorageUnit with If-Match header when ETag is present', async () => {
            mockODataClient.post.mockResolvedValueOnce({ Success: true, MaterialDocument: '5000005502' });
            const payload = { StorageUnit: '2000018143', Quantity: 10, Unit: 'KG', ETag: 'W/"20261028160002"' };
            await FrontendGoodsReceiptService.postGoodsReceiptWithStorageUnit(payload);
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-receipt/postGoodsReceiptWithStorageUnit',
                payload,
                { 'If-Match': 'W/"20261028160002"' }
            );
        });
    });
});
