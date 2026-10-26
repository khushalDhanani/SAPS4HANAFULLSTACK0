'use strict';

const { analyzeAuditReport, loadAllowlist } = require('../../../tools/scan-dependencies');

const TODAY = '2026-10-26';

function reportWith({ critical = 0, high = [] }) {
  const vulnerabilities = {};
  high.forEach((name) => { vulnerabilities[name] = { name, severity: 'high' }; });
  return {
    vulnerabilities,
    metadata: {
      vulnerabilities: { total: critical + high.length + 2, critical, high: high.length, moderate: 2, low: 0 }
    }
  };
}

const entry = (pkg, expires = '2026-12-31') => ({ package: pkg, severity: 'high', reason: 'reviewed', expires });

describe('Release Automation: Dependency Scanner Unit Tests', () => {
  it('passes when there are no critical or high vulnerabilities', () => {
    const res = analyzeAuditReport(reportWith({}), 'Root', { allowlist: [], today: TODAY });
    expect(res.ok).toBe(true);
    expect(res.critical).toBe(0);
    expect(res.message).toContain('passed critical/high severity release gate');
  });

  it('fails release gate when critical vulnerabilities are found', () => {
    const res = analyzeAuditReport(reportWith({ critical: 1, high: ['a'] }), 'Root', { allowlist: [entry('a')], today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Blocked by release gate: 1 critical vulnerability');
  });

  it('fails release gate when a high vulnerability is not allowlisted', () => {
    const res = analyzeAuditReport(reportWith({ high: ['a', 'b'] }), 'Root', { allowlist: [entry('a')], today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('1 high vulnerability/vulnerabilities not allowlisted or allowlist entry expired: b.');
  });

  it('passes when every high vulnerability has an active allowlist entry', () => {
    const res = analyzeAuditReport(reportWith({ high: ['a', 'b'] }), 'Root', { allowlist: [entry('a'), entry('b', TODAY)], today: TODAY });
    expect(res.ok).toBe(true);
    expect(res.allowlisted).toEqual(['a', 'b']);
  });

  it('fails release gate when the allowlist entry has expired', () => {
    const res = analyzeAuditReport(reportWith({ high: ['a'] }), 'Root', { allowlist: [entry('a', '2026-10-25')], today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(': a.');
  });

  it('ignores allowlist entries without a reason or with a non-high severity', () => {
    const allowlist = [{ package: 'a', severity: 'high', expires: '2026-12-31' }, { ...entry('b'), severity: 'critical' }];
    const res = analyzeAuditReport(reportWith({ high: ['a', 'b'] }), 'Root', { allowlist, today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(': a, b.');
  });

  it('fails release gate when high findings are reported without package details', () => {
    const report = { metadata: { vulnerabilities: { total: 3, critical: 0, high: 3, moderate: 0, low: 0 } } };
    const res = analyzeAuditReport(report, 'Root', { allowlist: [entry('a')], today: TODAY });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('without package details');
  });

  it('ships a well-formed allowlist: unique high-only entries, each with a reason and a valid expiry', () => {
    const entries = loadAllowlist();
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((e) => {
      expect(e.severity).toBe('high');
      expect(e.reason).toEqual(expect.any(String));
      expect(e.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(new Set(entries.map((e) => e.package)).size).toBe(entries.length);
  });
});
