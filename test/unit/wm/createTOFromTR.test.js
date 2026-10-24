/**
 * Unit Tests for Chunk 4: Step 2 Service — CreateTOFromTR & Auto-Confirm
 * [mock only, not SAP verification]
 *
 * Testing:
 * - OData action createTOFromTR & function lookupTR
 * - TR lookup & quantity check against open quantity
 * - Batch capture for batch-managed materials
 * - Serial number capture for serial-managed materials
 * - Chained TO step: CREATE TO via Z_WM_TO_CREATE_FROM_TR, then CONFIRM TO via L_TO_CONFIRM
 * - Status 03 (TO Created), Status 04 (TO Confirmed), Status 12 (TO Create Error), Status 13 (TO Confirm Error)
 * - Retry logic: status 13 retries confirm only; duplicate TO blocked when TANUM is already confirmed
 */

const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');

describe('Chunk 4: Step 2 Service — CreateTOFromTR & Auto Confirm [mock only, not SAP verification]', () => {
    let mockRfc;
    let adapter;

    let currentTr = '0001001839';
    beforeEach(() => {
        currentTr = '0001001839';
        mockRfc = {
            call: jest.fn(async (fm, params) => {
                if (params?.IV_TR_NUMBER) currentTr = params.IV_TR_NUMBER;
                return {};
            }),
            readTable: jest.fn((table, fields, options) => {
                const optStr = JSON.stringify(options || []);
                if (table === 'LTBK') {
                    return Promise.resolve([{
                        LGNUM: 'W01',
                        TBNUM: adapter?._lastTr || currentTr,
                        BWLVS: '311'
                    }]);
                }
                if (table === 'LTAK' && optStr.includes('TANUM')) {
                    const match = optStr.match(/TANUM\s*=\s*'(\d+)'/);
                    const tanum = match ? match[1] : '0001012966';
                    return Promise.resolve([{
                        LGNUM: 'W01',
                        TANUM: tanum,
                        TBNUM: adapter?._lastTr || currentTr,
                        BWLVS: '311',
                        KQUIT: '',
                        BDATU: '20261010'
                    }]);
                }
                if (table === 'LTAP' && optStr.includes('TANUM')) {
                    const match = optStr.match(/TANUM\s*=\s*'(\d+)'/);
                    const tanum = match ? match[1] : '0001012966';
                    return Promise.resolve([{
                        LGNUM: 'W01',
                        TANUM: tanum,
                        TAPOS: '0001',
                        TBPOS: '0001',
                        MATNR: '000000001000000045',
                        WERKS: '1120',
                        LGORT: 'HS01',
                        CHARG: '',
                        NSOLA: '5.000',
                        ALTME: 'KG',
                        PQUIT: ''
                    }]);
                }
                return Promise.resolve([]);
            })
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

            const tr = await adapter.lookupTR('0001001839', 'W01', 'TR');

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
            expect(tr.DestinationStorageType).toBe('921'); // from the TR header, no default
            expect(tr.DestinationStorageBin).toBe('TRANSFER');
            expect(tr.Items).toHaveLength(1);
        });

        it('rejects a lookup without an explicit document type (TR / RES) with 400 [mock only, not SAP verification]', async () => {
            await expect(adapter.lookupTR('0001001839', 'W01')).rejects.toMatchObject({ status: 400 });
            expect(mockRfc.call).not.toHaveBeenCalled();
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
                lgnum: 'W01',
                tbnum: '0001001839',
                qty: 0
            })).rejects.toThrow('Quantity must be greater than zero');

            await expect(adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839',
                qty: -2
            })).rejects.toThrow('Quantity must be greater than zero');
        });

        it('rejects quantity exceeding open TR quantity with 400', async () => {
            await expect(adapter.createTOFromTR({
                lgnum: 'W01',
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
                lgnum: 'W01',
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
                lgnum: 'W01',
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
                lgnum: 'W01',
                tbnum: '0001001839',
                qty: 2,
                serials: ['SER001'] // Only 1 serial for qty 2
            })).rejects.toThrow(/Number of serials \(1\) must equal requested quantity \(2\)/);
        });
    });

    describe('4. Chained Create and Confirm TO Execution [mock only, not SAP verification]', () => {
        const mockTrSetup = (includeGuard = true) => {
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
            if (includeGuard) {
                mockRfc.readTable.mockResolvedValueOnce([]); // LTAK: no TO yet for this TR (double-TO guard)
            }
        };
        const authOk = () => mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // AUTHORITY_CHECK always raises

        it('scenario A: create ok + confirm ok -> status 04, Confirmed true', async () => {
            mockTrSetup();
            authOk(); // L_BWLVS before create

            // Mock Z_WM_TO_CREATE_FROM_TR -> generates TO 0001012966
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0001012966',
                EV_MESSAGE: 'TO 0001012966 created'
            });

            authOk(); // L_LGNUM before confirm
            // Mock L_TO_CONFIRM
            mockRfc.call.mockResolvedValueOnce({
                E_SUBRC: 0
            });

            const result = await adapter.createTOFromTR({
                lgnum: 'W01',
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

        it('scenario B: create ok + confirm fail -> TANUM kept, status 13, Confirmed false', async () => {
            mockTrSetup();
            authOk();

            // Mock Z_WM_TO_CREATE_FROM_TR -> succeeds and returns TANUM
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0001012966',
                EV_MESSAGE: 'TO 0001012966 created'
            });

            authOk();
            // Mock L_TO_CONFIRM -> fails with foreign lock; LTAP then shows the item unconfirmed
            mockRfc.call.mockRejectedValueOnce(new Error('L_TO_CONFIRM: foreign_lock'));
            mockRfc.readTable.mockResolvedValueOnce([{ TAPOS: '0001', PQUIT: '' }]);

            const result = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839',
                qty: 5,
                autoConfirm: true
            });

            // TANUM must be kept!
            expect(result.TransferOrder).toBe('1012966');
            expect(result.Status).toBe('13');
            expect(result.StatusText).toBe('TO Confirmation Error');
            expect(result.Confirmed).toBe(false);
            expect(result.ErrorStep).toBe('LT12');
            expect(result.ErrorMessage).toContain('foreign_lock');
        });

        it('scenario C: retry confirm only -> invokes L_TO_CONFIRM, does NOT call create FM', async () => {
            mockTrSetup(false);
            authOk(); // L_LGNUM before confirm

            // Mock L_TO_CONFIRM -> succeeds
            mockRfc.call.mockResolvedValueOnce({
                E_SUBRC: 0
            });

            const result = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839',
                qty: 5,
                autoConfirm: true,
                existingToNumber: '1012966',
                status: '13'
            });

            expect(result.TransferOrder).toBe('1012966');
            expect(result.Status).toBe('04');
            expect(result.Confirmed).toBe(true);
            expect(result.StatusText).toBe('TO Confirmed');

            // Verify Z_WM_TO_CREATE_FROM_TR was NOT called
            expect(mockRfc.call).not.toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.anything());
            expect(mockRfc.call).not.toHaveBeenCalledWith('ZWM_TO_CREATE_FROM_TR', expect.anything());

            // Verify L_TO_CONFIRM was called
            expect(mockRfc.call).toHaveBeenCalledWith('L_TO_CONFIRM', expect.objectContaining({
                I_LGNUM: 'W01',
                I_TANUM: '0001012966',
                I_SQUIT: 'X'
            }));
        });

        it('scenario D: a confirmed earlier TO (status 04) does not block a further TO for the open quantity', async () => {
            mockTrSetup();
            authOk();
            mockRfc.call.mockResolvedValueOnce({ EV_SUCCESS: 'S', EV_TANUM: '0001012967', EV_MESSAGE: 'TO created' });
            authOk();
            mockRfc.call.mockResolvedValueOnce({ E_SUBRC: 0 });

            const result = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839',
                qty: 5,
                autoConfirm: true,
                existingToNumber: '1012966',
                status: '04'
            });

            expect(result.TransferOrder).toBe('1012967');
            expect(result.Status).toBe('04');
            expect(mockRfc.call).toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.anything());
        });

        it('scenario E: an unconfirmed TO item in SAP (LTAK/LTAP PQUIT blank) blocks a second TO for the same TR item', async () => {
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311', RSNUM: '0000524979' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0001001839', TBPOS: '0001', MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', CHARG: '', MENGE: '10.000', TAMEN: '5.000', MEINS: 'KG' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Standard Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: '', SERNP: '' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ TANUM: '0001012966', KQUIT: '' }]); // LTAK: TO header for the TR, not confirmed
            mockRfc.readTable.mockResolvedValueOnce([{ TAPOS: '0001', TBPOS: '0001' }]);   // LTAP: its item with PQUIT blank

            await expect(adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 5, autoConfirm: true }))
                .rejects.toThrow(/Unconfirmed Transfer Order 1012966 exists for TR 1001839 item 0001/);

            expect(mockRfc.readTable).toHaveBeenCalledWith('LTAK', ['TANUM', 'KQUIT'], ["LGNUM = 'W01'", "AND TBNUM = '0001001839'"]);
            expect(mockRfc.readTable).toHaveBeenCalledWith('LTAP', ['TAPOS', 'TBPOS'], expect.arrayContaining(["AND PQUIT = ''", "AND TBPOS = '0001'"]));
            expect(mockRfc.call).not.toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.anything());
        });

        it('supports autoConfirm=false leaving TO in status 03 (TO Created)', async () => {
            mockTrSetup();
            authOk();

            // Mock Z_WM_TO_CREATE_FROM_TR
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0001012966',
                EV_MESSAGE: 'TO 0001012966 created'
            });

            const result = await adapter.createTOFromTR({
                lgnum: 'W01',
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

    describe('9. Material profile reads the serial profile from MARC (not MARA)', () => {
        it('detects a serial-managed material from MARC-SERNP, filtered by plant', async () => {
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: '', SERNP: 'ZSN1' }]);

            const profiles = await adapter._materialProfiles(['8000009753'], '1120');

            expect(profiles['8000009753'].isSerialManaged).toBe(true);
            expect(profiles['8000009753'].isBatchManaged).toBe(false);
            expect(mockRfc.readTable).toHaveBeenCalledWith(
                'MARC',
                ['XCHPF', 'SERNP'],
                expect.arrayContaining([expect.stringContaining("WERKS = '1120'")]),
                1
            );
        });

        it('treats a material as non-serial when MARC-SERNP is blank', async () => {
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: 'X', SERNP: '' }]);

            const profiles = await adapter._materialProfiles(['8900000004'], '1120');

            expect(profiles['8900000004'].isSerialManaged).toBe(false);
            expect(profiles['8900000004'].isBatchManaged).toBe(true);
        });
    });

    // ─── autoConfirm × autoPostMigo matrix (adapter level) ─────────────────────
    // autoPostMigo is NOT handled by the adapter; it is handled by the handler.
    // These 4 tests verify the adapter half: confirm called/skipped, status correct.
    // [mock only, not SAP verification]
    describe('10. autoConfirm × autoPostMigo flag matrix — adapter level [mock only, not SAP verification]', () => {
        const trHeader = [{
            LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311',
            RSNUM: '0000524979', NLTYP: '921', NLPLA: 'TRANSFER', VLTYP: '', VLPLA: ''
        }];
        const trItem = [{
            LGNUM: 'W01', TBNUM: '0001001839', TBPOS: '0001',
            MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', CHARG: '',
            MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG', ELIKZ: ''
        }];

        /** Minimal TR + profile setup shared by all 4 cases */
        const setupTr = () => {
            mockRfc.call.mockResolvedValueOnce({ ET_TR_HEADER: trHeader, ET_TR_ITEMS: trItem }); // getTR
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Test Mat' }]);          // MAKT
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: '', SERNP: '' }]);       // MARC profile
            mockRfc.readTable.mockResolvedValueOnce([]);                                // LTAK double-TO guard
            // AUTHORITY_CHECK always throws (auth stub)
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' }));
        };
        const toCreated = { EV_SUCCESS: 'S', EV_TANUM: '0001099001', EV_MESSAGE: 'created' };

        it('case 1: autoConfirm=true, autoPostMigo=true — adapter confirms, returns status 04, Confirmed true', async () => {
            setupTr();
            mockRfc.call.mockResolvedValueOnce(toCreated);      // Z_WM_TO_CREATE_FROM_TR
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // L_LGNUM auth
            mockRfc.call.mockResolvedValueOnce({});             // L_TO_CONFIRM succeeds

            const res = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839', qty: 3,
                autoConfirm: true,
                autoPostMigo: true   // adapter ignores this; handler uses it for MIGO
            });

            expect(res.Confirmed).toBe(true);
            expect(res.Status).toBe('04');
            expect(mockRfc.call).toHaveBeenCalledWith('L_TO_CONFIRM', expect.objectContaining({ I_TANUM: '0001099001' }));
        });

        it('case 2: autoConfirm=true, autoPostMigo=false — adapter confirms, returns status 04, Confirmed true', async () => {
            setupTr();
            mockRfc.call.mockResolvedValueOnce(toCreated);
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // L_LGNUM auth
            mockRfc.call.mockResolvedValueOnce({});             // L_TO_CONFIRM

            const res = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839', qty: 3,
                autoConfirm: true,
                autoPostMigo: false
            });

            expect(res.Confirmed).toBe(true);
            expect(res.Status).toBe('04');
            expect(mockRfc.call).toHaveBeenCalledWith('L_TO_CONFIRM', expect.objectContaining({ I_TANUM: '0001099001' }));
        });

        it('case 3: autoConfirm=false, autoPostMigo=true — adapter skips confirm, returns status 03, Confirmed false', async () => {
            setupTr();
            mockRfc.call.mockResolvedValueOnce(toCreated);  // Z_WM_TO_CREATE_FROM_TR

            const res = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839', qty: 3,
                autoConfirm: false,
                autoPostMigo: true
            });

            expect(res.Confirmed).toBe(false);
            expect(res.Status).toBe('03');
            expect(mockRfc.call).not.toHaveBeenCalledWith('L_TO_CONFIRM', expect.anything());
        });

        it('case 4: autoConfirm=false, autoPostMigo=false — adapter skips confirm, returns status 03, Confirmed false', async () => {
            setupTr();
            mockRfc.call.mockResolvedValueOnce(toCreated);  // Z_WM_TO_CREATE_FROM_TR

            const res = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839', qty: 3,
                autoConfirm: false,
                autoPostMigo: false
            });

            expect(res.Confirmed).toBe(false);
            expect(res.Status).toBe('03');
            expect(mockRfc.call).not.toHaveBeenCalledWith('L_TO_CONFIRM', expect.anything());
        });
    });

    // ─── WM_PICK_SOURCE_FROM_LQUA Feature Flag Tests ─────────────────────────
    // [mock only, not SAP verification]
    describe('11. WM_PICK_SOURCE_FROM_LQUA feature flag [mock only, not SAP verification]', () => {
        const origEnv = process.env.WM_PICK_SOURCE_FROM_LQUA;
        afterEach(() => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = origEnv;
        });

        const trHeader = [{
            LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311',
            RSNUM: '0000524979', NLTYP: '921', NLPLA: 'TRANSFER', VLTYP: '', VLPLA: ''
        }];
        const trItem = [{
            LGNUM: 'W01', TBNUM: '0001001839', TBPOS: '0001',
            MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', CHARG: '',
            MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG', ELIKZ: ''
        }];

        const setupTr = () => {
            mockRfc.call.mockResolvedValueOnce({ ET_TR_HEADER: trHeader, ET_TR_ITEMS: trItem }); // getTR
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Test Mat' }]);          // MAKT
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: '', SERNP: '' }]);       // MARC profile
            mockRfc.readTable.mockResolvedValueOnce([]);                                // LTAK double-TO guard
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // checkAuthorization
        };
        const toCreated = { EV_SUCCESS: 'S', EV_TANUM: '0001099001', EV_MESSAGE: 'created' };

        it('when flag is false (default), leaves VLTYP/VLPLA/VLENR blank without querying LQUA [mock only, not SAP verification]', async () => {
            delete process.env.WM_PICK_SOURCE_FROM_LQUA;
            setupTr();
            mockRfc.call.mockResolvedValueOnce(toCreated); // Z_WM_TO_CREATE_FROM_TR

            await adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 3, autoConfirm: false });

            expect(mockRfc.call).toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.objectContaining({
                IT_ITEMS: [expect.objectContaining({ VLTYP: '', VLPLA: '', VLENR: '' })]
            }));
        });

        it('when flag is true and TR has no source, reads LQUA, excludes interim T333, verifies FIFO T331-STAUS, and passes VLTYP/VLPLA/VLENR [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            // 1. T333 interim types
            mockRfc.readTable.mockResolvedValueOnce([
                { VLTYP: '', NLTYP: '921', VKDYN: '', NKDYN: 'X' },
                { VLTYP: '902', NLTYP: '', VKDYN: 'X', NKDYN: '' }
            ]);
            // 2. LQUA quants (one interim 921, one newer physical EN1, one older physical EN1)
            mockRfc.readTable.mockResolvedValueOnce([
                { LQNUM: '102', LGTYP: '921', LGPLA: 'TRANSFER', LENUM: '', CHARG: '', VERME: '5.000', WDATU: '20261001' },
                { LQNUM: '101', LGTYP: 'EN1', LGPLA: '0-L0001-02', LENUM: '00000000001000057775', CHARG: '', VERME: '2.000', WDATU: '20261005', BZEIT: '120000' },
                { LQNUM: '100', LGTYP: 'EN1', LGPLA: '0-L0001-01', LENUM: '00000000001000057774', CHARG: '', VERME: '1.000', WDATU: '20261001', BZEIT: '090000' }
            ]);
            // 3. T331 for EN1: STAUS = 'F' (FIFO), VOLLE = 'X' (Complete removal)
            mockRfc.readTable.mockResolvedValueOnce([
                { LGTYP: 'EN1', STAUS: 'F', VOLLE: 'X', LENVW: 'X' }
            ]);
            // 4. Z_WM_TO_CREATE_FROM_TR call
            mockRfc.call.mockResolvedValueOnce(toCreated);

            await adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 1, autoConfirm: false });

            expect(mockRfc.call).toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.objectContaining({
                IT_ITEMS: [expect.objectContaining({
                    VLTYP: 'EN1',
                    VLPLA: '0-L0001-01',
                    VLENR: '1000057774'
                })]
            }));
        });

        it('when chosen quant has SU and T331-VOLLE = X but requested qty !== SU qty, throws clear 400 naming SU and qty [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            // 1. T333 interim types
            mockRfc.readTable.mockResolvedValueOnce([]);
            // 2. LQUA quants (SU with 5.000 KG)
            mockRfc.readTable.mockResolvedValueOnce([
                { LQNUM: '100', LGTYP: 'EN1', LGPLA: '0-L0001-01', LENUM: '00000000001000057774', CHARG: '', VERME: '5.000', WDATU: '20261001' }
            ]);
            // 3. T331 for EN1: STAUS = 'F', VOLLE = 'X'
            mockRfc.readTable.mockResolvedValueOnce([
                { LGTYP: 'EN1', STAUS: 'F', VOLLE: 'X' }
            ]);

            await expect(adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 2, autoConfirm: false }))
                .rejects.toMatchObject({
                    status: 400,
                    message: expect.stringContaining('Storage unit 1000057774 in storage type EN1 requires complete stock removal')
                });
        });

        it('when multiple SUs exist and T331-VOLLE = X, chooses SU whose qty matches requested qty via FIFO without splitting SUs [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            // 1. T333 interim types
            mockRfc.readTable.mockResolvedValueOnce([]);
            // 2. LQUA quants (SU 1000057774 with 5.000 KG older, SU 1000057775 with 2.000 KG newer)
            mockRfc.readTable.mockResolvedValueOnce([
                { LQNUM: '100', LGTYP: 'EN1', LGPLA: '0-L0001-01', LENUM: '00000000001000057774', CHARG: '', VERME: '5.000', WDATU: '20261001', BZEIT: '090000' },
                { LQNUM: '101', LGTYP: 'EN1', LGPLA: '0-L0001-02', LENUM: '00000000001000057775', CHARG: '', VERME: '2.000', WDATU: '20261002', BZEIT: '100000' }
            ]);
            // 3. T331 for EN1: STAUS = 'F', VOLLE = 'X'
            mockRfc.readTable.mockResolvedValueOnce([
                { LGTYP: 'EN1', STAUS: 'F', VOLLE: 'X' }
            ]);
            // 4. Z_WM_TO_CREATE_FROM_TR call
            mockRfc.call.mockResolvedValueOnce(toCreated);

            await adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 2, autoConfirm: false });

            // Must choose SU 1000057775 (qty 2) without splitting SU 1000057774 (qty 5)
            expect(mockRfc.call).toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.objectContaining({
                IT_ITEMS: [expect.objectContaining({
                    VLTYP: 'EN1',
                    VLPLA: '0-L0001-02',
                    VLENR: '1000057775'
                })]
            }));
        });

        it('when multiple SUs exist and none match requested qty under T331-VOLLE = X, throws 400 listing all SU numbers and quantities [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            // 1. T333 interim types
            mockRfc.readTable.mockResolvedValueOnce([]);
            // 2. LQUA quants (SU 1 with 5 KG, SU 2 with 10 KG)
            mockRfc.readTable.mockResolvedValueOnce([
                { LQNUM: '100', LGTYP: 'EN1', LGPLA: '0-L0001-01', LENUM: '00000000001000057774', CHARG: '', VERME: '5.000', WDATU: '20261001' },
                { LQNUM: '101', LGTYP: 'EN1', LGPLA: '0-L0001-02', LENUM: '00000000001000057775', CHARG: '', VERME: '10.000', WDATU: '20261002' }
            ]);
            // 3. T331 for EN1: STAUS = 'F', VOLLE = 'X'
            mockRfc.readTable.mockResolvedValueOnce([
                { LGTYP: 'EN1', STAUS: 'F', VOLLE: 'X' }
            ]);

            await expect(adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 3, autoConfirm: false }))
                .rejects.toMatchObject({
                    status: 400,
                    message: expect.stringMatching(/1000057774 \(qty: 5\).*1000057775 \(qty: 10\)/)
                });
        });

        it('when flag is true but caller explicitly passes sourceStorageType/Bin, skips LQUA lookup [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            mockRfc.call.mockResolvedValueOnce(toCreated);

            await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001001839', qty: 1, autoConfirm: false,
                sourceStorageType: 'RM1', sourceStorageBin: 'BIN-RM'
            });

            expect(mockRfc.call).toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.objectContaining({
                IT_ITEMS: [expect.objectContaining({
                    VLTYP: 'RM1',
                    VLPLA: 'BIN-RM'
                })]
            }));
        });

        it('when flag is true and no physical matching stock in LQUA, throws clear 400 error [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            // T333
            mockRfc.readTable.mockResolvedValueOnce([{ VLTYP: '', NLTYP: '921', VKDYN: '', NKDYN: 'X' }]);
            // LQUA returns only interim stock (or empty)
            mockRfc.readTable.mockResolvedValueOnce([
                { LQNUM: '102', LGTYP: '921', LGPLA: 'TRANSFER', LENUM: '', CHARG: '', VERME: '5.000' }
            ]);

            await expect(adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 1, autoConfirm: false }))
                .rejects.toMatchObject({
                    status: 400,
                    message: expect.stringContaining('No matching stock found')
                });
        });

        it('when flag is true and storage type uses non-FIFO strategy, throws clear 400 error [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            // T333
            mockRfc.readTable.mockResolvedValueOnce([]);
            // LQUA returns quant in ST1
            mockRfc.readTable.mockResolvedValueOnce([
                { LQNUM: '200', LGTYP: 'ST1', LGPLA: 'BIN-01', LENUM: '', CHARG: '', VERME: '2.000' }
            ]);
            // T331 for ST1 has STAUS = 'L' (LIFO)
            mockRfc.readTable.mockResolvedValueOnce([
                { LGTYP: 'ST1', STAUS: 'L' }
            ]);

            await expect(adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 1, autoConfirm: false }))
                .rejects.toMatchObject({
                    status: 400,
                    message: expect.stringContaining("only FIFO ('F') is supported")
                });
        });

        it('when storage type is OH1 with strategy H (user exit), throws 400 naming OH1 and strategy H [mock only, not SAP verification]', async () => {
            process.env.WM_PICK_SOURCE_FROM_LQUA = 'true';
            setupTr();
            // T333
            mockRfc.readTable.mockResolvedValueOnce([]);
            // LQUA returns quant in OH1
            mockRfc.readTable.mockResolvedValueOnce([
                { LQNUM: '300', LGTYP: 'OH1', LGPLA: 'ONHOLD', LENUM: '', CHARG: '', VERME: '5.000' }
            ]);
            // T331 for OH1 has STAUS = 'H' (User Exit)
            mockRfc.readTable.mockResolvedValueOnce([
                { LGTYP: 'OH1', STAUS: 'H' }
            ]);

            await expect(adapter.createTOFromTR({ lgnum: 'W01', tbnum: '0001001839', qty: 1, autoConfirm: false }))
                .rejects.toMatchObject({
                    status: 400,
                    message: expect.stringContaining("Storage type OH1 has stock removal strategy 'H'; only FIFO ('F') is supported under WM_PICK_SOURCE_FROM_LQUA")
                });
        });
    });

    // ─── Task 8: SLoc Pre-Check in lookupTR ──────────────────────────────────
    // [mock only, not SAP verification]
    describe('12. SLoc pre-check in lookupTR [mock only, not SAP verification]', () => {
        it('returns StockWarning listing other SLocs when requested SLoc has no stock in warehouse [mock only, not SAP verification]', async () => {
            const trHeader = [{
                LGNUM: 'W01', TBNUM: '0001000799', BWLVS: '311',
                RSNUM: '0000525862', NLTYP: '921', NLPLA: 'TRANSFER', VLTYP: '', VLPLA: ''
            }];
            const trItem = [{
                LGNUM: 'W01', TBNUM: '0001000799', TBPOS: '0001',
                MATNR: '000000008000009753', WERKS: '1120', LGORT: 'HS01', CHARG: '',
                MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: ''
            }];

            mockRfc.call.mockResolvedValueOnce({ ET_TR_HEADER: trHeader, ET_TR_ITEMS: trItem }); // getTR
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Laptop' }]);                       // MAKT
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: '', SERNP: '' }]);                    // MARC
            // LQUA for HS01: empty (no stock)
            mockRfc.readTable.mockResolvedValueOnce([]);
            // LQUA for other SLocs: stock in MT01
            mockRfc.readTable.mockResolvedValueOnce([
                { LGORT: 'MT01', VERME: '3.000' }
            ]);

            const res = await adapter.lookupTR('0001000799', 'W01', 'TR');

            expect(res.StorageLocation).toBe('HS01'); // Not silently changed!
            expect(res.StockWarning).toContain('Storage location HS01 has no WM stock for material 8000009753 in warehouse W01');
            expect(res.StockWarning).toContain('Available in storage location(s): MT01');
        });
    });

    describe('13. Mismatched TR validation & flag control in lookupTR and createTOFromTR [mock only, not browser verification]', () => {
        const origEnv = process.env.WM_ALLOW_MISMATCHED_TR;

        afterEach(() => {
            if (origEnv !== undefined) {
                process.env.WM_ALLOW_MISMATCHED_TR = origEnv;
            } else {
                delete process.env.WM_ALLOW_MISMATCHED_TR;
            }
        });

        it('lookupTR detects mismatch between LTBK-BWLVS (311) and RESB-BWART (201) and returns warning [mock only, not browser verification]', async () => {
            delete process.env.WM_ALLOW_MISMATCHED_TR;

            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{
                    LGNUM: 'W01', TBNUM: '0001000823', BWLVS: '311',
                    RSNUM: '0000527870', NLTYP: '921', NLPLA: 'TRANSFER'
                }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001000823', TBPOS: '0001',
                    RSPOS: '0001',
                    MATNR: '000000008000005294', WERKS: '1120', LGORT: 'HS01',
                    MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: ''
                }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Mobile Charger' }]); // MAKT
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: '', SERNP: '' }]);    // MARC
            mockRfc.readTable.mockResolvedValueOnce([{ LGTYP: '001', LGPLA: 'BIN1', VERME: '1.000' }]); // LQUA
            mockRfc.readTable.mockResolvedValueOnce([                              // RESB
                { RSNUM: '0000527870', RSPOS: '0001', BWART: '201', UMWRK: '', UMLGO: '', CHARG: '' }
            ]);
            mockRfc.readTable.mockResolvedValueOnce([                              // RKPF
                { KOSTL: 'CC1120', ANLN1: '', ANLN2: '' }
            ]);

            const res = await adapter.lookupTR('0001000823', 'W01', 'TR');

            expect(res.MovementType).toBe('311');
            expect(res.ReservationMovementType).toBe('201');
            expect(res.AllowMismatchedTR).toBe(false);
            expect(res.Warning).toBe('TR movement 311 does not match reservation movement 201');
            expect(res.CostCenter).toBe('CC1120');
        });

        it('lookupTR allows only the exact app-tracked reservation/TR/item/movement link [mock only, not browser verification]', async () => {
            delete process.env.WM_ALLOW_MISMATCHED_TR;
            adapter._findTrackedReservationForTR = jest.fn().mockResolvedValue({
                TransferRequirement: '0001000823', ReservationNo: '0000527870', ReservationItem: '0001', MovementType: '201'
            });
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001000823', BWLVS: '311', RSNUM: '0000527870', NLTYP: '921', NLPLA: 'TRANSFER' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0001000823', TBPOS: '0001', RSPOS: '0001', MATNR: '000000008000005294', WERKS: '1120', LGORT: 'HS01', MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: '' }]
            });
            mockRfc.readTable
                .mockResolvedValueOnce([{ MAKTX: 'Mobile Charger' }])
                .mockResolvedValueOnce([{ XCHPF: '', SERNP: '' }])
                .mockResolvedValueOnce([{ LGTYP: '001', LGPLA: 'BIN1', VERME: '1.000' }])
                .mockResolvedValueOnce([{ RSNUM: '0000527870', RSPOS: '0001', BWART: '201', UMWRK: '', UMLGO: '', CHARG: '' }])
                .mockResolvedValueOnce([{ KOSTL: '1011201301', ANLN1: '', ANLN2: '' }]);

            const result = await adapter.lookupTR('0001000823', 'W01', 'TR');

            expect(result.ReservationMovementType).toBe('201');
            expect(result.AllowMismatchedTR).toBe(true);
            expect(adapter._findTrackedReservationForTR).toHaveBeenCalledWith('0001000823', 'W01'); // warehouse is part of the tracking key
        });

        it('createTOFromTR blocks mismatched TR when WM_ALLOW_MISMATCHED_TR is default false [mock only, not browser verification]', async () => {
            delete process.env.WM_ALLOW_MISMATCHED_TR;

            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{
                    LGNUM: 'W01', TBNUM: '0001000823', BWLVS: '311',
                    RSNUM: '0000527870', NLTYP: '921', NLPLA: 'TRANSFER'
                }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001000823', TBPOS: '0001',
                    RSPOS: '0001',
                    MATNR: '000000008000005294', WERKS: '1120', LGORT: 'HS01',
                    MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: ''
                }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Mobile Charger' }]); // MAKT

            await expect(adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001000823',
                tbpos: '0001',
                qty: 1,
                unit: 'NOS',
                ReservationMovementType: '201'
            })).rejects.toMatchObject({
                status: 400,
                message: 'TR movement 311 does not match reservation movement 201'
            });
        });

        it('createTOFromTR allows a mismatch only when its exact TR, reservation item, and movement are app-tracked [mock only, not browser verification]', async () => {
            delete process.env.WM_ALLOW_MISMATCHED_TR;

            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{
                    LGNUM: 'W01', TBNUM: '0001000823', BWLVS: '311',
                    RSNUM: '0000527870', NLTYP: '921', NLPLA: 'TRANSFER'
                }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001000823', TBPOS: '0001',
                    RSPOS: '0001',
                    MATNR: '000000008000005294', WERKS: '1120', LGORT: 'HS01',
                    MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: ''
                }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Mobile Charger' }]); // MAKT
            mockRfc.readTable.mockResolvedValueOnce([{ XCHPF: '', SERNP: '' }]); // MARC
            mockRfc.readTable.mockResolvedValueOnce([]); // findUnconfirmedToItems (LTAK)
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // L_BWLVS
            mockRfc.call.mockResolvedValueOnce({ // Z_WM_TO_CREATE_FROM_TR
                EV_SUCCESS: 'S',
                EV_TANUM: '0001037310'
            });
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // L_LGNUM
            mockRfc.call.mockResolvedValueOnce({ E_SUBRC: 0 }); // L_TO_CONFIRM

            const res = await adapter.createTOFromTR({
                lgnum: 'W01',
                tbnum: '0001000823',
                tbpos: '0001',
                qty: 1,
                unit: 'NOS',
                autoConfirm: true,
                ReservationMovementType: '201',
                trackedReservation: {
                    TransferRequirement: '0001000823',
                    ReservationNo: '0000527870',
                    ReservationItem: '0001',
                    MovementType: '201'
                }
            });

            expect(res.TransferOrder).toBe('1037310');
            expect(res.Confirmed).toBe(true);
            expect(res.ReservationMovementType).toBe('201');
        });

        it('does not allow a tracked mismatch when the reservation key differs from the SAP TR [mock only, not browser verification]', async () => {
            delete process.env.WM_ALLOW_MISMATCHED_TR;
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001000823', BWLVS: '311', RSNUM: '0000527870', NLTYP: '921', NLPLA: 'TRANSFER' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0001000823', TBPOS: '0001', RSPOS: '0001', MATNR: '000000008000005294', WERKS: '1120', LGORT: 'HS01', MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: '' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Mobile Charger' }]);
            await expect(adapter.createTOFromTR({
                lgnum: 'W01', tbnum: '0001000823', tbpos: '0001', qty: 1, unit: 'NOS', ReservationMovementType: '201',
                trackedReservation: { TransferRequirement: '0001000823', ReservationNo: '0000527871', ReservationItem: '0001', MovementType: '201' }
            })).rejects.toMatchObject({ status: 400, message: 'TR movement 311 does not match reservation movement 201' });
        });
    });

    describe('14. Step 7: Transactional TO Creation & Verification (createTOFromTR)', () => {
        it('executes full transactional sequence: TR -> Validate TR -> Create TO -> Receive TO number -> Verify TO -> Return TO', async () => {
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0000123456', BWLVS: '311', RSNUM: '0000524979', NLTYP: '921', NLPLA: 'TRANSFER' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0000123456', TBPOS: '0001', MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Transactional Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: '', SERNP: '' }]);
            mockRfc.readTable.mockResolvedValueOnce([]); // double-TO guard: no pending unconfirmed TOs
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // L_BWLVS auth
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0000987654',
                EV_MESSAGE: 'TO 0000987654 created'
            });
            // LTAK verification
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TBNUM: '0000123456',
                BWLVS: '311',
                KQUIT: ''
            }]);
            // LTAP verification
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TAPOS: '0001',
                TBPOS: '0001',
                MATNR: '000000001000000045',
                NSOLA: '10.000',
                ALTME: 'KG',
                PQUIT: ''
            }]);

            const res = await adapter.createTOFromTR({
                trNumber: '123456',
                lgnum: 'W01'
            });

            expect(res).toMatchObject({
                success: true,
                trNumber: '123456',
                toNumber: '987654',
                toItem: '0001',
                confirmed: false
            });
        });

        it('does not mark it completed just because TO creation returned without an exception if LTAK verification fails', async () => {
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0000123456', BWLVS: '311', RSNUM: '0000524979', NLTYP: '921', NLPLA: 'TRANSFER' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0000123456', TBPOS: '0001', MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Transactional Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: '', SERNP: '' }]);
            mockRfc.readTable.mockResolvedValueOnce([]); // double-TO guard
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // L_BWLVS auth
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0000987654',
                EV_MESSAGE: 'TO 0000987654 created'
            });
            // LTAK verification fails (table returns empty array -> document not persisted in SAP!)
            mockRfc.readTable.mockResolvedValueOnce([]);

            await expect(adapter.createTOFromTR({
                trNumber: '123456',
                lgnum: 'W01'
            })).rejects.toMatchObject({
                status: 500,
                message: expect.stringContaining('Transfer Order 987654 was created by SAP FM but cannot be verified in SAP LTAK (persistence check failed)')
            });
        });

        it('rejects when verified TO in SAP references a different TR', async () => {
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0000123456', BWLVS: '311', RSNUM: '0000524979', NLTYP: '921', NLPLA: 'TRANSFER' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0000123456', TBPOS: '0001', MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Transactional Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: '', SERNP: '' }]);
            mockRfc.readTable.mockResolvedValueOnce([]); // double-TO guard
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // L_BWLVS auth
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0000987654'
            });
            // LTAK verification returns TO but referencing TR 999999
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TBNUM: '0000999999',
                BWLVS: '311'
            }]);
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TAPOS: '0001',
                TBPOS: '0001',
                NSOLA: '10.000',
                ALTME: 'KG'
            }]);

            await expect(adapter.createTOFromTR({
                trNumber: '123456',
                lgnum: 'W01'
            })).rejects.toMatchObject({
                status: 500,
                message: expect.stringContaining('Transfer Order 987654 verification failed: references TR 999999, expected TR 123456')
            });
        });

        it('rejects during TR validation if TR is already completed (STATU = E) before creating TO', async () => {
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0000123456', BWLVS: '311', STATU: 'E' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0000123456', TBPOS: '0001', MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', MENGE: '10.000', TAMEN: '10.000', MEINS: 'KG' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Transactional Mat' }]);

            await expect(adapter.createTOFromTR({
                trNumber: '123456',
                lgnum: 'W01'
            })).rejects.toMatchObject({
                status: 400,
                message: expect.stringContaining('already completed (STATU = E)')
            });

            // Create TO FM should NEVER have been called!
            expect(mockRfc.call).not.toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.anything());
        });
    });

    // ─── Step 8: Automatic TO Confirmation & MIGO Dependency ───────────────
    describe('15. Step 8: Automatic TO Confirmation & MIGO Dependency', () => {
        const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');
        const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

        it('executes strict sequence: Create TO -> TO number received -> Confirm TO -> SAP confirmation successful -> confirmed = true', async () => {
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0000123456', BWLVS: '311', RSNUM: '0000524979', NLTYP: '921', NLPLA: 'TRANSFER' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0000123456', TBPOS: '0001', MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Test Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: '', SERNP: '' }]);
            mockRfc.readTable.mockResolvedValueOnce([]); // double-TO guard
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // checkAuthorization
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0000987654',
                EV_MESSAGE: 'TO 0000987654 created'
            });
            // LTAK verification
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TBNUM: '0000123456',
                BWLVS: '311'
            }]);
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TAPOS: '0001',
                TBPOS: '0001',
                NSOLA: '10.000',
                ALTME: 'KG'
            }]);
            // Confirm TO: auth + L_TO_CONFIRM
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' }));
            mockRfc.call.mockResolvedValueOnce({
                E_TANUM: '0000987654'
            });

            const result = await adapter.createTOFromTR({
                trNumber: '123456',
                qty: 10,
                autoConfirm: true,
                lgnum: 'W01'
            });

            expect(result.success).toBe(true);
            expect(result.confirmed).toBe(true);
            expect(result.Confirmed).toBe(true);
            expect(result.IsConfirmed).toBe(true);
            expect(result.toNumber).toBe('987654');
            expect(result.TransferOrder).toBe('987654');
            expect(result.Status).toBe('04');
            expect(result.StatusText).toBe('TO Confirmed');
            expect(mockRfc.call).toHaveBeenCalledWith('L_TO_CONFIRM', expect.objectContaining({
                I_LGNUM: 'W01',
                I_TANUM: '0000987654',
                I_SQUIT: 'X'
            }));
        });

        it('if confirmation fails: returns { success: false, stage: "TO_CONFIRMATION", toNumber: "987654", error: "...", confirmed: false }', async () => {
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0000123456', BWLVS: '311', RSNUM: '0000524979', NLTYP: '921', NLPLA: 'TRANSFER' }],
                ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0000123456', TBPOS: '0001', MATNR: '000000001000000045', WERKS: '1120', LGORT: 'HS01', MENGE: '10.000', TAMEN: '0.000', MEINS: 'KG' }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Test Mat' }]);
            mockRfc.readTable.mockResolvedValueOnce([{ MATNR: '000000001000000045', XCHPF: '', SERNP: '' }]);
            mockRfc.readTable.mockResolvedValueOnce([]); // double-TO guard
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' })); // checkAuthorization
            mockRfc.call.mockResolvedValueOnce({
                EV_SUCCESS: 'S',
                EV_TANUM: '0000987654',
                EV_MESSAGE: 'TO 0000987654 created'
            });
            // LTAK verification
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TBNUM: '0000123456',
                BWLVS: '311'
            }]);
            mockRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TAPOS: '0001',
                TBPOS: '0001',
                NSOLA: '10.000',
                ALTME: 'KG'
            }]);
            // Confirm TO fails
            mockRfc.call.mockRejectedValueOnce(Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' }));
            mockRfc.call.mockRejectedValueOnce(new Error('Destination bin 0-L0001-01 is blocked for stock placement'));

            const result = await adapter.createTOFromTR({
                trNumber: '123456',
                qty: 10,
                autoConfirm: true,
                lgnum: 'W01'
            });

            expect(result).toMatchObject({
                success: false,
                stage: 'TO_CONFIRMATION',
                toNumber: '987654',
                confirmed: false
            });
            expect(result.error).toContain('Destination bin 0-L0001-01 is blocked for stock placement');
            expect(result.TransferOrder).toBe('987654');
            expect(result.Status).toBe('13');
            expect(result.StatusText).toBe('TO Confirmation Error');
            expect(result.ErrorStep).toBe('LT12');
            expect(result.Confirmed).toBe(false);
            expect(result.IsConfirmed).toBe(false);
        });

        it('strict dependency: do not call MIGO after confirmation failure', async () => {
            const handlers = {};
            const mockSrv = { on: (event, fn) => { handlers[event] = fn; } };
            const mockTrAdapter = {
                createTOFromTR: jest.fn().mockResolvedValue({
                    success: false,
                    stage: 'TO_CONFIRMATION',
                    toNumber: '987654',
                    error: 'L_TO_CONFIRM failed: foreign lock',
                    confirmed: false,
                    TransferOrder: '987654',
                    Status: '13',
                    StatusText: 'TO Confirmation Error',
                    Confirmed: false,
                    IsConfirmed: false,
                    Quantity: 10,
                    Unit: 'KG',
                    MovementType: '311'
                })
            };
            const mockResAdapter = {
                postGoodsMovement: jest.fn(),
                checkAuthorization: jest.fn().mockResolvedValue(true)
            };

            TrToHandler.init(mockSrv, {
                adapter: mockTrAdapter,
                resProcessAdapter: mockResAdapter
            });

            const req = {
                data: {
                    tbnum: '0000123456',
                    qty: 10,
                    autoConfirm: true,
                    autoPostMigo: true
                },
                error: jest.fn()
            };

            const result = await handlers.createTOFromTR(req);

            expect(result.success).toBe(false);
            expect(result.stage).toBe('TO_CONFIRMATION');
            expect(result.toNumber).toBe('987654');
            expect(result.Confirmed).toBe(false);
            expect(result.IsConfirmed).toBe(false);

            // MIGO MUST NOT BE CALLED!
            expect(mockResAdapter.postGoodsMovement).not.toHaveBeenCalled();
        });

        it('strict dependency: MIGO rejects when TransferOrder is not confirmed in tracking record', async () => {
            const handlers = {};
            const mockSrv = { on: (event, fn) => { handlers[event] = fn; } };
            const postGoodsMovement = jest.fn();
            TrToHandler.init(mockSrv, {
                adapter: {},
                resProcessAdapter: {
                    rfc: { readTable: jest.fn() },
                    checkAuthorization: jest.fn().mockResolvedValue(true),
                    postGoodsMovement
                }
            });

            const cds = require('@sap/cds');
            const savedDb = cds.db;
            cds.db = {
                entities: () => ({ ReservationTrack: { name: 'ReservationTrack' } }),
                run: jest.fn(async (q) => {
                    if (q.SELECT) {
                        return {
                            ReservationNo: '524979',
                            ReservationItem: '0001',
                            TransferOrder: '987654',
                            Status_code: '13',
                            MovementType: '311'
                        };
                    }
                    return 1;
                })
            };

            try {
                await expect(handlers.postMigoGoodsMovement({
                    data: {
                        TransferOrder: '987654',
                        MovementType: '311',
                        Material: '8000000023',
                        Plant: '1120',
                        StorageLocation: 'HS01',
                        Quantity: 1,
                        Unit: 'KG'
                    }
                })).rejects.toMatchObject({
                    status: 400,
                    message: expect.stringContaining('is not confirmed (status 13)')
                });
            } finally {
                cds.db = savedDb;
            }

            expect(postGoodsMovement).not.toHaveBeenCalled();
        });

        it('strict dependency: MIGO rejects when SAP LTAK-KQUIT is blank (unconfirmed TO)', async () => {
            const handlers = {};
            const mockSrv = { on: (event, fn) => { handlers[event] = fn; } };
            const postGoodsMovement = jest.fn();
            const mockRfc = {
                readTable: jest.fn().mockImplementation((table) => {
                    if (table === 'LTAK') {
                        return Promise.resolve([{
                            TBNUM: '0000123456',
                            RSNUM: '',
                            BWLVS: '311',
                            KQUIT: '' // unconfirmed!
                        }]);
                    }
                    return Promise.resolve([]);
                })
            };

            TrToHandler.init(mockSrv, {
                adapter: {},
                resProcessAdapter: {
                    rfc: mockRfc,
                    checkAuthorization: jest.fn().mockResolvedValue(true),
                    postGoodsMovement
                }
            });

            await expect(handlers.postMigoGoodsMovement({
                data: {
                    TransferOrder: '987654',
                    MovementType: '311',
                    Material: '8000000023',
                    Plant: '1120',
                    StorageLocation: 'HS01',
                    Quantity: 1,
                    Unit: 'KG'
                }
            })).rejects.toMatchObject({
                status: 400,
                message: expect.stringContaining('not confirmed in SAP (LTAK-KQUIT is blank)')
            });

            expect(postGoodsMovement).not.toHaveBeenCalled();
        });

        it('ReservationProcessAdapter: createTransferOrderFromTR handles autoConfirm: true and returns structured failure on confirm error', async () => {
            const resRfc = {
                session: jest.fn(async (fn) => fn(resRfc.call)),
                call: jest.fn(),
                readTable: jest.fn()
            };
            const resAdapter = new ReservationProcessAdapter({ rfc: resRfc });

            // Mock getTransferRequirement (TR exists)
            resRfc.readTable.mockResolvedValueOnce([{
                TBNUM: '0000123456',
                LGNUM: 'W01',
                BWLVS: '311',
                STATU: ''
            }]);
            // Mock L_TO_CREATE_TR succeeds
            resRfc.call.mockResolvedValueOnce({
                E_TANUM: '0000987654'
            });
            // Mock getTransferOrder (TO exists in LTAK)
            resRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TBNUM: '0000123456',
                BWLVS: '311',
                KQUIT: ''
            }]);
            resRfc.readTable.mockResolvedValueOnce([{
                LGNUM: 'W01',
                TANUM: '0000987654',
                TAPOS: '0001',
                TBPOS: '0001',
                NSOLA: '10.000',
                ALTME: 'KG',
                PQUIT: ''
            }]);
            // Mock L_TO_CONFIRM fails
            resRfc.call.mockRejectedValueOnce(new Error('L_TO_CONFIRM failed: foreign lock'));
            // Mock isToFullyConfirmed -> returns false
            resRfc.readTable.mockResolvedValueOnce([{
                TAPOS: '0001',
                PQUIT: ''
            }]);

            const res = await resAdapter.createTransferOrderFromTR({
                warehouseNumber: 'W01',
                trNumber: '123456',
                movementType: '311',
                autoConfirm: true
            });

            expect(res).toEqual({
                success: false,
                stage: 'TO_CONFIRMATION',
                toNumber: '987654',
                toNumberRaw: '0000987654',
                toItem: '0001',
                trNumber: '123456',
                warehouseNumber: 'W01',
                status: '13',
                error: 'L_TO_CONFIRM failed: foreign lock',
                confirmed: false
            });
        });
    });
});
