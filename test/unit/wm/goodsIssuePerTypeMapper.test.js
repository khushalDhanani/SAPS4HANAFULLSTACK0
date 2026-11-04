/**
 * Unit tests for the ISOLATED per-movement-type S/4HANA mappers.
 * Proves each mapper emits only its own type's fields and no cross-type leakage.
 */

const M261 = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue261Mapper');

const base = { IssueQty: 1, Unit: 'KG', Plant: '1130', StorageLocation: 'CS02', PostingDate: '2026-09-29', DocumentDate: '2026-09-29', OrderType: 'ZP01' };
const item = (p) => p.to_MaterialDocumentItem.results[0];

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


test('261 mapper puts the idempotency ReferenceDocument on the header (max 16 chars) and omits it when absent', () => {
  const M = M261;
  const extra = { MovementType: '261', ReservationNo: '512851', ReservationItem: '3', OrderNo: '1002707' };
  const data = { ...base, ...extra, Material: '1000000980' };
  expect(M.mapToMaterialDocumentPayload({ ...data, ReferenceDocument: 'GI345678901234567890' }).ReferenceDocument).toBe('GI34567890123456');
  expect(M.mapToMaterialDocumentPayload(data).ReferenceDocument).toBeUndefined();
});

test('serial numbers deep-insert is emitted', () => {
  const p = M261.mapToMaterialDocumentPayload({ ...base, ...{ MovementType: '261', ReservationNo: '512851', ReservationItem: '3', OrderNo: '1002707' }, Material: 'M1', SerialNumbers: ['SN1', 'SN2'], IssueQty: 2 });
  expect(item(p).to_SerialNumbers.results).toEqual([{ SerialNumber: 'SN1' }, { SerialNumber: 'SN2' }]);
});
