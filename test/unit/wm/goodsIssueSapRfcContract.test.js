/**
 * LIVE SAP RFC_READ_TABLE field-set contract checks (read-only).
 *
 * This release's RFC parser rejects specific fields with AD 718 (e.g. STORNO/XAUTO/ERFMG on
 * MATDOC, anything beyond a narrow list on MSEG/LTBP) and rejects parentheses in OPTIONS.
 * These tests run the exact field sets the 261 lookup and TR-item resolution depend on
 * against live SAP, so a system change cannot silently break the document/TR fallbacks again.
 *
 * Field acceptance is validated independently of data (an invalid field fails even for an
 * impossible key), so the WHERE clauses use keys that match nothing and return instantly.
 *
 * Skipped automatically when no SAP connection is configured.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });

const hasSap = Boolean(process.env.S4_DESTINATION_URL && process.env.S4_USERNAME && process.env.S4_PASSWORD);
const liveDescribe = hasSap ? describe : describe.skip;

liveDescribe('SAP RFC_READ_TABLE field-set contract (live, read-only)', () => {
  jest.setTimeout(60000);
  const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
  const rfc = new RfcClient();
  // A document/TR number of all nines matches nothing; RSNUM of zeros would match every
  // non-reservation row, so it must not be used as a "no match" key.
  const NO_MATCH_DOC = ["MBLNR = '9999999999'", "AND MJAHR = '1900'"];

  test('MATDOC accepts the 13-field 261-lookup list', async () => {
    await expect(rfc.readTable('MATDOC', [
      'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'RSNUM', 'RSPOS', 'USNAM', 'BUDAT',
      'CPUDT', 'CPUTM', 'MENGE', 'SMBLN', 'SJAHR'
    ], NO_MATCH_DOC)).resolves.toEqual([]);
  });

  test('MSEG accepts the 7-field fallback list', async () => {
    await expect(rfc.readTable('MSEG', [
      'MBLNR', 'MJAHR', 'BWART', 'RSNUM', 'RSPOS', 'MENGE', 'SMBLN'
    ], NO_MATCH_DOC)).resolves.toEqual([]);
  });

  test('LTBP accepts the 6-field TR-item list', async () => {
    await expect(rfc.readTable('LTBP', [
      'TBNUM', 'TBPOS', 'RSPOS', 'MENGE', 'TAMEN', 'ELIKZ'
    ], ["LGNUM = 'XXX'", "AND TBNUM = '9999999999'"])).resolves.toEqual([]);
  });

  test('LTBK accepts the TR-header list', async () => {
    await expect(rfc.readTable('LTBK', [
      'TBNUM', 'RSNUM', 'LGNUM', 'NLTYP', 'NLPLA', 'STATU', 'BWLVS'
    ], ["LGNUM = 'XXX'", "AND TBNUM = '9999999999'"])).resolves.toEqual([]);
  });

  test('LIPS accepts the delivery-item list keyed by RSNUM/RSPOS', async () => {
    await expect(rfc.readTable('LIPS', [
      'VBELN', 'POSNR', 'LFIMG', 'VRKME', 'BWART'
    ], ["RSNUM = '9999999999'", "AND RSPOS = '9999'"])).resolves.toEqual([]);
  });

  test('LIKP accepts the delivery-header list, LIFEX and OR-joined VBELN predicates', async () => {
    const fields = ['VBELN', 'LFART', 'ERDAT', 'ERZET', 'WBSTK', 'LIFEX'];
    await expect(rfc.readTable('LIKP', fields, ["LIFEX = 'GINOMATCH000000X'"])).resolves.toEqual([]);
    await expect(rfc.readTable('LIKP', fields, ["VBELN = '9999999998'", "OR VBELN = '9999999999'"])).resolves.toEqual([]);
  });
});
