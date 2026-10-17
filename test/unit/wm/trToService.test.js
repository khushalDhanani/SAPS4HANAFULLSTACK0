/**
 * Unit Tests for TrToService (Warehouse Management TR to TO Client Service)
 * Live SAP only — the mock/simulation path was removed (a fabricated TO number is never
 * an acceptable substitute for a real SAP posting).
 */

let TrToService;
const mockODataClient = {
    get: jest.fn(),
    post: jest.fn()
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            TrToService = factory(mockODataClient);
        }
    }
};

require('../../../app/fiori-app/webapp/modules/wm/tr-to/service/TrToService');

describe('TrToService Unit Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Model Management', () => {
        it('should get and set the OData model', () => {
            const mockModel = { name: 'testModel' };
            TrToService.setModel(mockModel);
            expect(TrToService.getModel()).toBe(mockModel);
        });
    });

    describe('getOpenTRs', () => {
        it('should fetch open TRs via ODataClient.get', async () => {
            const mockList = [
                { Tbnum: '0001000663', Bwlvs: '319', DisplayText: 'TR 1000663' }
            ];
            mockODataClient.get.mockResolvedValue({ value: mockList });

            const result = await TrToService.getOpenTRs('W01', '319');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining("/odata/v4/tr-to/getOpenTRs(lgnum='W01',mvt='319')")
            );
            expect(result).toHaveLength(1);
            expect(result[0].Tbnum).toBe('0001000663');
        });

        it('should propagate backend errors (no mock fallback)', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));
            await expect(TrToService.getOpenTRs('W01', '319')).rejects.toThrow('Backend offline');
        });
    });

    describe('getTR', () => {
        it('should reject when TR number is empty', async () => {
            await expect(TrToService.getTR('')).rejects.toThrow('Transfer Requirement number is required');
            await expect(TrToService.getTR(null)).rejects.toThrow('Transfer Requirement number is required');
        });

        it('should fetch TR details via ODataClient.get', async () => {
            const mockResponse = {
                value: {
                    Lgnum: 'W01',
                    Tbnum: '0001000663',
                    Items: [{ Tbpos: '0001', Material: '1000000867', OpenQty: 17323.2 }]
                }
            };
            mockODataClient.get.mockResolvedValue(mockResponse);

            const result = await TrToService.getTR('0001000663', 'W01');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining("/odata/v4/tr-to/getTR(tbnum='0001000663',lgnum='W01')")
            );
            expect(result.Tbnum).toBe('0001000663');
            expect(result.Items).toHaveLength(1);
        });

        it('should propagate backend errors (no mock fallback)', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));
            await expect(TrToService.getTR('0001000663', 'W01')).rejects.toThrow('Backend offline');
        });
    });

    describe('getAvailableSUs', () => {
        it('should reject when TR number is empty', async () => {
            await expect(TrToService.getAvailableSUs('')).rejects.toThrow('Transfer Requirement number is required');
            await expect(TrToService.getAvailableSUs(null)).rejects.toThrow('Transfer Requirement number is required');
        });

        it('should fetch available SUs via ODataClient.get', async () => {
            const mockList = [
                { StorageUnit: '1000041635', Material: '1000000156', AvailableStock: 1620.0 }
            ];
            mockODataClient.get.mockResolvedValue({ value: mockList });

            const result = await TrToService.getAvailableSUs('0001000446', 'W01', '0001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining("/odata/v4/tr-to/getAvailableSUs(tbnum='0001000446',lgnum='W01',tbpos='0001')")
            );
            expect(result).toHaveLength(1);
            expect(result[0].StorageUnit).toBe('1000041635');
        });

        it('should propagate backend errors (no mock fallback)', async () => {
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));
            await expect(TrToService.getAvailableSUs('0001000446', 'W01')).rejects.toThrow('Backend offline');
        });
    });

    describe('checkSU', () => {
        it('should reject when SU number is empty', async () => {
            await expect(TrToService.checkSU('', '0001000663')).rejects.toThrow('Storage Unit number is required');
            await expect(TrToService.checkSU(null, '0001000663')).rejects.toThrow('Storage Unit number is required');
        });

        it('should validate SU via ODataClient.get', async () => {
            const mockResponse = {
                value: {
                    Lenum: '00000000001000043935',
                    IsValid: true,
                    Quants: [{ Quant: '0001035375', Material: '1000000867', AvailableStock: 11210.0 }]
                }
            };
            mockODataClient.get.mockResolvedValue(mockResponse);

            const result = await TrToService.checkSU('1000043935', '0001000663', 'W01');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                expect.stringContaining("/odata/v4/tr-to/checkSU(lenum='1000043935',tbnum='0001000663',lgnum='W01')")
            );
            expect(result.IsValid).toBe(true);
            expect(result.Quants[0].AvailableStock).toBe(11210.0);
        });

        it('should propagate backend errors (no mock fallback)', async () => {
            mockODataClient.get.mockRejectedValue(new Error('SU 99999 not found'));
            await expect(TrToService.checkSU('99999', '0001000663', 'W01')).rejects.toThrow('SU 99999 not found');
        });
    });

    describe('createTO', () => {
        it('should validate required fields in payload', async () => {
            await expect(TrToService.createTO(null)).rejects.toThrow('Transfer Requirement number is required');
            await expect(TrToService.createTO({ tbnum: '' })).rejects.toThrow('Transfer Requirement number is required');
            await expect(TrToService.createTO({ tbnum: '0001000663', lenum: '' })).rejects.toThrow('Storage Unit number is required');
            await expect(TrToService.createTO({ tbnum: '0001000663', lenum: '1000043935', qty: 0 })).rejects.toThrow('Quantity must be greater than zero');
            await expect(TrToService.createTO({ tbnum: '0001000663', lenum: '1000043935', qty: -5 })).rejects.toThrow('Quantity must be greater than zero');
            await expect(TrToService.createTO({ tbnum: '0001000663', lenum: '1000043935', qty: 200, openQty: 100 })).rejects.toThrow('Requested quantity (200) exceeds open TR quantity (100)');
        });

        it('should post TO creation via ODataClient.post', async () => {
            const mockResponse = {
                value: {
                    TransferOrder: '0001010943',
                    Success: true,
                    Confirmed: true,
                    Message: 'TO 0001010943 created and confirmed.'
                }
            };
            mockODataClient.post.mockResolvedValue(mockResponse);

            const payload = {
                lgnum: 'W01',
                tbnum: '0001000663',
                tbpos: '0001',
                lenum: '1000043935',
                qty: 500,
                openQty: 1000,
                unit: 'KG',
                confirmImmediate: true
            };

            const result = await TrToService.createTO(payload);
            expect(mockODataClient.post).toHaveBeenCalledWith(
                '/odata/v4/tr-to/createTO',
                payload
            );
            expect(result.TransferOrder).toBe('0001010943');
            expect(result.Confirmed).toBe(true);
        });

        it('should propagate backend errors (no mock fallback)', async () => {
            mockODataClient.post.mockRejectedValue(new Error('Gateway down'));
            const payload = {
                lgnum: 'W01', tbnum: '0001000663', tbpos: '0001',
                lenum: '1000043935', qty: 500, openQty: 1000, confirmImmediate: true
            };
            await expect(TrToService.createTO(payload)).rejects.toThrow('Gateway down');
        });
    });
});
