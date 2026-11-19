'use strict';

const MibLabelService = require('../../../srv/wm/mib-label/service');

describe('MibLabelService', () => {
  let srv;
  let mockAdapter;

  const adminUser = { is: jest.fn((r) => r === 'Admin'), attr: {} };
  const clerkW01 = { is: jest.fn((r) => r === 'WarehouseClerk'), attr: { WarehouseNumber: ['W01'] } };
  const clerkNoWarehouse = { is: jest.fn((r) => r === 'WarehouseClerk'), attr: {} };

  beforeEach(async () => {
    srv = new MibLabelService('MibLabelService');
    mockAdapter = {
      generateMibSticker: jest.fn(),
      readMibStickerData: jest.fn(),
      listTransferOrders: jest.fn()
    };
    srv.adapter = mockAdapter;
    await srv.init();
  });

  describe('generateMibSticker action', () => {
    it('returns generated sticker payload on adapter success for authorized warehouse', async () => {
      const mockResult = {
        WarehouseNumber: 'W01',
        TransferOrderNumber: '0001037246',
        LabelCount: 1,
        FileName: 'MIB-Sticker-W01-0001037246.pdf',
        PdfBase64: 'JVBERi0xLjcK'
      };
      mockAdapter.generateMibSticker.mockResolvedValueOnce(mockResult);

      const req = {
        user: clerkW01,
        data: {
          WarehouseNumber: 'W01',
          TransferOrderNumber: '1037246',
          WeightedBy: 'USER1',
          CheckedBy: 'USER2'
        },
        error: jest.fn()
      };

      const handler = srv._handlers.on.find((h) => h.on === 'generateMibSticker');
      expect(handler).toBeDefined();

      const result = await handler.handler.call(srv, req);
      expect(result).toEqual(mockResult);
      expect(mockAdapter.generateMibSticker).toHaveBeenCalledWith(req.data, { allowedWarehouses: ['W01'] });
      expect(req.error).not.toHaveBeenCalled();
    });

    it('rejects with 403 if requested warehouse is outside user scope', async () => {
      const req = {
        user: clerkW01,
        data: {
          WarehouseNumber: 'W02',
          TransferOrderNumber: '1037246'
        },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'generateMibSticker');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(403, expect.stringContaining("outside the user's authorized warehouse scope"));
      expect(mockAdapter.generateMibSticker).not.toHaveBeenCalled();
    });

    it('surfaces adapter error status and message via req.error', async () => {
      const err = new Error('Z_MM_MIB_LABEL_PDF not installed');
      err.status = 503;
      mockAdapter.generateMibSticker.mockRejectedValueOnce(err);

      const req = {
        user: adminUser,
        data: { WarehouseNumber: 'W01', TransferOrderNumber: '1037246' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'generateMibSticker');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(503, 'Z_MM_MIB_LABEL_PDF not installed');
    });
  });

  describe('readMibStickerData action', () => {
    it('returns sticker rows from adapter for authorized warehouse', async () => {
      const mockRows = [{
        Material: 'MAT-001',
        MaterialDescription: 'Test Material',
        Batch: 'BATCH-01',
        TransferOrder: '0001037246',
        TransferRequirement: '123',
        RequirementNumber: '456',
        TransferDate: '2026-10-23',
        QuantityWithUom: '10 KG',
        StorageUnit: 'SU-1',
        WeightedBy: 'USER1',
        CheckedBy: 'USER2'
      }];
      mockAdapter.readMibStickerData.mockResolvedValueOnce(mockRows);

      const req = {
        user: clerkW01,
        data: { WarehouseNumber: 'W01', TransferOrderNumber: '1037246' },
        error: jest.fn()
      };

      const handler = srv._handlers.on.find((h) => h.on === 'readMibStickerData');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual(mockRows);
      expect(mockAdapter.readMibStickerData).toHaveBeenCalledWith(req.data, { allowedWarehouses: ['W01'] });
    });

    it('rejects with 403 if requested warehouse is outside user scope', async () => {
      const req = {
        user: clerkW01,
        data: { WarehouseNumber: 'W99', TransferOrderNumber: '1037246' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'readMibStickerData');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(403, expect.stringContaining("outside the user's authorized warehouse scope"));
      expect(mockAdapter.readMibStickerData).not.toHaveBeenCalled();
    });

    it('returns req.error if read fails', async () => {
      const err = new Error('Database error');
      err.status = 500;
      mockAdapter.readMibStickerData.mockRejectedValueOnce(err);

      const req = {
        user: adminUser,
        data: { WarehouseNumber: 'W01', TransferOrderNumber: '1037246' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'readMibStickerData');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(500, 'Database error');
    });
  });

  describe('listTransferOrders action', () => {
    it('returns transfer orders from adapter for authorized warehouse', async () => {
      const mockList = {
        WarehouseNumber: 'W01',
        DateFrom: '2026-10-20',
        DateTo: '2026-10-25',
        More: false,
        TransferOrders: [{ TransferOrderNumber: '0001037246', Material: 'MAT-001' }]
      };
      mockAdapter.listTransferOrders.mockResolvedValueOnce(mockList);

      const req = {
        user: clerkW01,
        data: { WarehouseNumber: 'W01', DateFrom: '2026-10-20', DateTo: '2026-10-25' },
        error: jest.fn()
      };

      const handler = srv._handlers.on.find((h) => h.on === 'listTransferOrders');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual(mockList);
      expect(mockAdapter.listTransferOrders).toHaveBeenCalledWith(req.data, { allowedWarehouses: ['W01'] });
    });

    it('rejects with 403 if requested warehouse is outside user scope', async () => {
      const req = {
        user: clerkW01,
        data: { WarehouseNumber: 'W02', DateFrom: '2026-10-20', DateTo: '2026-10-25' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'listTransferOrders');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(403, expect.stringContaining("outside the user's authorized warehouse scope"));
      expect(mockAdapter.listTransferOrders).not.toHaveBeenCalled();
    });

    it('returns req.error if list fails', async () => {
      const err = new Error('List read failed');
      err.status = 500;
      mockAdapter.listTransferOrders.mockRejectedValueOnce(err);

      const req = {
        user: adminUser,
        data: { WarehouseNumber: 'W01', DateFrom: '2026-10-20', DateTo: '2026-10-25' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'listTransferOrders');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(500, 'List read failed');
    });
  });

  describe('getWarehouseContext function', () => {
    it('returns unrestricted true and default warehouses for Admin user', async () => {
      const req = {
        user: adminUser
      };

      const handler = srv._handlers.on.find((h) => h.on === 'getWarehouseContext');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual({
        warehouses: ['W01'],
        unrestricted: true
      });
    });

    it('returns scoped warehouses for clerk with explicit warehouse attribute', async () => {
      const req = {
        user: { is: jest.fn(() => false), attr: { WarehouseNumber: ['W02'] } }
      };

      const handler = srv._handlers.on.find((h) => h.on === 'getWarehouseContext');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual({
        warehouses: ['W02'],
        unrestricted: false
      });
    });

    it('returns mapped warehouse for clerk with Plant attribute via authoritative mapping', async () => {
      const req = {
        user: { is: jest.fn(() => false), attr: { Plant: ['1120'] } }
      };

      const handler = srv._handlers.on.find((h) => h.on === 'getWarehouseContext');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual({
        warehouses: ['W01'],
        unrestricted: false
      });
    });

    it('returns empty warehouse list for clerk without warehouse or plant assignment', async () => {
      const req = {
        user: clerkNoWarehouse
      };

      const handler = srv._handlers.on.find((h) => h.on === 'getWarehouseContext');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual({
        warehouses: [],
        unrestricted: false
      });
    });
  });
});
