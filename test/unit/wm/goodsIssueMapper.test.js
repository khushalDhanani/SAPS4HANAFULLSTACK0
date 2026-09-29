const {
  normalizeGoodsIssuePayload,
  normalizeReversalPayload,
  sanitizeScannerString,
  toIsoDateString
} = require('../../../srv/wm/goods-issue/mapping/goodsIssue.mapper');

const {
  formatDateToODataV2,
  mapToMaterialDocumentPayload,
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

    it('normalizes 201 Goods Issue payload (uppercasing, trimming, zero-padding item)', () => {
      const input = {
        MovementType: '201',
        CostCenter: ' cc10111013 ',
        GLAccount: ' 400000 ',
        Material: ' 8000009753 ',
        Plant: ' 1120 ',
        StorageLocation: ' hs01 ',
        IssueQty: ' 2 ',
        Unit: ' ea ',
        ReservationNo: ' 519658 ',
        ReservationItem: ' 1 ',
        SerialNumbers: ['  sn001\r\n ', 'sn002', 'sn001'] // includes duplicate & dirty scanner suffix
      };

      const normalized = normalizeGoodsIssuePayload(input, { user: 'TEST_USER' });
      expect(normalized.MovementType).toBe('201');
      expect(normalized.CostCenter).toBe('CC10111013');
      expect(normalized.GLAccount).toBe('400000');
      expect(normalized.Material).toBe('8000009753');
      expect(normalized.Plant).toBe('1120');
      expect(normalized.StorageLocation).toBe('HS01');
      expect(normalized.IssueQty).toBe(2);
      expect(normalized.Unit).toBe('EA');
      expect(normalized.ReservationNo).toBe('519658');
      expect(normalized.ReservationItem).toBe('0001');
      expect(normalized.SerialNumbers).toEqual(['sn001', 'sn002']); // deduplicated and cleaned
      expect(normalized.User).toBe('TEST_USER');
      expect(normalized.PostingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

    it('maps Movement 201 to A_MaterialDocumentHeader with GoodsMovementCode 03 and CostCenter, never forwarding GLAccount', () => {
      const data = {
        MovementType: '201',
        CostCenter: '1011101301',
        GLAccount: '0000400000', // must be ignored for 201 - system-determined via OBYC/GBB-VBR
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 1,
        Unit: 'EA',
        PostingDate: '2026-09-29',
        SerialNumbers: ['MACBOOK-004']
      };

      const payload = mapToMaterialDocumentPayload(data);
      expect(payload.GoodsMovementCode).toBe('03');
      expect(payload.PostingDate).toMatch(/^\/Date\(\d+\)\/$/);
      expect(payload.MaterialDocumentHeaderText).toBe('GI CC 1011101301');

      const items = payload.to_MaterialDocumentItem.results;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        GoodsMovementType: '201',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        QuantityInEntryUnit: '1',
        EntryUnit: 'EA',
        CostCenter: '1011101301'
      });
      expect(items[0].GLAccount).toBeUndefined();

      expect(items[0].to_SerialNumbers.results).toEqual([
        { SerialNumber: 'MACBOOK-004' }
      ]);
    });

    it('forwards a caller-supplied GLAccount for non-201 movement types (e.g. 261)', () => {
      const data = {
        MovementType: '261',
        GLAccount: '0000400000',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 1,
        Unit: 'EA',
        ReservationNo: '519658',
        ReservationItem: '0001'
      };
      const payload = mapToMaterialDocumentPayload(data);
      expect(payload.to_MaterialDocumentItem.results[0].GLAccount).toBe('0000400000');
    });

    it('maps planned 201 with reservation references', () => {
      const data = {
        MovementType: '201',
        CostCenter: '1011101301',
        Material: '8000009753',
        Plant: '1120',
        StorageLocation: 'HS01',
        IssueQty: 2,
        Unit: 'EA',
        ReservationNo: '519658',
        ReservationItem: '0001'
      };

      const payload = mapToMaterialDocumentPayload(data);
      expect(payload.MaterialDocumentHeaderText).toBe('GI CC Resv 519658');
      const item = payload.to_MaterialDocumentItem.results[0];
      expect(item.Reservation).toBe('519658');
      expect(item.ReservationItem).toBe('0001');
      expect(item.CostCenter).toBe('1011101301');
    });

    it('maps CancelHeader URL with proper encoding', () => {
      const url = mapToCancelHeaderUrl('4900012345', '2026', '2026-09-29');
      expect(url).toContain("CancelHeader?MaterialDocument='4900012345'");
      expect(url).toContain("MaterialDocumentYear='2026'");
      expect(url).toContain("PostingDate=datetime'2026-09-29T00:00:00'");
    });
  });
});
