const { formatDateToYMD } = require('../../../srv/common/dateUtils');

describe('Unit: dateUtils (formatDateToYMD)', () => {
  it('should format /Date(epoch)/ format correctly', () => {
    const epoch = 1757376000000;
    const formatted = formatDateToYMD(`/Date(${epoch})/`);
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should format /Date(epoch+tz)/ format correctly', () => {
    const epoch = 1757376000000;
    const formatted = formatDateToYMD(`/Date(${epoch}+0000)/`);
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should format ISO datetime string to YYYY-MM-DD', () => {
    expect(formatDateToYMD('2026-09-08T10:00:00.000Z')).toBe('2026-09-08');
  });

  it('should format Date instance to YYYY-MM-DD', () => {
    const d = new Date('2026-11-15T00:00:00.000Z');
    expect(formatDateToYMD(d)).toBe('2026-11-15');
  });

  it('should format numeric timestamp to YYYY-MM-DD', () => {
    const ts = new Date('2026-05-20T00:00:00.000Z').getTime();
    expect(formatDateToYMD(ts)).toBe('2026-05-20');
  });

  it('should return null by default for null, undefined, or empty string', () => {
    expect(formatDateToYMD(null)).toBeNull();
    expect(formatDateToYMD(undefined)).toBeNull();
    expect(formatDateToYMD('')).toBeNull();
    expect(formatDateToYMD('   ')).toBeNull();
  });

  it('should respect emptyFallback option when provided', () => {
    expect(formatDateToYMD(null, { emptyFallback: '' })).toBe('');
    expect(formatDateToYMD('', { emptyFallback: '' })).toBe('');
    expect(formatDateToYMD(undefined, { emptyFallback: '' })).toBe('');
  });

  it('should return fallback for invalid date strings', () => {
    expect(formatDateToYMD('invalid-date-string')).toBeNull();
    expect(formatDateToYMD('invalid-date-string', { emptyFallback: '' })).toBe('');
  });
});
