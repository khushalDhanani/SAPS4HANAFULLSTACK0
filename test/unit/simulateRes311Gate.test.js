'use strict';

const {
  parseArgs,
  checkGates,
  buildPlannedPayload
} = require('../../tools/simulate-res-311-bapi');

describe('tools/simulate-res-311-bapi gate and payload unit tests', () => {
  describe('parseArgs', () => {
    test('uses safe defaults when no CLI arguments provided', () => {
      const args = parseArgs([]);
      expect(args.reservation).toBe('529960');
      expect(args.item).toBe('1');
      expect(args.userGo).toBe(false);
      expect(args.allowLiveSap).toBe(false);
    });

    test('parses --reservation and --item flags with separate tokens', () => {
      const args = parseArgs(['--reservation', '523657', '--item', '2']);
      expect(args.reservation).toBe('523657');
      expect(args.item).toBe('2');
    });

    test('parses --reservation= and --item= flags with equals tokens', () => {
      const args = parseArgs(['--reservation=523957', '--item=3', '--allow-live-sap', '--user-go']);
      expect(args.reservation).toBe('523957');
      expect(args.item).toBe('3');
      expect(args.allowLiveSap).toBe(true);
      expect(args.userGo).toBe(true);
    });

    test('parses shorthand -r and -i options', () => {
      const args = parseArgs(['-r', '529959', '-i', '1']);
      expect(args.reservation).toBe('529959');
      expect(args.item).toBe('1');
    });
  });

  describe('checkGates', () => {
    test('blocks execution when neither env vars nor flags are present', () => {
      const args = { allowLiveSap: false, userGo: false };
      const env = {};
      const status = checkGates(args, env);
      expect(status.canExecute).toBe(false);
      expect(status.liveGatePassed).toBe(false);
      expect(status.userGoPassed).toBe(false);
    });

    test('blocks execution when only ALLOW_LIVE_SAP_TOOLS=1 is set without --allow-live-sap', () => {
      const args = { allowLiveSap: false, userGo: false };
      const env = { ALLOW_LIVE_SAP_TOOLS: '1' };
      const status = checkGates(args, env);
      expect(status.liveGatePassed).toBe(false);
      expect(status.canExecute).toBe(false);
    });

    test('blocks execution when live gate passes but user written go is missing', () => {
      const args = { allowLiveSap: true, userGo: false };
      const env = { ALLOW_LIVE_SAP_TOOLS: '1' };
      const status = checkGates(args, env);
      expect(status.liveGatePassed).toBe(true);
      expect(status.userGoPassed).toBe(false);
      expect(status.canExecute).toBe(false);
    });

    test('blocks execution when user-go passes but live gate is missing', () => {
      const args = { allowLiveSap: false, userGo: true };
      const env = { USER_WRITTEN_GO: 'go' };
      const status = checkGates(args, env);
      expect(status.liveGatePassed).toBe(false);
      expect(status.userGoPassed).toBe(true);
      expect(status.canExecute).toBe(false);
    });

    test('permits execution only when BOTH live-sap-gate and user-go env and flags match', () => {
      const args = { allowLiveSap: true, userGo: true };
      const env = { ALLOW_LIVE_SAP_TOOLS: '1', USER_WRITTEN_GO: 'go' };
      const status = checkGates(args, env);
      expect(status.liveGatePassed).toBe(true);
      expect(status.userGoPassed).toBe(true);
      expect(status.canExecute).toBe(true);
    });
  });

  describe('buildPlannedPayload', () => {
    test('constructs dynamic BAPI payload from RESB row with GM_CODE 06 and TESTRUN X', () => {
      const resbRow = {
        RSNUM: '529960',
        RSPOS: '1',
        MATNR: '8000009754',
        WERKS: '1120',
        LGORT: 'CS02',
        UMLGO: 'CIS1',
        CHARG: 'BATCH01',
        BDMNG: '5.000',
        ENMNG: '2.000',
        MEINS: 'NOS'
      };

      const payload = buildPlannedPayload(resbRow, 'TEST_REF_123');

      expect(payload.GOODSMVT_CODE).toEqual({ GM_CODE: '06' });
      expect(payload.TESTRUN).toBe('X');
      expect(payload.GOODSMVT_HEADER.REF_DOC_NO).toBe('TEST_REF_123');
      expect(payload.GOODSMVT_ITEM).toHaveLength(1);

      const item = payload.GOODSMVT_ITEM[0];
      expect(item.MATERIAL).toBe('8000009754');
      expect(item.PLANT).toBe('1120');
      expect(item.STGE_LOC).toBe('CS02');
      expect(item.MOVE_TYPE).toBe('311');
      expect(item.MOVE_PLANT).toBe('1120');
      expect(item.MOVE_STLOC).toBe('CIS1');
      expect(item.RESERV_NO).toBe('0000529960');
      expect(item.RES_ITEM).toBe('0001');
      expect(item.ENTRY_QNT).toBe(3); // 5.000 - 2.000
      expect(item.ENTRY_UOM).toBe('NOS');
      expect(item.BATCH).toBe('BATCH01');
    });

    test('omits BATCH if empty in RESB row', () => {
      const resbRow = {
        RSNUM: '523657',
        RSPOS: '1',
        MATNR: '8000007113',
        WERKS: '1120',
        LGORT: 'CS02',
        UMLGO: 'CI01',
        CHARG: '',
        BDMNG: '2.000',
        ENMNG: '0.000',
        MEINS: 'EA'
      };

      const payload = buildPlannedPayload(resbRow);
      expect(payload.GOODSMVT_ITEM[0].BATCH).toBeUndefined();
      expect(payload.GOODSMVT_ITEM[0].ENTRY_QNT).toBe(2);
      expect(payload.GOODSMVT_CODE.GM_CODE).toBe('06');
    });
  });

  describe('isShippingManaged', () => {
    const { isShippingManaged } = require('../../tools/simulate-res-311-bapi');

    test('returns false when t001lRow is null or blank', () => {
      expect(isShippingManaged(null)).toBe(false);
      expect(isShippingManaged({ VSTEL: '', VKORG: '', KUNNR: '' })).toBe(false);
    });

    test('returns true when VSTEL (shipping point) is present', () => {
      expect(isShippingManaged({ VSTEL: '1105' })).toBe(true);
    });

    test('returns true when sales area (VKORG) or customer (KUNNR) is present', () => {
      expect(isShippingManaged({ VKORG: '1000' })).toBe(true);
      expect(isShippingManaged({ KUNNR: '0000001120' })).toBe(true);
    });

    test('correctly identifies CS02 as shipping-managed and CIS1 as not shipping-managed', () => {
      const cs02Row = {
        WERKS: '1120',
        LGORT: 'CS02',
        XHUPF: 'X',
        VSTEL: '1105',
        VKORG: '1000'
      };
      const cis1Row = {
        WERKS: '1120',
        LGORT: 'CIS1',
        XHUPF: '',
        VSTEL: '',
        VKORG: ''
      };
      expect(isShippingManaged(cs02Row)).toBe(true);
      expect(isShippingManaged(cis1Row)).toBe(false);
    });

    test('relies strictly on T001L fields and returns false for CS02 if T001L shipping fields are blank', () => {
      const blankCs02 = {
        WERKS: '1120',
        LGORT: 'CS02',
        VSTEL: '',
        VKORG: '',
        KUNNR: ''
      };
      expect(isShippingManaged(blankCs02)).toBe(false);
    });
  });
});
