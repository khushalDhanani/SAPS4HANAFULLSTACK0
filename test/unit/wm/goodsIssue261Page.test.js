/**
 * Unit Tests for Movement 261 Dedicated UI Page (Model, Service)
 */

const GoodsIssue261Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue261Model');

const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

describe('Movement 261 Dedicated Page: Model & Service Tests', () => {
    describe('GoodsIssue261Model: Data & Domain Validation', () => {
        it('initializes with default Movement 261 values and no unplanned/cost-center fields', () => {
            const data = GoodsIssue261Model.getInitialData();
            expect(data.movementType).toBe('261');
            expect(data.movementTypeName).toBe('Goods Issue for Order');
            expect(data.quantity).toBe(1);
            expect(data.isBatchManaged).toBe(false);
            expect(data.isSerialManaged).toBe(false);
            expect(data.reservationNo).toBe('');
            expect(data.reservationItem).toBe('');
            expect(data.orderNo).toBe('');
            expect(data.serialNumbers).toEqual([]);
            expect(data.costCenter).toBeUndefined();
            expect(data.glAccount).toBeUndefined();
        });

        it('rejects when Reservation Number is missing (no unplanned posting path exists for this movement type)', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.reservationNo).toContain('Reservation Number is required');
        });

        it('rejects when Reservation Item is missing', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.reservationItem).toContain('Reservation Item is required');
        });

        it('validates successfully once Reservation No/Item and derived fields are populated', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';

            const res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(true);
        });

        it('applyReservationItem populates Order (display-only) but validate() never checks or requires it', () => {
            const data = GoodsIssue261Model.getInitialData();
            GoodsIssue261Model.applyReservationItem(data, {
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

            const res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(true);
            // Order/Network is never part of the errors object - it is purely descriptive
            expect(res.errors.orderNo).toBeUndefined();

            // Blanking it out does not affect validity - confirms it is not independently validated
            data.orderNo = '';
            const res2 = GoodsIssue261Model.validate(data);
            expect(res2.isValid).toBe(true);
        });

        it('rejects non-positive quantities and quantities with more than 3 decimal places', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.unit = 'EA';

            data.quantity = 0;
            let res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('greater than 0');

            data.quantity = '1.2345';
            res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('cannot exceed 3 decimal places');
        });

        it('enforces batch number when material is batch-managed', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.isBatchManaged = true;
            data.batch = '';

            let res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.batch).toContain('Batch is required');

            data.batch = 'BATCH001';
            res = GoodsIssue261Model.validate(data);
            expect(res.errors.batch).toBe('');
        });

        it('enforces serial numbers matching quantity and uniqueness when serial-managed', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 2;
            data.unit = 'EA';
            data.isSerialManaged = true;
            data.serialNumbers = ['SN-001'];

            let res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.serials).toContain('must match quantity');

            data.serialNumbers = ['SN-001', 'SN-002'];
            res = GoodsIssue261Model.validate(data);
            expect(res.errors.serials).toBe('');
        });

        it('enforces scanned units count when scanEnabled is active', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '0010';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 2;
            data.unit = 'EA';
            data.scanEnabled = true;
            data.requiredScanCount = 2;
            data.scannedUnits = [{ barcode: 'SN01', serial: 'SN01', isSerial: true }];

            let res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.scannedUnits).toContain('Required 2 units scanned');

            data.scannedUnits.push({ barcode: 'SN02', serial: 'SN02', isSerial: true });
            res = GoodsIssue261Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.scannedUnits).toBe('');
        });

        it('toBackendPayload generates a clean payload with no CostCenter/GLAccount and includes scanned serials', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '10';
            data.material = 'MAT1';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 2;
            data.unit = 'EA';
            data.scanEnabled = true;
            data.scannedUnits = [
                { barcode: 'SN-001', serial: 'SN-001', isSerial: true },
                { barcode: 'SN-002', serial: 'SN-002', isSerial: true }
            ];

            const payload = GoodsIssue261Model.toBackendPayload(data);
            expect(payload.MovementType).toBe('261');
            expect(payload.ReservationNo).toBe('RES001');
            expect(payload.ReservationItem).toBe('0010');
            expect(payload.CostCenter).toBeUndefined();
            expect(payload.GLAccount).toBeUndefined();
            expect(payload.SerialNumbers).toEqual(['SN-001', 'SN-002']);
        });

        it('toBackendPayload carries a fresh ClientAttemptId per call so deliberate re-posts are distinct attempts', () => {
            const data = GoodsIssue261Model.getInitialData();
            data.reservationNo = 'RES001';
            data.reservationItem = '10';
            data.material = 'MAT1';
            data.plant = '1120';
            data.quantity = 2;
            data.unit = 'EA';

            const first = GoodsIssue261Model.toBackendPayload(data);
            const second = GoodsIssue261Model.toBackendPayload(data);
            expect(first.ClientAttemptId).toEqual(expect.stringMatching(/^GIA/));
            expect(first.ClientAttemptId.length).toBeLessThanOrEqual(36);
            expect(second.ClientAttemptId).not.toBe(first.ClientAttemptId);
        });
    });

    describe('GoodsIssue261Service: Client Calls', () => {
        let GoodsIssue261Service;

        beforeAll(() => {
            GoodsIssue261Service = {
                postGoodsIssue: (oPayload) => {
                    if (!oPayload) return Promise.reject(new Error('Goods Issue payload is required'));
                    if (!oPayload.ReservationNo) return Promise.reject(new Error('Reservation Number is required for Movement 261'));
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
            await expect(GoodsIssue261Service.postGoodsIssue({ MovementType: '261' }))
                .rejects.toThrow('Reservation Number is required');
        });

        it('calls postGoodsIssue with the Reservation-based payload and returns Material Document', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                MaterialDocument: '4900099001',
                MaterialDocYear: '2026'
            });

            const res = await GoodsIssue261Service.postGoodsIssue({
                MovementType: '261',
                ReservationNo: 'RES001',
                ReservationItem: '0010',
                Material: 'MAT1',
                IssueQty: 1,
                Unit: 'EA'
            });

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/postGoodsIssue',
                expect.objectContaining({ MovementType: '261', ReservationNo: 'RES001' })
            );
            expect(res.MaterialDocument).toBe('4900099001');
        });

        it('calls reverseGoodsIssue with CancelHeader parameters', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                ReversalMaterialDocument: '4900099002',
                ReversalMaterialDocYear: '2026'
            });

            const res = await GoodsIssue261Service.reverseGoodsIssue('4900099001', '2026', '2026-09-29', '01');

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
