'use strict';

const cds = require('@sap/cds');
const { MibLabelAdapter } = require('../../../srv/integration/s4hana/wm/MibLabelAdapter');

const cdsTest = cds.test(__dirname + '/../../../');
const { POST, GET } = cdsTest;

const BASE = '/odata/v4/mib-label';
const as = (username) => ({ auth: { username, password: '' } });

describe('Integration: MibLabelService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('unauthenticated requests are refused with 401', async () => {
    await expect(POST(`${BASE}/generateMibSticker`, {
      WarehouseNumber: 'W01',
      TransferOrderNumber: '1037246'
    })).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('generates MIB sticker via POST /generateMibSticker', async () => {
    const mockPdfResult = {
      WarehouseNumber: 'W01',
      TransferOrderNumber: '0001037246',
      LabelCount: 1,
      FileName: 'MIB-Sticker-W01-0001037246.pdf',
      PdfBase64: 'JVBERi0xLjcK'
    };
    jest.spyOn(MibLabelAdapter.prototype, 'generateMibSticker').mockResolvedValue(mockPdfResult);

    const { data } = await POST(`${BASE}/generateMibSticker`, {
      WarehouseNumber: 'W01',
      TransferOrderNumber: '1037246',
      WeightedBy: 'TESTUSER',
      CheckedBy: 'CHECKER'
    }, as('khushal'));

    expect(data).toMatchObject(mockPdfResult);
  });

  it('reads sticker data via POST /readMibStickerData', async () => {
    const mockRows = [{
      Material: 'MAT-001',
      MaterialDescription: 'Chemical A',
      Batch: 'BATCH-01',
      TransferOrder: '0001037246',
      TransferRequirement: '1001222',
      RequirementNumber: '1002318',
      TransferDate: '2026-10-23',
      QuantityWithUom: '10 KG',
      StorageUnit: 'SU-100',
      WeightedBy: 'TESTUSER',
      CheckedBy: 'CHECKER'
    }];
    jest.spyOn(MibLabelAdapter.prototype, 'readMibStickerData').mockResolvedValue(mockRows);

    const { data } = await POST(`${BASE}/readMibStickerData`, {
      WarehouseNumber: 'W01',
      TransferOrderNumber: '1037246',
      WeightedBy: 'TESTUSER',
      CheckedBy: 'CHECKER'
    }, as('khushal'));

    expect(data.value).toMatchObject(mockRows);
  });

  it('returns warehouse context via GET /getWarehouseContext()', async () => {
    const { data } = await GET(`${BASE}/getWarehouseContext()`, as('khushal'));
    expect(data).toMatchObject({
      warehouses: ['W01'],
      unrestricted: true
    });
  });

  it('propagates 503 error if SAP RFC wrapper is missing', async () => {
    const err = new Error('Z_MM_MIB_LABEL_PDF is not installed on this system.');
    err.status = 503;
    jest.spyOn(MibLabelAdapter.prototype, 'generateMibSticker').mockRejectedValue(err);

    await expect(POST(`${BASE}/generateMibSticker`, {
      WarehouseNumber: 'W01',
      TransferOrderNumber: '1037246'
    }, as('khushal'))).rejects.toMatchObject({
      response: {
        status: 503,
        data: {
          error: {
            message: 'Z_MM_MIB_LABEL_PDF is not installed on this system.'
          }
        }
      }
    });
  });
});
