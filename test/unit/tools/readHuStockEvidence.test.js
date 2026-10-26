'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ALLOWED_RFC_FUNCTIONS,
  createReadOnlyRfcClient,
  assertNoSensitiveEnvironmentValuesInFile
} = require('../../../tools/lib/readOnlyRfcGuard');

describe('read-only HU evidence collector guards', () => {
  test('allows RFC_READ_TABLE only and rejects other function names before the client call', async () => {
    const rawCall = jest.fn().mockResolvedValue({ DATA: [] });
    const rawClient = {
      call: rawCall,
      readTable: function (table, fields) {
        return this.call('RFC_READ_TABLE', { QUERY_TABLE: table, FIELDS: fields });
      }
    };
    const callOrder = [];
    const rfc = createReadOnlyRfcClient(rawClient, { onCall: (name) => callOrder.push(`guard:${name}`) });
    rawCall.mockImplementation((name, _params) => {
      callOrder.push(`client:${name}`);
      return Promise.resolve({ DATA: [] });
    });

    expect(ALLOWED_RFC_FUNCTIONS).toEqual(['RFC_READ_TABLE']);
    await rfc.readTable('DD03L', ['TABNAME']);
    expect(rawCall).toHaveBeenCalledTimes(1);
    expect(rawCall).toHaveBeenCalledWith('RFC_READ_TABLE', {
      QUERY_TABLE: 'DD03L', FIELDS: ['TABNAME']
    });
    expect(callOrder).toEqual(['guard:RFC_READ_TABLE', 'client:RFC_READ_TABLE']);

    expect(() => rfc.call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' })).toThrow(/not allowed/);
    expect(() => rfc.call('RFC_SYSTEM_INFO')).toThrow(/not allowed/);
    expect(() => rfc.session(() => {})).toThrow(/sessions are disabled/);
    expect(rawCall).toHaveBeenCalledTimes(1);
    expect(rfc.getCalledFunctions()).toEqual(['RFC_READ_TABLE']);
  });

  test('scans generated evidence files for SAP user, host, system number, and credential env values', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-evidence-redaction-'));
    const filePath = path.join(directory, 'generated.raw.json');
    const env = {
      S4_USERNAME: 'SAP_USER_REDACTION_SENTINEL',
      S4_PASSWORD: 'SAP_PASSWORD_REDACTION_SENTINEL',
      S4_DESTINATION_URL: 'https://sap-host-redaction-sentinel.example:44300',
      S4_RFC_SYSNR: 'SAP_SYSNR_REDACTION_SENTINEL',
      VCAP_SERVICES: JSON.stringify({ destination: [{ credentials: { clientsecret: 'VCAP_CREDENTIAL_SENTINEL' } }] })
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify({ mode: 'READ-ONLY', rows: [{ LGTYP: 'W01' }] }));
      expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, env)).not.toThrow();

      for (const key of ['S4_USERNAME', 'S4_PASSWORD', 'S4_DESTINATION_URL', 'S4_RFC_SYSNR']) {
        fs.writeFileSync(filePath, JSON.stringify({ rawValue: env[key] }));
        expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, env)).toThrow(/sensitive environment value/);
      }
      fs.writeFileSync(filePath, JSON.stringify({ host: 'sap-host-redaction-sentinel.example' }));
      expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, env)).toThrow(/sensitive environment value/);
      fs.writeFileSync(filePath, JSON.stringify({ credential: 'VCAP_CREDENTIAL_SENTINEL' }));
      expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, env)).toThrow(/sensitive environment value/);

      fs.writeFileSync(filePath, JSON.stringify({ connection: { sysnr: 'hidden' } }));
      expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, env)).toThrow(/forbidden connection metadata/);
      expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, env)).toThrow(expect.objectContaining({ code: 'EVIDENCE_REDACTION_FAILED', keys: ['field:sysnr'] }));

      // Live failure 2026-10-26: ENABLE_DEV_TOKEN_ISSUER=true matched a boolean field. Low-entropy
      // values are not substring-scanned; a real leaked value still names its env key.
      const lowEntropy = { ...env, ENABLE_DEV_TOKEN_ISSUER: 'true', CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1', SHORT_TOKEN: 'ab' };
      fs.writeFileSync(filePath, JSON.stringify({ hasNegativeQuants: true, rowCount: 1, status: 'ab' }));
      expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, lowEntropy)).not.toThrow();
      fs.writeFileSync(filePath, JSON.stringify({ rawValue: env.S4_USERNAME }));
      expect(() => assertNoSensitiveEnvironmentValuesInFile(filePath, lowEntropy)).toThrow(expect.objectContaining({ keys: ['S4_USERNAME'] }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
