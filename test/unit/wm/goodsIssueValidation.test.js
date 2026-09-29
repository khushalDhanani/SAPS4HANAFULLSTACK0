const {
  validateGoodsIssuePayload,
  validateReversalPayload,
  isValidCalendarDate
} = require('../../../srv/wm/goods-issue/validation/goodsIssue.validation');

describe('goodsIssue.validation: Movement 201 and Goods Issue Rules', () => {
  describe('isValidCalendarDate', () => {
    it('accepts valid calendar dates', () => {
      expect(isValidCalendarDate('2026-09-29')).toBe(true);
      expect(isValidCalendarDate('2026-02-28')).toBe(true);
      expect(isValidCalendarDate(new Date())).toBe(true);
    });

    it('rejects invalid calendar dates', () => {
      expect(isValidCalendarDate('2026-02-31')).toBe(false);
      expect(isValidCalendarDate('2026-13-01')).toBe(false);
      expect(isValidCalendarDate('invalid-date')).toBe(false);
      expect(isValidCalendarDate('')).toBe(false);
      expect(isValidCalendarDate(null)).toBe(false);
    });
  });

  describe('validateGoodsIssuePayload - Movement 201 (Goods Issue to Cost Center)', () => {
    const valid201Base = {
      MovementType: '201',
      CostCenter: '1011101301',
      Material: '8000009753',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 1,
      Unit: 'EA'
    };

    it('passes for a valid unplanned 201 payload (no reservation)', () => {
      const res = validateGoodsIssuePayload(valid201Base);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('passes for a valid planned 201 payload with reservation', () => {
      const res = validateGoodsIssuePayload({
        ...valid201Base,
        ReservationNo: '519658',
        ReservationItem: '0001'
      });
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects 201 when CostCenter is missing or empty', () => {
      const res1 = validateGoodsIssuePayload({ ...valid201Base, CostCenter: '' });
      expect(res1.isValid).toBe(false);
      expect(res1.errors.some(e => e.field === 'CostCenter')).toBe(true);

      const res2 = validateGoodsIssuePayload({ ...valid201Base, CostCenter: undefined });
      expect(res2.isValid).toBe(false);
      expect(res2.errors.some(e => e.field === 'CostCenter')).toBe(true);
    });

    it('rejects 201 when CostCenter exceeds 10 characters or has invalid characters', () => {
      const res1 = validateGoodsIssuePayload({ ...valid201Base, CostCenter: '12345678901' });
      expect(res1.isValid).toBe(false);
      expect(res1.errors.some(e => e.field === 'CostCenter')).toBe(true);

      const res2 = validateGoodsIssuePayload({ ...valid201Base, CostCenter: 'CC@100' });
      expect(res2.isValid).toBe(false);
      expect(res2.errors.some(e => e.field === 'CostCenter')).toBe(true);
    });

    it('rejects any caller-supplied GLAccount for Movement 201, even a syntactically valid one', () => {
      // G/L account is system-determined via OBYC/GBB-VBR for cost-center consumption; a client
      // must never be able to override it for 201, regardless of format validity.
      const resValidFormat = validateGoodsIssuePayload({ ...valid201Base, GLAccount: '400000' });
      expect(resValidFormat.isValid).toBe(false);
      expect(resValidFormat.errors.some(e => e.field === 'GLAccount')).toBe(true);

      const resInvalidFormat = validateGoodsIssuePayload({ ...valid201Base, GLAccount: 'GL#4000000000' });
      expect(resInvalidFormat.isValid).toBe(false);
      expect(resInvalidFormat.errors.some(e => e.field === 'GLAccount')).toBe(true);
    });

    it('validates optional GLAccount format for movement types other than 201 (e.g. 261)', () => {
      const base261 = { ...valid201Base, MovementType: '261', ReservationNo: '519658', ReservationItem: '0001', CostCenter: undefined };
      const resPass = validateGoodsIssuePayload({ ...base261, GLAccount: '400000' });
      expect(resPass.errors.some(e => e.field === 'GLAccount')).toBe(false);

      const resFail = validateGoodsIssuePayload({ ...base261, GLAccount: 'GL#4000000000' });
      expect(resFail.isValid).toBe(false);
      expect(resFail.errors.some(e => e.field === 'GLAccount')).toBe(true);
    });

    it('rejects unsupported movement types', () => {
      const res = validateGoodsIssuePayload({ ...valid201Base, MovementType: '999' });
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'MovementType')).toBe(true);
    });

    it('requires ReservationNo and ReservationItem for movement types other than 201', () => {
      const res261 = validateGoodsIssuePayload({
        ...valid201Base,
        MovementType: '261',
        ReservationNo: '',
        ReservationItem: ''
      });
      expect(res261.isValid).toBe(false);
      expect(res261.errors.some(e => e.field === 'ReservationNo')).toBe(true);
      expect(res261.errors.some(e => e.field === 'ReservationItem')).toBe(true);
    });
  });

  describe('validateGoodsIssuePayload - Quantity & Master Data Rules', () => {
    const validBase = {
      MovementType: '201',
      CostCenter: '1011101301',
      Material: '8000009753',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 5,
      Unit: 'EA'
    };

    it('rejects non-positive, zero, NaN, or missing quantities', () => {
      expect(validateGoodsIssuePayload({ ...validBase, IssueQty: 0 }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, IssueQty: -1 }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, IssueQty: 'abc' }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, IssueQty: null }).isValid).toBe(false);
    });

    it('rejects quantities with more than 3 decimal places', () => {
      expect(validateGoodsIssuePayload({ ...validBase, IssueQty: 1.1234 }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, IssueQty: 1.123 }).isValid).toBe(true);
    });

    it('rejects missing or invalid Plant / StorageLocation', () => {
      expect(validateGoodsIssuePayload({ ...validBase, Plant: '' }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, Plant: '11' }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, StorageLocation: '' }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, StorageLocation: 'HSO123' }).isValid).toBe(false);
    });

    it('rejects missing or invalid Unit', () => {
      expect(validateGoodsIssuePayload({ ...validBase, Unit: '' }).isValid).toBe(false);
      expect(validateGoodsIssuePayload({ ...validBase, Unit: 'PIECES' }).isValid).toBe(false);
    });
  });

  describe('validateGoodsIssuePayload - Serial Numbers Rules', () => {
    const validBase = {
      MovementType: '201',
      CostCenter: '1011101301',
      Material: '8000009753',
      Plant: '1120',
      StorageLocation: 'HS01',
      IssueQty: 2,
      Unit: 'EA',
      IsSerialManaged: true
    };

    it('rejects serial count mismatch when material is serial managed', () => {
      const res = validateGoodsIssuePayload({
        ...validBase,
        SerialNumbers: ['SN001'] // Qty is 2, but only 1 serial
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.field === 'SerialNumbers')).toBe(true);
    });

    it('rejects duplicate serial numbers in input', () => {
      const res = validateGoodsIssuePayload({
        ...validBase,
        SerialNumbers: ['SN001', 'SN001']
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.message.includes('Duplicate serial numbers'))).toBe(true);
    });

    it('rejects serial numbers exceeding 18 characters', () => {
      const res = validateGoodsIssuePayload({
        ...validBase,
        IssueQty: 1,
        SerialNumbers: ['A_VERY_LONG_SERIAL_EXCEEDING_EIGHTEEN_CHARS']
      });
      expect(res.isValid).toBe(false);
      expect(res.errors.some(e => e.message.includes('exceeds maximum length of 18'))).toBe(true);
    });

    it('accepts valid distinct serial numbers matching quantity', () => {
      const res = validateGoodsIssuePayload({
        ...validBase,
        SerialNumbers: ['MACBOOK-001', 'MACBOOK-002']
      });
      expect(res.isValid).toBe(true);
    });
  });

  describe('validateReversalPayload', () => {
    const validReversal = {
      MaterialDocument: '4900012345',
      MaterialDocYear: '2026',
      PostingDate: '2026-09-29'
    };

    it('passes for a valid reversal payload', () => {
      const res = validateReversalPayload(validReversal);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects missing or invalid MaterialDocument', () => {
      expect(validateReversalPayload({ ...validReversal, MaterialDocument: '' }).isValid).toBe(false);
      expect(validateReversalPayload({ ...validReversal, MaterialDocument: '123456789012' }).isValid).toBe(false);
    });

    it('rejects missing or non-4-digit MaterialDocYear', () => {
      expect(validateReversalPayload({ ...validReversal, MaterialDocYear: '' }).isValid).toBe(false);
      expect(validateReversalPayload({ ...validReversal, MaterialDocYear: '26' }).isValid).toBe(false);
    });

    it('rejects invalid PostingDate in reversal', () => {
      expect(validateReversalPayload({ ...validReversal, PostingDate: '2026-02-31' }).isValid).toBe(false);
    });
  });
});
