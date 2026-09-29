/**
 * Unit tests for the ISOLATED per-movement-type S/4HANA mappers.
 * Proves each mapper emits only its own type's fields and no cross-type leakage.
 */

const M201 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue201Mapper');
const M261 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue261Mapper');
const M301 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue301Mapper');
const M311 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue311Mapper');

const base = { IssueQty: 1, Unit: 'KG', Plant: '1130', StorageLocation: 'CS02', PostingDate: '2026-09-29', DocumentDate: '2026-09-29' };
const item = (p) => p.to_MaterialDocumentItem.results[0];

describe('201 mapper', () => {
  const p = M201.mapToMaterialDocumentPayload({ ...base, CostCenter: '1011202902', Material: '1000000980', GLAccount: '400000' });
  test('GoodsMovementCode 03, type 201', () => {
    expect(p.GoodsMovementCode).toBe('03');
    expect(item(p).GoodsMovementType).toBe('201');
  });
  test('sets CostCenter, never forwards GLAccount, no receiving', () => {
    expect(item(p).CostCenter).toBe('1011202902');
    expect(item(p).GLAccount).toBeUndefined();
    expect(item(p).IssuingOrReceivingPlant).toBeUndefined();
  });
});

describe('261 mapper', () => {
  const p = M261.mapToMaterialDocumentPayload({ ...base, Material: '1000001002', ReservationNo: '518023', ReservationItem: '0001', Batch: 'IN26091921' });
  test('GoodsMovementCode 03, type 261, reservation linked, no cost center/receiving', () => {
    expect(p.GoodsMovementCode).toBe('03');
    expect(item(p).GoodsMovementType).toBe('261');
    expect(item(p).Reservation).toBe('518023');
    expect(item(p).Batch).toBe('IN26091921');
    expect(item(p).CostCenter).toBeUndefined();
    expect(item(p).IssuingOrReceivingPlant).toBeUndefined();
  });
});

describe.each([
  ['301', M301, '04'],
  ['311', M311, '04']
])('%s mapper', (type, M, gm) => {
  const p = M.mapToMaterialDocumentPayload({ ...base, Material: '1000001003', ReservationNo: '519944', ReservationItem: '0001', ReceivingPlant: '1600', ReceivingStorageLocation: 'CS02' });
  test(`GoodsMovementCode ${gm}, type ${type}, receiving set, no cost center`, () => {
    expect(p.GoodsMovementCode).toBe(gm);
    expect(item(p).GoodsMovementType).toBe(type);
    expect(item(p).IssuingOrReceivingPlant).toBe('1600');
    expect(item(p).IssuingOrReceivingStorageLoc).toBe('CS02');
    expect(item(p).CostCenter).toBeUndefined();
  });
});

test('serial numbers deep-insert is emitted', () => {
  const p = M201.mapToMaterialDocumentPayload({ ...base, CostCenter: 'CC1', Material: 'M1', SerialNumbers: ['SN1', 'SN2'], IssueQty: 2 });
  expect(item(p).to_SerialNumbers.results).toEqual([{ SerialNumber: 'SN1' }, { SerialNumber: 'SN2' }]);
});
