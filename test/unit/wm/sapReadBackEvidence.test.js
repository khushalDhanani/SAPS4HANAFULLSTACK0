'use strict';

/**
 * test/unit/wm/sapReadBackEvidence.test.js
 *
 * P1 - Add controlled SAP read-back evidence for critical movement flows:
 * Validates transparent table queries (MATDOC, MSEG, MKPF, OData) and field matching
 * across critical warehouse movements:
 * - Movement 201: GI to Cost Center
 * - Movement 241: GI to Asset
 * - Movement 261: GI to Internal Order
 * - Movement 301: Plant-to-Plant Transfer Posting
 * - Movement 311: Storage Location to Storage Location Transfer Posting
 *
 * [mock only, not SAP verification]
 */

const cds = require('@sap/cds');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

const { POST } = cds.test(__dirname + '/../../../');

describe('P1: Controlled SAP Read-Back Evidence for Critical Movement Flows [mock only]', () => {
  let adapter;
  let rfcClient;
  let postingClient;
  const authCarol = { auth: { username: 'carol', password: '' } };

  beforeEach(() => {
    jest.restoreAllMocks();
    adapter = new ReservationProcessAdapter({ mock: true });
    rfcClient = new RfcClient();
    adapter.rfc = rfcClient;
    postingClient = new GoodsIssuePostingClient({ rfc: rfcClient, mock: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // SECTION 1: Movement 201 (Cost Center) Read-Back Evidence
  // ===========================================================================
  describe('1. Movement 201: GI to Cost Center Read-Back Evidence', () => {

    test('confirms persistence in MATDOC (Tier 1) with exact field matching', async () => {
      jest.spyOn(rfcClient, 'readTable').mockImplementation(async (table) => {
        if (table === 'MATDOC') {
          return [{
            MBLNR: '004900050142',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'CS01',
            MENGE: '2.000',
            MEINS: 'KG',
            RSNUM: '0000520001',
            RSPOS: '0001'
          }];
        }
        return [];
      });

      const evidence = await adapter.verifyMaterialDocument({
        materialDocument: '4900050142',
        materialDocYear: '2026',
        movementType: '201',
        material: '8000000023',
        quantity: 2,
        plant: '1120',
        storageLocation: 'CS01',
        reservationNumber: '520001'
      });

      expect(evidence.success).toBe(true);
      expect(evidence.stage).toBe('MIGO');
      expect(evidence.materialDocument).toBe('4900050142');
      expect(evidence.materialDocumentYear).toBe('2026');
      expect(evidence.movementType).toBe('201');
    });

    test('falls back to MSEG (Tier 2) when MATDOC yields no record', async () => {
      let readTables = [];
      jest.spyOn(rfcClient, 'readTable').mockImplementation(async (table) => {
        readTables.push(table);
        if (table === 'MATDOC') return [];
        if (table === 'MSEG') {
          return [{
            MBLNR: '004900050142',
            MJAHR: '2026',
            ZEILE: '0001',
            BWART: '201',
            MATNR: '000000008000000023',
            WERKS: '1120',
            LGORT: 'CS01',
            MENGE: '2.000',
            MEINS: 'KG',
            RSNUM: '0000520001',
            RSPOS: '0001'
          }];
        }
        return [];
      });

      const evidence = await adapter.verifyMaterialDocument({
        materialDocument: '4900050142',
        materialDocYear: '2026',
        movementType: '201',
        material: '8000000023',
        quantity: 2,
        plant: '1120',
        storageLocation: 'CS01'
      });

      expect(evidence.success).toBe(true);
      expect(readTables).toEqual(['MATDOC', 'MSEG']);
      expect(evidence.materialDocument).toBe('4900050142');
    });

    test('fails closed (400) when Movement Type mismatches SAP table record', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '004900050142',
        MJAHR: '2026',
        ZEILE: '0001',
        BWART: '201',
        MATNR: '000000008000000023',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '2.000'
      }]);

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '4900050142',
        materialDocYear: '2026',
        movementType: '261', // expected 261, but SAP has 201
        plant: '1120'
      })).rejects.toMatchObject({
        status: 400,
        message: 'Material document 4900050142 verification failed: SAP BWART 201 does not exactly equal requested MovementType 261'
      });
    });

    test('fails closed (400) when Plant mismatches SAP table record', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '004900050142',
        MJAHR: '2026',
        ZEILE: '0001',
        BWART: '201',
        MATNR: '000000008000000023',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '2.000'
      }]);

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '4900050142',
        materialDocYear: '2026',
        movementType: '201',
        plant: '1110' // expected 1110, but SAP has 1120
      })).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Plant mismatch \(SAP: 1120, expected: 1110\)/i)
      });
    });

    test('fails closed (400) when Quantity mismatches SAP table record', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '004900050142',
        MJAHR: '2026',
        ZEILE: '0001',
        BWART: '201',
        MATNR: '000000008000000023',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '2.000'
      }]);

      await expect(adapter.verifyMaterialDocument({
        materialDocument: '4900050142',
        materialDocYear: '2026',
        movementType: '201',
        quantity: 5 // expected 5, but SAP has 2
      })).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/Quantity mismatch \(SAP: 2, expected: 5\)/i)
      });
    });
  });

  // ===========================================================================
  // SECTION 2: Movement 241 (Asset) Read-Back Evidence
  // ===========================================================================
  describe('2. Movement 241: GI to Asset Read-Back Evidence', () => {

    test('confirms persistence in MATDOC with movement type 241 and plant', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '004900050143',
        MJAHR: '2026',
        ZEILE: '0001',
        BWART: '241',
        MATNR: '000000008900000004',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '1.000',
        MEINS: 'KG'
      }]);

      const evidence = await adapter.verifyMaterialDocument({
        materialDocument: '4900050143',
        materialDocYear: '2026',
        movementType: '241',
        plant: '1120',
        storageLocation: 'CS01',
        material: '8900000004',
        quantity: 1
      });

      expect(evidence.success).toBe(true);
      expect(evidence.materialDocument).toBe('4900050143');
      expect(evidence.movementType).toBe('241');
    });
  });

  // ===========================================================================
  // SECTION 3: Movement 261 (Internal Order) Read-Back Evidence
  // ===========================================================================
  describe('3. Movement 261: GI to Internal Order Read-Back Evidence', () => {

    test('confirms persistence in MATDOC with movement type 261 and reservation reference', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '004900050254',
        MJAHR: '2026',
        ZEILE: '0001',
        BWART: '261',
        MATNR: '000000001000000928',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '1.000',
        MEINS: 'KG',
        RSNUM: '0000528780',
        RSPOS: '0001'
      }]);

      const evidence = await adapter.verifyMaterialDocument({
        materialDocument: '4900050254',
        materialDocYear: '2026',
        movementType: '261',
        plant: '1120',
        storageLocation: 'CS01',
        material: '1000000928',
        quantity: 1,
        reservationNumber: '528780'
      });

      expect(evidence.success).toBe(true);
      expect(evidence.materialDocument).toBe('4900050254');
      expect(evidence.movementType).toBe('261');
    });
  });

  // ===========================================================================
  // SECTION 4: Movement 301 (Plant-to-Plant) Read-Back Evidence
  // ===========================================================================
  describe('4. Movement 301: Plant-to-Plant Read-Back Evidence', () => {

    test('confirms persistence in MATDOC with movement type 301 and issuing plant', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '004900050149',
        MJAHR: '2026',
        ZEILE: '0001',
        BWART: '301',
        MATNR: '000000008900000004',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '1.000',
        MEINS: 'KG',
        RSNUM: '0000525868',
        RSPOS: '0001'
      }]);

      const evidence = await adapter.verifyMaterialDocument({
        materialDocument: '4900050149',
        materialDocYear: '2026',
        movementType: '301',
        plant: '1120',
        storageLocation: 'CS01',
        material: '8900000004',
        quantity: 1,
        reservationNumber: '525868'
      });

      expect(evidence.success).toBe(true);
      expect(evidence.materialDocument).toBe('4900050149');
      expect(evidence.movementType).toBe('301');
    });
  });

  // ===========================================================================
  // SECTION 5: Movement 311 (SLoc-to-SLoc) Read-Back Evidence
  // ===========================================================================
  describe('5. Movement 311: SLoc-to-SLoc Read-Back Evidence', () => {

    test('confirms persistence in MATDOC with movement type 311 and issuing storage location', async () => {
      jest.spyOn(rfcClient, 'readTable').mockResolvedValue([{
        MBLNR: '004900050153',
        MJAHR: '2026',
        ZEILE: '0001',
        BWART: '311',
        MATNR: '000000008900000004',
        WERKS: '1120',
        LGORT: 'CS01',
        MENGE: '1.000',
        MEINS: 'KG',
        RSNUM: '0000525869',
        RSPOS: '0001'
      }]);

      const evidence = await adapter.verifyMaterialDocument({
        materialDocument: '4900050153',
        materialDocYear: '2026',
        movementType: '311',
        plant: '1120',
        storageLocation: 'CS01',
        material: '8900000004',
        quantity: 1,
        reservationNumber: '525869'
      });

      expect(evidence.success).toBe(true);
      expect(evidence.materialDocument).toBe('4900050153');
      expect(evidence.movementType).toBe('311');
    });
  });

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

  // ===========================================================================
  // SECTION 7: Controlled SAP Read-Back HTTP Action Endpoint
  // ===========================================================================
  describe('7. HTTP Action verifyMaterialDocument Endpoint', () => {

    test('POST /odata/v4/reservation-entry/verifyMaterialDocument returns verified contract', async () => {
      jest.spyOn(ReservationProcessAdapter.prototype, 'verifyMaterialDocument').mockResolvedValue({
        success: true,
        stage: 'MIGO',
        materialDocument: '4900050142',
        materialDocumentYear: '2026',
        movementType: '201'
      });

      const res = await POST('/odata/v4/reservation-entry/verifyMaterialDocument', {
        materialDocument: '4900050142',
        materialDocYear: '2026',
        movementType: '201',
        plant: '1120'
      }, authCarol);

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.materialDocument).toBe('4900050142');
      expect(res.data.materialDocumentYear).toBe('2026');
      expect(res.data.movementType).toBe('201');
    });
  });
});
