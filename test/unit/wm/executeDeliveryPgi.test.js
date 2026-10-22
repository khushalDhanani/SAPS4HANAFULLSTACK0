'use strict';

const {
  parseArgs,
  validateT319A,
  validateLikpStatus,
  validateTransport,
  runPgiFlow
} = require('../../../tools/execute-delivery-pgi');

describe('execute-delivery-pgi CLI & Guard Unit Tests', () => {
  describe('parseArgs', () => {
    test('aborts when --expected-sut is missing', () => {
      expect(() => parseArgs(['node', 'script.js', '--transport', 'DS4K905282']))
        .toThrow('Missing required argument: --expected-sut <SUT> must be specified.');
    });

    test('aborts when --transport is missing', () => {
      expect(() => parseArgs(['node', 'script.js', '--expected-sut', 'E10']))
        .toThrow('Missing required argument: --transport <number> must be specified.');
    });

    test('aborts when both are missing', () => {
      expect(() => parseArgs(['node', 'script.js']))
        .toThrow('Missing required argument: --expected-sut <SUT> must be specified.');
    });

    test('parses --expected-sut and --transport correctly', () => {
      const res = parseArgs(['node', 'script.js', '--expected-sut', 'E10', '--transport', 'DS4K905282']);
      expect(res).toEqual({
        expectedSut: 'E10',
        transport: 'DS4K905282',
        readOnly: false
      });
    });

    test('handles whitespace and extra flags', () => {
      const res = parseArgs(['node', 'script.js', '--read-t319a-only', '--expected-sut', '  E1  ', '--transport', ' DS4K905282 ']);
      expect(res).toEqual({
        expectedSut: 'E1',
        transport: 'DS4K905282',
        readOnly: true
      });
    });
  });

  describe('validateT319A', () => {
    const existingRows = [
      { LGNUM: 'W01', VHART: '0001', LETYP: 'E1' },
      { LGNUM: 'W01', VHART: 'Z003', LETYP: 'E1' }
    ];

    test('aborts when entry for W01 / Z007 is completely missing', () => {
      expect(() => validateT319A(existingRows, 'E10', 'W01', 'Z007'))
        .toThrow("[ABORT] T319A does not contain entry for warehouse 'W01' and packaging material type 'Z007'.");
    });

    test('aborts when LETYP in T319A does not match expected SUT', () => {
      const rowsWithE1 = [
        ...existingRows,
        { LGNUM: 'W01', VHART: 'Z007', LETYP: 'E1' }
      ];
      expect(() => validateT319A(rowsWithE1, 'E10', 'W01', 'Z007'))
        .toThrow("[ABORT] T319A LETYP 'E1' does not match expected SUT 'E10'.");
    });

    test('passes when W01 / Z007 entry matches expected SUT', () => {
      const rowsWithE10 = [
        ...existingRows,
        { LGNUM: 'W01', VHART: 'Z007', LETYP: 'E10' }
      ];
      const entry = validateT319A(rowsWithE10, 'E10', 'W01', 'Z007');
      expect(entry).toEqual({ LGNUM: 'W01', VHART: 'Z007', LETYP: 'E10' });
    });
  });

  describe('validateLikpStatus', () => {
    test('aborts when LIKP-WBSTK is already C (double posting guard)', () => {
      expect(() => validateLikpStatus({ VBELN: '0080000134', WBSTK: 'C', KOSTK: 'C', LVSTK: 'C' }))
        .toThrow("[ABORT] Outbound Delivery 0080000134 is already completely posted (LIKP-WBSTK = 'C'). Aborting to prevent double posting.");
    });

    test('passes when LIKP-WBSTK is A (open for goods issue)', () => {
      expect(() => validateLikpStatus({ VBELN: '0080000134', WBSTK: 'A', KOSTK: 'C', LVSTK: 'C' }))
        .not.toThrow();
    });
  });

  describe('validateTransport', () => {
    test('aborts when transport does not appear in E071 or E071K', () => {
      expect(() => validateTransport([], [], 'DS4K999999'))
        .toThrow("[ABORT] Transport 'DS4K999999' does not appear in E071 or E071K for table/view T319A/V_T319A.");
    });

    test('passes when transport appears in E071 with V_T319A', () => {
      const e071 = [{ TRKORR: 'DS4K905282', OBJECT: 'VDAT', OBJ_NAME: 'V_T319A' }];
      expect(validateTransport(e071, [], 'DS4K905282')).toBe(true);
    });

    test('passes when transport appears in E071K with T319A', () => {
      const e071k = [{ TRKORR: 'DS4K905282', OBJECT: 'TABU', OBJNAME: 'T319A', TABKEY: '220W01Z007' }];
      expect(validateTransport([], e071k, 'DS4K905282')).toBe(true);
    });
  });

  describe('runPgiFlow orchestration with mocks', () => {
    test('executes BAPI once and reads back all verification items', async () => {
      const mockCalls = [];
      const mockRfc = {
        readTable: jest.fn(async (tab, fields, where) => {
          if (tab === 'T319A') {
            return [{ LGNUM: 'W01', VHART: 'Z007', LETYP: 'E10' }];
          }
          if (tab === 'LIKP') {
            return [{ VBELN: '0080000134', WBSTK: 'A', KOSTK: 'C', LVSTK: 'C' }];
          }
          if (tab === 'E071') {
            return [{ TRKORR: 'DS4K905282', OBJECT: 'VDAT', OBJ_NAME: 'V_T319A' }];
          }
          if (tab === 'E071K') {
            return [];
          }
          if (tab === 'VBFA') {
            return [{ VBELV: '0080000134', VBELN: '4900001234', VBTYP_N: 'R' }];
          }
          if (tab === 'MATDOC') {
            return [{ MBLNR: '4900001234', BWART: '241', MENGE: '1.000' }];
          }
          if (tab === 'EQBS') {
            return [{ EQUNR: '000000000010015790', B_WERK: '1120', B_LAGER: 'CS02' }];
          }
          if (tab === 'OBJK') {
            return [{ SERNR: 'MBP00001' }];
          }
          if (tab === 'MARD') {
            return [{ MATNR: '000000008000009754', WERKS: '1120', LGORT: 'CS02', LABST: '9.000' }];
          }
          if (tab === 'LQUA') {
            return [];
          }
          return [];
        }),
        session: jest.fn(async (cb) => {
          const call = jest.fn(async (fm, params) => {
            mockCalls.push({ fm, params });
            if (fm === 'BAPI_OUTB_DELIVERY_CONFIRM_DEC') {
              return { RETURN: [{ TYPE: 'S', ID: 'VL', NUMBER: '001', MESSAGE: 'Delivery updated' }] };
            }
            if (fm === 'BAPI_TRANSACTION_COMMIT') {
              return {};
            }
            return {};
          });
          return await cb(call);
        })
      };

      const result = await runPgiFlow(mockRfc, {
        expectedSut: 'E10',
        transport: 'DS4K905282'
      });

      expect(mockCalls.map(c => c.fm)).toEqual(['BAPI_OUTB_DELIVERY_CONFIRM_DEC', 'BAPI_TRANSACTION_COMMIT']);
      expect(result.matDocNo).toBe('4900001234');
      expect(result.stock).toBe(9);
    });
  });
});
