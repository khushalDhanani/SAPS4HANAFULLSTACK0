'use strict';

const { analyzeAuditReport } = require('../../../tools/scan-dependencies');

describe('Release Automation: Dependency Scanner Unit Tests', () => {
  it('passes when zero critical vulnerabilities are present', () => {
    const report = {
      metadata: {
        vulnerabilities: {
          total: 5,
          critical: 0,
          high: 3,
          moderate: 2,
          low: 0
        }
      }
    };
    const res = analyzeAuditReport(report);
    expect(res.ok).toBe(true);
    expect(res.critical).toBe(0);
    expect(res.message).toContain('passed critical severity release gate');
  });

  it('fails release gate when critical vulnerabilities are found', () => {
    const report = {
      metadata: {
        vulnerabilities: {
          total: 6,
          critical: 1,
          high: 3,
          moderate: 2,
          low: 0
        }
      }
    };
    const res = analyzeAuditReport(report);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Blocked by release gate: 1 critical vulnerability');
  });
});
