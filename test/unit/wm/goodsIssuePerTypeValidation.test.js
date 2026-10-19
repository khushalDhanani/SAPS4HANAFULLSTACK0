/**
 * Unit tests for the ISOLATED per-movement-type Goods Issue validators.
 * Proves each type enforces only its own rules and does not share type logic.
 * Covers canonical Movement 301 destination validation & SAP verification.
 */

const {
  validateGoodsIssue301Payload,
  verifyGoodsIssue301InSap,
  verifyReceivingLocationInSap
} = require('../../../srv/wm/goods-issue/validation/goodsIssue301.validation');
const { validateGoodsIssue201Payload } = require('../../../srv/wm/goods-issue/validation/goodsIssue201.validation');
const {
  validateGoodsIssue311Payload,
  verifyGoodsIssue311InSap
} = require('../../../srv/wm/goods-issue/validation/goodsIssue311.validation');
const { validateGoodsIssue261Payload } = require('../../../srv/wm/goods-issue/validation/goodsIssue261.validation');

const base = { IssueQty: 1, Unit: 'EA', PostingDate: '2026-09-29', DocumentDate: '2026-09-29' };
const valid301Destination = { ReceivingPlant: '1110', ReceivingStorageLocation: 'CS01' };

describe('201 validation (Cost Center)', () => {
  test('valid 201 payload passes', () => {
    const r = validateGoodsIssue201Payload({ ...base, CostCenter: '1011202902', Material: '1000000980', Plant: '1130', StorageLocation: 'CS01' });
    expect(r.isValid).toBe(true);
  });
  test('missing Cost Center fails', () => {
    const r = validateGoodsIssue201Payload({ ...base, Material: 'M1', Plant: '1130', StorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'CostCenter')).toBe(true);
  });
  test('supplied GLAccount is rejected', () => {
    const r = validateGoodsIssue201Payload({ ...base, CostCenter: 'CC1', Material: 'M1', Plant: '1130', StorageLocation: 'CS01', GLAccount: '400000' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'GLAccount')).toBe(true);
  });
  test('does NOT require a reservation (201 isolation)', () => {
    const r = validateGoodsIssue201Payload({ ...base, CostCenter: 'CC1', Material: 'M1', Plant: '1130', StorageLocation: 'CS01' });
    expect(r.errors.some(e => e.field === 'ReservationNo')).toBe(false);
  });
});

describe('301 validation (Plant-to-Plant Transfer)', () => {
  const resv = { ReservationNo: '519944', ReservationItem: '0001', Plant: '1120', StorageLocation: 'CS01' };

  test('valid 301 payload with reservation, receiving plant and receiving SLoc passes', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ...valid301Destination });
    expect(r.isValid).toBe(true);
  });

  test('301 requires a reservation', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...valid301Destination });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReservationNo')).toBe(true);
  });

  // Requirement 2: Receiving Plant = REQUIRED (missing, empty, whitespace, invalid plant, same as issuing plant)
  test('301 rejects missing ReceivingPlant', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingStorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /mandatory|required/i.test(e.message))).toBe(true);
  });

  test('301 rejects empty ReceivingPlant', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '', ReceivingStorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /mandatory|required/i.test(e.message))).toBe(true);
  });

  test('301 rejects whitespace ReceivingPlant', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '   ', ReceivingStorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /mandatory|required/i.test(e.message))).toBe(true);
  });

  test('301 rejects invalid plant format (< 4 chars)', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: 'XX', ReceivingStorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /4 alphanumeric characters/i.test(e.message))).toBe(true);
  });

  test('301 rejects invalid plant format (> 4 chars or symbols)', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '11200', ReceivingStorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /4 alphanumeric characters/i.test(e.message))).toBe(true);
  });

  test('301 rejects receiving plant same as issuing plant', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '1120', ReceivingStorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /must be different|must differ/i.test(e.message))).toBe(true);
  });

  // Requirement 3: Receiving Storage Location = REQUIRED (missing, empty, whitespace, invalid storage location)
  test('301 rejects missing ReceivingStorageLocation', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '1110' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation' && /mandatory|required/i.test(e.message))).toBe(true);
  });

  test('301 rejects empty ReceivingStorageLocation', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '1110', ReceivingStorageLocation: '' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation' && /mandatory|required/i.test(e.message))).toBe(true);
  });

  test('301 rejects whitespace ReceivingStorageLocation', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '1110', ReceivingStorageLocation: '   ' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation' && /mandatory|required/i.test(e.message))).toBe(true);
  });

  test('301 rejects invalid ReceivingStorageLocation format', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '1110', ReceivingStorageLocation: 'SL' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation' && /4 alphanumeric characters/i.test(e.message))).toBe(true);
  });

  test('301 does NOT enforce a Cost Center rule (isolation)', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ...valid301Destination });
    expect(r.errors.some(e => e.field === 'CostCenter')).toBe(false);
  });
});

describe('301 SAP verification (ReceivingPlant + ReceivingStorageLocation in SAP)', () => {
  test('verifyGoodsIssue301InSap returns valid when T001L and MARC/MARD records exist', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table) => {
        if (table === 'T001L') return [{ WERKS: '1110', LGORT: 'CS01' }];
        if (table === 'MARC') return [{ MATNR: '000000000000000100', WERKS: '1110' }];
        if (table === 'MARD') return [{ MATNR: '000000000000000100', WERKS: '1110', LGORT: 'CS01', LABST: '50.000' }];
        return [];
      })
    };
    const result = await verifyGoodsIssue301InSap(mockRfc, {
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS01',
      Material: '100'
    });
    expect(result.valid).toBe(true);
    expect(result.initialDestStock).toBe(50);
  });

  test('verifyGoodsIssue301InSap rejects when Receiving Storage Location does not exist in plant (T001L)', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table) => {
        if (table === 'T001L') return [];
        return [];
      })
    };
    const result = await verifyGoodsIssue301InSap(mockRfc, {
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS99',
      checkT001L: true
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Receiving Storage Location CS99 does not exist in plant 1110 (T001L)');
  });

  test('verifyGoodsIssue301InSap rejects when Material is not extended to Receiving Plant (MARC)', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table) => {
        if (table === 'MARC') return [];
        return [];
      })
    };
    const result = await verifyGoodsIssue301InSap(mockRfc, {
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS01',
      Material: 'MAT999'
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Material MAT999 is not extended to receiving plant 1110 (MARC)');
  });

  test('verifyGoodsIssue301InSap rejects when Material is not extended to Receiving Storage Location (MARD)', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table) => {
        if (table === 'MARC') return [{ WERKS: '1110' }];
        if (table === 'MARD') return [];
        return [];
      })
    };
    const result = await verifyGoodsIssue301InSap(mockRfc, {
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS01',
      Material: 'MAT100'
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Material MAT100 is not extended to receiving storage location CS01 in plant 1110 (MARD)');
  });

  test('gracefully returns valid when RFC client is not available (offline unit test)', async () => {
    const result = await verifyGoodsIssue301InSap(null, {
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS01'
    });
    expect(result.valid).toBe(true);
  });

  test('verifyReceivingLocationInSap directly verifies location in SAP', async () => {
    const mockRfc = {
      readTable: jest.fn().mockResolvedValue([{ WERKS: '1110', LGORT: 'CS01' }])
    };
    const res = await verifyReceivingLocationInSap(mockRfc, {
      receivingPlant: '1110',
      receivingStorageLocation: 'CS01'
    });
    expect(res.valid).toBe(true);
  });
});

describe('311 validation (Transfer)', () => {
  test('valid 311 payload with reservation and receiving storage location passes', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: 'CS02' });
    expect(r.isValid).toBe(true);
  });
  test('311 requires a reservation', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReceivingStorageLocation: 'CS02' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReservationNo')).toBe(true);
  });
  test('311 rejects missing ReceivingStorageLocation', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
  });
  test('311 rejects empty ReceivingStorageLocation', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: '' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
  });
  test('311 rejects whitespace ReceivingStorageLocation', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: '   ' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
  });
  test('311 rejects invalid ReceivingStorageLocation format (< 4 chars)', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: 'C1' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
  });
  test('311 rejects invalid ReceivingStorageLocation format (> 4 chars or symbols)', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: 'CS-01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
  });
  test('311 receiving plant is optional (absent is valid)', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: 'CS02' });
    expect(r.isValid).toBe(true);
    expect(r.errors.some(e => e.field === 'ReceivingPlant')).toBe(false);
  });
  test('311 malformed receiving plant is rejected', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: 'CS02', ReceivingPlant: 'XX' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
  });
  test('311 does NOT enforce a Cost Center rule (isolation)', () => {
    const r = validateGoodsIssue311Payload({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingStorageLocation: 'CS02' });
    expect(r.errors.some(e => e.field === 'CostCenter')).toBe(false);
  });
});

describe('311 destination invariant (intra-plant storage-location transfer)', () => {
  const resv = { ReservationNo: '519944', ReservationItem: '0001', Plant: '1120', StorageLocation: 'CS01' };
  test('rejects a receiving plant different from the issuing plant', () => {
    const r = validateGoodsIssue311Payload({ ...base, ...resv, ReceivingPlant: '1130', ReceivingStorageLocation: 'CS02' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /must match|must equal/i.test(e.message))).toBe(true);
  });
  test('rejects a receiving storage location equal to the issuing one', () => {
    const r = validateGoodsIssue311Payload({ ...base, ...resv, ReceivingStorageLocation: 'CS01' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(true);
  });
  test('accepts same-plant, different storage location', () => {
    const r = validateGoodsIssue311Payload({ ...base, ...resv, ReceivingPlant: '1120', ReceivingStorageLocation: 'CS02' });
    expect(r.isValid).toBe(true);
  });
});

describe('311 SAP destination verification (T320, T001L, MARD)', () => {
  const payload311 = {
    Plant: '1120',
    StorageLocation: 'CS01',
    ReceivingStorageLocation: 'CS02',
    Material: 'MAT100'
  };

  test('passes when receiving SLoc is assigned to same warehouse in T320', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table, fields, where = []) => {
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (table === 'T320') {
          if (whereStr.includes("LGORT = 'CS02'")) return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
          return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        }
        if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02' }];
        if (table === 'MARD') return [{ WERKS: '1120', LGORT: 'CS02', LABST: '25.000' }];
        return [];
      })
    };
    const res = await verifyGoodsIssue311InSap(mockRfc, payload311);
    expect(res.valid).toBe(true);
    expect(res.initialDestStock).toBe(25);
  });

  test('rejects when receiving SLoc belongs to different warehouse in T320', async () => {
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
    const res = await verifyGoodsIssue311InSap(mockRfc, payload311);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('belongs to warehouse W10, but issuing storage location belongs to warehouse W01');
  });

  test('supports non-WM receiving SLoc when not mapped in T320', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table, fields, where = []) => {
        const whereStr = Array.isArray(where) ? where.join(' ') : String(where);
        if (table === 'T320') {
          if (whereStr.includes("LGORT = 'CS02'")) return []; // non-WM
          return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
        }
        if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02' }];
        if (table === 'MARD') return [{ WERKS: '1120', LGORT: 'CS02', LABST: '0.000' }];
        return [];
      })
    };
    const res = await verifyGoodsIssue311InSap(mockRfc, payload311);
    expect(res.valid).toBe(true);
  });

  test('rejects when receiving SLoc does not exist in plant (T001L)', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
        if (table === 'MARD') return [{ WERKS: '1120', LGORT: 'CS02', LABST: '10.000' }];
        if (table === 'T001L') return []; // SLoc not found in plant
        return [];
      })
    };
    const res = await verifyGoodsIssue311InSap(mockRfc, payload311);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Receiving Storage Location CS02 does not exist in plant 1120 (T001L)');
  });

  test('rejects when material is not extended to receiving SLoc in plant (MARD)', async () => {
    const mockRfc = {
      readTable: jest.fn().mockImplementation(async (table) => {
        if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }];
        if (table === 'T001L') return [{ WERKS: '1120', LGORT: 'CS02' }];
        if (table === 'MARD') return []; // Material not extended
        return [];
      })
    };
    const res = await verifyGoodsIssue311InSap(mockRfc, payload311);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Material MAT100 is not extended to receiving storage location CS02 in plant 1120 (MARD)');
  });

  test('gracefully returns valid when RFC client is null (offline unit test)', async () => {
    const res = await verifyGoodsIssue311InSap(null, payload311);
    expect(res.valid).toBe(true);
  });
});

describe('261 validation (Goods Issue to Order)', () => {
  test('valid 261 payload passes', () => {
    const r = validateGoodsIssue261Payload({ reservation: '512851', item: '1', quantity: 50 });
    expect(r.isValid).toBe(true);
  });

  test('valid 261 PascalCase payload passes', () => {
    const r = validateGoodsIssue261Payload({ ReservationNo: '512851', ReservationItem: '0001', IssueQty: 50 });
    expect(r.isValid).toBe(true);
  });

  test('missing reservation or item fails', () => {
    const r = validateGoodsIssue261Payload({ reservation: '', item: '1', quantity: 50 });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'reservation')).toBe(true);
  });

  test('quantity <= 0 fails', () => {
    const r = validateGoodsIssue261Payload({ reservation: '512851', item: '1', quantity: 0 });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'quantity')).toBe(true);
  });

  test('supplied CostCenter or ReceivingPlant is rejected', () => {
    const r = validateGoodsIssue261Payload({ reservation: '512851', item: '1', quantity: 50, CostCenter: 'CC1', ReceivingPlant: '1110' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'CostCenter')).toBe(true);
    expect(r.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
  });
});
