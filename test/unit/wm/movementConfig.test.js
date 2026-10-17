'use strict';

const {
  MOVEMENT_CONFIG,
  SUPPORTED_MOVEMENT_TYPES,
  getMovementConfig,
  resolveWmMovement,
  validateReservationInput
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
});
