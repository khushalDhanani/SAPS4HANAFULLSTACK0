/**
 * Unit tests for the ISOLATED per-movement-type CAP-domain normalizers.
 * Proves each normalizer fills only its own type's exclusive fields and drops the others'.
 */

const { normalizeGoodsIssue201Payload } = require('../../../srv/wm/goods-issue/mapping/goodsIssue201.normalize');
const { normalizeGoodsIssue261Payload } = require('../../../srv/wm/goods-issue/mapping/goodsIssue261.normalize');
const { normalizeGoodsIssue301Payload } = require('../../../srv/wm/goods-issue/mapping/goodsIssue301.normalize');
const { normalizeGoodsIssue311Payload } = require('../../../srv/wm/goods-issue/mapping/goodsIssue311.normalize');

// A payload deliberately carrying EVERY type's exclusive fields, to prove each normalizer keeps
// only its own and zeroes the rest.
const kitchenSink = {
  CostCenter: ' cc100 ', GLAccount: ' 400000 ', OrderNo: ' 1002743 ',
  ReceivingPlant: ' 1600 ', ReceivingStorageLocation: ' cs02 ',
  ReservationNo: ' 519658 ', ReservationItem: ' 1 ',
  Material: ' 8000009753 ', Plant: ' 1120 ', StorageLocation: ' hs01 ',
  IssueQty: ' 2 ', Unit: ' ea ', SerialNumbers: ['  sn001\r\n ', 'sn002', 'sn001']
};

test('201 normalize: keeps CostCenter; drops GLAccount/OrderNo/receiving', () => {
  const n = normalizeGoodsIssue201Payload(kitchenSink, { user: 'U' });
  expect(n.MovementType).toBe('201');
  expect(n.CostCenter).toBe('CC100');
  expect(n.GLAccount).toBe('');
  expect(n.OrderNo).toBe('');
  expect(n.ReceivingPlant).toBe('');
  expect(n.ReceivingStorageLocation).toBe('');
  // common normalization still applies
  expect(n.Material).toBe('8000009753');
  expect(n.Plant).toBe('1120');
  expect(n.StorageLocation).toBe('HS01');
  expect(n.IssueQty).toBe(2);
  expect(n.Unit).toBe('EA');
  expect(n.ReservationItem).toBe('0001');
  expect(n.SerialNumbers).toEqual(['sn001', 'sn002']);
  expect(n.User).toBe('U');
});

test('261 normalize: keeps OrderNo + GLAccount; drops CostCenter/receiving', () => {
  const n = normalizeGoodsIssue261Payload(kitchenSink, { user: 'U' });
  expect(n.MovementType).toBe('261');
  expect(n.OrderNo).toBe('1002743');
  expect(n.GLAccount).toBe('400000');
  expect(n.CostCenter).toBe('');
  expect(n.ReceivingPlant).toBe('');
  expect(n.ReceivingStorageLocation).toBe('');
});

test.each([
  ['301', normalizeGoodsIssue301Payload],
  ['311', normalizeGoodsIssue311Payload]
])('%s normalize: keeps receiving; drops CostCenter/GLAccount/OrderNo', (type, fn) => {
  const n = fn(kitchenSink, { user: 'U' });
  expect(n.MovementType).toBe(type);
  expect(n.ReceivingPlant).toBe('1600');
  expect(n.ReceivingStorageLocation).toBe('CS02');
  expect(n.CostCenter).toBe('');
  expect(n.GLAccount).toBe('');
  expect(n.OrderNo).toBe('');
});
