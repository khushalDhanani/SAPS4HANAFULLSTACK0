const registerCustomerReturnHandlers = require('../../../srv/sd/customer-return/handlers/customerReturn.handler');
const customerReturnAdapter = require('../../../srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter');

jest.mock('../../../srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter');

describe('Unit: CustomerReturnService Handlers', () => {
  let srv;
  let handlers;

  beforeEach(() => {
    handlers = {};
    srv = {
      on: jest.fn((event, entity, handler) => {
        const key = typeof entity === 'function' ? event : `${event}:${entity}`;
        const fn = typeof entity === 'function' ? entity : handler;
        handlers[key] = fn;
      })
    };
    registerCustomerReturnHandlers(srv);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('READ CustomerReturns', () => {
    test('fetches returns and applies paging', async () => {
      const mockReturns = [
        { CustomerReturn: '4500001', SoldToParty: '10001', TotalNetAmount: 1000 },
        { CustomerReturn: '4500002', SoldToParty: '10002', TotalNetAmount: 2000 }
      ];
      customerReturnAdapter.getCustomerReturns.mockResolvedValueOnce({ results: mockReturns, count: 2 });

      const req = {
        query: { SELECT: { limit: { rows: { val: 1 } } } },
        _queryOptions: { $top: '1', $skip: '0' },
        error: jest.fn()
      };

      const res = await handlers['READ:CustomerReturns'](req);
      expect(customerReturnAdapter.getCustomerReturns).toHaveBeenCalled();
      expect(res.length).toBe(1);
      expect(res[0].CustomerReturn).toBe('4500001');
    });

    test('filters by ReturnsOrderReason', async () => {
      const mockReturns = [
        { CustomerReturn: '4500001', ReturnsOrderReason: '101' },
        { CustomerReturn: '4500002', ReturnsOrderReason: '102' }
      ];
      customerReturnAdapter.getCustomerReturns.mockResolvedValueOnce({ results: mockReturns, count: 2 });

      const req = {
        query: { SELECT: { where: ['ReturnsOrderReason', '=', { val: '101' }] } },
        _queryOptions: {},
        error: jest.fn()
      };

      const res = await handlers['READ:CustomerReturns'](req);
      expect(res.length).toBe(1);
      expect(res[0].CustomerReturn).toBe('4500001');
    });

    test('filters by search parameter', async () => {
      const mockReturns = [
        { CustomerReturn: '4500001', SoldToParty: '10082', SoldToPartyName: 'Bajaj Healthcare' },
        { CustomerReturn: '4500002', SoldToParty: '10358', SoldToPartyName: 'R L Fine Chem' }
      ];
      customerReturnAdapter.getCustomerReturns.mockResolvedValueOnce({ results: mockReturns, count: 2 });

      const req = {
        query: { SELECT: {} },
        _queryOptions: { $search: 'Bajaj' },
        error: jest.fn()
      };

      const res = await handlers['READ:CustomerReturns'](req);
      expect(res.length).toBe(1);
      expect(res[0].SoldToPartyName).toContain('Bajaj');
    });
  });

  describe('READ CustomerReturnItems', () => {
    test('fetches items by CustomerReturn key', async () => {
      const mockItems = [
        { CustomerReturn: '4500001', CustomerReturnItem: '10', Material: 'MAT-1' }
      ];
      customerReturnAdapter.getCustomerReturnItems.mockResolvedValueOnce(mockItems);

      const req = {
        query: { SELECT: { where: ['CustomerReturn', '=', { val: '4500001' }] } },
        _queryOptions: {},
        error: jest.fn()
      };

      const res = await handlers['READ:CustomerReturnItems'](req);
      expect(customerReturnAdapter.getCustomerReturnItems).toHaveBeenCalledWith('4500001');
      expect(res.length).toBe(1);
    });

    test('returns empty array when no CustomerReturn is passed', async () => {
      const req = {
        query: { SELECT: {} },
        _queryOptions: {},
        error: jest.fn()
      };

      const res = await handlers['READ:CustomerReturnItems'](req);
      expect(res).toEqual([]);
    });
  });

  describe('getReturnMetrics', () => {
    test('calculates correct metrics counts', async () => {
      const mockReturns = [
        { CustomerReturn: '4500001', ReturnsOrderReason: '101', TotalNetAmount: 1000 },
        { CustomerReturn: '4500002', ReturnsOrderReason: '101', TotalNetAmount: 2000 },
        { CustomerReturn: '4500003', ReturnsOrderReason: '102', TotalNetAmount: 1500 },
        { CustomerReturn: '4500004', ReturnsOrderReason: '004', TotalNetAmount: 500 }
      ];
      customerReturnAdapter.getCustomerReturns.mockResolvedValueOnce({ results: mockReturns, count: 4 });

      const req = { error: jest.fn() };
      const res = await handlers['getReturnMetrics'](req);

      expect(res.totalReturns).toBe(4);
      expect(res.totalNetValue).toBe(5000);
      expect(res.poorQualityCount).toBe(2);
      expect(res.damagedTransitCount).toBe(1);
      expect(res.otherReasonsCount).toBe(1);
    });
  });

  describe('getReturnReasons', () => {
    test('delegates to adapter', async () => {
      const reasons = [{ ReasonCode: '101', ReasonText: 'Poor quality' }];
      customerReturnAdapter.getReturnReasons.mockResolvedValueOnce(reasons);

      const req = { error: jest.fn() };
      const res = await handlers['getReturnReasons'](req);
      expect(res).toBe(reasons);
    });
  });

  describe('getReferenceDocuments', () => {
    test('delegates to adapter with search and top params', async () => {
      const refDocs = [{ ReferenceSDDocument: '31000007', SoldToParty: '10082' }];
      customerReturnAdapter.getReferenceDocuments.mockResolvedValueOnce(refDocs);

      const req = { data: { search: '31000007', top: 5 }, error: jest.fn() };
      const res = await handlers['getReferenceDocuments'](req);
      expect(customerReturnAdapter.getReferenceDocuments).toHaveBeenCalledWith({ search: '31000007', top: 5 });
      expect(res).toBe(refDocs);
    });
  });

  describe('getCustomers', () => {
    test('delegates to adapter with search and top params', async () => {
      const custs = [{ Customer: '10082', OrganizationBPName1: 'Bajaj Healthcare Limited' }];
      customerReturnAdapter.getCustomers.mockResolvedValueOnce(custs);

      const req = { data: { search: 'Bajaj', top: 10 }, error: jest.fn() };
      const res = await handlers['getCustomers'](req);
      expect(customerReturnAdapter.getCustomers).toHaveBeenCalledWith({ search: 'Bajaj', top: 10 });
      expect(res).toBe(custs);
    });
  });

  describe('getMaterials', () => {
    test('delegates to adapter with search and top params', async () => {
      const mats = [{ Material: '4000000001', Material_Text: 'X-265 Active' }];
      customerReturnAdapter.getMaterials.mockResolvedValueOnce(mats);

      const req = { data: { search: '40000', top: 10 }, error: jest.fn() };
      const res = await handlers['getMaterials'](req);
      expect(customerReturnAdapter.getMaterials).toHaveBeenCalledWith({ search: '40000', top: 10 });
      expect(res).toBe(mats);
    });
  });

  describe('getPlants', () => {
    test('delegates to adapter', async () => {
      const plants = [{ Plant: '1110', PlantName: 'Ascend Plant 1' }];
      customerReturnAdapter.getPlants.mockResolvedValueOnce(plants);

      const req = { error: jest.fn() };
      const res = await handlers['getPlants'](req);
      expect(customerReturnAdapter.getPlants).toHaveBeenCalled();
      expect(res).toBe(plants);
    });
  });

  describe('getDocumentTypes', () => {
    test('delegates to adapter', async () => {
      const docTypes = [{ CustomerReturnType: 'ZRET', CustomerReturnType_Text: 'Sales Return Order' }];
      customerReturnAdapter.getDocumentTypes.mockResolvedValueOnce(docTypes);

      const req = { error: jest.fn() };
      const res = await handlers['getDocumentTypes'](req);
      expect(customerReturnAdapter.getDocumentTypes).toHaveBeenCalled();
      expect(res).toBe(docTypes);
    });
  });

  describe('createCustomerReturn', () => {
    test('rejects missing SoldToParty with 400', async () => {
      const req = {
        data: { ReturnsOrderReason: '101' },
        error: jest.fn()
      };

      await handlers['createCustomerReturn'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('SoldToParty is mandatory'));
    });

    test('rejects missing ReturnsOrderReason with 400', async () => {
      const req = {
        data: { SoldToParty: '10082' },
        error: jest.fn()
      };

      await handlers['createCustomerReturn'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('ReturnsOrderReason is mandatory'));
    });

    test('delegates to adapter when input is valid', async () => {
      const mockResult = {
        CustomerReturn: '4500099',
        CustomerReturnType: 'ZRET',
        SoldToParty: '10082',
        TotalNetAmount: 15000,
        TransactionCurrency: 'INR',
        Success: true,
        Message: 'Customer Return 4500099 successfully created'
      };
      customerReturnAdapter.createCustomerReturn.mockResolvedValueOnce(mockResult);

      const req = {
        data: {
          SoldToParty: '10082',
          ReturnsOrderReason: '101',
          ReferenceSDDocument: '31000007'
        },
        user: { is: jest.fn().mockReturnValue(true) },
        error: jest.fn()
      };

      const res = await handlers['createCustomerReturn'](req);
      expect(customerReturnAdapter.createCustomerReturn).toHaveBeenCalled();
      expect(res).toEqual(mockResult);
    });

    test('forwards 501 when adapter throws missing persistence capability error', async () => {
      const err = new Error('SD_F2651_CRT_CREATE_SRV lacks persistence');
      err.code = 501;
      customerReturnAdapter.createCustomerReturn.mockRejectedValueOnce(err);

      const req = {
        data: {
          SoldToParty: '10082',
          ReturnsOrderReason: '101'
        },
        user: { is: jest.fn().mockReturnValue(true) },
        reject: jest.fn()
      };

      await handlers['createCustomerReturn'](req);
      expect(req.reject).toHaveBeenCalledWith(501, expect.stringContaining('SD_F2651_CRT_CREATE_SRV lacks persistence'));
    });
  });
});
