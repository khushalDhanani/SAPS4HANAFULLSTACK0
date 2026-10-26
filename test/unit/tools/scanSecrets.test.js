const { verifyGitignore, getTrackedFiles, SECRET_RULES } = require('../../../tools/scan-secrets');

describe('Release Automation: Secret Scanner Unit Tests', () => {
  it('fails closed when git ls-files fails', () => {
    const exec = () => { throw new Error('git: command not found'); };
    expect(() => getTrackedFiles(exec)).toThrow(/git ls-files failed.*git: command not found/);
  });

  it('fails closed when git ls-files returns no scannable files', () => {
    expect(() => getTrackedFiles(() => '')).toThrow(/returned no files to scan/);
    expect(() => getTrackedFiles(() => 'node_modules/x.js\npackage-lock.json\n')).toThrow(/returned no files to scan/);
  });

  it('returns tracked files minus ignored paths', () => {
    expect(getTrackedFiles(() => 'srv/a.js\nnode_modules/b.js\n\ntools/c.js\n')).toEqual(['srv/a.js', 'tools/c.js']);
    expect(getTrackedFiles().length).toBeGreaterThan(0);
  });

  it('validates that .gitignore contains necessary environment secret rules', () => {
    const res = verifyGitignore();
    expect(res.ok).toBe(true);
  });

  it('detects private key blocks in scanned text', () => {
    const privateKeyRule = SECRET_RULES.find((r) => r.name === 'Private Key Block');
    expect(privateKeyRule).toBeDefined();
    const rsaFixture = ['-----BEGIN', 'RSA', 'PRIVATE KEY-----'].join(' ') + '\nMIIEowIBAAKCAQEA...';
    const genericFixture = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
    expect(privateKeyRule.regex.test(rsaFixture)).toBe(true);
    expect(privateKeyRule.regex.test(genericFixture)).toBe(true);
    expect(privateKeyRule.regex.test('const normalString = "hello";')).toBe(false);
  });

  it('detects AWS access key IDs in scanned text', () => {
    const awsRule = SECRET_RULES.find((r) => r.name === 'AWS Access Key ID');
    expect(awsRule).toBeDefined();
    const awsFixture1 = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const awsFixture2 = ['AKIA', '1234567890ABCDEF'].join('');
    expect(awsRule.regex.test(awsFixture1)).toBe(true);
    expect(awsRule.regex.test(awsFixture2)).toBe(true);
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
