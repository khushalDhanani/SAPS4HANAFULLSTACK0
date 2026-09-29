/**
 * Unit tests for the 201 scan-to-complete matching logic (applyScanResolution) - the pass/fail
 * feedback the user sees per scan: matched / wrong material / already-issued (not found in stock) /
 * duplicate / quantity exceeded. Never a silent fill.
 */

const GoodsIssue201Model = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue201Model');

function baseData(overrides) {
  return Object.assign({
    material: '8000009753',
    requiredScanCount: 2,
    scannedUnits: []
  }, overrides || {});
}

describe('GoodsIssue201Model.applyScanResolution', () => {
  test('matched: SU in stock for the expected material is added (unit)', () => {
    const data = baseData();
    const res = GoodsIssue201Model.applyScanResolution(data, { SuExists: true, Material: '8000009753', IsSerialManaged: false, CurrentStock: 1 }, '1000033379');
    expect(res.ok).toBe(true);
    expect(res.state).toBe('Success');
    expect(data.scannedUnits).toHaveLength(1);
    expect(data.scannedUnits[0].barcode).toBe('1000033379');
    expect(data.scannedUnits[0].isSerial).toBe(false);
  });

  test('matched: serial-managed unit captures the determined serial', () => {
    const data = baseData();
    const res = GoodsIssue201Model.applyScanResolution(data, { SuExists: true, Material: '8000009753', IsSerialManaged: true, DeterminedSerial: 'SN-001' }, 'SU9');
    expect(res.ok).toBe(true);
    expect(data.scannedUnits[0].serial).toBe('SN-001');
    expect(data.scannedUnits[0].isSerial).toBe(true);
  });

  test('wrong material: rejected with a clear message, not added', () => {
    const data = baseData();
    const res = GoodsIssue201Model.applyScanResolution(data, { SuExists: true, Material: '9999999999' }, 'X1');
    expect(res.ok).toBe(false);
    expect(res.state).toBe('Error');
    expect(res.text).toMatch(/Wrong material/i);
    expect(data.scannedUnits).toHaveLength(0);
  });

  test('not found / not in stock (already issued): SuExists false surfaces the reason', () => {
    const data = baseData();
    const res = GoodsIssue201Model.applyScanResolution(data, { SuExists: false, SuNotFoundReason: 'Serial already issued (not in unrestricted stock).' }, 'X2');
    expect(res.ok).toBe(false);
    expect(res.state).toBe('Error');
    expect(res.text).toMatch(/already issued/i);
    expect(data.scannedUnits).toHaveLength(0);
  });

  test('duplicate: the same unit scanned twice is rejected', () => {
    const data = baseData();
    GoodsIssue201Model.applyScanResolution(data, { SuExists: true, Material: '8000009753' }, 'SU1');
    const res = GoodsIssue201Model.applyScanResolution(data, { SuExists: true, Material: '8000009753' }, 'SU1');
    expect(res.ok).toBe(false);
    expect(res.state).toBe('Warning');
    expect(res.text).toMatch(/already scanned/i);
    expect(data.scannedUnits).toHaveLength(1);
  });

  test('quantity exceeded: scanning beyond the required count is rejected', () => {
    const data = baseData({ requiredScanCount: 1 });
    GoodsIssue201Model.applyScanResolution(data, { SuExists: true, Material: '8000009753' }, 'SU1');
    const res = GoodsIssue201Model.applyScanResolution(data, { SuExists: true, Material: '8000009753' }, 'SU2');
    expect(res.ok).toBe(false);
    expect(res.state).toBe('Warning');
    expect(res.text).toMatch(/exceeded/i);
    expect(data.scannedUnits).toHaveLength(1);
  });
});
