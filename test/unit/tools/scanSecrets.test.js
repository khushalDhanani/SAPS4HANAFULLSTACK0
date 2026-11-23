const { verifyGitignore, getTrackedFiles, SECRET_RULES, scanFile, localSecretValues, findLocalValues } = require('../../../tools/scan-secrets');

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

  it('accepts only the explicitly allowed environment templates', () => {
    expect(verifyGitignore(() => '.env.example\n.env.docker.local.example\n')).toEqual({ ok: true });
  });

  it.each(['.env', '.env.local', '.env.docker.local', '.env.production', '.env.other.example', '.env.docker.local.example.bak'])(
    'rejects tracked environment file %s alongside allowed templates', (file) => {
      const result = verifyGitignore(() => `.env.example\n.env.docker.local.example\n${file}\n`);
      expect(result.ok).toBe(false);
      expect(result.message).toBe(`FATAL: Sensitive environment file(s) are tracked in git: ${file}`);
    }
  );

  it('keeps allowed templates in the content scan and detects credentials inside them', () => {
    const files = getTrackedFiles(() => '.env.example\n.env.docker.local.example\n');
    expect(files).toEqual(['.env.example', '.env.docker.local.example']);
    const read = jest.spyOn(require('fs'), 'readFileSync').mockReturnValue(Buffer.from('S4_PASSWORD="scanner-test-value"\n'));
    try {
      for (const file of files) {
        expect(scanFile(file)).toEqual(expect.arrayContaining([
          expect.objectContaining({ file, rule: 'Hardcoded S/4HANA Password in non-test file' })
        ]));
      }
    } finally {
      read.mockRestore();
    }
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

  it('detects a password written into a comparison, the form that got past this scanner', () => {
    const rule = SECRET_RULES.find((r) => r.name === 'Hardcoded password comparison');
    expect(rule).toBeDefined();
    expect(rule.regex.test('localTokenUtil.timingSafeEqual(sPass, "not-a-real-value")')).toBe(true);
    expect(rule.regex.test('localTokenUtil.timingSafeEqual(sPass, sEnvDevPass)')).toBe(false);
  });

  it('detects a real name in an SAP user field and accepts the neutral labels', () => {
    const rule = SECRET_RULES.find((r) => r.name === 'Real name in an SAP user field');
    expect(rule).toBeDefined();
    ['"USNAM":"SOMEPERSON"', "ERNAM: 'SOMEPERSON'", 'BNAME = "someperson"'].forEach((v) => expect(rule.regex.test(v)).toBe(true));
    ['"USNAM":"SAP_USER_07"', "ERNAM: 'KHUSHAL'", "USNAM: 'TESTUSER'", 'USNAM: row.USNAM', "['ERNAM', 'ERDAT']"].forEach((v) => expect(rule.regex.test(v)).toBe(false));
  });

  it('detects private network addresses and not public ones', () => {
    const rule = SECRET_RULES.find((r) => r.name === 'Private network address');
    expect(rule).toBeDefined();
    ['10.20.30.40', 'https://172.16.0.5:44300', '172.31.255.1', '192.168.1.1'].forEach((v) => expect(rule.regex.test(v)).toBe(true));
    ['8.8.8.8', '172.15.0.1', '172.32.0.1', 'version 10.1.1', '1.10.20.30.40'].forEach((v) => expect(rule.regex.test(v)).toBe(false));
  });

  describe('real values from the local environment file', () => {
    const SECRET = 'an-example-value-1';

    it('reads secrets and the SAP host, and skips short or missing values', () => {
      const values = localSecretValues(() => `S4_PASSWORD=${SECRET}\nS4_DESTINATION_URL=https://sap.example.test:44300\nLOCAL_DEV_PASSWORD=short\nS4_CLIENT=220\n`);
      expect(values).toEqual(expect.arrayContaining([SECRET, 'sap.example.test']));
      expect(values).not.toContain('short');
      expect(values).not.toContain('220');
      expect(localSecretValues(() => { throw new Error('ENOENT'); })).toEqual([]);
    });

    it('finds a value in any form and never includes it in the finding', () => {
      const findings = findLocalValues('notes.md', `line one\nsomeCall(x, "${SECRET}")\n`, [SECRET]);
      expect(findings).toEqual([expect.objectContaining({ file: 'notes.md', line: 2, rule: 'Value from the local environment file' })]);
      expect(JSON.stringify(findings)).not.toContain(SECRET);
      expect(findLocalValues('notes.md', 'nothing here', [SECRET])).toEqual([]);
    });
  });

  it('the repository has no finding for the new rules and local values', () => {
    const files = getTrackedFiles();
    const local = localSecretValues();
    const found = files.flatMap((f) => scanFile(f, local)).map((x) => `${x.file}:${x.line} ${x.rule}`);
    expect(found).toEqual([]);
  });
});
