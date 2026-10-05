/**
 * Unit Tests for Movement 301 Dedicated UI Page (Model, Service)
 */

const GoodsIssue301Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue301Model');

const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

describe('Movement 301 Dedicated Page: Model & Service Tests', () => {
    describe('GoodsIssue301Model: Data & Domain Validation', () => {
        it('initializes with default Movement 301 values and no unplanned/cost-center fields', () => {
            const data = GoodsIssue301Model.getInitialData();
            expect(data.movementType).toBe('301');
            expect(data.movementTypeName).toBe('Plant-to-Plant Transfer');
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
            const data = GoodsIssue301Model.getInitialData();
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.reservationNo).toContain('Reservation Number is required');
        });

        it('rejects when Reservation Item is missing', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.reservationItem).toContain('Reservation Item is required');
        });

        it('rejects when Material is missing', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.material).toContain('Material is required');
        });

        it('validates and auto-pads Reservation Item when applied from reservation', () => {
            const data = GoodsIssue301Model.getInitialData();
            GoodsIssue301Model.applyReservationItem(data, {
                ReservationItem: '1',
                Material: 'MAT-301',
                MaterialDesc: 'Reactor Part',
                Plant: '1120',
                StorageLocation: 'HS01',
                Unit: 'EA',
                OrderNo: '',
                OpenQty: 5
            });

            expect(data.reservationItem).toBe('0001');
            expect(data.material).toBe('MAT-301');
            expect(data.materialName).toBe('Reactor Part');
            expect(data.plant).toBe('1120');
            expect(data.storageLocation).toBe('HS01');
            expect(data.unit).toBe('EA');
            expect(data.isUnitEditable).toBe(false);
            expect(data.fromReservation).toBe(true);

            data.reservationNo = 'RES001';
            const res = GoodsIssue301Model.validate(data);
            expect(res.errors.reservationItem).toBe('');
            expect(res.errors.material).toBe('');
            expect(res.errors.plant).toBe('');
            expect(res.errors.storageLocation).toBe('');
        });

        it('validates quantity: positive, non-zero, max 3 decimal places', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.unit = 'EA';

            data.quantity = 0;
            let res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('greater than 0');

            data.quantity = '1.2345';
            res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('cannot exceed 3 decimal places');
        });

        it('enforces batch number when material is batch-managed', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.isBatchManaged = true;
            data.batch = '';

            let res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.batch).toContain('Batch is required');

            data.batch = 'BATCH001';
            res = GoodsIssue301Model.validate(data);
            expect(res.errors.batch).toBe('');
        });

        it('enforces serial numbers matching quantity and uniqueness when serial-managed', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 2;
            data.unit = 'EA';
            data.isSerialManaged = true;
            data.serialNumbers = ['SN-001'];

            let res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.serials).toContain('must match quantity');

            data.serialNumbers = ['SN-001', 'SN-002'];
            res = GoodsIssue301Model.validate(data);
            expect(res.errors.serials).toContain('not verified with SAP');

            data.serialStatus = { 'SN-001': { available: true }, 'SN-002': { available: true } };
            res = GoodsIssue301Model.validate(data);
            expect(res.errors.serials).toBe('');
        });

        it('requires Receiving Plant; Receiving Storage Location stays optional', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.receivingPlant = '';
            data.receivingStorageLocation = '';

            let res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.receivingPlant).toContain('Receiving Plant is required');
            expect(res.errors.receivingStorageLocation).toBe('');

            data.receivingPlant = '1150';
            res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.receivingPlant).toBe('');
        });

        it('makes the issuing Storage Location editable only when the reservation item has none', () => {
            const data = GoodsIssue301Model.getInitialData();
            GoodsIssue301Model.applyReservationItem(data, { ReservationItem: '1', Material: 'MAT1', Plant: '1120', StorageLocation: '', Unit: 'NOS', OpenQty: 1 });
            expect(data.isStorageLocationEditable).toBe(true);
            expect(GoodsIssue301Model.validate(data).errors.storageLocation).toContain('the reservation has none');

            GoodsIssue301Model.applyReservationItem(data, { ReservationItem: '1', Material: 'MAT1', Plant: '1120', StorageLocation: 'HS01', Unit: 'NOS', OpenQty: 1 });
            expect(data.isStorageLocationEditable).toBe(false);
            expect(GoodsIssue301Model.validate(data).errors.storageLocation).toBe('');
        });

        it('flags Receiving Plant / Storage Location on bad format length', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.receivingPlant = 'AB'; // wrong length

            let res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.receivingPlant).toContain('4 characters');

            data.receivingPlant = '1150';
            res = GoodsIssue301Model.validate(data);
            expect(res.errors.receivingPlant).toBe('');
        });

        it('enforces inter-plant destination invariant for Movement 301 (must DIFFER from issuing plant)', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            // 1. Receiving Plant matching issuing plant must REJECT (inverse of 311's rule)
            data.receivingPlant = '1120';
            let res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.receivingPlant).toContain('must differ from issuing plant');

            // 2. Receiving Plant differing from issuing plant is ACCEPTED
            data.receivingPlant = '1150';
            res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.receivingPlant).toBe('');

            // 3. Receiving SLoc can match issuing SLoc (unlike 311, same SLoc code across different plants is permitted)
            data.receivingStorageLocation = 'HS01';
            res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.receivingStorageLocation).toBe('');

            // 4. Receiving SLoc differing from issuing SLoc is also valid
            data.receivingStorageLocation = 'AD01';
            res = GoodsIssue301Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.receivingStorageLocation).toBe('');
        });

        it('toBackendPayload includes ReceivingPlant/ReceivingStorageLocation when set', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '10';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.receivingPlant = '1150';
            data.receivingStorageLocation = 'AD01';

            const payload = GoodsIssue301Model.toBackendPayload(data);
            expect(payload.ReceivingPlant).toBe('1150');
            expect(payload.ReceivingStorageLocation).toBe('AD01');
        });

        it('toBackendPayload generates a clean payload with MovementType 301 and no CostCenter/GLAccount', () => {
            const data = GoodsIssue301Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '10';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const payload = GoodsIssue301Model.toBackendPayload(data);
            expect(payload.MovementType).toBe('301');
            expect(payload.ReservationNo).toBe('RES001');
            expect(payload.ReservationItem).toBe('0010');
            expect(payload.CostCenter).toBeUndefined();
            expect(payload.GLAccount).toBeUndefined();
        });
    });

    describe('GoodsIssue301Service: Client Calls', () => {
        let GoodsIssue301Service;

        beforeAll(() => {
            GoodsIssue301Service = {
                postGoodsIssue: (oPayload) => {
                    if (!oPayload) return Promise.reject(new Error('Goods Issue payload is required'));
                    if (!oPayload.ReservationNo) return Promise.reject(new Error('Reservation Number is required for Movement 301'));
                    return mockODataClient.post('/odata/v4/goods-issue/postGoodsIssue301', oPayload);
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
            await expect(GoodsIssue301Service.postGoodsIssue({ MovementType: '301' }))
                .rejects.toThrow('Reservation Number is required');
        });

        it('calls postGoodsIssue301 with the Reservation-based payload and returns Material Document', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                MaterialDocument: '4900099001',
                MaterialDocYear: '2026'
            });

            const res = await GoodsIssue301Service.postGoodsIssue({
                MovementType: '301',
                ReservationNo: 'RES001',
                ReservationItem: '0010',
                Material: 'MAT1',
                IssueQty: 1,
                Unit: 'EA'
            });

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/postGoodsIssue301',
                expect.objectContaining({ MovementType: '301', ReservationNo: 'RES001' })
            );
            expect(res.MaterialDocument).toBe('4900099001');
        });

        it('calls reverseGoodsIssue with CancelHeader parameters', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                ReversalMaterialDocument: '4900099002',
                ReversalMaterialDocYear: '2026'
            });

            const res = await GoodsIssue301Service.reverseGoodsIssue('4900099001', '2026', '2026-09-30', '01');

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/reverseGoodsIssue',
                {
                    MaterialDocument: '4900099001',
                    MaterialDocYear: '2026',
                    PostingDate: '2026-09-30',
                    ReversalReason: '01'
                }
            );
            expect(res.ReversalMaterialDocument).toBe('4900099002');
        });
    });
});
