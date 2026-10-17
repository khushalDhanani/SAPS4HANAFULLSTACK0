jest.mock('../../../srv/integration/s4hana/le/delivery-no-ref/DeliveryNoRefAdapter', () => ({
  getDeliveryTypes: jest.fn(),
  getShipToParties: jest.fn(),
  createDeliveryWithoutRef: jest.fn(),
  getDeliveryWithoutRef: jest.fn()
}));

const deliveryNoRefAdapter = require('../../../srv/integration/s4hana/le/delivery-no-ref/DeliveryNoRefAdapter');
const registerOutboundDeliveryHandlers = require('../../../srv/le/outbound-delivery/handlers/outboundDelivery.handler');

function createMockService() {
  const handlers = {};
  const mockSrv = {
    on: (event, entity, handlerFn) => {
      if (!handlerFn) {
        handlers[event] = entity;
      } else {
        handlers[`${event}_${entity}`] = handlerFn;
      }
    }
  };
  registerOutboundDeliveryHandlers(mockSrv);
  return handlers;
}

describe('Unit: OutboundDeliveryService DeliveryWithoutRef Handlers', () => {
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = createMockService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('READ DeliveryWithoutRefTypes', () => {
    test('delegates to adapter and applies paging', async () => {
      const mockTypes = [
        { DeliveryDocumentType: 'LO2', DeliveryDocumentTypeName: 'Delivery w/o ref.' },
        { DeliveryDocumentType: 'LO', DeliveryDocumentTypeName: 'Delivery w/o ref.' }
      ];
      deliveryNoRefAdapter.getDeliveryTypes.mockResolvedValue(mockTypes);

      const req = {
        query: { SELECT: { limit: { rows: { val: 1 } } } },
        error: jest.fn()
      };

      const result = await handlers['READ_DeliveryWithoutRefTypes'](req);
      expect(deliveryNoRefAdapter.getDeliveryTypes).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].DeliveryDocumentType).toBe('LO2');
      expect(req.error).not.toHaveBeenCalled();
    });

    test('handles adapter errors via req.error', async () => {
      const err = new Error('Gateway error');
      err.status = 502;
      deliveryNoRefAdapter.getDeliveryTypes.mockRejectedValue(err);

      const req = { query: {}, error: jest.fn() };
      await handlers['READ_DeliveryWithoutRefTypes'](req);
      expect(req.error).toHaveBeenCalledWith(502, 'Gateway error');
    });
  });

  describe('READ DeliveryWithoutRefShipToParties', () => {
    test('delegates to adapter and applies paging', async () => {
      const mockParties = [
        { Customer: '10135', CustomerName: 'Divis Lab' },
        { Customer: '100001', CustomerName: 'Aether Cust' }
      ];
      deliveryNoRefAdapter.getShipToParties.mockResolvedValue(mockParties);

      const req = {
        query: { SELECT: { limit: { rows: { val: 1 } } } },
        error: jest.fn()
      };

      const result = await handlers['READ_DeliveryWithoutRefShipToParties'](req);
      expect(deliveryNoRefAdapter.getShipToParties).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].Customer).toBe('10135');
      expect(req.error).not.toHaveBeenCalled();
    });

    test('handles adapter errors via req.error', async () => {
      const err = new Error('Ship-to read failed');
      err.status = 500;
      deliveryNoRefAdapter.getShipToParties.mockRejectedValue(err);

      const req = { query: {}, error: jest.fn() };
      await handlers['READ_DeliveryWithoutRefShipToParties'](req);
      expect(req.error).toHaveBeenCalledWith(500, 'Ship-to read failed');
    });
  });

  describe('createDeliveryWithoutRef action', () => {
    test('calls adapter with mapped parameters and returns created delivery', async () => {
      deliveryNoRefAdapter.createDeliveryWithoutRef.mockResolvedValue({
        OutboundDelivery: '80000059',
        ShippingPoint: '1104',
        DeliveryDocumentType: 'LO2',
        Plant: '1110',
        StorageLocation: 'FG01',
        ShipToParty: '10135',
        ItemCount: 1
      });

      const req = {
        data: {
          ShippingPoint: '1104',
          DeliveryDocumentType: 'LO2',
          SalesOrganization: '1000',
          DistributionChannel: '10',
          Division: '52',
          ShipToParty: '10135',
          Plant: '1110',
          StorageLocation: 'FG01',
          PlannedGoodsIssueDate: '2026-10-01',
          Items: [{ Material: '4000000186', ActualDeliveryQuantity: 1, DeliveryQuantityUnit: 'KG' }]
        },
        error: jest.fn()
      };

      const res = await handlers['createDeliveryWithoutRef'](req);
      expect(res.OutboundDelivery).toBe('80000059');
      expect(deliveryNoRefAdapter.createDeliveryWithoutRef).toHaveBeenCalledWith({
        shippingPoint: '1104',
        deliveryType: 'LO2',
        salesOrg: '1000',
        distChannel: '10',
        division: '52',
        shipToParty: '10135',
        plant: '1110',
        storageLocation: 'FG01',
        plannedGoodsIssueDate: '2026-10-01',
        items: [{ Material: '4000000186', ActualDeliveryQuantity: 1, DeliveryQuantityUnit: 'KG' }]
      });
      expect(req.error).not.toHaveBeenCalled();
    });

    test('handles adapter errors via req.error', async () => {
      const err = new Error('Document incomplete');
      err.status = 400;
      deliveryNoRefAdapter.createDeliveryWithoutRef.mockRejectedValue(err);

      const req = {
        data: { ShippingPoint: '1104' },
        error: jest.fn()
      };

      await handlers['createDeliveryWithoutRef'](req);
      expect(req.error).toHaveBeenCalledWith(400, 'Document incomplete');
    });
  });

  describe('getDeliveryWithoutRef function', () => {
    test('returns 400 when OutboundDelivery parameter is missing', async () => {
      const req = {
        data: {},
        error: jest.fn()
      };

      await handlers['getDeliveryWithoutRef'](req);
      expect(req.error).toHaveBeenCalledWith(400, expect.stringContaining('OutboundDelivery parameter is required'));
    });

    test('delegates to adapter when OutboundDelivery is provided', async () => {
      deliveryNoRefAdapter.getDeliveryWithoutRef.mockResolvedValue({
        OutboundDelivery: '80000059',
        ShippingPoint: '1104',
        Items: []
      });

      const req = {
        data: { OutboundDelivery: '80000059' },
        error: jest.fn()
      };

      const res = await handlers['getDeliveryWithoutRef'](req);
      expect(res.OutboundDelivery).toBe('80000059');
      expect(deliveryNoRefAdapter.getDeliveryWithoutRef).toHaveBeenCalledWith('80000059');
      expect(req.error).not.toHaveBeenCalled();
    });

    test('handles adapter errors via req.error', async () => {
      const err = new Error('Delivery not found');
      err.status = 404;
      deliveryNoRefAdapter.getDeliveryWithoutRef.mockRejectedValue(err);

      const req = {
        data: { OutboundDelivery: '99999999' },
        error: jest.fn()
      };

      await handlers['getDeliveryWithoutRef'](req);
      expect(req.error).toHaveBeenCalledWith(404, 'Delivery not found');
    });
  });
});
