'use strict';

const {
  MOVEMENT_CONFIG,
  SUPPORTED_MOVEMENT_TYPES,
  getMovementConfig,
  resolveWmMovement,
  validateReservationInput,
  validateMovement301Destination,
  validateMovement311Destination,
  verifyReceivingLocationInSap,
  verifyMovement311DestinationInSap,
  calculateMovement261StockEligibility
} = require('../../../srv/common/movementConfig');

describe('Single Normalized Movement Configuration (Step 2) [mock only, not SAP verification]', () => {
  const origEnv = process.env.WM_TR_REAL_MOVEMENT;

  afterEach(() => {
    process.env.WM_TR_REAL_MOVEMENT = origEnv;
  });

  describe('1. Movement Configuration Definitions', () => {
    test('Contains supported movement types: 201, 241, 311, 301, 261', () => {
      expect(SUPPORTED_MOVEMENT_TYPES).toEqual(['201', '241', '311', '301', '261']);
    });

    test('261: GI to Order configuration has required properties', () => {
      const cfg = MOVEMENT_CONFIG['261'];
      expect(cfg.inventoryMovement).toBe('261');
      expect(cfg.configuredWmMovement).toBe('261');
      expect(cfg.stagingWmMovement).toBe('261');
      expect(cfg.requiresCostCenter).toBe(false);
      expect(cfg.requiresAsset).toBe(false);
      expect(cfg.requiresReceivingPlant).toBe(false);
      expect(cfg.requiresReceivingSloc).toBe(false);
      expect(cfg.requiresOrder).toBe(true);
      expect(cfg.requirementType).toBe('F');
      expect(cfg.interimStorageType).toBe('914');
      expect(cfg.preserveReservationOnTr).toBe(true);
      expect(cfg.gmCode).toBe('03');
    });

    test('201: GI to Cost Center configuration has required properties', () => {
      const cfg = MOVEMENT_CONFIG['201'];
      expect(cfg.inventoryMovement).toBe('201');
      expect(cfg.configuredWmMovement).toBe('201');
      expect(cfg.stagingWmMovement).toBe('311');
      expect(cfg.requiresCostCenter).toBe(true);
      expect(cfg.requiresAsset).toBe(false);
      expect(cfg.requiresReceivingPlant).toBe(false);
      expect(cfg.requiresReceivingSloc).toBe(false);
      expect(cfg.requirementType).toBe('K');
      expect(cfg.interimStorageType).toBe('911');
      expect(cfg.gmCode).toBe('03');
    });

    test('241: GI to Asset configuration has required properties', () => {
      const cfg = MOVEMENT_CONFIG['241'];
      expect(cfg.inventoryMovement).toBe('241');
      expect(cfg.configuredWmMovement).toBe('241');
      expect(cfg.stagingWmMovement).toBe('311');
      expect(cfg.requiresCostCenter).toBe(false);
      expect(cfg.requiresAsset).toBe(true);
      expect(cfg.requiresReceivingPlant).toBe(false);
      expect(cfg.requiresReceivingSloc).toBe(false);
      expect(cfg.requirementType).toBe('A');
      expect(cfg.interimStorageType).toBe('913');
      expect(cfg.gmCode).toBe('03');
    });

    test('311: SLoc Transfer configuration has required properties', () => {
      const cfg = MOVEMENT_CONFIG['311'];
      expect(cfg.inventoryMovement).toBe('311');
      expect(cfg.wmMovement).toBe('311');
      expect(cfg.requiresCostCenter).toBe(false);
      expect(cfg.requiresAsset).toBe(false);
      expect(cfg.requiresReceivingPlant).toBe(false);
      expect(cfg.requiresReceivingSloc).toBe(true);
      expect(cfg.receivingPlantMustMatch).toBe(true);
      expect(cfg.receivingSlocMustDiffer).toBe(true);
      expect(cfg.interimStorageType).toBe('921');
      expect(cfg.interimStorageBin).toBe('TRANSFER');
      expect(cfg.gmCode).toBe('04');
    });

    test('301: Plant Transfer configuration has required properties', () => {
      const cfg = MOVEMENT_CONFIG['301'];
      expect(cfg.inventoryMovement).toBe('301');
      expect(cfg.wmMovement).toBe('301');
      expect(cfg.requiresCostCenter).toBe(false);
      expect(cfg.requiresAsset).toBe(false);
      expect(cfg.requiresReceivingPlant).toBe(true);
      expect(cfg.requiresReceivingSloc).toBe(true);
      expect(cfg.receivingPlantMustDiffer).toBe(true);
      expect(cfg.preserveReservationOnTr).toBe(false);
      expect(cfg.interimStorageType).toBe('920');
      expect(cfg.interimStorageBin).toBe('TRANSFER');
      expect(cfg.gmCode).toBe('04');
    });
  });

  describe('2. WM Movement Resolution (Real vs Staging)', () => {
    test('Default (WM_TR_REAL_MOVEMENT != true): 201 and 241 resolve to staging movement 311', () => {
      delete process.env.WM_TR_REAL_MOVEMENT;
      expect(resolveWmMovement('201')).toBe('311');
      expect(resolveWmMovement('241')).toBe('311');
      expect(resolveWmMovement('311')).toBe('311');
      expect(resolveWmMovement('301')).toBe('301');
    });

    test('Real Movement active (WM_TR_REAL_MOVEMENT = true): 201 and 241 resolve to configured 201/241', () => {
      process.env.WM_TR_REAL_MOVEMENT = 'true';
      expect(resolveWmMovement('201')).toBe('201');
      expect(resolveWmMovement('241')).toBe('241');
      expect(resolveWmMovement('311')).toBe('311');
      expect(resolveWmMovement('301')).toBe('301');
    });

    test('getMovementConfig handles whitespace trimming and unsupported keys', () => {
      expect(getMovementConfig(' 201 ')?.movementType).toBe('201');
      expect(getMovementConfig('999')).toBeNull();
      expect(getMovementConfig('')).toBeNull();
      expect(getMovementConfig(null)).toBeNull();
    });
  });

  describe('3. Required Pre-Validation Before Calling SAP', () => {
    describe('Common Mandatory Field Validations', () => {
      test('Fails when MovementType is missing', () => {
        const res = validateReservationInput({ Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('MovementType is mandatory (201, 241, 311, 301, 261)');
      });

      test('Fails when MovementType is unsupported', () => {
        const res = validateReservationInput({ MovementType: '999', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors[0]).toMatch(/Unsupported movement type '999'/);
      });

      test('Fails when Plant is missing', () => {
        const res = validateReservationInput({ MovementType: '201', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG', CostCenter: '1011201301' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Plant is mandatory');
      });

      test('Fails when StorageLocation is missing', () => {
        const res = validateReservationInput({ MovementType: '201', Plant: '1120', Material: 'MAT01', Quantity: 10, Unit: 'KG', CostCenter: '1011201301' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('StorageLocation is mandatory');
      });

      test('Fails when Material is missing', () => {
        const res = validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Quantity: 10, Unit: 'KG', CostCenter: '1011201301' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Material is mandatory');
      });

      test('Fails when Quantity is missing, zero, or negative', () => {
        expect(validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Unit: 'KG', CostCenter: '1011201301' }).isValid).toBe(false);
        expect(validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 0, Unit: 'KG', CostCenter: '1011201301' }).isValid).toBe(false);
        expect(validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: -5, Unit: 'KG', CostCenter: '1011201301' }).isValid).toBe(false);
      });

      test('Fails when Unit / UoM is missing', () => {
        const res = validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, CostCenter: '1011201301' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Unit is mandatory');
      });

      test('Validates ReservationDate format when provided', () => {
        const validIso = validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG', CostCenter: '1011201301', ReservationDate: '2026-10-14' });
        expect(validIso.isValid).toBe(true);

        const validSap = validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG', CostCenter: '1011201301', ReservationDate: '20261014' });
        expect(validSap.isValid).toBe(true);

        const invalidDate = validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG', CostCenter: '1011201301', ReservationDate: 'invalid-date' });
        expect(invalidDate.isValid).toBe(false);
        expect(invalidDate.errors).toContain('Invalid ReservationDate');
      });
    });

    describe('Movement 201 Validations (Cost Center)', () => {
      test('Fails when CostCenter is missing', () => {
        const res = validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Cost Center is mandatory for Movement Type 201 (GI to Cost Center)');
      });

      test('Passes with valid CostCenter and required fields', () => {
        const res = validateReservationInput({ MovementType: '201', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG', CostCenter: '1011201301' });
        expect(res.isValid).toBe(true);
        expect(res.errors).toHaveLength(0);
      });
    });

    describe('Movement 241 Validations (Asset)', () => {
      test('Fails when AssetNo is missing', () => {
        const res = validateReservationInput({ MovementType: '241', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Asset number is mandatory for Movement Type 241 (GI to Asset)');
      });

      test('Passes with valid AssetNo and required fields', () => {
        const res = validateReservationInput({ MovementType: '241', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG', AssetNo: '000000400001' });
        expect(res.isValid).toBe(true);
        expect(res.errors).toHaveLength(0);
      });
    });

    describe('Movement 311 Validations (SLoc to SLoc)', () => {
      test('Fails when ReceivingStorageLocation is missing', () => {
        const res = validateReservationInput({ MovementType: '311', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Receiving Storage Location is mandatory for Movement Type 311 (SLoc Transfer)');
      });

      test('Fails when ReceivingStorageLocation equals issuing StorageLocation', () => {
        const res = validateReservationInput({ MovementType: '311', Plant: '1120', StorageLocation: 'HS01', ReceivingStorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Receiving Storage Location must be different from Issuing Storage Location');
      });

      test('Fails when ReceivingPlant is provided but differs from issuing Plant', () => {
        const res = validateReservationInput({ MovementType: '311', Plant: '1120', StorageLocation: 'HS01', ReceivingStorageLocation: 'CS01', ReceivingPlant: '1110', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Receiving Plant must match Issuing Plant for Movement Type 311 (SLoc Transfer)');
      });

      test('Passes with valid different Receiving SLoc within same Plant', () => {
        const res = validateReservationInput({ MovementType: '311', Plant: '1120', StorageLocation: 'HS01', ReceivingStorageLocation: 'CS01', ReceivingPlant: '1120', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(true);
        expect(res.errors).toHaveLength(0);
      });
    });

    describe('Movement 301 Validations (Plant to Plant)', () => {
      test('Fails when ReceivingPlant is missing', () => {
        const res = validateReservationInput({ MovementType: '301', Plant: '1120', StorageLocation: 'HS01', ReceivingStorageLocation: 'CS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Receiving Plant is mandatory for Movement Type 301 (Plant Transfer)');
      });

      test('Fails when ReceivingPlant equals issuing Plant', () => {
        const res = validateReservationInput({ MovementType: '301', Plant: '1120', ReceivingPlant: '1120', StorageLocation: 'HS01', ReceivingStorageLocation: 'CS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Receiving Plant must be different from Issuing Plant');
      });

      test('Fails when ReceivingStorageLocation is missing for 301', () => {
        const res = validateReservationInput({ MovementType: '301', Plant: '1120', ReceivingPlant: '1110', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(false);
        expect(res.errors).toContain('Receiving Storage Location is mandatory for Movement Type 301 (Plant to Plant Transfer)');
      });

      test('Passes with valid different ReceivingPlant and Receiving SLoc', () => {
        const res = validateReservationInput({ MovementType: '301', Plant: '1120', ReceivingPlant: '1110', StorageLocation: 'HS01', ReceivingStorageLocation: 'CS01', Material: 'MAT01', Quantity: 10, Unit: 'KG' });
        expect(res.isValid).toBe(true);
        expect(res.errors).toHaveLength(0);
      });
    });

    describe('Options handling: throwError vs req.error', () => {
      test('Throws when throwError = true', () => {
        expect(() => {
          validateReservationInput({}, { throwError: true });
        }).toThrow('MovementType is mandatory (201, 241, 311, 301, 261)');
      });

      test('Populates req.error when req is passed', () => {
        const mockReq = { error: jest.fn() };
        const res = validateReservationInput({}, { req: mockReq });
        expect(res.isValid).toBe(false);
        expect(mockReq.error).toHaveBeenCalled();
      });
    });
  });

  describe('4. Destination Validation & SAP Backend Verification', () => {
    describe('validateMovement311Destination', () => {
      test('rejects missing receiving storage location', () => {
        const res = validateMovement311Destination('1120', 'CS01', '', '');
        expect(res.isValid).toBe(false);
        expect(res.errors[0].message).toContain('Receiving Storage Location is mandatory for Movement Type 311');
      });

      test('rejects receiving storage location equal to issuing storage location', () => {
        const res = validateMovement311Destination('1120', 'CS01', '1120', 'CS01');
        expect(res.isValid).toBe(false);
        expect(res.errors[0].message).toContain('Receiving Storage Location must be different from Issuing Storage Location');
      });

      test('rejects receiving plant mismatch for 311', () => {
        const res = validateMovement311Destination('1120', 'CS01', '1130', 'CS02');
        expect(res.isValid).toBe(false);
        expect(res.errors[0].message).toContain('Receiving Plant must match Issuing Plant for Movement Type 311');
      });

      test('accepts valid intra-plant transfer', () => {
        const res = validateMovement311Destination('1120', 'CS01', '1120', 'CS02');
        expect(res.isValid).toBe(true);
        expect(res.errors).toHaveLength(0);
      });
    });

    describe('verifyReceivingLocationInSap (Movement 311 WM & SAP checks)', () => {
      test('rejects when receiving SLoc is mapped to different warehouse in T320', async () => {
        const mockRfc = {
          readTable: jest.fn().mockImplementation(async (table, fields, where = []) => {
            const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
            if (table === 'T320') {
              if (whereStr.includes("LGORT = 'CS02'")) return [{ LGNUM: 'W10', WERKS: '1120', LGORT: 'CS02' }];
              return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
            }
            return [];
          })
        };
        const res = await verifyMovement311DestinationInSap(mockRfc, {
          plant: '1120',
          storageLocation: 'CS01',
          receivingStorageLocation: 'CS02'
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('belongs to warehouse W10, but issuing storage location belongs to warehouse W01');
        expect(res.error).toContain('cross-warehouse transfer not supported in 311');
      });

      test('passes when receiving SLoc is mapped to same warehouse in T320', async () => {
        const mockRfc = {
          readTable: jest.fn().mockImplementation(async (table, fields, where = []) => {
            const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
            if (table === 'T320') {
              if (whereStr.includes("LGORT = 'CS02'")) return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
              return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
            }
            if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02' }];
            return [];
          })
        };
        const res = await verifyMovement311DestinationInSap(mockRfc, {
          plant: '1120',
          storageLocation: 'CS01',
          receivingStorageLocation: 'CS02'
        });
        expect(res.valid).toBe(true);
      });

      test('supports non-WM receiving SLoc when not mapped in T320', async () => {
        const mockRfc = {
          readTable: jest.fn().mockImplementation(async (table, fields, where = []) => {
            const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
            if (table === 'T320') {
              if (whereStr.includes("LGORT = 'CS02'")) return [];
              return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
            }
            if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02' }];
            return [];
          })
        };
        const res = await verifyMovement311DestinationInSap(mockRfc, {
          plant: '1120',
          storageLocation: 'CS01',
          receivingStorageLocation: 'CS02'
        });
        expect(res.valid).toBe(true);
      });

      test('rejects when receiving SLoc does not exist in plant (T001L)', async () => {
        const mockRfc = {
          readTable: jest.fn().mockImplementation(async (table) => {
            if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
            if (table === 'T001L') return [];
            return [];
          })
        };
        const res = await verifyMovement311DestinationInSap(mockRfc, {
          plant: '1120',
          storageLocation: 'CS01',
          receivingStorageLocation: 'CS02'
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('Receiving Storage Location CS02 does not exist in plant 1120 (T001L)');
      });

      test('rejects when material is not extended to receiving SLoc (MARD)', async () => {
        const mockRfc = {
          readTable: jest.fn().mockImplementation(async (table) => {
            if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
            if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02' }];
            if (table === 'MARD') return [];
            return [];
          })
        };
        const res = await verifyMovement311DestinationInSap(mockRfc, {
          plant: '1120',
          storageLocation: 'CS01',
          receivingStorageLocation: 'CS02',
          material: 'MAT100'
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('Material MAT100 is not extended to receiving storage location CS02 in plant 1120 (MARD)');
      });

      test('verifyReceivingLocationInSap supports both 301 and 311 movements directly', async () => {
        const mockRfc = {
          readTable: jest.fn().mockImplementation(async (table) => {
            if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
            if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02' }];
            return [];
          })
        };
        const res311 = await verifyReceivingLocationInSap(mockRfc, {
          movementType: '311',
          plant: '1120',
          storageLocation: 'CS01',
          receivingStorageLocation: 'CS02'
        });
        expect(res311.valid).toBe(true);

        const res301Val = validateMovement301Destination('1120', '1130', 'CS01');
        expect(res301Val.isValid).toBe(true);
      });
    });
  });

  describe('5. Canonical Movement 261 Stock-Eligibility Calculation', () => {
    test('unifies open, issuable, supply area, staged, storage unit, and no-unit stock into authoritative result', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        supplyAreaStock: 0,
        stagedQuantity: 10,
        storageUnitQuantity: 10,
        noUnitQuantity: 0,
        unit: 'KG',
        source: 'SAP'
      });

      expect(result).toMatchObject({
        eligible: true,
        Eligible: true,
        issuableQuantity: 10,
        IssuableQuantity: 10,
        reason: null,
        Reason: null,
        source: 'SAP',
        Source: 'SAP',
        openQuantity: 10,
        OpenQuantity: 10,
        supplyAreaStock: 0,
        SupplyAreaStock: 0,
        stagedQuantity: 10,
        StagedQuantity: 10,
        storageUnitQuantity: 10,
        StorageUnitQuantity: 10,
        noUnitQuantity: 0,
        NoUnitQuantity: 0,
        partialCoverage: false,
        PartialCoverage: false
      });
    });

    test('correctly calculates partial coverage when issuable stock is less than open quantity', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 20,
        issuableQuantity: 8,
        supplyAreaStock: 0,
        stagedQuantity: 8,
        storageUnitQuantity: 5,
        noUnitQuantity: 3,
        unit: 'KG'
      });

      expect(result.eligible).toBe(true);
      expect(result.issuableQuantity).toBe(8);
      expect(result.partialCoverage).toBe(true);
      expect(result.storageUnitQuantity).toBe(5);
      expect(result.noUnitQuantity).toBe(3);
      expect(result.reason).toBeNull();
    });

    test('marks zero open quantity as ineligible with explicit reason', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 0,
        issuableQuantity: 10,
        unit: 'KG'
      });

      expect(result.eligible).toBe(false);
      expect(result.Eligible).toBe(false);
      expect(result.reason).toBe('No open quantity remaining');
      expect(result.issuableQuantity).toBe(0);
    });

    test('rejects when upstream/external blockers are present', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        blockers: ['Order status locked (REL DLV)', 'Item flagged for deletion']
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Order status locked');
      expect(result.reason).toContain('Item flagged for deletion');
    });

    test('rejects when requested quantity exceeds open quantity', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 20,
        requestQuantity: 15,
        unit: 'KG'
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Quantity 15 exceeds the open quantity 10 KG');
    });

    test('rejects when requested quantity is non-positive', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        requestQuantity: 0
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Quantity must be greater than zero');
    });

    test('detects staging shortfall when staging is required and staged stock is insufficient', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 10,
        stagedQuantity: 4,
        stagingRequired: true,
        stagingStorageType: '100',
        stagingBin: 'STAGE-01',
        unit: 'KG'
      });

      expect(result.eligible).toBe(false);
      expect(result.stagingShortfall).toBe(6);
      expect(result.reason).toContain('shortfall of 6 KG in interim storage bin 100/STAGE-01');
      expect(result.issuableQuantity).toBe(4);
    });

    test('identifies when issue location has no stock but supply area has stock, advising transfer', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 0,
        supplyAreaStock: 12,
        unit: 'KG',
        storageLocation: '101A',
        supplyAreaStorageLocation: '101B'
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('12 KG in supply area 101B; issue location 101A is empty - transfer required');
    });

    test('identifies when no unrestricted stock exists at all', () => {
      const result = calculateMovement261StockEligibility({
        openQuantity: 10,
        issuableQuantity: 0,
        supplyAreaStock: 0,
        unit: 'KG',
        storageLocation: '101A',
        batch: 'BATCH01'
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('no unrestricted stock in 101A for batch BATCH01');
    });

    test('accepts PascalCase inputs and produces dual-cased results', () => {
      const result = calculateMovement261StockEligibility({
        OpenQuantity: 15,
        IssuableQuantity: 15,
        SupplyAreaStock: 0,
        StagedQuantity: 15,
        StorageUnitQuantity: 10,
        NoUnitQuantity: 5,
        Unit: 'L',
        Source: 'SAP'
      });

      expect(result.Eligible).toBe(true);
      expect(result.eligible).toBe(true);
      expect(result.IssuableQuantity).toBe(15);
      expect(result.issuableQuantity).toBe(15);
      expect(result.StorageUnitQuantity).toBe(10);
      expect(result.NoUnitQuantity).toBe(5);
      expect(result.Source).toBe('SAP');
    });
  });
});
