const EwmAdapter = require('../../../srv/integration/s4hana/ewm/EwmAdapter');

describe('Unit: EWM RF Terminal & Scan Verification', () => {
  describe('verifyScan barcode matching', () => {
    it('should verify exact bin match (case-insensitive)', async () => {
      const bValid = await EwmAdapter.verifyScan('0001', 'BIN', '0010-01-01', '0010-01-01');
      expect(bValid).toBe(true);

      const bCaseInsensitive = await EwmAdapter.verifyScan('0001', 'BIN', 'bin-01', 'BIN-01');
      expect(bCaseInsensitive).toBe(true);
    });

    it('should verify product barcode with standard GS1/SAP prefix stripping', async () => {
      // Barcode scanners often send "PTG11" for Product "TG11"
      const bPrefixed = await EwmAdapter.verifyScan('0001', 'PRODUCT', 'PTG11', 'TG11');
      expect(bPrefixed).toBe(true);

      // Barcode scanners often send "S0010-01" for Storage Bin "0010-01"
      const bBinPrefixed = await EwmAdapter.verifyScan('0001', 'BIN', 'S0010-01', '0010-01');
      expect(bBinPrefixed).toBe(true);
    });

    it('should reject mismatched barcodes', async () => {
      const bMismatch = await EwmAdapter.verifyScan('0001', 'PRODUCT', 'WRONG-PROD', 'TG11');
      expect(bMismatch).toBe(false);

      const bBinMismatch = await EwmAdapter.verifyScan('0001', 'BIN', '0020-01-01', '0010-01-01');
      expect(bBinMismatch).toBe(false);
    });

    it('should reject empty or null scan values', async () => {
      expect(await EwmAdapter.verifyScan('0001', 'BIN', '', '0010-01-01')).toBe(false);
      expect(await EwmAdapter.verifyScan('0001', 'BIN', null, '0010-01-01')).toBe(false);
      expect(await EwmAdapter.verifyScan('0001', 'BIN', '0010-01-01', '')).toBe(false);
    });
  });

  describe('logonResource contract', () => {
    it('should throw if Warehouse is missing', async () => {
      await expect(EwmAdapter.logonResource('', 'CART-01', 'PICK_FAST')).rejects.toThrow(
        /Warehouse and Resource are required/
      );
    });

    it('should throw if Resource is missing', async () => {
      await expect(EwmAdapter.logonResource('0001', '', 'PICK_FAST')).rejects.toThrow(
        /Warehouse and Resource are required/
      );
    });

    it('should throw if Queue is missing', async () => {
      await expect(EwmAdapter.logonResource('0001', 'CART-01', '')).rejects.toThrow(
        /Queue is required/
      );
    });

    it('should return active logon session for valid inputs', async () => {
      const session = await EwmAdapter.logonResource('0001', 'CART-01', 'PICK_FAST');
      expect(session).toEqual(expect.objectContaining({
        Warehouse: '0001',
        Resource: 'CART-01',
        Queue: 'PICK_FAST',
        LogonStatus: 'ACTIVE'
      }));
      expect(session.LogonTimestamp).toBeDefined();
    });
  });

  describe('confirmRfPickTask contract', () => {
    it('should throw if Warehouse or WarehouseTask is missing', async () => {
      await expect(EwmAdapter.confirmRfPickTask('', '10001', 1, 'HU-01', 'BIN-01')).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
      await expect(EwmAdapter.confirmRfPickTask('0001', '', 1, 'HU-01', 'BIN-01')).rejects.toThrow(
        /Warehouse and WarehouseTask are required/
      );
    });
  });

  describe('getWarehouseResources contract', () => {
    it('should query API_WAREHOUSE_RESOURCE and map results', async () => {
      const origGet = EwmAdapter._get;
      EwmAdapter._get = jest.fn().mockResolvedValue([
        {
          Warehouse: '0001',
          WarehouseResource: 'CART-01',
          ResourceType: 'CART',
          AssignedQueue: 'PICK_FAST',
          UserName: 'ALICE'
        }
      ]);

      try {
        const resources = await EwmAdapter.getWarehouseResources('0001');
        expect(EwmAdapter._get).toHaveBeenCalledWith(
          '/sap/opu/odata/sap/API_WAREHOUSE_RESOURCE/WarehouseResource',
          expect.stringContaining("$filter=Warehouse eq '0001'")
        );
        expect(resources).toHaveLength(1);
        expect(resources[0].Resource).toBe('CART-01');
        expect(resources[0].LogonStatus).toBe('LOGGED_ON');
      } finally {
        EwmAdapter._get = origGet;
      }
    });

    it('should return empty array if no resources returned by SAP', async () => {
      const origGet = EwmAdapter._get;
      EwmAdapter._get = jest.fn().mockResolvedValue([]);

      try {
        const resources = await EwmAdapter.getWarehouseResources('0001');
        expect(resources).toEqual([]);
      } finally {
        EwmAdapter._get = origGet;
      }
    });
  });
});
