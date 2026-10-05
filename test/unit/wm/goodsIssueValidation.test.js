const {
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
