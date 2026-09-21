describe('Frontend OutboundDeliveryService Unit Tests', () => {
  let FrontendOutboundDeliveryService;
  let mockODataClient;
  let mockModel;
  let mockBinding;

  beforeAll(() => {
    mockODataClient = {
      get: jest.fn(),
      post: jest.fn()
    };
    const origSap = global.sap;
    global.sap = {
      ui: {
        define: (deps, factory) => {
          FrontendOutboundDeliveryService = factory(mockODataClient);
        }
      }
    };
    delete require.cache[require.resolve('../../../app/fiori-app/webapp/modules/le/outbound-delivery/service/OutboundDeliveryService')];
    require('../../../app/fiori-app/webapp/modules/le/outbound-delivery/service/OutboundDeliveryService');
    global.sap = origSap;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBinding = {
      requestContexts: jest.fn().mockResolvedValue([
        { getObject: () => ({ SalesOrder: '5000104', ShippingPoint: '1120', ShipToParty: '10082' }) }
      ])
    };
    mockModel = {
      bindList: jest.fn().mockReturnValue(mockBinding)
    };
  });

  it('supports setModel and getModel', () => {
    FrontendOutboundDeliveryService.setModel(mockModel);
    expect(FrontendOutboundDeliveryService.getModel()).toBe(mockModel);
    FrontendOutboundDeliveryService.setModel(null);
    expect(FrontendOutboundDeliveryService.getModel()).toBeNull();
  });

  it('queries orders due for delivery via V4 model binding', async () => {
    FrontendOutboundDeliveryService.setModel(mockModel);
    const res = await FrontendOutboundDeliveryService.getOrdersDueForDelivery();
    expect(mockModel.bindList).toHaveBeenCalledWith(
      '/OrdersDueForDelivery',
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(mockBinding.requestContexts).toHaveBeenCalledWith(0, Infinity);
    expect(res).toEqual([{ SalesOrder: '5000104', ShippingPoint: '1120', ShipToParty: '10082' }]);
    expect(mockODataClient.get).not.toHaveBeenCalled();
  });

  it('falls back to ODataClient.get when no model is set', async () => {
    FrontendOutboundDeliveryService.setModel(null);
    mockODataClient.get.mockResolvedValueOnce({ value: [{ SalesOrder: '5000104' }] });
    const res = await FrontendOutboundDeliveryService.getOrdersDueForDelivery();
    expect(mockODataClient.get).toHaveBeenCalledWith('/odata/v4/outbound-delivery/OrdersDueForDelivery');
    expect(res).toEqual([{ SalesOrder: '5000104' }]);
  });

  it('queries shipping points via V4 model binding', async () => {
    FrontendOutboundDeliveryService.setModel(mockModel);
    mockBinding.requestContexts.mockResolvedValueOnce([
      { getObject: () => ({ ShippingPoint: '1120', ShippingPointName: '1130-FG Loading Area' }) }
    ]);
    const res = await FrontendOutboundDeliveryService.getShippingPoints();
    expect(mockModel.bindList).toHaveBeenCalledWith(
      '/ShippingPointVH',
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(res).toEqual([{ ShippingPoint: '1120', ShippingPointName: '1130-FG Loading Area' }]);
  });

  it('fetches default shipping point information via function call', async () => {
    mockODataClient.get.mockResolvedValueOnce({
      value: { ShippingPoint: '1120', ShippingPoints: ['1120', '1112', '1108', '1109'] }
    });
    const res = await FrontendOutboundDeliveryService.getDefaultShippingPoint();
    expect(mockODataClient.get).toHaveBeenCalledWith('/odata/v4/outbound-delivery/getDefaultShippingPoint()');
    expect(res.ShippingPoint).toBe('1120');
    expect(res.ShippingPoints).toContain('1120');
  });

  it('rejects createOutboundDelivery when salesOrder is missing', async () => {
    await expect(FrontendOutboundDeliveryService.createOutboundDelivery({}))
      .rejects.toThrow('Sales Order is required');
  });

  it('creates outbound delivery successfully and returns document number', async () => {
    mockODataClient.post.mockResolvedValueOnce({ value: '13000526' });
    const res = await FrontendOutboundDeliveryService.createOutboundDelivery({
      salesOrder: '5000104',
      shippingPoint: '1120',
      deliveryDate: '2026-09-19'
    });
    expect(mockODataClient.post).toHaveBeenCalledWith(
      '/odata/v4/outbound-delivery/createOutboundDelivery',
      {
        SalesOrder: '5000104',
        ShippingPoint: '1120',
        DeliveryDate: '2026-09-19'
      }
    );
    expect(res).toBe('13000526');
  });

  it('unwraps raw string response from createOutboundDelivery if not wrapped in value', async () => {
    mockODataClient.post.mockResolvedValueOnce('13000527');
    const res = await FrontendOutboundDeliveryService.createOutboundDelivery({
      salesOrder: '5000104',
      shippingPoint: '1120'
    });
    expect(res).toBe('13000527');
  });
});
