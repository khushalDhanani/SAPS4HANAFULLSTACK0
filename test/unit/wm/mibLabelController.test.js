'use strict';

/** MibLabel controller unit tests without UI5 runtime. */
let ctrl;
const MibLabelService = {
  generateMibSticker: jest.fn(),
  readMibStickerData: jest.fn(),
  listTransferOrders: jest.fn(),
  getWarehouseContext: jest.fn()
};
const MibLabelPdf = {
  generateBlob: jest.fn(),
  print: jest.fn()
};
const AuthService = {
  getCurrentUser: jest.fn(() => ({ username: 'DEMOUSER' })),
  getCurrentUserName: jest.fn(() => 'DEMOUSER')
};
const BaseController = {
  extend: (name, obj) => {
    ctrl = obj;
    return obj;
  }
};
const MessageBox = {
  error: jest.fn(),
  warning: jest.fn()
};
const MessageToast = {
  show: jest.fn()
};

global.sap = {
  ui: {
    define: (deps, f) => f(BaseController, function () {}, MibLabelService, MibLabelPdf, AuthService, MessageBox, MessageToast)
  }
};

require('../../../app/fiori-app/webapp/modules/wm/mib-label/controller/MibLabel.controller.js');

const PDF_B64 = Buffer.from('%PDF-1.7').toString('base64');
global.window = { atob: (s) => Buffer.from(s, 'base64').toString('latin1') };
global.URL.createObjectURL = jest.fn(() => 'blob:mib-pdf-1');
global.URL.revokeObjectURL = jest.fn();
global.Blob = global.Blob || class {};

function createSubject(viewData = {}, listData = {}) {
  const models = {
    mibView: {
      _d: {
        busy: false,
        message: '',
        messageType: 'Information',
        pdfSource: '',
        warehouseNumber: 'W01',
        transferOrderNumber: '1037246',
        weightedBy: '',
        checkedBy: '',
        variant: 'vertical',
        ...viewData
      },
      getProperty(p) { return this._d[p.slice(1)]; },
      setProperty(p, v) { this._d[p.slice(1)] = v; },
      getData() { return this._d; }
    },
    mibList: {
      _d: {
        warehouseNumber: 'W01',
        dateFrom: new Date('2026-10-20'),
        dateTo: new Date('2026-10-27'),
        transferOrderNumber: '',
        transferOrders: [],
        listed: false,
        more: false,
        selectedCount: 0,
        ...listData
      },
      getProperty(p) { return this._d[p.slice(1)]; },
      setProperty(p, v) { this._d[p.slice(1)] = v; },
      getData() { return this._d; }
    }
  };

  const s = Object.assign(Object.create(ctrl), {
    getOwnerComponent: () => ({}),
    getModel: (name) => models[name || 'mibView'],
    getText: (k, a, d) => {
      let t = d || k;
      if (a && a.length) {
        a.forEach((val, idx) => {
          t = t.replace(new RegExp(`\\{${idx}\\}`, 'g'), val);
        });
      }
      return t;
    },
    byId: jest.fn((id) => {
      if (id === 'mibToTable') {
        return {
          removeSelections: jest.fn(),
          getSelectedItems: jest.fn(() => [])
        };
      }
      return {
        getDomRef: () => ({ scrollIntoView: jest.fn() })
      };
    }),
    _iRequest: 0
  });

  return { s, viewD: models.mibView._d, listD: models.mibList._d };
}

describe('MibLabel controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Form input validation & preview', () => {
    it('validates top form inputs and does not call service if invalid', () => {
      const { s, viewD } = createSubject({ warehouseNumber: '', transferOrderNumber: 'abc' });
      s.onPreview();
      expect(MibLabelService.generateMibSticker).not.toHaveBeenCalled();
      expect(viewD.warehouseState).toBe('Error');
      expect(viewD.toState).toBe('Error');
      expect(viewD.messageType).toBe('Error');
    });

    it('displays preview PDF on successful generateMibSticker call', async () => {
      MibLabelService.generateMibSticker.mockResolvedValueOnce({
        WarehouseNumber: 'W01',
        TransferOrderNumber: '0001037246',
        LabelCount: 2,
        FileName: 'MIB-Sticker-W01-0001037246.pdf',
        PdfBase64: PDF_B64
      });

      const { s, viewD } = createSubject();
      await s.onPreview();

      expect(MibLabelService.generateMibSticker).toHaveBeenCalled();
      expect(viewD.pdfSource).toBe('blob:mib-pdf-1');
      expect(viewD.fileName).toBe('MIB-Sticker-W01-0001037246.pdf');
      expect(viewD.labelCount).toBe(2);
      expect(viewD.messageType).toBe('Success');
      expect(MessageToast.show).toHaveBeenCalled();
    });

    it('falls back to client-side 4x6 labels on 503 from RFC wrapper', async () => {
      const err = new Error('Wrapper not installed');
      err.status = 503;
      MibLabelService.generateMibSticker.mockRejectedValueOnce(err);
      MibLabelService.readMibStickerData.mockResolvedValueOnce([
        { Material: 'MAT-1', QuantityWithUom: '10 KG' }
      ]);
      MibLabelPdf.generateBlob.mockResolvedValueOnce(new Blob());

      const { s, viewD } = createSubject();
      await s.onPreview();

      expect(MibLabelService.readMibStickerData).toHaveBeenCalled();
      expect(viewD.messageType).toBe('Warning');
      expect(viewD.message).toContain('Wrapper not installed');
    });

    it('drops preview and increments request counter on input change', () => {
      const { s, viewD } = createSubject({ pdfSource: 'blob:old' });
      s._pdfBlobUrl = 'blob:old';

      s.onInputChange();

      expect(viewD.pdfSource).toBe('');
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:old');
    });
  });

  describe('App-drawn 4x6 labels (on4x6Labels)', () => {
    it('generates 4x6 labels from readMibStickerData', async () => {
      const rows = [{ Material: 'MAT-1', QuantityWithUom: '10 KG' }];
      MibLabelService.readMibStickerData.mockResolvedValueOnce(rows);
      MibLabelPdf.generateBlob.mockResolvedValueOnce(new Blob());

      const { s, viewD } = createSubject();
      await s.on4x6Labels();

      expect(MibLabelService.readMibStickerData).toHaveBeenCalled();
      expect(MibLabelPdf.generateBlob).toHaveBeenCalledWith(rows, expect.objectContaining({ variant: 'vertical' }));
      expect(viewD.pdfSource).toBe('blob:mib-pdf-1');
      expect(viewD.messageType).toBe('Success');
    });

    it('handles empty rows gracefully with error message', async () => {
      MibLabelService.readMibStickerData.mockResolvedValueOnce([]);

      const { s, viewD } = createSubject();
      await s.on4x6Labels();

      expect(viewD.messageType).toBe('Error');
    });
  });

  describe('Transfer Order List (onListGo)', () => {
    it('validates list inputs and rejects invalid warehouse', () => {
      const { s, viewD } = createSubject({}, { warehouseNumber: '' });
      s.onListGo();
      expect(MibLabelService.listTransferOrders).not.toHaveBeenCalled();
      expect(viewD.message).toBe('mibListWarehouseInvalid');
    });

    it('validates list inputs and rejects date range > 31 days', () => {
      const { s, viewD } = createSubject({}, {
        warehouseNumber: 'W01',
        dateFrom: new Date('2026-08-01'),
        dateTo: new Date('2026-10-01')
      });
      s.onListGo();
      expect(MibLabelService.listTransferOrders).not.toHaveBeenCalled();
      expect(viewD.message).toBe('mibListRangeTooLong');
    });

    it('queries transfer orders and populates list model on success', async () => {
      const mockOrders = [
        { TransferOrderNumber: '0001037246', Material: 'MAT-1', QuantityWithUom: '10 KG' }
      ];
      MibLabelService.listTransferOrders.mockResolvedValueOnce({
        WarehouseNumber: 'W01',
        More: false,
        TransferOrders: mockOrders
      });

      const { s, listD } = createSubject();
      await s.onListGo();

      expect(MibLabelService.listTransferOrders).toHaveBeenCalledWith({
        warehouseNumber: 'W01',
        dateFrom: '2026-10-20',
        dateTo: '2026-10-27',
        transferOrderNumber: ''
      });
      expect(listD.transferOrders).toEqual(mockOrders);
      expect(listD.listed).toBe(true);
      expect(listD.more).toBe(false);
      expect(listD.selectedCount).toBe(0);
    });

    it('sets warning message if More flag is true', async () => {
      MibLabelService.listTransferOrders.mockResolvedValueOnce({
        WarehouseNumber: 'W01',
        More: true,
        TransferOrders: [{ TransferOrderNumber: '0001037246' }]
      });

      const { s, viewD } = createSubject();
      await s.onListGo();

      expect(viewD.messageType).toBe('Warning');
    });
  });

  describe('Row and Bulk Actions', () => {
    it('formatCount and formatSelected substitute numbers', () => {
      const { s } = createSubject();
      expect(s.formatCount('TOs: {0}', [1, 2])).toBe('TOs: 2');
      expect(s.formatSelected('Selected: {0}', 5)).toBe('Selected: 5');
    });

    it('onListSelectionChange updates selectedCount', () => {
      const { s, listD } = createSubject();
      s.onListSelectionChange({
        getSource: () => ({ getSelectedItems: () => [1, 2, 3] })
      });
      expect(listD.selectedCount).toBe(3);
    });

    it('onRowLabels loads row into form and generates 4x6 labels', async () => {
      const row = { WarehouseNumber: 'W02', TransferOrderNumber: '0001037999' };
      const { s, viewD } = createSubject();

      MibLabelService.readMibStickerData.mockResolvedValueOnce([{ Material: 'M1' }]);
      MibLabelPdf.generateBlob.mockResolvedValueOnce(new Blob());

      await s.onRowLabels({
        getSource: () => ({
          getBindingContext: () => ({ getObject: () => row })
        })
      });

      expect(viewD.warehouseNumber).toBe('W02');
      expect(viewD.transferOrderNumber).toBe('0001037999');
      expect(viewD.pdfSource).toBe('blob:mib-pdf-1');
    });

    it('refuses bulk download if selection exceeds BULK_MAX_ORDERS (20)', async () => {
      const { s, viewD } = createSubject();
      const fakeOrders = Array.from({ length: 21 }, (_, i) => ({
        WarehouseNumber: 'W01',
        TransferOrderNumber: String(i)
      }));

      await s._listLabels(fakeOrders, 'download');

      expect(viewD.messageType).toBe('Error');
      expect(MessageBox.error).toHaveBeenCalled();
    });

    it('downloads combined PDF for selected orders', async () => {
      const { s, viewD } = createSubject();
      const orders = [
        { WarehouseNumber: 'W01', TransferOrderNumber: '1001' },
        { WarehouseNumber: 'W01', TransferOrderNumber: '1002' }
      ];

      MibLabelService.readMibStickerData
        .mockResolvedValueOnce([{ TransferOrder: '1001', Material: 'MAT-1' }])
        .mockResolvedValueOnce([{ TransferOrder: '1002', Material: 'MAT-2' }]);
      MibLabelPdf.generateBlob.mockResolvedValueOnce(new Blob());

      // Mock saveBlob helper
      s._saveBlob = jest.fn();

      await s._listLabels(orders, 'download');

      expect(MibLabelPdf.generateBlob).toHaveBeenCalledWith(
        [
          { TransferOrder: '1001', Material: 'MAT-1' },
          { TransferOrder: '1002', Material: 'MAT-2' }
        ],
        expect.objectContaining({ variant: 'vertical' })
      );
      expect(s._saveBlob).toHaveBeenCalled();
      expect(viewD.messageType).toBe('Success');
      expect(MessageToast.show).toHaveBeenCalled();
    });
  });

  describe('Notification feedback (_notifyResult)', () => {
    it('shows MessageBox.error on Error', () => {
      const { s } = createSubject({ message: 'Error occurred', messageType: 'Error' });
      s._notifyResult();
      expect(MessageBox.error).toHaveBeenCalledWith('Error occurred');
    });

    it('shows MessageBox.warning on Warning', () => {
      const { s } = createSubject({ message: 'Warning notice', messageType: 'Warning' });
      s._notifyResult();
      expect(MessageBox.warning).toHaveBeenCalledWith('Warning notice');
    });

    it('shows MessageToast on Success/Info', () => {
      const { s } = createSubject({ message: 'Success complete', messageType: 'Success' });
      s._notifyResult();
      expect(MessageToast.show).toHaveBeenCalledWith('Success complete');
    });
  });
});
