'use strict';

const MibLabelService = require('../../../srv/wm/mib-label/service');

describe('MibLabelService', () => {
  let srv;
  let mockAdapter;

  beforeEach(async () => {
    srv = new MibLabelService('MibLabelService');
    mockAdapter = {
      generateMibSticker: jest.fn(),
      readMibStickerData: jest.fn()
    };
    srv.adapter = mockAdapter;
    await srv.init();
  });

  describe('generateMibSticker action', () => {
    it('returns generated sticker payload on adapter success', async () => {
      const mockResult = {
        WarehouseNumber: 'W01',
        TransferOrderNumber: '0001037246',
        LabelCount: 1,
        FileName: 'MIB-Sticker-W01-0001037246.pdf',
        PdfBase64: 'JVBERi0xLjcK'
      };
      mockAdapter.generateMibSticker.mockResolvedValueOnce(mockResult);

      const req = {
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
      expect(mockAdapter.generateMibSticker).toHaveBeenCalledWith(req.data);
      expect(req.error).not.toHaveBeenCalled();
    });

    it('surfaces adapter error status and message via req.error', async () => {
      const err = new Error('Z_MM_MIB_LABEL_PDF not installed');
      err.status = 503;
      mockAdapter.generateMibSticker.mockRejectedValueOnce(err);

      const req = {
        data: { WarehouseNumber: 'W01', TransferOrderNumber: '1037246' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'generateMibSticker');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(503, 'Z_MM_MIB_LABEL_PDF not installed');
    });
  });

  describe('readMibStickerData action', () => {
    it('returns sticker rows from adapter', async () => {
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
        data: { WarehouseNumber: 'W01', TransferOrderNumber: '1037246' },
        error: jest.fn()
      };

      const handler = srv._handlers.on.find((h) => h.on === 'readMibStickerData');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual(mockRows);
      expect(mockAdapter.readMibStickerData).toHaveBeenCalledWith(req.data);
    });

    it('returns req.error if read fails', async () => {
      const err = new Error('Database error');
      err.status = 500;
      mockAdapter.readMibStickerData.mockRejectedValueOnce(err);

      const req = {
        data: { WarehouseNumber: 'W01', TransferOrderNumber: '1037246' },
        error: jest.fn((status, msg) => ({ status, msg }))
      };

      const handler = srv._handlers.on.find((h) => h.on === 'readMibStickerData');
      await handler.handler.call(srv, req);

      expect(req.error).toHaveBeenCalledWith(500, 'Database error');
    });
  });

  describe('getWarehouseContext function', () => {
    it('returns unrestricted true for Admin user', async () => {
      const req = {
        user: { is: jest.fn((role) => role === 'Admin'), attr: {} }
      };

      const handler = srv._handlers.on.find((h) => h.on === 'getWarehouseContext');
      const result = await handler.handler.call(srv, req);

      expect(result).toEqual({
        warehouses: ['W01'],
        unrestricted: true
      });
    });

    it('returns unrestricted false for user with Plant attribute', async () => {
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
  });
});
