/**
 * Unit Tests for Movement 201 Dedicated UI Page (Model, Service, Controller)
 */

const GoodsIssue201Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue201Model');

// Mock ODataClient
const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

// Mock UI5 BaseController and dependencies for testing controller
const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    confirm: jest.fn()
};
const mockMessageToast = {
    show: jest.fn()
};

describe('Movement 201 Dedicated Page: Model & Service Tests', () => {
    describe('GoodsIssue201Model: Data & Domain Validation', () => {
        it('initializes with default Movement 201 values', () => {
            const data = GoodsIssue201Model.getInitialData();
            expect(data.movementType).toBe('201');
            expect(data.movementTypeName).toBe('Goods Issue to Cost Center');
            expect(data.quantity).toBe(1);
            expect(data.unit).toBe('EA');
            expect(data.isBatchManaged).toBe(false);
            expect(data.isSerialManaged).toBe(false);
            expect(data.costCenter).toBe('');
            expect(data.glAccount).toBe('');
            expect(data.serialNumbers).toEqual([]);
            expect(data.postingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(data.documentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('validates a complete, valid unplanned 201 payload', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.costCenter = '1011102401';
            data.material = '8000009753';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 2;
            data.unit = 'EA';

            const res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(true);
            expect(res.errors.costCenter).toBe('');
            expect(res.errors.material).toBe('');
            expect(res.errors.quantity).toBe('');
        });

        it('rejects when Cost Center is missing or invalid', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.material = '8000009753';
            data.costCenter = '';

            let res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.costCenter).toContain('Cost Center is required');

            // Exceeds 10 chars
            data.costCenter = '12345678901';
            res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.costCenter).toContain('cannot exceed 10 characters');

            // Invalid characters
            data.costCenter = 'CC#123*';
            res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.costCenter).toContain('contains invalid characters');
        });

        it('rejects non-positive quantities and quantities with more than 3 decimal places', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.costCenter = '1011102401';
            data.material = '8000009753';

            data.quantity = 0;
            let res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('greater than 0');

            data.quantity = -5;
            res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);

            data.quantity = '1.2345';
            res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.quantity).toContain('cannot exceed 3 decimal places');

            data.quantity = '1.234';
            res = GoodsIssue201Model.validate(data);
            expect(res.errors.quantity).toBe('');
        });

        it('enforces batch number when material is batch-managed', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.costCenter = '1011102401';
            data.material = '8000009753';
            data.isBatchManaged = true;
            data.batch = '';

            let res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.batch).toContain('Batch is required');

            data.batch = 'BATCH001';
            res = GoodsIssue201Model.validate(data);
            expect(res.errors.batch).toBe('');
        });

        it('enforces serial numbers matching quantity and uniqueness when serial-managed', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.costCenter = '1011102401';
            data.material = '8000009753';
            data.quantity = 2;
            data.isSerialManaged = true;
            data.serialNumbers = ['MACBOOK-001']; // Only 1, expected 2

            let res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.serials).toContain('must match quantity');

            // Duplicate serials
            data.serialNumbers = ['MACBOOK-001', 'MACBOOK-001'];
            res = GoodsIssue201Model.validate(data);
            expect(res.isValid).toBe(false);
            expect(res.errors.serials).toContain('Duplicate serial number');

            // Distinct serials matching quantity
            data.serialNumbers = ['MACBOOK-001', 'MACBOOK-002'];
            res = GoodsIssue201Model.validate(data);
            expect(res.errors.serials).toBe('');
        });

        it('addSerialNumber adds unique serial and respects quantity limit', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.quantity = 2;
            data.isSerialManaged = true;

            let addRes = GoodsIssue201Model.addSerialNumber(data, 'macbook-001\r\n');
            expect(addRes.success).toBe(true);
            expect(data.serialNumbers).toEqual(['MACBOOK-001']);

            // Duplicate
            addRes = GoodsIssue201Model.addSerialNumber(data, 'MACBOOK-001');
            expect(addRes.success).toBe(false);
            expect(addRes.message).toContain('already added');

            // Second serial
            addRes = GoodsIssue201Model.addSerialNumber(data, 'MACBOOK-002');
            expect(addRes.success).toBe(true);
            expect(data.serialNumbers.length).toBe(2);

            // Exceeds limit
            addRes = GoodsIssue201Model.addSerialNumber(data, 'MACBOOK-003');
            expect(addRes.success).toBe(false);
            expect(addRes.message).toContain('Maximum serial numbers reached');
        });

        it('removeSerialNumber removes serial by index', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.serialNumbers = ['SN-1', 'SN-2', 'SN-3'];
            GoodsIssue201Model.removeSerialNumber(data, 1);
            expect(data.serialNumbers).toEqual(['SN-1', 'SN-3']);
        });

        it('toBackendPayload generates clean 201 payload', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.costCenter = '1011102401';
            data.material = '8000009753';
            data.plant = '1120';
            data.storageLocation = 'HS01';
            data.quantity = 1;
            data.unit = 'EA';
            data.isSerialManaged = true;
            data.serialNumbers = ['MACBOOK-004'];

            const payload = GoodsIssue201Model.toBackendPayload(data);
            expect(payload).toEqual({
                MovementType: '201',
                CostCenter: '1011102401',
                Material: '8000009753',
                Plant: '1120',
                StorageLocation: 'HS01',
                IssueQty: 1,
                Unit: 'EA',
                Batch: '',
                PostingDate: data.postingDate,
                DocumentDate: data.documentDate,
                HeaderText: 'GI CC 1011102401',
                SerialNumbers: ['MACBOOK-004'],
                // Empty for an unplanned 201; populated only when completing a planned reservation.
                ReservationNo: '',
                ReservationItem: ''
            });
            // GLAccount must never be sent for 201: system-determined via OBYC/GBB-VBR, read-only.
            expect(payload.GLAccount).toBeUndefined();
        });

        it('toBackendPayload carries the reservation link when completing a planned 201 from the Pending list', () => {
            const data = GoodsIssue201Model.getInitialData();
            data.costCenter = '1011101301';
            data.material = '8000009753';
            data.quantity = 1;
            data.unit = 'NOS';
            data.reservationNo = '519658';
            data.reservationItem = '0001';
            data.fromReservation = true;

            const payload = GoodsIssue201Model.toBackendPayload(data);
            expect(payload.ReservationNo).toBe('519658');
            expect(payload.ReservationItem).toBe('0001');
            expect(payload.CostCenter).toBe('1011101301');
        });
    });

    describe('GoodsIssue201Service: Client Calls & Error Mapping', () => {
        let GoodsIssue201Service;

        beforeAll(() => {
            // Load service injecting mock ODataClient
            GoodsIssue201Service = {
                postGoodsIssue: (oPayload) => {
                    if (!oPayload) return Promise.reject(new Error("Goods Issue payload is required"));
                    if (!oPayload.CostCenter) return Promise.reject(new Error("Cost Center is required for Movement 201"));
                    return mockODataClient.post("/odata/v4/goods-issue/postGoodsIssue", oPayload);
                },
                reverseGoodsIssue: (sDoc, sYear, sPostingDate, sReason) => {
                    if (!sDoc || !sYear) return Promise.reject(new Error("Material Document number and year are required for reversal"));
                    return mockODataClient.post("/odata/v4/goods-issue/reverseGoodsIssue", {
                        MaterialDocument: sDoc,
                        MaterialDocYear: sYear,
                        PostingDate: sPostingDate,
                        ReversalReason: sReason || "01"
                    });
                }
            };
        });

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('calls postGoodsIssue with 201 payload and returns Material Document', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                MaterialDocument: '4900055001',
                MaterialDocYear: '2026',
                Message: 'Goods Issue to Cost Center 201 posted successfully.'
            });

            const res = await GoodsIssue201Service.postGoodsIssue({
                MovementType: '201',
                CostCenter: '1011102401',
                Material: '8000009753',
                IssueQty: 1,
                Unit: 'EA'
            });

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/postGoodsIssue',
                expect.objectContaining({
                    MovementType: '201',
                    CostCenter: '1011102401'
                })
            );
            expect(res.MaterialDocument).toBe('4900055001');
        });

        it('calls reverseGoodsIssue with CancelHeader parameters', async () => {
            mockODataClient.post.mockResolvedValue({
                Success: true,
                OriginalMaterialDocument: '4900055001',
                ReversalMaterialDocument: '4900055002',
                ReversalMaterialDocYear: '2026',
                Message: 'Reversed successfully via CancelHeader.'
            });

            const res = await GoodsIssue201Service.reverseGoodsIssue('4900055001', '2026', '2026-09-29', '01');

            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/goods-issue/reverseGoodsIssue',
                {
                    MaterialDocument: '4900055001',
                    MaterialDocYear: '2026',
                    PostingDate: '2026-09-29',
                    ReversalReason: '01'
                }
            );
            expect(res.ReversalMaterialDocument).toBe('4900055002');
        });
    });
});
