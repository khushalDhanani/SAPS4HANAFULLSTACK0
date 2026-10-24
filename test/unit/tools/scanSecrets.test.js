const { verifyGitignore, SECRET_RULES } = require('../../../tools/scan-secrets');

describe('Release Automation: Secret Scanner Unit Tests', () => {
  it('validates that .gitignore contains necessary environment secret rules', () => {
    const res = verifyGitignore();
    expect(res.ok).toBe(true);
  });

  it('detects private key blocks in scanned text', () => {
    const privateKeyRule = SECRET_RULES.find((r) => r.name === 'Private Key Block');
    expect(privateKeyRule).toBeDefined();
    expect(privateKeyRule.regex.test('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...')).toBe(true);
    expect(privateKeyRule.regex.test('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(privateKeyRule.regex.test('const normalString = "hello";')).toBe(false);
  });

  it('detects AWS access key IDs in scanned text', () => {
    const awsRule = SECRET_RULES.find((r) => r.name === 'AWS Access Key ID');
    expect(awsRule).toBeDefined();
    expect(awsRule.regex.test('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(awsRule.regex.test('AKIA1234567890ABCDEF')).toBe(true);
    expect(awsRule.regex.test('normalTextWithoutKeys')).toBe(false);
  });

  it('detects hardcoded S/4 passwords in production code', () => {
    const pwdRule = SECRET_RULES.find((r) => r.name.includes('Hardcoded S/4HANA Password'));
    expect(pwdRule).toBeDefined();
    expect(pwdRule.regex.test('S4_PASSWORD = "supersecretpassword123"')).toBe(true);
    expect(pwdRule.regex.test('S4HANA_PASSWORD: "anothersecretvalue"')).toBe(true);
    expect(pwdRule.regex.test('S4HANA_PASSWORD: "${S4HANA_PASSWORD}"')).toBe(false);
  });
});
