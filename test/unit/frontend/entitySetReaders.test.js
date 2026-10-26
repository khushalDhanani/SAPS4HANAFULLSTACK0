const fs = require('fs');
const path = require('path');
const vm = require('vm');

const webapp = path.resolve(__dirname, '../../../app/fiori-app/webapp');
function loadModule(relativePath, dependencies) {
  let exported;
  vm.runInNewContext(fs.readFileSync(path.join(webapp, relativePath), 'utf8'), {
    sap: { ui: { define: (names, factory) => { exported = factory(...names.map(name => dependencies[name])); } } }
  });
  return exported;
}

const cases = [
  ['mm/purchase-order', 'PurchaseOrder', 'getPurchaseOrders', 'PurchaseOrders', true],
  ['sd/sales-inquiry', 'SalesInquiry', 'getSalesInquiries', 'SalesInquiries', true],
  ['sd/sales-order', 'SalesOrder', 'getSalesOrders', 'SalesOrders', true],
  ['le/outbound-delivery', 'OutboundDelivery', 'getOrdersDueForDelivery', 'OrdersDueForDelivery', false],
  ['sd/customer-invoice', 'CustomerInvoice', 'getInvoices', 'CustomerInvoices', false],
  ['sd/customer-return', 'CustomerReturn', 'getCustomerReturns', 'CustomerReturns', false]
];

describe.each(cases)('%s entity reader contract', (modulePath, name, method, entity, contextLength) => {
  let client, service;
  const base = '/odata/v4/' + modulePath.split('/')[1];
  beforeEach(() => {
    client = loadModule('service/ODataClient.js', { 'sap/base/Log': {} });
    client.get = jest.fn();
    service = loadModule(`modules/${modulePath}/service/${name}Service.js`, {
      'saps4hana/fiori/service/ODataClient': client
    });
  });
  test('reads through the supplied model and returns context objects', async () => {
    const row = { ID: 'document' };
    const binding = { requestContexts: jest.fn().mockResolvedValue([{ getObject: () => row }]) };
    const model = { bindList: jest.fn().mockReturnValue(binding) };
    expect(await service[method](model)).toEqual([row]);
    expect(model.bindList).toHaveBeenCalledWith('/' + entity, undefined, undefined, undefined, undefined);
    expect(binding.requestContexts).toHaveBeenCalledWith(0, Infinity);
    expect(client.get).not.toHaveBeenCalled();
  });
  test.each([{ value: [{ ID: 'v4' }] }, { d: { results: [{ ID: 'v2' }] } }, null])('unwraps HTTP result %j without a model', async result => {
    client.get.mockResolvedValue(result);
    expect(await service[method]()).toEqual(result ? result.value || result.d.results : []);
    expect(client.get).toHaveBeenCalledWith(base + '/' + entity);
  });
  test('propagates model and HTTP failures without success fallback', async () => {
    const error = new Error('Read failed');
    client.get.mockRejectedValue(error);
    await expect(service[method]()).rejects.toBe(error);
    const binding = { requestContexts: jest.fn().mockRejectedValue(error) };
    await expect(service[method]({ bindList: () => binding })).rejects.toBe(error);
  });
  if (contextLength) {
    test('passes material lookup top as context length rather than a binding parameter', async () => {
      const row = { Material: 'MAT01' };
      const binding = { requestContexts: jest.fn().mockResolvedValue([{ getObject: () => row }]) };
      const model = { bindList: jest.fn().mockReturnValue(binding) };
      expect(await service.getMaterialDetails(model, 'MAT01')).toEqual(row);
      expect(binding.requestContexts).toHaveBeenCalledWith(0, 1);
      expect(model.bindList.mock.calls[0][4]).toBeUndefined();
    });
  }
  if (!contextLength) {
    test('uses its stored model and preserves binding parameters and filter references', async () => {
      const filters = [{ sPath: 'ID', oValue1: 'A B' }];
      const parameters = { $select: 'ID' };
      const binding = { requestContexts: jest.fn().mockResolvedValue([]) };
      const model = { bindList: jest.fn().mockReturnValue(binding) };
      service.setModel(model);
      await service[method](undefined, filters, parameters);
      expect(model.bindList).toHaveBeenCalledWith('/' + entity, undefined, undefined, filters, parameters);
      expect(binding.requestContexts).toHaveBeenCalledWith(0, Infinity);
    });
    test('preserves filter getter and top handling in HTTP fallback', async () => {
      client.get.mockResolvedValue({ value: [] });
      await service[method](undefined, [{ getPath: () => 'ID', getValue1: () => 'A B' }], { $top: 3 });
      expect(client.get).toHaveBeenCalledWith(base + '/' + entity + "?$filter=ID eq 'A%20B'&$top=3");
    });
  }
});

describe('shared entity reader pagination compatibility', () => {
  test('does not mutate query parameters when using a bounded context request', async () => {
    const client = loadModule('service/ODataClient.js', { 'sap/base/Log': {} });
    const parameters = Object.freeze({ $top: 2, $select: 'ID' });
    const binding = { requestContexts: jest.fn().mockResolvedValue([]) };
    const model = { bindList: jest.fn().mockReturnValue(binding) };
    await client.readEntitySet('/service', model, '/Items', [], parameters, { useContextLength: true });
    expect(model.bindList).toHaveBeenCalledWith('/Items', undefined, undefined, [], { $select: 'ID' });
    expect(binding.requestContexts).toHaveBeenCalledWith(0, 2);
    expect(parameters.$top).toBe(2);
  });
  test('retains caller-owned binding parameters when context-length translation is disabled', async () => {
    const client = loadModule('service/ODataClient.js', { 'sap/base/Log': {} });
    const parameters = { $top: 2, $select: 'ID' };
    const binding = { requestContexts: jest.fn().mockResolvedValue([]) };
    const model = { bindList: jest.fn().mockReturnValue(binding) };
    await client.readEntitySet('/service', model, '/Items', [], parameters, { useFilterGetters: true });
    expect(model.bindList.mock.calls[0][4]).toBe(parameters);
    expect(binding.requestContexts).toHaveBeenCalledWith(0, Infinity);
  });
});
