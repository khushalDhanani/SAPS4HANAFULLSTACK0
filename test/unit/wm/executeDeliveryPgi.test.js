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

    test('aborts when the only E071 row for the T319A view belongs to another transport', () => {
      const e071 = [{ TRKORR: 'DS4K111111', OBJECT: 'VDAT', OBJ_NAME: 'V_T319A' }];
      expect(() => validateTransport(e071, [], 'DS4K905282')).toThrow("[ABORT] Transport 'DS4K905282' does not appear");
    });

    // Known defect: tools/execute-delivery-pgi.js:89 accepts any VDAT or TABU object in the transport, though its own abort message requires table/view T319A/V_T319A.
    test.failing('aborts when the transport holds a view other than T319A', () => {
      const e071 = [{ TRKORR: 'DS4K905282', OBJECT: 'VDAT', OBJ_NAME: 'V_MARA' }];
      expect(() => validateTransport(e071, [], 'DS4K905282')).toThrow('[ABORT]');
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
    // The SAP rows and BAPI return below are the fixture this test always used; the SAP shape is not proven here.
    const SUT = 'E10';
    const TRANSPORT = 'DS4K905282';
    const goodTables = () => ({
      T319A: [{ LGNUM: 'W01', VHART: 'Z007', LETYP: 'E10' }],
      LIKP: [{ VBELN: '0080000134', WBSTK: 'A', KOSTK: 'C', LVSTK: 'C' }],
      E071: [{ TRKORR: TRANSPORT, OBJECT: 'VDAT', OBJ_NAME: 'V_T319A' }],
      E071K: [],
      VBFA: [{ VBELV: '0080000134', VBELN: '7300000001', VBTYP_N: 'J' }, { VBELV: '0080000134', VBELN: '4900001234', VBTYP_N: 'R' }],
      MATDOC: [{ MBLNR: '4900001234', BWART: '241', MENGE: '1.000' }],
      EQBS: [{ EQUNR: '000000000010015790', B_WERK: '1120', B_LAGER: 'CS02' }],
      OBJK: [{ SERNR: 'MBP00001' }],
      MARD: [{ MATNR: '000000008000009754', WERKS: '1120', LGORT: 'CS02', LABST: '9.000' }],
      LQUA: []
    });
    const rfcDouble = (tables = goodTables(), bapiReturn = [{ TYPE: 'S', ID: 'VL', NUMBER: '001', MESSAGE: 'Delivery updated' }]) => {
      const calls = [];
      return {
        calls,
        rfc: {
          readTable: async (table) => tables[table] || [],
          session: async (fn) => fn(async (fm, params) => {
            calls.push({ fm, params });
            return fm === 'BAPI_OUTB_DELIVERY_CONFIRM_DEC' ? { RETURN: bapiReturn } : {};
          })
        }
      };
    };
    const run = (rfc) => runPgiFlow(rfc, { expectedSut: SUT, transport: TRANSPORT });

    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'table').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    test('calls the delivery BAPI once and then commits with WAIT = X', async () => {
      const { rfc, calls } = rfcDouble();
      await run(rfc);
      expect(calls.map((c) => c.fm)).toEqual(['BAPI_OUTB_DELIVERY_CONFIRM_DEC', 'BAPI_TRANSACTION_COMMIT']);
      expect(calls[1].params).toEqual({ WAIT: 'X' });
    });

    test('sends the delivery number, the post-goods-issue flag and the serial to the BAPI', async () => {
      const { rfc, calls } = rfcDouble();
      await run(rfc);
      expect(calls[0].params).toMatchObject({
        DELIVERY: '0080000134',
        HEADER_CONTROL: { DELIV_NUMB: '0080000134', POST_GI_FLG: 'X' },
        ITEM_SERIAL_NO: [{ DELIV_NUMB: '0080000134', ITM_NUMBER: '000010', SERIALNO: 'MBP00001' }]
      });
    });

    test('returns the material document from the VBFA row of type R, not the first row', async () => {
      const { rfc } = rfcDouble();
      expect((await run(rfc)).matDocNo).toBe('4900001234');
    });

    test('returns the MARD unrestricted stock as a number', async () => {
      const { rfc } = rfcDouble();
      expect((await run(rfc)).stock).toBe(9);
    });

    test('a BAPI error rolls back, never commits, and throws the SAP message', async () => {
      const { rfc, calls } = rfcDouble(goodTables(), [{ TYPE: 'E', ID: 'VL', NUMBER: '609', MESSAGE: 'Delivery is locked' }]);
      await expect(run(rfc)).rejects.toThrow('PGI failed: [E] Delivery is locked');
      expect(calls.map((c) => c.fm)).toEqual(['BAPI_OUTB_DELIVERY_CONFIRM_DEC', 'BAPI_TRANSACTION_ROLLBACK']);
    });

    test.each([
      ['T319A has another SUT', { T319A: [{ LGNUM: 'W01', VHART: 'Z007', LETYP: 'E1' }] }, "T319A LETYP 'E1' does not match expected SUT 'E10'"],
      ['the delivery is already posted', { LIKP: [{ VBELN: '0080000134', WBSTK: 'C' }] }, 'already completely posted'],
      ['the transport holds no T319A entry', { E071: [] }, "Transport 'DS4K905282' does not appear in E071 or E071K"]
    ])('never calls a write FM when %s', async (_label, override, message) => {
      const { rfc, calls } = rfcDouble({ ...goodTables(), ...override });
      await expect(run(rfc)).rejects.toThrow(message);
      expect(calls).toEqual([]);
    });
  });
});
