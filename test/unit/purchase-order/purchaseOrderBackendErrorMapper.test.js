'use strict';

const PurchaseOrderBackendErrorMapper = require('../../../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderBackendErrorMapper');

describe('Unit: PurchaseOrderBackendErrorMapper', () => {
  let mockModel;

  beforeEach(() => {
    mockModel = {
      _data: {
        errors: {
          PurchaseOrderType: { state: 'None', text: '' },
          CompanyCode: { state: 'None', text: '' },
          Supplier: { state: 'None', text: '' }
        },
        items: [
          { errors: {} }
        ]
      },
      getData() {
        return this._data;
      },
      setProperty(path, value) {
        const key = path.replace(/^\//, '');
        this._data[key] = value;
      }
    };
  });

  it('returns empty error count when model is missing', () => {
    const res = PurchaseOrderBackendErrorMapper.applyBackendErrors(null, { message: 'Failed' });
    expect(res).toEqual({ errorCount: 0, errorList: [], errorMessage: '' });
  });

  it('maps backend details array to header fields', () => {
    const error = {
      message: 'Validation failed',
      details: [
        { target: 'header.CompanyCode', message: 'Company code 1010 invalid', code: 'ME001' }
      ]
    };

    const res = PurchaseOrderBackendErrorMapper.applyBackendErrors(mockModel, error);
    expect(res.errorCount).toBe(1);
    expect(res.errorList[0].field).toBe('SAP (ME001)');
    expect(res.errorList[0].controlId).toBe('inCompanyCode');
    expect(mockModel._data.errors.CompanyCode.state).toBe('Error');
    expect(mockModel._data.errors.CompanyCode.text).toBe('Company code 1010 invalid');
  });

  it('maps backend details array to line item fields', () => {
    const error = {
      message: 'Item error',
      details: [
        { target: 'items[0].Plant', message: 'Plant 1010 not allowed', code: 'ME002' }
      ]
    };

    const res = PurchaseOrderBackendErrorMapper.applyBackendErrors(mockModel, error);
    expect(res.errorCount).toBe(1);
    expect(res.errorList[0].controlId).toBe('poItemsTable');
    expect(mockModel._data.items[0].errors.Plant.state).toBe('Error');
    expect(mockModel._data.items[0].errors.Plant.text).toBe('Plant 1010 not allowed');
  });

  it('handles semicolon-separated compound error messages', () => {
    const error = {
      message: 'CompanyCode is invalid; Supplier not active',
      status: 400
    };

    const res = PurchaseOrderBackendErrorMapper.applyBackendErrors(mockModel, error);
    expect(res.errorCount).toBe(2);
    expect(mockModel._data.errors.CompanyCode.state).toBe('Error');
    expect(mockModel._data.errors.Supplier.state).toBe('Error');
  });

  it('handles fallback single error message', () => {
    const error = {
      message: 'General SAP backend failure',
      code: 'SYS_ERR',
      status: 500
    };

    const res = PurchaseOrderBackendErrorMapper.applyBackendErrors(mockModel, error);
    expect(res.errorCount).toBe(1);
    expect(res.errorList[0].field).toBe('SAP Backend (HTTP 500)');
    expect(mockModel._data.hasError).toBe(true);
  });
});
