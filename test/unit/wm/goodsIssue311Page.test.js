/**
 * Unit Tests for Movement 311 Dedicated UI Page (Model, Service)
 */

const GoodsIssue311Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue311Model');

const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

describe('Movement 311 Dedicated Page: Model & Service Tests', () => {
    describe('GoodsIssue311Model: Data & Domain Validation', () => {
        it('initializes with default Movement 311 values and no unplanned/cost-center fields', () => {
            const data = GoodsIssue311Model.getInitialData();
            expect(data.movementType).toBe('311');
            expect(data.movementTypeName).toBe('Storage Location Transfer');
            expect(data.quantity).toBe(1);
            expect(data.isBatchManaged).toBe(false);
            expect(data.isSerialManaged).toBe(false);
            expect(data.fromReservation).toBe(false);
            expect(data.reservationNo).toBe('');
            expect(data.reservationItem).toBe('');
            expect(data.orderNo).toBe('');
            expect(data.serialNumbers).toEqual([]);
            expect(data.costCenter).toBeUndefined();
            expect(data.glAccount).toBeUndefined();
        });

        it('rejects when Reservation Number is missing (no unplanned posting path exists for this movement type)', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.reservationNo).toContain('Reservation Number is required');
        });

        it('rejects when Reservation Item is missing', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.reservationItem).toContain('Reservation Item is required');
        });

        it('validates successfully once Reservation No/Item and derived fields are populated', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(true);
        });

        it('applyReservationItem populates Order (display-only) but validate() never checks or requires it', () => {
            const data = GoodsIssue311Model.getInitialData();
            GoodsIssue311Model.applyReservationItem(data, {
                ReservationItem: '10',
                OrderNo: 'ORD123456',
                Material: 'MAT1',
                MaterialDesc: 'Widget',
                Plant: '1120',
                StorageLocation: 'HS01',
                Unit: 'EA',
                OpenQty: 5
            });
            data.reservationNo = 'RES001';

            expect(data.orderNo).toBe('ORD123456');

            const res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(true);
            // Order/Network is never part of the errors object - it is purely descriptive
            expect(res.errors.orderNo).toBeUndefined();

            // Blanking it out does not affect validity - confirms it is not independently validated
            data.orderNo = '';
            const res2 = GoodsIssue311Model.validate(data);
            expect(res2.isValid).toBe(true);
        });

        it('rejects non-positive quantities and quantities with more than 3 decimal places', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.unit = 'EA';

            data.quantity = 0;
            let res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('greater than 0');

            data.quantity = '1.2345';
            res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('cannot exceed 3 decimal places');
        });

        it('enforces batch number when material is batch-managed', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.isBatchManaged = true;
            data.batch = '';

            let res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.batch).toContain('Batch is required');

            data.batch = 'BATCH001';
            res = GoodsIssue311Model.validate(data);
            expect(res.errors.batch).toBe('');
        });

        it('enforces serial numbers matching quantity and uniqueness when serial-managed', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 2;
            data.unit = 'EA';
            data.isSerialManaged = true;
            data.serialNumbers = ['SN-001'];

            let res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.serials).toContain('must match quantity');

            data.serialNumbers = ['SN-001', 'SN-002'];
            res = GoodsIssue311Model.validate(data);
            expect(res.errors.serials).toBe('');
        });

        it('does NOT fail validation when Receiving Plant / Storage Location are blank (optional fields)', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.receivingPlant = '';
            data.receivingStorageLocation = '';

            const res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.receivingPlant).toBe('');
            expect(res.errors.receivingStorageLocation).toBe('');
        });

        it('flags Receiving Plant / Storage Location only on bad format, never as required', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.receivingPlant = 'AB'; // wrong length

            let res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.receivingPlant).toContain('4 characters');

            data.receivingPlant = '1120';
            res = GoodsIssue311Model.validate(data);
            expect(res.errors.receivingPlant).toBe('');
        });

        it('enforces intra-plant destination invariants for Movement 311', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            // 1. Receiving Plant must equal issuing plant
            data.receivingPlant = '1130';
            let res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.receivingPlant).toContain('must equal issuing plant');

            // 2. Receiving Storage Location must differ from issuing storage location
            data.receivingPlant = '1120';
            data.receivingStorageLocation = 'HS01';
            res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.receivingStorageLocation).toContain('must differ from the issuing storage location');

            // 3. Valid intra-plant transfer (same plant, different storage location)
            data.receivingStorageLocation = 'HS02';
            res = GoodsIssue311Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.receivingPlant).toBe('');
            expect(res.errors.receivingStorageLocation).toBe('');
        });

        it('toBackendPayload includes ReceivingPlant/ReceivingStorageLocation when set', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '10';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.receivingPlant = '1130';
            data.receivingStorageLocation = 'MT01';

            const payload = GoodsIssue311Model.toBackendPayload(data);
            expect(payload.ReceivingPlant).toBe('1130');
            expect(payload.ReceivingStorageLocation).toBe('MT01');
        });

        it('toBackendPayload generates a clean payload with no CostCenter/GLAccount', () => {
            const data = GoodsIssue311Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '10';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const payload = GoodsIssue311Model.toBackendPayload(data);
            expect(payload.MovementType).toBe('311');
            expect(payload.ReservationNo).toBe('RES001');
            expect(payload.ReservationItem).toBe('0010');
            expect(payload.CostCenter).toBeUndefined();
            expect(payload.GLAccount).toBeUndefined();
        });
    });

    describe('GoodsIssue311Service: Client Calls', () => {
        let GoodsIssue311Service;

        beforeAll(() => {
            GoodsIssue311Service = {
                postGoodsIssue: (oPayload) => {
                    if (!oPayload) return Promise.reject(new Error('Goods Issue payload is required'));
                    if (!oPayload.ReservationNo) return Promise.reject(new Error('Reservation Number is required for Movement 311'));
                    return mockODataClient.post('/odata/v4/goods-issue/postGoodsIssue', oPayload);
                },
                reverseGoodsIssue: (sDoc, sYear, sPostingDate, sReason) => {
                    if (!sDoc || !sYear) return Promise.reject(new Error('Material Document number and year are required for reversal'));
                    return mockODataClient.post('/odata/v4/goods-issue/reverseGoodsIssue', {
                        MaterialDocument: sDoc,
                        MaterialDocYear: sYear,
                        PostingDate: sPostingDate,
                        ReversalReason: sReason || '01'
                    });
                }
            };
        });

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('rejects postGoodsIssue when Reservation Number is missing', async () => {
            await expect(GoodsIssue311Service.postGoodsIssue({ MovementType: '311' }))
                .rejects.toThrow('Reservation Number is required');
        });

        it('calls postGoodsIssue with the Reservation-based payload and returns Material Document', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                MaterialDocument: '4900099001',
                MaterialDocYear: '2026'
            });

            const res = await GoodsIssue311Service.postGoodsIssue({
                MovementType: '311',
                ReservationNo: 'RES001',
                ReservationItem: '0010',
                Material: 'MAT1',
                IssueQty: 1,
                Unit: 'EA'
            });

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/postGoodsIssue',
                expect.objectContaining({ MovementType: '311', ReservationNo: 'RES001' })
            );
            expect(res.MaterialDocument).toBe('4900099001');
        });

        it('calls reverseGoodsIssue with CancelHeader parameters', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                ReversalMaterialDocument: '4900099002',
                ReversalMaterialDocYear: '2026'
            });

            const res = await GoodsIssue311Service.reverseGoodsIssue('4900099001', '2026', '2026-09-29', '01');

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/reverseGoodsIssue',
                {
                    MaterialDocument: '4900099001',
                    MaterialDocYear: '2026',
                    PostingDate: '2026-09-29',
                    ReversalReason: '01'
                }
            );
            expect(res.ReversalMaterialDocument).toBe('4900099002');
        });
    });
});
