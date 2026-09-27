const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');

describe('Phase 4: TR to TO Scenarios (Mocked Adapter & Handlers)', () => {
  let mockSrv;
  let mockAdapter;
  let handlers;

  beforeEach(() => {
    handlers = {};
    mockSrv = {
      on: jest.fn((event, fn) => {
        handlers[event] = fn;
      })
    };
    mockAdapter = {
      getTR: jest.fn(),
      checkSU: jest.fn(),
      createTO: jest.fn()
    };

    TrToHandler.init(mockSrv, { adapter: mockAdapter });
  });

  // Scenario 1: TR not found
  describe('Scenario 1: TR Not Found', () => {
    it('should reject with 404 when Transfer Requirement does not exist in SAP', async () => {
      const notFoundErr = new Error('Failed to retrieve Transfer Requirement 9999999999: Transfer Requirement 9999999999 not found in warehouse W01');
      notFoundErr.status = 404;
      mockAdapter.getTR.mockRejectedValueOnce(notFoundErr);

      const req = {
        data: { tbnum: '9999999999', lgnum: 'W01' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      await handlers['getTR'](req);

      expect(mockAdapter.getTR).toHaveBeenCalledWith('9999999999', 'W01');
      expect(req.error).toHaveBeenCalledWith(
        404,
        expect.stringContaining('Transfer Requirement 9999999999 not found')
      );
    });

    it('TrToAdapter should normalize TR number and throw 404 on SAP missing response', async () => {
      const mockClient = {
        get: jest.fn().mockResolvedValueOnce({ data: { d: null } })
      };
      const adapter = new TrToAdapter({ client: mockClient });

      await expect(adapter.getTR('663', 'W01')).rejects.toThrow(
        /Transfer Requirement 663 not found in warehouse W01/
      );
    });
  });

  // Scenario 2: SU in another warehouse
  describe('Scenario 2: SU In Another Warehouse', () => {
    it('should flag IsValid=false and ErrorCode=SU_NOT_FOUND when SU is not in warehouse W01', async () => {
      const wrongWhSU = {
        Lgnum: 'W01',
        StorageUnit: '00000000001000099999',
        Tbnum: '0001000663',
        StorageType: '',
        StorageBin: '',
        SUType: '',
        IsValid: false,
        ErrorCode: 'SU_NOT_FOUND',
        ErrorMessage: 'Storage Unit 1000099999 not found in warehouse W01',
        Quants: []
      };
      mockAdapter.checkSU.mockResolvedValueOnce(wrongWhSU);

      const req = {
        data: { lenum: '1000099999', tbnum: '0001000663', lgnum: 'W01' },
        error: jest.fn()
      };

      const result = await handlers['checkSU'](req);

      expect(mockAdapter.checkSU).toHaveBeenCalledWith('1000099999', '0001000663', 'W01');
      expect(result.IsValid).toBe(false);
      expect(result.ErrorCode).toBe('SU_NOT_FOUND');
      expect(result.ErrorMessage).toContain('not found in warehouse W01');
    });

    it('TrToAdapter should return empty quants and error message when Gateway returns no SU for W01', async () => {
      const mockClient = {
        get: jest.fn().mockResolvedValueOnce({ data: { d: { results: [] } } })
      };
      const adapter = new TrToAdapter({ client: mockClient });

      const res = await adapter.checkSU('1000099999', '0001000663', 'W01');
      expect(res.IsValid).toBe(false);
      expect(res.ErrorCode).toBe('SU_NOT_FOUND');
      expect(res.Quants).toEqual([]);
    });
  });

  // Scenario 3: SU doesn't match the TR
  describe("Scenario 3: SU Doesn't Match the TR", () => {
    it('should report material mismatch when scanned SU material is not required by TR', async () => {
      const mismatchSU = {
        Lgnum: 'W01',
        StorageUnit: '00000000001000041619',
        Tbnum: '0001000663',
        StorageType: '001',
        StorageBin: '0-L0001-03',
        SUType: 'E1',
        IsValid: false,
        ErrorCode: 'MATERIAL_MISMATCH',
        ErrorMessage: 'Storage Unit contains material 4000000123 which does not match TR 0001000663 components',
        Quants: [
          {
            Material: '4000000123',
            MaterialDesc: 'Ethanol Absolute',
            AvailableStock: 500,
            Unit: 'KG'
          }
        ]
      };
      mockAdapter.checkSU.mockResolvedValueOnce(mismatchSU);

      const req = {
        data: { lenum: '1000041619', tbnum: '0001000663', lgnum: 'W01' },
        error: jest.fn()
      };

      const result = await handlers['checkSU'](req);

      expect(result.IsValid).toBe(false);
      expect(result.ErrorCode).toBe('MATERIAL_MISMATCH');
      expect(result.ErrorMessage).toContain('does not match TR 0001000663');
    });
  });

  // Scenario 4: SU blocked
  describe('Scenario 4: SU Blocked', () => {
    it('should report SU_BLOCKED when Storage Unit or bin is locked for removal', async () => {
      const blockedSU = {
        Lgnum: 'W01',
        StorageUnit: '00000000001000043935',
        Tbnum: '0001000663',
        StorageType: 'OH1',
        StorageBin: 'ONHOLD',
        SUType: 'E1',
        IsValid: false,
        ErrorCode: 'SU_BLOCKED',
        ErrorMessage: 'Storage Unit 1000043935 is blocked for stock removal in SAP (LEIN-SPERR)',
        Quants: [
          {
            Material: '1000000867',
            MaterialDesc: 'IPA, Extra Pure',
            AvailableStock: 11210,
            Unit: 'KG'
          }
        ]
      };
      mockAdapter.checkSU.mockResolvedValueOnce(blockedSU);

      const req = {
        data: { lenum: '1000043935', tbnum: '0001000663', lgnum: 'W01' },
        error: jest.fn()
      };

      const result = await handlers['checkSU'](req);

      expect(result.IsValid).toBe(false);
      expect(result.ErrorCode).toBe('SU_BLOCKED');
      expect(result.ErrorMessage).toContain('blocked for stock removal');
    });
  });

  // Scenario 5: Quantity above OQty
  describe('Scenario 5: Quantity Above Open Quantity (OQty)', () => {
    it('should reject in CAP handler when requested quantity exceeds open TR quantity', async () => {
      const req = {
        data: {
          lgnum: 'W01',
          tbnum: '0001000663',
          tbpos: '0001',
          lenum: '00000000001000043935',
          qty: 25000,
          openQty: 17323.2,
          unit: 'KG',
          confirmImmediate: true
        },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      await handlers['createTO'](req);

      expect(req.error).toHaveBeenCalledWith(
        400,
        'Requested quantity 25000 KG exceeds open TR quantity 17323.2 KG'
      );
      expect(mockAdapter.createTO).not.toHaveBeenCalled();
    });

    it('TrToAdapter should enforce openQty limit and reject before calling SAP', async () => {
      const mockClient = { post: jest.fn() };
      const adapter = new TrToAdapter({ client: mockClient });

      await expect(
        adapter.createTO({
          tbnum: '0001000663',
          lenum: '1000043935',
          qty: 20000,
          openQty: 17323.2,
          unit: 'KG'
        })
      ).rejects.toThrow(/exceeds open TR quantity/);

      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('TrToAdapter should map SAP backend quantity exceed error cleanly', async () => {
      const mockClient = {
        post: jest.fn().mockRejectedValueOnce({
          status: 400,
          response: {
            data: {
              error: {
                message: {
                  value: 'Quantity 25000 exceeds available TR item open quantity 17323.200 (L3/102)'
                }
              }
            }
          }
        })
      };
      const adapter = new TrToAdapter({ client: mockClient });

      await expect(
        adapter.createTO({
          tbnum: '0001000663',
          lenum: '1000043935',
          qty: 25000
        })
      ).rejects.toThrow(/Quantity 25000 exceeds available TR item open quantity/);
    });
  });

  // Scenario 6: TO created
  describe('Scenario 6: TO Created (Synchronous 1-step Pick & Transfer)', () => {
    it('should synchronously return generated TO number and confirmation', async () => {
      const successfulTO = {
        TransferOrder: '0001010943',
        Success: true,
        Message: 'Transfer Order 0001010943 created and confirmed successfully.',
        Confirmed: true
      };
      mockAdapter.createTO.mockResolvedValueOnce(successfulTO);

      const req = {
        data: {
          lgnum: 'W01',
          tbnum: '0001000663',
          tbpos: '0001',
          lenum: '00000000001000043935',
          qty: 5000,
          openQty: 17323.2,
          unit: 'KG',
          confirmImmediate: true
        },
        error: jest.fn()
      };

      const result = await handlers['createTO'](req);

      expect(mockAdapter.createTO).toHaveBeenCalledWith({
        lgnum: 'W01',
        tbnum: '0001000663',
        tbpos: '0001',
        lenum: '00000000001000043935',
        qty: 5000,
        unit: 'KG',
        confirmImmediate: true
      });
      expect(result).toBe(successfulTO);
      expect(result.TransferOrder).toBe('0001010943');
      expect(result.Success).toBe(true);
      expect(result.Confirmed).toBe(true);
    });

    it('TrToAdapter should parse successful Gateway CreateTO response', async () => {
      const mockClient = {
        post: jest.fn().mockResolvedValueOnce({
          data: {
            d: {
              Tanum: '0001010943',
              Success: 'S',
              Message: 'Transfer Order 0001010943 created successfully.',
              Confirmed: 'X'
            }
          }
        })
      };
      const adapter = new TrToAdapter({ client: mockClient });

      const result = await adapter.createTO({
        tbnum: '0001000663',
        lenum: '1000043935',
        qty: 5000,
        confirmImmediate: true
      });

      expect(result.TransferOrder).toBe('0001010943');
      expect(result.Success).toBe(true);
      expect(result.Confirmed).toBe(true);
      expect(result.Message).toContain('Transfer Order 0001010943 created successfully.');
    });
  });
});
