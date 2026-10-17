'use strict';

const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

describe('Corrupted Staging TR Auto-Recovery & Statistical Order KI 248 Handling', () => {
    let mockRfc;
    let adapter;
    let resAdapter;

    beforeEach(() => {
        mockRfc = {
            call: jest.fn(),
            readTable: jest.fn(),
            session: jest.fn(async (fn) => fn(mockRfc.call))
        };
        adapter = new TrToAdapter({ rfc: mockRfc });
        resAdapter = new ReservationProcessAdapter({ rfc: mockRfc });
    });

    describe('1. _isCorruptedStagingTR detection', () => {
        it('returns null if TR status is not E', async () => {
            const tr = { Tbnum: '0001000849', Statu: '', Lgnum: 'W01', Bwlvs: '311' };
            const result = await adapter._isCorruptedStagingTR(tr, 'W01');
            expect(result).toBeNull();
        });

        it('detects corrupted staging TR when LTAK has no TOs and RESB has open quantity', async () => {
            const tr = {
                Tbnum: '0001000849',
                Statu: 'E',
                Lgnum: 'W01',
                Bwlvs: '311',
                Rsnum: '0000528771',
                Items: [{
                    Tbpos: '0001',
                    Material: '000000008000009754',
                    Plant: '1120',
                    StorageLocation: 'HS01',
                    RequiredQty: 1,
                    Rspos: '0001'
                }]
            };

            // LTAK has no TOs
            mockRfc.readTable.mockResolvedValueOnce([]);
            // RESB has open reservation
            mockRfc.readTable.mockResolvedValueOnce([{
                RSNUM: '0000528771',
                RSPOS: '0001',
                MATNR: '000000008000009754',
                WERKS: '1120',
                LGORT: 'HS01',
                BDMNG: '1.000',
                ENMNG: '0.000',
                KZEAR: '',
                AUFNR: '000000001011'
            }]);
            // RKPF has movement type 261
            mockRfc.readTable.mockResolvedValueOnce([{
                RSNUM: '0000528771',
                BWART: '261',
                AUFNR: '000000001011'
            }]);

            const result = await adapter._isCorruptedStagingTR(tr, 'W01');
            expect(result).not.toBeNull();
            expect(result.ReservationNo).toBe('528771');
            expect(result.MovementType).toBe('261');
            expect(result.OrderID).toBe('1011');
        });

        it('returns null if LTAK already has confirmed TOs for the TR', async () => {
            const tr = {
                Tbnum: '0001000849',
                Statu: 'E',
                Lgnum: 'W01',
                Bwlvs: '311',
                Rsnum: '0000528771'
            };

            // LTAK returns a TO
            mockRfc.readTable.mockResolvedValueOnce([{ TANUM: '0001037000' }]);

            const result = await adapter._isCorruptedStagingTR(tr, 'W01');
            expect(result).toBeNull();
        });
    });

    describe('2. _recoverCorruptedStagingTR recovery logic', () => {
        it('adopts an existing open staging TR from LTBK/LTBP', async () => {
            const tr = { Tbnum: '0001000849', Statu: 'E', Lgnum: 'W01', Bwlvs: '311' };
            const track = {
                ReservationNo: '528771',
                ReservationItem: '1',
                Material: '8000009754',
                Plant: '1120',
                StorageLocation: 'HS01',
                Quantity: 1,
                Unit: 'NOS',
                MovementType: '261',
                OrderID: '1011'
            };

            // LTBK finds candidate
            mockRfc.readTable.mockResolvedValueOnce([{ TBNUM: '0001000854', STATU: '' }]);
            // getTR for candidate 0001000854 (called twice: in scan loop and in return)
            mockRfc.call.mockResolvedValue({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001000854', BWLVS: '311', STATU: '', RSNUM: '' }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001000854', TBPOS: '0001',
                    MATNR: '000000008000009754', WERKS: '1120', LGORT: 'HS01',
                    MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: ''
                }]
            });
            mockRfc.readTable.mockResolvedValue([{ MAKTX: 'Macbook' }]);

            const recovered = await adapter._recoverCorruptedStagingTR(tr, track, 'W01');
            expect(recovered).toBeDefined();
            expect(recovered.Tbnum).toBe('0001000854');
            expect(recovered._recoveredFrom).toBe('1000849');
            expect(recovered._recoveredTrack.ReservationNo).toBe('528771');
        });

        it('creates a clean staging TR in SAP if no candidate exists', async () => {
            const tr = { Tbnum: '0001000849', Statu: 'E', Lgnum: 'W01', Bwlvs: '311' };
            const track = {
                ReservationNo: '528771',
                ReservationItem: '1',
                Material: '8000009754',
                Plant: '1120',
                StorageLocation: 'HS01',
                Quantity: 1,
                Unit: 'NOS',
                MovementType: '261',
                OrderID: '1011'
            };

            // LTBK finds no candidate
            mockRfc.readTable.mockResolvedValueOnce([]);
            // Z_WM_TR_CREATE called with IV_RSNUM: ''
            mockRfc.call.mockResolvedValueOnce({
                EV_TBNUM: '0001000855',
                EV_SUCCESS: 'S'
            });
            // getTR for new TR
            mockRfc.call.mockResolvedValueOnce({
                ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001000855', BWLVS: '311', STATU: '', RSNUM: '' }],
                ET_TR_ITEMS: [{
                    LGNUM: 'W01', TBNUM: '0001000855', TBPOS: '0001',
                    MATNR: '000000008000009754', WERKS: '1120', LGORT: 'HS01',
                    MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: ''
                }]
            });
            mockRfc.readTable.mockResolvedValueOnce([{ MAKTX: 'Macbook' }]);

            const recovered = await adapter._recoverCorruptedStagingTR(tr, track, 'W01');
            expect(recovered.Tbnum).toBe('0001000855');
            expect(mockRfc.call).toHaveBeenCalledWith('Z_WM_TR_CREATE', expect.objectContaining({
                IV_BWLVS: '311',
                IV_RSNUM: '',
                IV_RSPOS: ''
            }));
        });
    });

    describe('3. Statistical Order (ASTKZ = X) KI 248 Handling', () => {
        it('pre-populates header COSTCENTER from AUFK-KOSTV when creating reservation for statistical order', async () => {
            // validateOrder AUFK (includes ASTKZ and KOSTV)
            mockRfc.readTable.mockResolvedValueOnce([{
                AUFNR: '000000001011',
                AUART: 'ZEMP',
                OBJNR: 'OR000000001011',
                LOEKZ: '',
                KTEXT: 'Test Order',
                ASTKZ: 'X',
                KOSTV: '001011201301'
            }]);
            // validateOrder JEST (status REL / I0002)
            mockRfc.readTable.mockResolvedValueOnce([{
                OBJNR: 'OR000000001011',
                STAT: 'I0002',
                INACT: ''
            }]);
            // MARC batch-managed check
            mockRfc.readTable.mockResolvedValueOnce([{
                XCHPF: ''
            }]);
            // validateStorageLocationForMaterial MARD
            mockRfc.readTable.mockResolvedValueOnce([{
                LGORT: 'HS01'
            }]);
            // BAPI_RESERVATION_CREATE1
            mockRfc.call.mockResolvedValueOnce({
                RESERVATION: '0000528777',
                RETURN: []
            });
            // BAPI_TRANSACTION_COMMIT
            mockRfc.call.mockResolvedValueOnce({});
            // RESB verification
            mockRfc.readTable.mockResolvedValueOnce([{
                RSNUM: '0000528777',
                RSPOS: '0001',
                MATNR: '000000008000009754',
                WERKS: '1120',
                LGORT: 'HS01',
                BDMNG: '1.000',
                MEINS: 'NOS'
            }]);

            const res = await resAdapter.createReservation({
                warehouseNumber: 'W01',
                movementType: '261',
                plant: '1120',
                storageLocation: 'HS01',
                material: '8000009754',
                quantity: 1,
                unit: 'NOS',
                orderId: '1011',
                orderType: 'ZEMP'
            });

            expect(res.success).toBe(true);
            expect(res.reservationNo).toBe('528777');
            expect(mockRfc.call).toHaveBeenCalledWith('BAPI_RESERVATION_CREATE1', expect.objectContaining({
                RESERVATIONHEADER: expect.objectContaining({
                    COSTCENTER: '1011201301'
                })
            }));
        });

        it('auto-resolves responsible cost center and retries MIGO when SAP returns KI 248 error', async () => {
            // BAPI_GOODSMVT_CREATE first call fails with KI 248
            mockRfc.call.mockResolvedValueOnce({
                MATERIALDOCUMENT: '',
                MATDOCUMENTYEAR: '',
                RETURN: [{
                    TYPE: 'E',
                    ID: 'KI',
                    NUMBER: '248',
                    MESSAGE: 'Account 500020 requires a true account assignment relevant to cost accounting'
                }]
            });
            // AUFK lookup finds KOSTV
            mockRfc.readTable.mockResolvedValueOnce([{
                AUFNR: '000000001011',
                KOSTV: '1011201301'
            }]);
            // Retry call succeeds
            mockRfc.call.mockResolvedValueOnce({
                MATERIALDOCUMENT: '4900050253',
                MATDOCUMENTYEAR: '2026',
                RETURN: []
            });
            // BAPI_TRANSACTION_COMMIT
            mockRfc.call.mockResolvedValueOnce({});

            const res = await resAdapter.postGoodsMovement({
                reservationNo: '0000528771',
                reservationItem: '1',
                movementType: '261',
                plant: '1120',
                storageLocation: 'HS01',
                material: '8000009754',
                quantity: 1,
                unit: 'NOS',
                orderId: '1011'
            });

            expect(res.success).toBe(true);
            expect(res.materialDocument).toBe('4900050253');
            expect(res.materialDocYear).toBe('2026');
        });
    });
});
