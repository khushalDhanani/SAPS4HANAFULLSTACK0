const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');

describe('TrToHandler Unit Tests', () => {
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

  describe('Service Event Wiring', () => {
    it('should register handlers for getTR, checkSU, and createTO', () => {
      expect(mockSrv.on).toHaveBeenCalledWith('getTR', expect.any(Function));
      expect(mockSrv.on).toHaveBeenCalledWith('checkSU', expect.any(Function));
      expect(mockSrv.on).toHaveBeenCalledWith('createTO', expect.any(Function));
    });
  });

  describe('getTR Handler', () => {
    it('should reject when tbnum is missing', async () => {
      const req = {
        data: {},
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      await handlers['getTR'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Transfer Requirement number (tbnum) is required');
    });

    it('should delegate to adapter and return data', async () => {
      const expectedData = { Tbnum: '0001000663', Items: [] };
      mockAdapter.getTR.mockResolvedValueOnce(expectedData);

      const req = {
        data: { tbnum: '0001000663', lgnum: 'W01' },
        error: jest.fn()
      };

      const result = await handlers['getTR'](req);
      expect(mockAdapter.getTR).toHaveBeenCalledWith('0001000663', 'W01');
      expect(result).toBe(expectedData);
    });

    it('should return req.error on adapter failure', async () => {
      const err = new Error('TR not found');
      err.status = 404;
      mockAdapter.getTR.mockRejectedValueOnce(err);

      const req = {
        data: { tbnum: '999999' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      await handlers['getTR'](req);
      expect(req.error).toHaveBeenCalledWith(404, 'TR not found');
    });
  });

  describe('checkSU Handler', () => {
    it('should reject when lenum is missing', async () => {
      const req = {
        data: { tbnum: '0001000663' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      await handlers['checkSU'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Storage Unit number (lenum) is required');
    });

    it('should delegate to adapter and return validation data', async () => {
      const expectedSU = { StorageUnit: '00000000001000043935', IsValid: true };
      mockAdapter.checkSU.mockResolvedValueOnce(expectedSU);

      const req = {
        data: { lenum: '1000043935', tbnum: '0001000663', lgnum: 'W01' },
        error: jest.fn()
      };

      const result = await handlers['checkSU'](req);
      expect(mockAdapter.checkSU).toHaveBeenCalledWith('1000043935', '0001000663', 'W01');
      expect(result).toBe(expectedSU);
    });
  });

  describe('createTO Handler (Synchronous - No offline queue)', () => {
    it('should validate mandatory fields before calling adapter', async () => {
      const req = {
        data: {},
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      await handlers['createTO'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Transfer Requirement number (tbnum) is required');

      req.data = { tbnum: '0001000663' };
      await handlers['createTO'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Storage Unit number (lenum) is required');

      req.data = { tbnum: '0001000663', lenum: '1000043935', qty: 0 };
      await handlers['createTO'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Quantity must be greater than zero');
    });

    it('should synchronously return TO confirmation from adapter', async () => {
      const expectedConfirm = {
        TransferOrder: '0000012345',
        Success: true,
        Message: 'Transfer Order created',
        Confirmed: true
      };
      mockAdapter.createTO.mockResolvedValueOnce(expectedConfirm);

      const req = {
        data: {
          lgnum: 'W01',
          tbnum: '0001000663',
          tbpos: '0001',
          lenum: '00000000001000043935',
          qty: 50,
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
        qty: 50,
        unit: 'KG',
        confirmImmediate: true
      });
      expect(result).toBe(expectedConfirm);
    });

    it('should immediately report failure without offline fallback queue', async () => {
      const err = new Error('Posting failed in SAP');
      err.status = 400;
      mockAdapter.createTO.mockRejectedValueOnce(err);

      const req = {
        data: {
          tbnum: '0001000663',
          lenum: '1000043935',
          qty: 50
        },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      await handlers['createTO'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Posting failed in SAP');
    });
  });
});
