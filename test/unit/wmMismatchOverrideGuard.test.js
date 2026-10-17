'use strict';

const { assertMismatchOverrideAllowed, isMismatchOverrideEnabled } = require('../../srv/common/wmMismatchOverrideGuard');

describe('WM mismatched TR startup override guard', () => {
  test('allows the override in sandbox', () => {
    expect(isMismatchOverrideEnabled({
      WM_ALLOW_MISMATCHED_TR: 'true',
      SAP_SYSTEM_TYPE: 'sandbox'
    })).toBe(true);
  });

  test('trims and normalizes SAP_SYSTEM_TYPE before allowing sandbox', () => {
    expect(isMismatchOverrideEnabled({
      WM_ALLOW_MISMATCHED_TR: 'true',
      SAP_SYSTEM_TYPE: '  SaNdBoX  '
    })).toBe(true);
  });

  test.each([undefined, '', 'dev', 'qas', 'prod'])('refuses the override when SAP_SYSTEM_TYPE is %s', (systemType) => {
    expect(() => assertMismatchOverrideAllowed({
      WM_ALLOW_MISMATCHED_TR: 'true',
      ...(systemType === undefined ? {} : { SAP_SYSTEM_TYPE: systemType })
    })).toThrow('WM_ALLOW_MISMATCHED_TR=true requires SAP_SYSTEM_TYPE=sandbox');
  });

  test('treats an unset override as false', () => {
    expect(isMismatchOverrideEnabled({ SAP_SYSTEM_TYPE: 'dev' })).toBe(false);
  });
});
