/**
 * Unit Tests for TrToService (Warehouse Management TR to TO Client Service)
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
        TrToService.setSimulationActive(false);
    });

    describe('Model Management', () => {
        it('should get and set the OData model', () => {
            const mockModel = { name: 'testModel' };
            TrToService.setModel(mockModel);
            expect(TrToService.getModel()).toBe(mockModel);
        });
    });

    describe('Simulation Toggle', () => {
        it('should toggle simulation mode', () => {
            expect(TrToService.isSimulationActive()).toBe(false);
            TrToService.setSimulationActive(true);
            expect(TrToService.isSimulationActive()).toBe(true);
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

        it('should fallback to mock data when simulation is active and TR ends with 663', async () => {
            TrToService.setSimulationActive(true);
            mockODataClient.get.mockRejectedValue(new Error('Network error'));

            const result = await TrToService.getTR('0001000663', 'W01');
            expect(result.Tbnum).toBe('0001000663');
            expect(result.Items[0].Material).toBe('1000000867');
            expect(result.Items[0].OpenQty).toBe(17323.2);
        });

        it('should propagate error when simulation is false', async () => {
            TrToService.setSimulationActive(false);
            mockODataClient.get.mockRejectedValue(new Error('Backend offline'));

            await expect(TrToService.getTR('0001000663', 'W01')).rejects.toThrow('Backend offline');
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

        it('should fallback to mock data when simulation is active and SU ends with 43935', async () => {
            TrToService.setSimulationActive(true);
            mockODataClient.get.mockRejectedValue(new Error('Network error'));

            const result = await TrToService.checkSU('1000043935', '0001000663', 'W01');
            expect(result.IsValid).toBe(true);
            expect(result.Lenum).toBe('00000000001000043935');
            expect(result.Quants[0].AvailableStock).toBe(11210.0);
        });

        it('should propagate error when simulation is false', async () => {
            TrToService.setSimulationActive(false);
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

        it('should fallback to mock TO creation when simulation is active', async () => {
            TrToService.setSimulationActive(true);
            mockODataClient.post.mockRejectedValue(new Error('Gateway down'));

            const payload = {
                lgnum: 'W01',
                tbnum: '0001000663',
                tbpos: '0001',
                lenum: '1000043935',
                qty: 500,
                openQty: 1000,
                confirmImmediate: true
            };

            const result = await TrToService.createTO(payload);
            expect(result.Success).toBe(true);
            expect(result.TransferOrder).toMatch(/^00010\d{5}$/);
            expect(result.Confirmed).toBe(true);
        });
    });

    describe('Direct Mock Methods', () => {
        it('getMockTR should return structured TR header and items', () => {
            const tr = TrToService.getMockTR('0001000663', 'W01');
            expect(tr.Lgnum).toBe('W01');
            expect(tr.Tbnum).toBe('0001000663');
            expect(tr.Items).toHaveLength(2);
            expect(tr.Items[0].Material).toBe('1000000867');
            expect(tr.Items[0].OpenQty).toBe(17323.2);
        });

        it('getMockSU should return matching SU and quants', () => {
            const su = TrToService.getMockSU('1000043935', '0001000663', 'W01');
            expect(su.IsValid).toBe(true);
            expect(su.Lenum).toBe('00000000001000043935');
            expect(su.Quants[0].Quant).toBe('0001035375');
            expect(su.Quants[0].AvailableStock).toBe(11210.0);
        });
    });
});
