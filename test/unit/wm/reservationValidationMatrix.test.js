'use strict';

/**
 * Step 7.3: movement-specific reservation validation driven by MOVEMENT_CONFIG (single source of truth).
 * Positive + negative cases for every movement type (201, 241, 261, 301, 311): missing required fields,
 * forbidden fields, wrong-type fields, plant/SLoc format, quantity/unit, batch, serials.
 */

const { MOVEMENT_CONFIG, validateReservationInput } = require('../../../srv/common/movementConfig');

const base = { Plant: '1120', StorageLocation: 'CS01', Material: '1000000045', Quantity: 2, Unit: 'KG' };
const valid = {
  '201': { ...base, MovementType: '201', CostCenter: '1011201301' },
  '241': { ...base, MovementType: '241', AssetNo: '400092', SubNumber: '0000' },
  '261': { ...base, MovementType: '261', OrderType: 'ZEMP', OrderID: '1011' },
  '301': { ...base, MovementType: '301', ReceivingPlant: '1130', ReceivingStorageLocation: 'ST02' },
  '311': { ...base, MovementType: '311', ReceivingStorageLocation: 'ST02' }
};
// A non-empty sample for every field a type may forbid.
const sample = {
  CostCenter: '1011201301', AssetNo: '400092', SubNumber: '0000', OrderID: '1011', OrderNo: '1011', OrderType: 'ZEMP',
  GLAccount: '400000', ReceivingPlant: '1130', ReceivingStorageLocation: 'ST02'
};
const types = Object.keys(valid);
const run = (d) => validateReservationInput(d);

describe('Step 7.3 reservation validation matrix (MOVEMENT_CONFIG driven)', () => {
  test('matrix covers exactly the five supported movement types', () => {
    expect(types.sort()).toEqual(Object.keys(MOVEMENT_CONFIG).sort());
  });

  describe.each(types)('Movement %s', (mvt) => {
    const cfg = MOVEMENT_CONFIG[mvt];
    const extraRequired = cfg.requiredFields.filter((f) => !['Plant', 'StorageLocation', 'Material', 'Quantity', 'Unit'].includes(f));

    test('positive: canonical payload is valid', () => {
      const res = run(valid[mvt]);
      expect(res.errors).toEqual([]);
      expect(res.isValid).toBe(true);
      expect(res.config).toBe(cfg);
    });

    test('positive: camelCase adapter payload is valid too', () => {
      const camel = Object.fromEntries(Object.entries(valid[mvt]).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]));
      camel.orderId = camel.orderID; delete camel.orderID;
      expect(run(camel).errors).toEqual([]);
    });

    test.each(extraRequired)('negative: missing required field %s', (f) => {
      const res = run({ ...valid[mvt], [f]: '' });
      expect(res.isValid).toBe(false);
      expect(res.errors.join(' | ')).toMatch(new RegExp(`mandatory for Movement Type ${mvt}|must be different`));
    });

    test.each(cfg.forbiddenFields)('negative: forbidden field %s is rejected', (f) => {
      const res = run({ ...valid[mvt], [f]: sample[f] });
      expect(res.isValid).toBe(false);
      expect(res.errors).toEqual([expect.stringMatching(new RegExp(`is not allowed for Movement Type ${mvt}`))]);
    });

    test('negative: every other type\'s account-assignment / destination fields are rejected together', () => {
      const wrong = Object.fromEntries(cfg.forbiddenFields.map((f) => [f, sample[f]]));
      const res = run({ ...valid[mvt], ...wrong });
      expect(res.errors.length).toBe(cfg.forbiddenFields.length);
    });

    test('negative: plant / storage location format', () => {
      expect(run({ ...valid[mvt], Plant: '' }).errors).toContain('Plant is mandatory');
      expect(run({ ...valid[mvt], Plant: '11200' }).errors).toEqual([expect.stringMatching(/Plant '11200' must be exactly 4 alphanumeric/)]);
      expect(run({ ...valid[mvt], StorageLocation: 'CS-1' }).errors).toEqual([expect.stringMatching(/Storage Location 'CS-1' must be exactly 4 alphanumeric/)]);
    });

    test('negative: quantity and unit', () => {
      expect(run({ ...valid[mvt], Quantity: 0 }).errors).toEqual(['Quantity must be greater than 0']);
      expect(run({ ...valid[mvt], Quantity: '1.2345' }).errors).toEqual(['Quantity exceeds maximum precision of 3 decimal places']);
      expect(run({ ...valid[mvt], Unit: '' }).errors).toEqual(['Unit is mandatory']);
      expect(run({ ...valid[mvt], Unit: 'KGMS' }).errors).toEqual([expect.stringMatching(/exceeds maximum length of 3/)]);
    });

    test('batch: optional, alphanumeric up to 10 chars per batchRules', () => {
      expect(run({ ...valid[mvt], Batch: 'IN26001170' }).errors).toEqual([]);
      expect(run({ ...valid[mvt], Batch: 'IN260011701' }).errors).toEqual([expect.stringMatching(/Batch 'IN260011701' must be 1-10 alphanumeric/)]);
      expect(run({ ...valid[mvt], Batch: 'AB 1' }).isValid).toBe(false);
    });

    test('serials: never accepted at reservation creation', () => {
      expect(run({ ...valid[mvt], Serials: ['SN1'] }).errors).toEqual([expect.stringMatching(/Serial numbers are not accepted at reservation creation/)]);
      expect(run({ ...valid[mvt], SerialNo: 'SN1' }).isValid).toBe(false);
      expect(run({ ...valid[mvt], Serials: [] }).isValid).toBe(true);
    });
  });

  test('311: ReceivingPlant allowed only when it equals the issuing plant (policy receivingPlantMustMatch)', () => {
    expect(MOVEMENT_CONFIG['311'].destinationRules.receivingPlantMustMatch).toBe(true);
    expect(run({ ...valid['311'], ReceivingPlant: '1120' }).isValid).toBe(true);
    expect(run({ ...valid['311'], ReceivingPlant: '1130' }).errors).toEqual(['Receiving Plant must match Issuing Plant for Movement Type 311 (SLoc Transfer)']);
    expect(run({ ...valid['311'], ReceivingStorageLocation: 'CS01' }).errors).toEqual(['Receiving Storage Location must be different from Issuing Storage Location']);
  });

  test('301: receiving plant must differ from issuing plant and both receiving fields are required', () => {
    expect(run({ ...valid['301'], ReceivingPlant: '1120' }).errors).toEqual(['Receiving Plant must be different from Issuing Plant']);
    expect(run({ ...valid['301'], ReceivingStorageLocation: '' }).errors).toEqual(['Receiving Storage Location is mandatory for Movement Type 301 (Plant to Plant Transfer)']);
  });

  test('241: AssetNo and SubNumber are both required by policy', () => {
    expect(MOVEMENT_CONFIG['241'].requiredFields).toEqual(expect.arrayContaining(['AssetNo', 'SubNumber']));
    expect(run({ ...valid['241'], SubNumber: '' }).errors).toEqual(['Asset sub-number is mandatory for Movement Type 241 (GI to Asset)']);
  });

  test('261: OrderType and OrderID required, cost center / asset forbidden', () => {
    expect(run({ ...valid['261'], OrderType: '' }).errors).toEqual(['Order Type is mandatory for Movement Type 261 (GI to Order)']);
    expect(run({ ...valid['261'], CostCenter: 'X' }).errors).toEqual(['Cost Center is not allowed for Movement Type 261 (GI to Order)']);
  });

  test('unsupported / missing movement type', () => {
    expect(run({ ...base, MovementType: '999' }).errors[0]).toMatch(/Unsupported movement type '999'/);
    expect(run({ ...base }).errors[0]).toMatch(/MovementType is mandatory/);
  });

  test('throwError option throws the first error with status 400', () => {
    expect(() => validateReservationInput({ ...valid['201'], CostCenter: '' }, { throwError: true }))
      .toThrow(expect.objectContaining({ status: 400, message: 'Cost Center is mandatory for Movement Type 201 (GI to Cost Center)' }));
  });
});
