const { enrichBatchStatus } = require('../../../srv/common/batchUtils');

describe('Unit: batchUtils (enrichBatchStatus)', () => {
  it('should return None / NO SLED for null, undefined, or empty expiry date', () => {
    const resNull = enrichBatchStatus(null);
    expect(resNull).toEqual({ StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: 9999 });

    const resUndef = enrichBatchStatus(undefined);
    expect(resUndef).toEqual({ StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: 9999 });

    const resEmpty = enrichBatchStatus('');
    expect(resEmpty).toEqual({ StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: 9999 });
  });

  it('should return None / NO SLED for invalid date strings', () => {
    const res = enrichBatchStatus('not-a-valid-date');
    expect(res).toEqual({ StatusState: 'None', StatusText: 'NO SLED', DaysToExpiry: 9999 });
  });

  it('should classify past expiry date as Error / EXPIRED', () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const res = enrichBatchStatus(past);
    expect(res.StatusState).toBe('Error');
    expect(res.StatusText).toBe('EXPIRED');
    expect(res.DaysToExpiry).toBeLessThan(0);
  });

  it('should classify expiry within 30 days as Warning / EXPIRING SOON', () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const res = enrichBatchStatus(soon);
    expect(res.StatusState).toBe('Warning');
    expect(res.StatusText).toBe('EXPIRING SOON');
    expect(res.DaysToExpiry).toBeGreaterThanOrEqual(0);
    expect(res.DaysToExpiry).toBeLessThanOrEqual(30);
  });

  it('should classify expiry beyond 30 days as Success / VALID', () => {
    const far = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString();
    const res = enrichBatchStatus(far);
    expect(res.StatusState).toBe('Success');
    expect(res.StatusText).toBe('VALID');
    expect(res.DaysToExpiry).toBeGreaterThan(30);
  });

  it('should parse OData /Date(ms)/ timestamps correctly', () => {
    const farMs = Date.now() + 60 * 24 * 60 * 60 * 1000;
    const res = enrichBatchStatus(`/Date(${farMs})/`);
    expect(res.StatusState).toBe('Success');
    expect(res.StatusText).toBe('VALID');
  });

  it('should accept Date instances', () => {
    const farDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const res = enrichBatchStatus(farDate);
    expect(res.StatusState).toBe('Success');
    expect(res.StatusText).toBe('VALID');
  });
});
