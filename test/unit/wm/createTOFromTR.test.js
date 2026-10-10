/**
 * Unit Tests for Chunk 4: Step 2 Service — CreateTOFromTR & Auto-Confirm
 * Testing:
 * - OData action createTOFromTR & function lookupTR
 * - TR lookup & quantity check against open quantity
 * - Batch capture for batch-managed materials
 * - Serial number capture for serial-managed materials
 * - Auto-confirm TO execution (L_TO_CONFIRM)
 * - Status update to 04 (TO Confirmed) in ZRES_TRACK & ZRES_LOG
 */

const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');

describe('Chunk 4: Step 2 Service — CreateTOFromTR & Auto Confirm', () => {
    let mockRfc;
    let adapter;

    beforeEach(() => {
        mockRfc = {
            call: jest.fn(),
            readTable: jest.fn()
        };
        adapter = new TrToAdapter({ rfc: mockRfc });
    });

    describe('1. TR Lookup (lookupTR)', () => {
        it('looks up TR, computes open quantity and detects material requirements', async () => {
            // Mock Z_WM_GET_TR_MATERIAL_LIST
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{
                    LGNUM: 'W01',
                    TBNUM: '0001001839',
                    BWLVS: '311',
                    BETYP: 'A',
                    BENUM: '0000000000',
                    RSNUM: '0000524979',
                    BDATU: '20261010',
                    STATU: '',
                    VLTYP: '911',
                    VLPLA: '',
                    NLTYP: '921',
                    NLPLA: 'TRANSFER'
                }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01',
                    TBNUM: '0001001839',
                    TBPOS: '0001',
                    MATNR: '000000008000000001',
                    WERKS: '1120',
                    LGORT: 'HS01',
                    CHARG: 'IN25000133',
                    MENGE: '10.000',
                    TAMEN: '2.000',
                    MEINS: 'NOS',
                    ELIKZ: ''
                }]
            });

            // Mock MAKT for description
            mockRfc.readTable.mockResolvedValueOnce([
                { MAKTX: 'iPhone 16 Pro 128GB' }
            ]);

            // Mock MARA for material profiles (Batch + Serial)
            mockRfc.readTable.mockResolvedValueOnce([
                { MATNR: '000000008000000001', XCHPF: 'X', SERNP: 'Z001' }
            ]);

            const tr = await adapter.lookupTR('0001001839', 'W01');

            expect(tr.TransferRequirement).toBe('1001839');
            expect(tr.TRItem).toBe('0001');
            expect(tr.ReservationNo).toBe('524979');
            expect(tr.MovementType).toBe('311');
            expect(tr.Material).toBe('8000000001');
            expect(tr.MaterialName).toBe('iPhone 16 Pro 128GB');
            expect(tr.OpenQuantity).toBe(8.000);
            expect(tr.Unit).toBe('NOS');
            expect(tr.Batch).toBe('IN25000133');
            expect(tr.IsBatchManaged).toBe(true);
            expect(tr.IsSerialManaged).toBe(true);
            expect(tr.DestinationStorageType).toBe('921');
            expect(tr.DestinationStorageBin).toBe('TRANSFER');
        });
    });

    describe('2. Quantity Checks & Input Validations', () => {
        beforeEach(() => {
            // Mock getTR response: open qty = 5
            mockRfc.call.mockResolvedValue({
                ET_TR_HEADER: [{
                    LGNUM: 'W01',
                    TBNUM: '0001001839',
                    BWLVS: '311',
                    RSNUM: '0000524979'
                }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01',
                    TBNUM: '0001001839',
                    TBPOS: '0001',
                    MATNR: '000000001000000045',
                    WERKS: '1120',
                    LGORT: 'HS01',
                    CHARG: '',
                    MENGE: '10.000',
                    TAMEN: '5.000',
                    MEINS: 'KG'
                }]
            });
            mockRfc.readTable.mockResolvedValue([]);
        });

        it('rejects zero or negative quantity with 400', async () => {
            await expect(adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: 0
            })).rejects.toThrow('Quantity must be greater than zero');

            await expect(adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: -2
            })).rejects.toThrow('Quantity must be greater than zero');
        });

        it('rejects quantity exceeding open TR quantity with 400', async () => {
            await expect(adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: 6 // Open is 5
            })).rejects.toThrow(/Requested quantity \(6\) exceeds open TR quantity \(5 KG\)/);
        });
    });

    describe('3. Batch & Serial Number Capture Validations', () => {
        it('requires batch when material is batch-managed', async () => {
            // Mock TR with batch-managed material
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311', RSNUM: '0000524979' }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001001839', TBPOS: '0001',
                    MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01',
                    CHARG: '', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG'
                }]
            });
            // MAKT description
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Batch Mat' }]);
            // MARA: XCHPF = 'X' (Batch-managed)
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: 'X', SERNP: '' }]);

            await expect(adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: 2,
                batch: '' // Missing batch
            })).rejects.toThrow(/Batch is mandatory for batch-managed material/);
        });

        it('requires serial numbers when material is serial-managed', async () => {
            // Mock TR with serial-managed material
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311', RSNUM: '0000524979' }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001001839', TBPOS: '0001',
                    MATNR: '000000008000000001', WERKS: '1120', LGORT: 'HS01',
                    CHARG: '', MENGE: '5.000', TAMEN: '0.000', MEINS: 'NOS'
                }]
            });
            // MAKT description
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Serial Mat' }]);
            // MARA: SERNP = 'Z001'
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000008000000001', XCHPF: '', SERNP: 'Z001' }]);

            // Missing serials
            await expect(adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: 2,
                serials: []
            })).rejects.toThrow(/Serial numbers are mandatory for serial-managed material/);

            // Mismatched serial count
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311', RSNUM: '0000524979' }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001001839', TBPOS: '0001',
                    MATNR: '000000008000000001', WERKS: '1120', LGORT: 'HS01',
                    CHARG: '', MENGE: '5.000', TAMEN: '0.000', MEINS: 'NOS'
                }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Serial Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000008000000001', XCHPF: '', SERNP: 'Z001' }]);

            await expect(adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: 2,
                serials: ['SER001'] // Only 1 serial for qty 2
            })).rejects.toThrow(/Number of serials \(1\) must equal requested quantity \(2\)/);
        });
    });

    describe('4. Create TO and Auto-Confirm Execution', () => {
        it('creates TO and automatically confirms it via L_TO_CONFIRM', async () => {
            // Mock getTR
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{
                    LGNUM: 'W01',
                    TBNUM: '0001001839',
                    BWLVS: '311',
                    RSNUM: '0000524979',
                    NLTYP: '921',
                    NLPLA: 'TRANSFER'
                }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01',
                    TBNUM: '0001001839',
                    TBPOS: '0001',
                    MATNR: '000000001000000045',
                    WERKS: '1120',
                    LGORT: 'HS01',
                    CHARG: '',
                    MENGE: '10.000',
                    TAMEN: '0.000',
                    MEINS: 'KG'
                }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Standard Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: '', SERNP: '' }]);

            // Mock ZWM_TO_CREATE_FROM_TR -> generates TO 0001012966
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0001012966',
                EV_MESSAGE: 'TO 0001012966 created'
            });

            // Mock L_TO_CONFIRM
            mockRfc.call.mockResolvedValueOnce({
                E_SUBRC: 0
            });

            const result = await adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: 5,
                autoConfirm: true
            });

            expect(result.Success).toBe(true);
            expect(result.TransferOrder).toBe('1012966');
            expect(result.TransferRequirement).toBe('1001839');
            expect(result.Confirmed).toBe(true);
            expect(result.Status).toBe('04');
            expect(result.StatusText).toBe('TO Confirmed');

            // Verify L_TO_CONFIRM was called with SQUIT='X'
            expect(mockRfc.call).toHaveBeenCalledWith('L_TO_CONFIRM', expect.objectContaining({
                I_LGNUM: 'W01',
                I_TANUM: '0001012966',
                I_SQUIT: 'X'
            }));
        });

        it('supports autoConfirm=false leaving TO in status 03 (TO Created)', async () => {
            // Mock getTR
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311', RSNUM: '0000524979' }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001001839', TBPOS: '0001',
                    MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01',
                    CHARG: '', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG'
                }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Standard Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: '', SERNP: '' }]);

            // Mock ZWM_TO_CREATE_FROM_TR
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0001012966',
                EV_MESSAGE: 'TO 0001012966 created'
            });

            const result = await adapter.createTOFromTR({
                tbnum: '0001001839',
                qty: 5,
                autoConfirm: false // No auto confirm
            });

            expect(result.Success).toBe(true);
            expect(result.TransferOrder).toBe('1012966');
            expect(result.Confirmed).toBe(false);
            expect(result.Status).toBe('03');
            expect(result.StatusText).toBe('TO Created');

            // L_TO_CONFIRM should not have been called
            expect(mockRfc.call).not.toHaveBeenCalledWith('L_TO_CONFIRM', expect.anything());
        });
    });
});
