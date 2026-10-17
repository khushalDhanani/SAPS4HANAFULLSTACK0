/**
 * Unit tests for the ISOLATED per-movement-type Goods Issue validators.
 * Proves each type enforces only its own rules and does not share type logic.
 */

const { validateGoodsIssue201Payload } = require('../../../srv/wm/goods-issue/validation/goodsIssue201.validation');
const { validateGoodsIssue301Payload } = require('../../../srv/wm/goods-issue/validation/goodsIssue301.validation');
const { validateGoodsIssue311Payload } = require('../../../srv/wm/goods-issue/validation/goodsIssue311.validation');

const base = { IssueQty: 1, Unit: 'EA', PostingDate: '2026-09-29', DocumentDate: '2026-09-29' };

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


describe.each([
  ['301', validateGoodsIssue301Payload],
  ['311', validateGoodsIssue311Payload]
])('%s validation (Transfer)', (type, fn) => {
  test(`valid ${type} payload with reservation passes`, () => {
    const r = fn({ ...base, ReservationNo: '519944', ReservationItem: '0001' });
    expect(r.isValid).toBe(true);
  });
  test(`${type} requires a reservation`, () => {
    const r = fn({ ...base });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReservationNo')).toBe(true);
  });
  test(`${type} receiving plant/sloc are optional (absent is valid)`, () => {
    const r = fn({ ...base, ReservationNo: '519944', ReservationItem: '0001' });
    expect(r.isValid).toBe(true);
    expect(r.errors.some(e => e.field === 'ReceivingPlant')).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingStorageLocation')).toBe(false);
  });
  test(`${type} malformed receiving plant is rejected`, () => {
    const r = fn({ ...base, ReservationNo: '519944', ReservationItem: '0001', ReceivingPlant: 'XX' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant')).toBe(true);
  });
  test(`${type} does NOT enforce a Cost Center rule (isolation)`, () => {
    const r = fn({ ...base, ReservationNo: '519944', ReservationItem: '0001' });
    expect(r.errors.some(e => e.field === 'CostCenter')).toBe(false);
  });
});

describe('301 destination invariant (plant-to-plant transfer)', () => {
  const resv = { ReservationNo: '519944', ReservationItem: '0001', Plant: '1120', StorageLocation: 'CS01' };
  test('rejects a receiving plant equal to the issuing plant', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '1120' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /must differ/.test(e.message))).toBe(true);
  });
  test('accepts a receiving plant different from the issuing plant', () => {
    const r = validateGoodsIssue301Payload({ ...base, ...resv, ReceivingPlant: '1130' });
    expect(r.isValid).toBe(true);
  });
});

describe('311 destination invariant (intra-plant storage-location transfer)', () => {
  const resv = { ReservationNo: '519944', ReservationItem: '0001', Plant: '1120', StorageLocation: 'CS01' };
  test('rejects a receiving plant different from the issuing plant', () => {
    const r = validateGoodsIssue311Payload({ ...base, ...resv, ReceivingPlant: '1130' });
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.field === 'ReceivingPlant' && /must equal/.test(e.message))).toBe(true);
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
