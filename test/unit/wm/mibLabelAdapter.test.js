'use strict';

const { MibLabelAdapter, normalizeInput, normalizeListInput, LIST_MAX_DAYS, LIST_MAX_ITEMS, FUNCTION_NAME } = require('../../../srv/integration/s4hana/wm/MibLabelAdapter');

const FAKE_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

function createRfcFake({
  fmode = 'R',
  tfdirError = null,
  callResult = { EV_RESULT: 'OK', EV_PDF: FAKE_PDF, EV_LABEL_COUNT: 2, EV_MESSAGE: 'Success' },
  ltakRows = [{ LGNUM: 'W01', TANUM: '0001037246', TBNUM: '0001001222', BDATU: '20261023', BENUM: '1002318' }],
  ltapRows = [
    { LGNUM: 'W01', TANUM: '0001037246', TAPOS: '0001', MATNR: 'MAT-001', CHARG: 'BATCH-A', NISTA: '10.500', MEINS: 'KG', VLENR: 'SU-100' },
    { LGNUM: 'W01', TANUM: '0001037246', TAPOS: '0002', MATNR: 'MAT-002', CHARG: 'BATCH-B', NISTA: '5.000', MEINS: 'KG', VLENR: 'SU-101' }
  ],
  afpoRows = [{ AUFNR: '000001002318', CHARG: 'PROD-BATCH-99' }],
  maktRows = [
    { MATNR: 'MAT-001', MAKTX: 'Chemical Raw Material A' },
    { MATNR: 'MAT-002', MAKTX: 'Chemical Raw Material B' }
  ]
} = {}) {
  return {
    readTable: jest.fn(async (table) => {
      if (table === 'TFDIR') {
        if (tfdirError) throw new Error(tfdirError);
        return fmode === null ? [] : [{ FUNCNAME: FUNCTION_NAME, FMODE: fmode }];
      }
      if (table === 'LTAK') return ltakRows;
      if (table === 'LTAP') return ltapRows;
      if (table === 'AFPO') return afpoRows;
      if (table === 'MAKT') return maktRows;
      return [];
    }),
    call: jest.fn(async (fm) => {
      if (fm === FUNCTION_NAME) return callResult;
      throw new Error(`Unexpected FM call: ${fm}`);
    })
  };
}

describe('MibLabelAdapter', () => {
  describe('normalizeInput', () => {
    it('normalizes valid warehouse, TO number and usernames', () => {
      const res = normalizeInput({
        WarehouseNumber: ' w01 ',
        TransferOrderNumber: ' 1037246 ',
        WeightedBy: ' jsmith ',
        CheckedBy: ' mbrown '
      });
      expect(res).toEqual({
        lgnum: 'W01',
        tanum: '0001037246',
        bname: 'JSMITH',
        bname1: 'MBROWN'
      });
    });

    it('rejects invalid warehouse number', () => {
      expect(() => normalizeInput({ WarehouseNumber: '', TransferOrderNumber: '100' }))
        .toThrow(/Warehouse number must be 1 to 3 letters or digits/);
      expect(() => normalizeInput({ WarehouseNumber: 'W0012', TransferOrderNumber: '100' }))
        .toThrow(/Warehouse number must be 1 to 3 letters or digits/);
    });

    it('rejects invalid transfer order number', () => {
      expect(() => normalizeInput({ WarehouseNumber: 'W01', TransferOrderNumber: '' }))
        .toThrow(/Transfer order number must be up to 10 digits/);
      expect(() => normalizeInput({ WarehouseNumber: 'W01', TransferOrderNumber: 'TO123' }))
        .toThrow(/Transfer order number must be up to 10 digits/);
      expect(() => normalizeInput({ WarehouseNumber: 'W01', TransferOrderNumber: '12345678901' }))
        .toThrow(/Transfer order number must be up to 10 digits/);
    });

    it('rejects over-long usernames', () => {
      expect(() => normalizeInput({ WarehouseNumber: 'W01', TransferOrderNumber: '100', WeightedBy: 'A'.repeat(13) }))
        .toThrow(/Weighted by username must be at most 12 characters/);
      expect(() => normalizeInput({ WarehouseNumber: 'W01', TransferOrderNumber: '100', CheckedBy: 'B'.repeat(13) }))
        .toThrow(/Checked by username must be at most 12 characters/);
    });
  });

  describe('generateMibSticker', () => {
    it('generates sticker PDF successfully when RFC returns OK', async () => {
      const rfc = createRfcFake();
      const adapter = new MibLabelAdapter(rfc);

      const result = await adapter.generateMibSticker({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246',
        WeightedBy: 'USER1',
        CheckedBy: 'USER2'
      });

      expect(result).toEqual({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '0001037246',
        LabelCount: 2,
        FileName: 'MIB-Sticker-W01-0001037246.pdf',
        PdfBase64: FAKE_PDF.toString('base64')
      });
      expect(rfc.call).toHaveBeenCalledWith(FUNCTION_NAME, {
        IV_LGNUM: 'W01',
        IV_TANUM: '0001037246',
        IV_BNAME: 'USER1',
        IV_BNAME1: 'USER2'
      });
    });

    it('throws 503 if RFC wrapper is not installed in SAP', async () => {
      const rfc = createRfcFake({ fmode: null });
      const adapter = new MibLabelAdapter(rfc);

      await expect(adapter.generateMibSticker({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246'
      })).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining('not installed')
      });
      expect(rfc.call).not.toHaveBeenCalled();
    });

    it('throws 503 if RFC wrapper is not remote-enabled', async () => {
      const rfc = createRfcFake({ fmode: '' });
      const adapter = new MibLabelAdapter(rfc);

      await expect(adapter.generateMibSticker({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246'
      })).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining('not remote-enabled')
      });
    });

    it('maps RFC NOT_FOUND result to 404', async () => {
      const rfc = createRfcFake({
        callResult: { EV_RESULT: 'NOT_FOUND', EV_MESSAGE: 'TO not found' }
      });
      const adapter = new MibLabelAdapter(rfc);

      await expect(adapter.generateMibSticker({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246'
      })).rejects.toMatchObject({
        status: 404,
        message: 'TO not found'
      });
    });

    it('rejects empty PDF return', async () => {
      const rfc = createRfcFake({
        callResult: { EV_RESULT: 'OK', EV_PDF: Buffer.alloc(0), EV_LABEL_COUNT: 0 }
      });
      const adapter = new MibLabelAdapter(rfc);

      await expect(adapter.generateMibSticker({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246'
      })).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining('empty PDF')
      });
    });

    it('throws 403 if warehouse is outside allowedWarehouses', async () => {
      const rfc = createRfcFake();
      const adapter = new MibLabelAdapter(rfc);

      await expect(adapter.generateMibSticker({
        WarehouseNumber: 'W02',
        TransferOrderNumber: '1037246'
      }, { allowedWarehouses: ['W01'] })).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('outside your authorized warehouses')
      });
      expect(rfc.call).not.toHaveBeenCalled();
    });
  });

  describe('readMibStickerData', () => {
    it('reads and formats sticker data from LTAK, LTAP, MAKT and AFPO', async () => {
      const rfc = createRfcFake();
      const adapter = new MibLabelAdapter(rfc);

      const rows = await adapter.readMibStickerData({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246',
        WeightedBy: 'USER1',
        CheckedBy: 'USER2'
      });

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        Material: 'MAT-001',
        MaterialDescription: 'Chemical Raw Material A',
        Batch: 'PROD-BATCH-99', // From AFPO via LTAK-BENUM
        TransferOrder: '0001037246',
        TransferRequirement: '0001001222',
        RequirementNumber: '1002318',
        TransferDate: '2026-10-23',
        QuantityWithUom: '10.5 KG',
        StorageUnit: 'SU-100',
        WeightedBy: 'USER1',
        CheckedBy: 'USER2'
      });
      expect(rows[1].Material).toBe('MAT-002');
      expect(rows[1].QuantityWithUom).toBe('5 KG');
    });

    it('returns empty array if LTAK or LTAP returns no rows', async () => {
      const rfc = createRfcFake({ ltakRows: [] });
      const adapter = new MibLabelAdapter(rfc);

      const rows = await adapter.readMibStickerData({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246'
      });

      expect(rows).toEqual([]);
    });

    it('throws 403 if warehouse is outside allowedWarehouses', async () => {
      const rfc = createRfcFake();
      const adapter = new MibLabelAdapter(rfc);

      await expect(adapter.readMibStickerData({
        WarehouseNumber: 'W02',
        TransferOrderNumber: '1037246'
      }, { allowedWarehouses: ['W01'] })).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('outside your authorized warehouses')
      });
      expect(rfc.readTable).not.toHaveBeenCalled();
    });
  });

  describe('normalizeListInput', () => {
    it('normalizes valid warehouse and date range', () => {
      const res = normalizeListInput({
        WarehouseNumber: ' w01 ',
        DateFrom: '2026-10-01',
        DateTo: '2026-10-20'
      });
      expect(res).toEqual({
        lgnum: 'W01',
        from: '2026-10-01',
        to: '2026-10-20'
      });
    });

    it('normalizes direct TransferOrderNumber lookup', () => {
      const res = normalizeListInput({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '1037246'
      });
      expect(res).toEqual({
        lgnum: 'W01',
        tanum: '0001037246'
      });
    });

    it('rejects invalid warehouse', () => {
      expect(() => normalizeListInput({ WarehouseNumber: '' }))
        .toThrow(/Warehouse number must be 1 to 3 letters or digits/);
      expect(() => normalizeListInput({ WarehouseNumber: 'W1234' }))
        .toThrow(/Warehouse number must be 1 to 3 letters or digits/);
    });

    it('rejects missing or invalid dates when TO is omitted', () => {
      expect(() => normalizeListInput({ WarehouseNumber: 'W01', DateFrom: 'invalid' }))
        .toThrow(/Transfer order dates must be valid dates/);
      expect(() => normalizeListInput({ WarehouseNumber: 'W01', DateFrom: '2026-10-01' }))
        .toThrow(/Transfer order dates must be valid dates/);
    });

    it('rejects date range where from is after to', () => {
      expect(() => normalizeListInput({ WarehouseNumber: 'W01', DateFrom: '2026-10-20', DateTo: '2026-10-01' }))
        .toThrow(/The transfer order date "from" must not be after "to"/);
    });

    it(`rejects date range exceeding ${LIST_MAX_DAYS} days`, () => {
      expect(() => normalizeListInput({ WarehouseNumber: 'W01', DateFrom: '2026-09-01', DateTo: '2026-10-15' }))
        .toThrow(/The transfer order date range must be at most 31 days/);
    });
  });

  describe('listTransferOrders', () => {
    it('returns transfer orders with items, MAKT descriptions and AFPO batches', async () => {
      const rfc = createRfcFake();
      const adapter = new MibLabelAdapter(rfc);

      const res = await adapter.listTransferOrders({
        WarehouseNumber: 'W01',
        DateFrom: '2026-10-20',
        DateTo: '2026-10-25'
      });

      expect(res).toEqual({
        WarehouseNumber: 'W01',
        DateFrom: '2026-10-20',
        DateTo: '2026-10-25',
        More: false,
        TransferOrders: [
          {
            WarehouseNumber: 'W01',
            TransferOrderNumber: '0001037246',
            TransferDate: '2026-10-23',
            TransferRequirement: '0001001222',
            RequirementNumber: '1002318',
            MovementType: '',
            Material: 'MAT-001',
            MaterialDescription: 'Chemical Raw Material A',
            Batch: 'PROD-BATCH-99',
            QuantityWithUom: '10.5 KG',
            StorageUnit: 'SU-100'
          }
        ]
      });
    });

    it('returns empty list if LTAK returns no rows', async () => {
      const rfc = createRfcFake({ ltakRows: [] });
      const adapter = new MibLabelAdapter(rfc);

      const res = await adapter.listTransferOrders({
        WarehouseNumber: 'W01',
        DateFrom: '2026-10-20',
        DateTo: '2026-10-25'
      });

      expect(res).toEqual({
        WarehouseNumber: 'W01',
        DateFrom: '2026-10-20',
        DateTo: '2026-10-25',
        More: false,
        TransferOrders: []
      });
    });

    it('flags More when LTAK returns more than LIST_MAX_ITEMS', async () => {
      const manyRows = Array.from({ length: LIST_MAX_ITEMS + 1 }, (_, i) => ({
        LGNUM: 'W01',
        TANUM: String(i + 1).padStart(10, '0'),
        BDATU: '20261023',
        TBNUM: '100',
        BENUM: '',
        BWLVS: '261'
      }));
      const rfc = createRfcFake({ ltakRows: manyRows, ltapRows: [] });
      const adapter = new MibLabelAdapter(rfc);

      const res = await adapter.listTransferOrders({
        WarehouseNumber: 'W01',
        DateFrom: '2026-10-20',
        DateTo: '2026-10-25'
      });

      expect(res.More).toBe(true);
      expect(res.TransferOrders.length).toBe(LIST_MAX_ITEMS);
    });

    it('throws 403 if warehouse is outside allowedWarehouses', async () => {
      const rfc = createRfcFake();
      const adapter = new MibLabelAdapter(rfc);

      await expect(adapter.listTransferOrders({
        WarehouseNumber: 'W02',
        DateFrom: '2026-10-20',
        DateTo: '2026-10-25'
      }, { allowedWarehouses: ['W01'] })).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('outside your authorized warehouses')
      });
      expect(rfc.readTable).not.toHaveBeenCalled();
    });
  });
});
