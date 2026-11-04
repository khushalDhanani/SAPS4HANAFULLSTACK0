'use strict';

/**
 * test/unit/wm/sapReadBackEvidence.test.js
 *
 * P1 - Add controlled SAP read-back evidence for critical movement flows:
 * Multi-tier material document read-back in GoodsIssuePostingClient (MATDOC, MKPF, then unconfirmed).
 *
 * [mock only, not SAP verification]
 */

const cds = require('@sap/cds');
const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

cds.test(__dirname + '/../../../');

describe('P1: Controlled SAP Read-Back Evidence for Critical Movement Flows [mock only]', () => {
  let rfcClient;
  let postingClient;

  beforeEach(() => {
    jest.restoreAllMocks();
    rfcClient = new RfcClient();
    postingClient = new GoodsIssuePostingClient({ rfc: rfcClient, mock: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // SECTION 5b: production path of verifyMaterialDocument
  // A plain-function RFC double has no .mock property, so the fail-closed branches at adapter:1242 and :1249 run.
  // ===========================================================================

  // ===========================================================================
  // SECTION 6: Multi-Tier Read-Back Fallback in GoodsIssuePostingClient
  // ===========================================================================
  describe('6. Multi-tier readback fallback in GoodsIssuePostingClient', () => {

    test('Tier 1: returns confirmed document with Tier=MATDOC when MATDOC read succeeds', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '4900050142',
        MJAHR: '2026',
        BUDAT: '20261024',
        ZEILE: '0001',
        BWART: '201',
        MATNR: '8000000023',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '2.000',
        MEINS: 'KG'
      }]);

      const res = await postingClient.readBackDocument('4900050142', '2026');

      expect(res.Confirmed).toBe(true);
      expect(res.Tier).toBe('MATDOC');
      expect(res.MaterialDocument).toBe('4900050142');
      expect(res.MaterialDocYear).toBe('2026');
      expect(res.Status).toBe('confirmed');
    });

    test('Tier 2: falls back to MKPF when MATDOC read fails', async () => {
      jest.spyOn(rfcClient, 'readTable').mockImplementation(async (table) => {
        if (table === 'MATDOC') throw new Error('MATDOC table locked');
        if (table === 'MKPF') {
          return [{
            MBLNR: '4900050142',
            MJAHR: '2026',
            BLDAT: '20261024',
            BUDAT: '20261024'
          }];
        }
        return [];
      });

      const res = await postingClient.readBackDocument('4900050142', '2026');

      expect(res.Confirmed).toBe(true);
      expect(res.Tier).toBe('MKPF');
      expect(res.MaterialDocument).toBe('4900050142');
    });

    test('Timeout handling: hanging read-back times out and returns unconfirmed without throwing or 504', async () => {
      let timer;
      jest.spyOn(rfcClient, 'readTable').mockImplementation(async () => {
        return new Promise((resolve) => {
          timer = setTimeout(() => resolve([]), 200);
        });
      });
      jest.spyOn(postingClient, '_get').mockResolvedValue(null);

      const res = await postingClient.readBackDocument('4900050999', '2026', { timeoutMs: 20 });
      clearTimeout(timer);

      expect(res.Confirmed).toBe(false);
      expect(res.Status).toBe('posted, confirmation pending');
      expect(res.MaterialDocument).toBe('4900050999');
    });
  });

});
