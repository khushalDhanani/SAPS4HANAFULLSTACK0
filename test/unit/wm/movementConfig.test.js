'use strict';

const {
  MOVEMENT_CONFIG,
  SUPPORTED_MOVEMENT_TYPES,
  POSTABLE_MOVEMENT_TYPES,
  GM_CODE,
  getGmCode,
  getMovementConfig,
  resolveWmMovement,
  validateReservationInput,
  validateMovementPostingPayload,
  validateMovementDestination,
  validateMovementAccountAssignment,
  validateMovement261Payload,
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
        const res = validateReservationInput({ MovementType: '241', Plant: '1120', StorageLocation: 'HS01', Material: 'MAT01', Quantity: 10, Unit: 'KG', AssetNo: '000000400001', SubNumber: '0000' });
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

  describe('6. Central GM_CODE and Policy Rules (Item 17)', () => {
    test('GM_CODE exports correct SAP Goods Movement codes for all 5 movement types', () => {
      expect(GM_CODE['201']).toBe('03');
      expect(GM_CODE['241']).toBe('03');
      expect(GM_CODE['311']).toBe('04');
      expect(GM_CODE['301']).toBe('04');
      expect(GM_CODE['261']).toBe('03');
    });

    test('POSTABLE_MOVEMENT_TYPES contains expected postable movement types', () => {
      expect(POSTABLE_MOVEMENT_TYPES).toEqual(['201', '301', '311', '261']);
    });

    test('getGmCode helper returns correct GM_CODE or null', () => {
      expect(getGmCode('201')).toBe('03');
      expect(getGmCode(' 201 ')).toBe('03');
      expect(getGmCode('241')).toBe('03');
      expect(getGmCode('311')).toBe('04');
      expect(getGmCode('301')).toBe('04');
      expect(getGmCode('261')).toBe('03');
      expect(getGmCode('999')).toBeNull();
      expect(getGmCode('')).toBeNull();
      expect(getGmCode(null)).toBeNull();
    });

    test('MOVEMENT_CONFIG specifies requiredFields, forbiddenFields, and policy rules for all types', () => {
      for (const mvt of SUPPORTED_MOVEMENT_TYPES) {
        const cfg = MOVEMENT_CONFIG[mvt];
        expect(Array.isArray(cfg.requiredFields)).toBe(true);
        expect(cfg.requiredFields.length).toBeGreaterThan(0);
        expect(Array.isArray(cfg.forbiddenFields)).toBe(true);
        expect(cfg.destinationRules).toBeDefined();
        expect(typeof cfg.destinationRules.type).toBe('string');
        expect(cfg.batchRules).toBeDefined();
        expect(cfg.batchRules.supported).toBe(true);
        expect(cfg.batchRules.maxLength).toBe(10);
        expect(cfg.serialRules).toBeDefined();
        expect(cfg.serialRules.supported).toBe(true);
        expect(cfg.serialRules.maxLength).toBe(18);
        expect(cfg.reservationRules).toBeDefined();
        expect(cfg.accountAssignment).toBeDefined();
        expect(typeof cfg.accountAssignment.type).toBe('string');
      }
    });

    test('201 config has correct forbidden fields, destination rules, and account assignment', () => {
      const cfg = MOVEMENT_CONFIG['201'];
      expect(cfg.forbiddenFields).toContain('ReceivingPlant');
      expect(cfg.forbiddenFields).toContain('ReceivingStorageLocation');
      expect(cfg.forbiddenFields).toContain('AssetNo');
      expect(cfg.forbiddenFields).toContain('OrderID');
      expect(cfg.destinationRules.type).toBe('none');
      expect(cfg.destinationRules.allowsReceivingPlant).toBe(false);
      expect(cfg.accountAssignment.type).toBe('CostCenter');
      expect(cfg.accountAssignment.mandatory).toBe(true);
    });

    test('301 config has correct required fields, destination rules, and account assignment', () => {
      const cfg = MOVEMENT_CONFIG['301'];
      expect(cfg.requiredFields).toContain('ReceivingPlant');
      expect(cfg.requiredFields).toContain('ReceivingStorageLocation');
      expect(cfg.forbiddenFields).toContain('CostCenter');
      expect(cfg.forbiddenFields).toContain('AssetNo');
      expect(cfg.forbiddenFields).toContain('OrderID');
      expect(cfg.destinationRules.type).toBe('inter_plant');
      expect(cfg.destinationRules.receivingPlantMustDiffer).toBe(true);
      expect(cfg.accountAssignment.type).toBe('None');
      expect(cfg.accountAssignment.forbidden).toBe(true);
    });

    test('311 config has correct required fields, destination rules, and account assignment', () => {
      const cfg = MOVEMENT_CONFIG['311'];
      expect(cfg.requiredFields).toContain('ReceivingStorageLocation');
      expect(cfg.destinationRules.type).toBe('intra_plant');
      expect(cfg.destinationRules.receivingPlantMustMatch).toBe(true);
      expect(cfg.destinationRules.receivingSlocMustDiffer).toBe(true);
      expect(cfg.accountAssignment.type).toBe('None');
      expect(cfg.accountAssignment.forbidden).toBe(true);
    });

    test('261 config has correct reservation rules and order account assignment', () => {
      const cfg = MOVEMENT_CONFIG['261'];
      expect(cfg.reservationRules.requiredForPosting).toBe(true);
      expect(cfg.reservationRules.preserveReservationOnTr).toBe(true);
      expect(cfg.accountAssignment.type).toBe('Order');
      expect(cfg.accountAssignment.mandatory).toBe(true);
      expect(cfg.forbiddenFields).toContain('CostCenter');
      expect(cfg.forbiddenFields).toContain('AssetNo');
      expect(cfg.forbiddenFields).toContain('ReceivingPlant');
    });
  });

  describe('7. Canonical Movement Posting & Destination Validation (Item 18)', () => {
    const validBase201 = {
      Plant: '1130',
      StorageLocation: 'CS01',
      Material: '1000000980',
      IssueQty: 5,
      Unit: 'EA',
      CostCenter: '1011202902',
      PostingDate: '2026-10-19',
      DocumentDate: '2026-10-19'
    };

    test('validateMovementPostingPayload: 201 valid payload passes', () => {
      const res = validateMovementPostingPayload('201', validBase201);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    test('validateMovementPostingPayload: 201 rejects missing CostCenter', () => {
      const payload = { ...validBase201, CostCenter: '' };
      const res = validateMovementPostingPayload('201', payload);
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'CostCenter')).toBe(true);
    });

    test('validateMovementPostingPayload: 201 rejects forbidden destination or order fields', () => {
      const payload = { ...validBase201, ReceivingPlant: '1110', OrderID: '12345' };
      const res = validateMovementPostingPayload('201', payload);
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
      expect(res.errors.some(e => e.field === 'OrderID')).toBe(true);
    });

    test('validateMovementPostingPayload: 301 valid payload passes', () => {
      const payload = {
        ReservationNo: '519944',
        ReservationItem: '0001',
        Plant: '1120',
        StorageLocation: 'CS01',
        ReceivingPlant: '1110',
        ReceivingStorageLocation: 'CS01',
        IssueQty: 10,
        Unit: 'EA'
      };
      const res = validateMovementPostingPayload('301', payload);
      expect(res.isValid).toBe(true);
    });

    test('validateMovementPostingPayload: 301 rejects same plant or missing receiving sloc', () => {
      const payload = {
        ReservationNo: '519944',
        ReservationItem: '0001',
        Plant: '1120',
        StorageLocation: 'CS01',
        ReceivingPlant: '1120',
        IssueQty: 10,
        Unit: 'EA'
      };
      const res = validateMovementPostingPayload('301', payload);
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
      expect(res.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
    });

    test('validateMovementPostingPayload: 311 valid payload passes', () => {
      const payload = {
        ReservationNo: '519944',
        ReservationItem: '0001',
        Plant: '1120',
        StorageLocation: 'CS01',
        ReceivingStorageLocation: 'CS02',
        Material: 'MAT01',
        IssueQty: 10,
        Unit: 'EA'
      };
      const res = validateMovementPostingPayload('311', payload);
      expect(res.isValid).toBe(true);
    });

    test('validateMovementPostingPayload: 311 rejects same sloc or different plant', () => {
      const payload = {
        ReservationNo: '519944',
        ReservationItem: '0001',
        Plant: '1120',
        StorageLocation: 'CS01',
        ReceivingPlant: '1130',
        ReceivingStorageLocation: 'CS01',
        Material: 'MAT01',
        IssueQty: 10,
        Unit: 'EA'
      };
      const res = validateMovementPostingPayload('311', payload);
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
      expect(res.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
    });

    test('validateMovementPostingPayload: rejects unsupported or non-postable movement type', () => {
      const res241 = validateMovementPostingPayload('241', validBase201);
      expect(res241.isValid).toBe(false);
      expect(res241.message).toContain('not a supported Goods Issue posting type');

      const res999 = validateMovementPostingPayload('999', validBase201);
      expect(res999.isValid).toBe(false);
      expect(res999.message).toContain('Unsupported movement type');
    });

    test('validateMovementDestination: delegates to centralized destination rules', () => {
      // 301
      const res301Ok = validateMovementDestination('301', '1120', 'CS01', '1110', 'CS01');
      expect(res301Ok.isValid).toBe(true);
      const res301Same = validateMovementDestination('301', '1120', 'CS01', '1120', 'CS01');
      expect(res301Same.isValid).toBe(false);

      // 311
      const res311Ok = validateMovementDestination('311', '1120', 'CS01', '1120', 'CS02');
      expect(res311Ok.isValid).toBe(true);
      const res311SameSloc = validateMovementDestination('311', '1120', 'CS01', '1120', 'CS01');
      expect(res311SameSloc.isValid).toBe(false);

      // 201 (no destination allowed)
      const res201Dest = validateMovementDestination('201', '1120', 'CS01', '1110', 'CS01');
      expect(res201Dest.isValid).toBe(false);
    });
  });

  describe('8. Canonical Movement 261 Payload Validation (Item 18)', () => {
    test('accepts valid 261 payload with reservation, item, quantity', () => {
      const res = validateMovement261Payload({ reservation: '512851', item: '3', quantity: 200 });
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    test('accepts PascalCase 261 payload (ReservationNo, ReservationItem, IssueQty)', () => {
      const res = validateMovement261Payload({ ReservationNo: '512851', ReservationItem: '0003', IssueQty: 200 });
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    test('rejects missing reservation or item', () => {
      const resNoRes = validateMovement261Payload({ reservation: '', item: '1', quantity: 10 });
      expect(resNoRes.isValid).toBe(false);
      expect(resNoRes.errors[0].message).toBe('Reservation and item are required');

      const resNoItem = validateMovement261Payload({ reservation: '512851', item: '', quantity: 10 });
      expect(resNoItem.isValid).toBe(false);
      expect(resNoItem.errors[0].message).toBe('Reservation and item are required');
    });

    test('rejects zero, negative, or invalid quantity', () => {
      const resZero = validateMovement261Payload({ reservation: '512851', item: '1', quantity: 0 });
      expect(resZero.isValid).toBe(false);
      expect(resZero.errors[0].message).toBe('Quantity must be greater than zero');

      const resNeg = validateMovement261Payload({ reservation: '512851', item: '1', quantity: -5 });
      expect(resNeg.isValid).toBe(false);
      expect(resNeg.errors[0].message).toBe('Quantity must be greater than zero');

      const resNan = validateMovement261Payload({ reservation: '512851', item: '1', quantity: 'abc' });
      expect(resNan.isValid).toBe(false);
      expect(resNan.errors[0].message).toBe('Quantity must be greater than zero');
    });

    test('rejects non-object or null input', () => {
      const resNull = validateMovement261Payload(null);
      expect(resNull.isValid).toBe(false);
      expect(resNull.message).toBe('Request body must be a valid JSON object');
    });

    test('rejects forbidden fields for 261 (CostCenter, AssetNo, ReceivingPlant, GLAccount)', () => {
      const res = validateMovement261Payload({
        reservation: '512851',
        item: '1',
        quantity: 10,
        CostCenter: '1011202902',
        ReceivingPlant: '1110',
        GLAccount: '400000'
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'CostCenter')).toBe(true);
      expect(res.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
      expect(res.errors.some(e => e.field === 'GLAccount')).toBe(true);
    });
  });

  describe('9. Canonical Movement Account Assignment Validation (Item 17/18)', () => {
    test('201 requires CostCenter and rejects GLAccount', () => {
      const valid = validateMovementAccountAssignment('201', { CostCenter: '1011202902' });
      expect(valid.isValid).toBe(true);

      const missing = validateMovementAccountAssignment('201', {});
      expect(missing.isValid).toBe(false);
      expect(missing.errors.some(e => e.field === 'CostCenter')).toBe(true);

      const withGl = validateMovementAccountAssignment('201', { CostCenter: '1011202902', GLAccount: '400000' });
      expect(withGl.isValid).toBe(false);
      expect(withGl.errors.some(e => e.field === 'GLAccount')).toBe(true);
    });

    test('241 requires AssetNo', () => {
      const valid = validateMovementAccountAssignment('241', { AssetNo: 'ASSET01' });
      expect(valid.isValid).toBe(true);

      const missing = validateMovementAccountAssignment('241', {});
      expect(missing.isValid).toBe(false);
      expect(missing.errors.some(e => e.field === 'AssetNo')).toBe(true);
    });

    test('261 requires OrderID and rejects CostCenter or AssetNo', () => {
      const valid = validateMovementAccountAssignment('261', { OrderID: '4000123' });
      expect(valid.isValid).toBe(true);

      const missing = validateMovementAccountAssignment('261', {});
      expect(missing.isValid).toBe(false);
      expect(missing.errors.some(e => e.field === 'OrderID')).toBe(true);

      const withCc = validateMovementAccountAssignment('261', { OrderID: '4000123', CostCenter: 'CC1' });
      expect(withCc.isValid).toBe(false);
      expect(withCc.errors.some(e => e.field === 'CostCenter')).toBe(true);
    });

    test('301/311 rejects any account assignment (CostCenter, AssetNo, GLAccount)', () => {
      const res301 = validateMovementAccountAssignment('301', { CostCenter: 'CC1' });
      expect(res301.isValid).toBe(false);
      expect(res301.errors.some(e => e.field === 'CostCenter')).toBe(true);

      const res311 = validateMovementAccountAssignment('311', { AssetNo: 'ASSET1' });
      expect(res311.isValid).toBe(false);
      expect(res311.errors.some(e => e.field === 'AssetNo')).toBe(true);
    });
  });
});
