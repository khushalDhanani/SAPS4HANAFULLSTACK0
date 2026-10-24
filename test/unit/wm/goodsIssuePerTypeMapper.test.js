/**
 * Unit tests for the ISOLATED per-movement-type S/4HANA mappers.
 * Proves each mapper emits only its own type's fields and no cross-type leakage.
 */

const M201 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue201Mapper');
const M261 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue261Mapper');
const M301 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue301Mapper');
const M311 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue311Mapper');

const base = { IssueQty: 1, Unit: 'KG', Plant: '1130', StorageLocation: 'CS02', PostingDate: '2026-09-29', DocumentDate: '2026-09-29', OrderType: 'ZP01' };
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
  const p = M261.mapToMaterialDocumentPayload({
    ...base, MovementType: '261', Material: '1000001001', ReservationNo: '512851',
    ReservationItem: '3', OrderNo: '1002707', ReferenceDocument: 'GI261TEST'
  });
  test('emits exactly movement 261 with its reservation and manufacturing order', () => {
    expect(p.GoodsMovementCode).toBe('03');
    expect(p.ReferenceDocument).toBe('GI261TEST');
    expect(item(p)).toMatchObject({
      GoodsMovementType: '261', Reservation: '512851', ReservationItem: '0003', ManufacturingOrder: '000001002707'
    });
    expect(item(p).CostCenter).toBeUndefined();
    expect(item(p).IssuingOrReceivingPlant).toBeUndefined();
  });

  test.each([undefined, '', '201', '241', '301', '311'])('rejects movement type %s before producing a SAP payload', (MovementType) => {
    expect(() => M261.mapToMaterialDocumentPayload({
      ...base, MovementType, Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123'
    })).toThrow();
  });

  test('rejects a 201 cost-center field', () => {
    expect(() => M261.mapToMaterialDocumentPayload({
      ...base, MovementType: '261', Material: 'M1', ReservationNo: '1', ReservationItem: '1', OrderNo: '123', CostCenter: 'CC1'
    })).toThrow(/Cost Center is not allowed/);
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

test.each([
  ['201', M201, { CostCenter: '1011202902' }],
  ['301', M301, { ReceivingPlant: '1120', ReceivingStorageLocation: 'CS01' }],
  ['311', M311, { ReceivingStorageLocation: 'CS01' }]
])('%s mapper puts the idempotency ReferenceDocument on the header (max 16 chars) and omits it when absent', (type, M, extra) => {
  const data = { ...base, ...extra, Material: '1000000980' };
  expect(M.mapToMaterialDocumentPayload({ ...data, ReferenceDocument: 'GI345678901234567890' }).ReferenceDocument).toBe('GI34567890123456');
  expect(M.mapToMaterialDocumentPayload(data).ReferenceDocument).toBeUndefined();
});

test('serial numbers deep-insert is emitted', () => {
  const p = M201.mapToMaterialDocumentPayload({ ...base, CostCenter: 'CC1', Material: 'M1', SerialNumbers: ['SN1', 'SN2'], IssueQty: 2 });
  expect(item(p).to_SerialNumbers.results).toEqual([{ SerialNumber: 'SN1' }, { SerialNumber: 'SN2' }]);
});
