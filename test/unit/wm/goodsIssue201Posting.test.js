const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');
const GoodsIssueStockUnitClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient');

describe('Movement 201 Backend Posting, Reversal & Serial Stock Pre-Check', () => {
  describe('GoodsIssuePostingClient: Movement 201 & CancelHeader Reversal', () => {
    it('successfully posts an unplanned 201 Goods Issue directly to Cost Center without reservation', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({
          MaterialDocument: '4900055001',
          MaterialDocumentYear: '2026'
        })
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const res = await client.postGoodsIssue(
        '', // No reservation
        '', // No reservation item
        '8000009753',
        1,
        'EA',
        '',
        0,
        '',
        '',
        false,
        '1120',
        'HS01',
        {
          movementType: '201',
          costCenter: '1011101301',
          glAccount: '0000400000',
          serialNumbers: ['MACBOOK-004']
        }
      );

      expect(mockAdapter._post).toHaveBeenCalledTimes(1);
      const [path, payload] = mockAdapter._post.mock.calls[0];
      expect(path).toBe('/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader');
      expect(payload.GoodsMovementCode).toBe('03');
      expect(payload.MaterialDocumentHeaderText).toBe('GI CC 1011101301');

      const item = payload.to_MaterialDocumentItem.results[0];
      expect(item.GoodsMovementType).toBe('201');
      expect(item.CostCenter).toBe('1011101301');
      expect(item.GLAccount).toBe('0000400000');
      expect(item.Reservation).toBeUndefined();
      expect(item.to_SerialNumbers.results).toEqual([{ SerialNumber: 'MACBOOK-004' }]);

      expect(res).toMatchObject({
        Success: true,
        MaterialDocument: '4900055001',
        MaterialDocYear: '2026'
      });
      expect(res.Message).toContain('Goods Issue to Cost Center 201 posted successfully');
    });

    it('successfully reverses a Material Document via CancelHeader FunctionImport', async () => {
      const mockAdapter = {
        _getDestination: jest.fn().mockResolvedValue({ name: 'S4HANA' }),
        _post: jest.fn().mockResolvedValue({
          MaterialDocument: '4900055002',
          MaterialDocumentYear: '2026'
        })
      };

      const client = new GoodsIssuePostingClient({ adapter: mockAdapter });
      const res = await client.reverseGoodsIssue('4900055001', '2026', '2026-09-29');

      expect(mockAdapter._post).toHaveBeenCalledTimes(1);
      const [url] = mockAdapter._post.mock.calls[0];
      expect(url).toContain("CancelHeader?MaterialDocument='4900055001'");
      expect(url).toContain("MaterialDocumentYear='2026'");

      expect(res).toMatchObject({
        OriginalMaterialDocument: '4900055001',
        OriginalMaterialDocYear: '2026',
        ReversalMaterialDocument: '4900055002',
        ReversalMaterialDocYear: '2026',
        Success: true
      });
      expect(res.Message).toContain('reversed successfully in S/4HANA via CancelHeader');
    });

    it('rejects reversal when MaterialDocument or Year is missing', async () => {
      const client = new GoodsIssuePostingClient();
      await expect(client.reverseGoodsIssue('', '2026')).rejects.toMatchObject({ status: 400 });
      await expect(client.reverseGoodsIssue('4900055001', '')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('GoodsIssueStockUnitClient: Serial Status Pre-Check (ESTO In-Stock)', () => {
    it('passes validation when serial is in unrestricted stock (InventoryStockType 01)', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            SerialNumber: 'MACBOOK-004',
            Material: '8000009753',
            Plant: '1120',
            StorageLocation: 'HS01',
            InventoryStockType: '01',
            InventoryStockType_Text: 'Unrestricted-Use Stock'
          }
        ])
      };

      const suClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      const res = await suClient.validateSerialStatus('8000009753', '1120', 'HS01', ['MACBOOK-004']);
      expect(res).toEqual({ valid: true });
    });

    it('rejects with 422 when serial number is not in unrestricted stock or already issued (ESTO failure)', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            SerialNumber: 'MACBOOK-004',
            Material: '8000009753',
            Plant: '1120',
            StorageLocation: 'HS01',
            InventoryStockType: '02', // Blocked or quality inspection or already issued
            InventoryStockType_Text: 'Quality Inspection'
          }
        ])
      };

      const suClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      await expect(
        suClient.validateSerialStatus('8000009753', '1120', 'HS01', ['MACBOOK-004'])
      ).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('already issued or not in unrestricted stock (Status: Quality Inspection)')
      });
    });

    it('rejects with 409 when serial number belongs to a different plant or storage location', async () => {
      const mockAdapter = {
        _get: jest.fn().mockResolvedValue([
          {
            SerialNumber: 'MACBOOK-004',
            Material: '8000009753',
            Plant: '2200', // Different plant
            StorageLocation: 'HS01',
            InventoryStockType: '01'
          }
        ])
      };

      const suClient = new GoodsIssueStockUnitClient({ adapter: mockAdapter });
      await expect(
        suClient.validateSerialStatus('8000009753', '1120', 'HS01', ['MACBOOK-004'])
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('located in Plant 2200, but Goods Issue requires Plant 1120')
      });
    });
  });
});
