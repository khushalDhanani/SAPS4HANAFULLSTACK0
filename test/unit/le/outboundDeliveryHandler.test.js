jest.mock('../../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter', () => ({
  getOrdersDueForDelivery: jest.fn(),
  getShippingPoints: jest.fn(),
  createDeliveryFromOrder: jest.fn()
}));

const outboundDeliveryAdapter = require('../../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');
const registerOutboundDeliveryHandlers = require('../../../srv/le/outbound-delivery/handlers/outboundDelivery.handler');
const s4Config = require('../../../srv/common/s4Config');

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

describe('Unit: OutboundDeliveryService Handlers', () => {
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = createMockService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('READ OrdersDueForDelivery', () => {
    test('delegates to adapter and applies paging', async () => {
      const mockOrders = [
        { SalesOrder: '5000104', SalesOrderItem: '000010', ScheduleLine: '0001', ShippingPoint: '1120' },
        { SalesOrder: '5000126', SalesOrderItem: '000010', ScheduleLine: '0001', ShippingPoint: '1120' }
      ];
      outboundDeliveryAdapter.getOrdersDueForDelivery.mockResolvedValue(mockOrders);

      const req = {
        query: { SELECT: { limit: { rows: { val: 1 } } } }
      };

      const result = await handlers['READ_OrdersDueForDelivery'](req);

      expect(outboundDeliveryAdapter.getOrdersDueForDelivery).toHaveBeenCalledWith(req);
      expect(result).toHaveLength(1);
      expect(result[0].SalesOrder).toBe('5000104');
    });

    test('calls req.error when adapter rejects', async () => {
      const err = new Error('Gateway timeout');
      err.status = 502;
      outboundDeliveryAdapter.getOrdersDueForDelivery.mockRejectedValue(err);

      const req = {
        query: {},
        error: jest.fn()
      };

      await handlers['READ_OrdersDueForDelivery'](req);

      expect(req.error).toHaveBeenCalledWith(502, 'Gateway timeout');
    });
  });

  describe('READ ShippingPointVH', () => {
    test('delegates to adapter and returns shipping points', async () => {
      const mockSPs = [
        { ShippingPoint: '1120', ShippingPointName: '1130-FG Loading Area' }
      ];
      outboundDeliveryAdapter.getShippingPoints.mockResolvedValue(mockSPs);

      const req = { query: {} };
      const result = await handlers['READ_ShippingPointVH'](req);

      expect(outboundDeliveryAdapter.getShippingPoints).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockSPs);
    });

    test('calls req.error when adapter fails', async () => {
      const err = new Error('Service unavailable');
      err.status = 503;
      outboundDeliveryAdapter.getShippingPoints.mockRejectedValue(err);

      const req = {
        query: {},
        error: jest.fn()
      };

      await handlers['READ_ShippingPointVH'](req);

      expect(req.error).toHaveBeenCalledWith(503, 'Service unavailable');
    });
  });

  describe('createOutboundDelivery action', () => {
    test('rejects with 400 when SalesOrder is missing', async () => {
      const req = {
        data: { SalesOrder: '' },
        error: jest.fn()
      };

      await handlers['createOutboundDelivery'](req);

      expect(req.error).toHaveBeenCalledWith(400, 'SalesOrder is required to create an outbound delivery.');
      expect(outboundDeliveryAdapter.createDeliveryFromOrder).not.toHaveBeenCalled();
    });

    test('creates outbound delivery with specified shipping point and delivery date', async () => {
      outboundDeliveryAdapter.createDeliveryFromOrder.mockResolvedValue({
        OutboundDelivery: '13000526',
        ReferenceSDDocument: '5000104',
        ShippingPoint: '1120'
      });

      const req = {
        data: {
          SalesOrder: '5000104',
          ShippingPoint: '1120',
          DeliveryDate: '2025-08-14'
        },
        error: jest.fn()
      };

      const result = await handlers['createOutboundDelivery'](req);

      expect(outboundDeliveryAdapter.createDeliveryFromOrder).toHaveBeenCalledWith({
        salesOrder: '5000104',
        shippingPoint: '1120',
        deliveryDate: '2025-08-14'
      });
      expect(result).toBe('13000526');
      expect(req.error).not.toHaveBeenCalled();
    });

    test('defaults shipping point from s4Config when none provided in payload', async () => {
      outboundDeliveryAdapter.createDeliveryFromOrder.mockResolvedValue({
        OutboundDelivery: '13000526'
      });

      const req = {
        data: {
          SalesOrder: '5000104'
        },
        error: jest.fn()
      };

      await handlers['createOutboundDelivery'](req);

      const configuredDefaultSP = s4Config.getShippingPoints()[0];
      expect(outboundDeliveryAdapter.createDeliveryFromOrder).toHaveBeenCalledWith({
        salesOrder: '5000104',
        shippingPoint: configuredDefaultSP,
        deliveryDate: undefined
      });
    });

    test('propagates mapped adapter error to req.error', async () => {
      const err = new Error('Subsequent documents not possible due to approval status of the document.');
      err.status = 400;
      outboundDeliveryAdapter.createDeliveryFromOrder.mockRejectedValue(err);

      const req = {
        data: {
          SalesOrder: '5000461',
          ShippingPoint: 'WAVG'
        },
        error: jest.fn()
      };

      await handlers['createOutboundDelivery'](req);

      expect(req.error).toHaveBeenCalledWith(
        400,
        'Subsequent documents not possible due to approval status of the document.'
      );
    });
  });

  describe('getDefaultShippingPoint function', () => {
    test('returns primary shipping point and configured list from s4Config', async () => {
      const result = await handlers['getDefaultShippingPoint']();

      const expectedSPs = s4Config.getShippingPoints();
      expect(result).toEqual({
        ShippingPoint: expectedSPs[0],
        ShippingPoints: expectedSPs
      });
    });
  });
});
