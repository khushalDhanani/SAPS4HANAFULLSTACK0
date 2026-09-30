const {
  normalizeReversalPayload,
  sanitizeScannerString,
  toIsoDateString
} = require('../../../srv/wm/goods-issue/mapping/goodsIssue.mapper');

const {
  formatDateToODataV2,
  mapToCancelHeaderUrl
} = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssueMapper');

describe('Goods Issue Mappers (Domain & S/4 Technical)', () => {
  describe('CAP Domain Mapper (goodsIssue.mapper)', () => {
    it('sanitizes barcode scanner strings with whitespace and control characters', () => {
      expect(sanitizeScannerString('  MACBOOK-004\r\n\t  ')).toBe('MACBOOK-004');
      expect(sanitizeScannerString(null)).toBe('');
      expect(sanitizeScannerString(undefined)).toBe('');
    });

    it('normalizes dates to YYYY-MM-DD or defaults to today', () => {
      expect(toIsoDateString('2026-09-29T10:00:00.000Z')).toBe('2026-09-29');
      expect(toIsoDateString(new Date('2026-09-29T00:00:00Z'))).toBe('2026-09-29');
      const today = new Date().toISOString().split('T')[0];
      expect(toIsoDateString(null)).toBe(today);
    });

    it('normalizes Reversal payload', () => {
      const input = {
        MaterialDocument: '4900012345',
        MaterialDocYear: ' 2026 '
      };
      const normalized = normalizeReversalPayload(input, { user: 'TEST_USER' });
      expect(normalized.MaterialDocument).toBe('4900012345');
      expect(normalized.MaterialDocYear).toBe('2026');
      expect(normalized.PostingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('S/4 Technical Mapper (GoodsIssueMapper)', () => {
    it('formats dates into SAP OData V2 JSON timestamp /Date(epoch)/ at UTC midnight', () => {
      const formatted = formatDateToODataV2('2026-09-29');
      expect(formatted).toMatch(/^\/Date\(\d+\)\/$/);
      const epoch = Number(formatted.match(/\d+/)[0]);
      const date = new Date(epoch);
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
    });

    it('maps CancelHeader URL with proper encoding', () => {
      const url = mapToCancelHeaderUrl('4900012345', '2026', '2026-09-29');
      // Reversal uses the API_MATERIAL_DOCUMENT_SRV `Cancel` FunctionImport (not `CancelHeader`).
      expect(url).toContain("Cancel?MaterialDocument='4900012345'");
      expect(url).toContain("MaterialDocumentYear='2026'");
      expect(url).toContain("PostingDate=datetime'2026-09-29T00:00:00'");
    });
  });
});
