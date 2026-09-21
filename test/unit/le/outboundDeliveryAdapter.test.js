const { OutboundDeliveryAdapter, _formatODataV2Date, _parseODataV2Date } = require('../../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');
const s4Config = require('../../../srv/common/s4Config');

describe('Unit: OutboundDeliveryAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      get: jest.fn(),
      post: jest.fn()
    };
    adapter = new OutboundDeliveryAdapter({ client: mockClient });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Date Helpers', () => {
    test('_formatODataV2Date formats Date and ISO strings to /Date(ms)/', () => {
      expect(_formatODataV2Date(null)).toBeUndefined();
      expect(_formatODataV2Date('invalid')).toBeUndefined();
      expect(_formatODataV2Date('/Date(1755129600000)/')).toBe('/Date(1755129600000)/');

      const d = new Date('2026-09-25T00:00:00.000Z');
      const formatted = _formatODataV2Date(d);
      expect(formatted).toBe(`/Date(${d.getTime()})/`);
    });

    test('_parseODataV2Date extracts YYYY-MM-DD from /Date(ms)/', () => {
      expect(_parseODataV2Date(null)).toBeNull();
      // Date(1755129600000) corresponds to 2025-08-14 UTC
      const parsed = _parseODataV2Date('/Date(1755129600000)/');
      expect(parsed).toBe('2025-08-14');
    });
  });

  describe('getOrdersDueForDelivery', () => {
    test('queries C_SalesOrderDueForDeliveryVH with explicit ShippingPoint filter using odataString', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              {
                SalesOrder: '5000104',
                SalesOrderItem: '000010',
                ScheduleLine: '0001',
                ShippingPoint: '1120',
                DeliveryCreationDate: '/Date(1755129600000)/',
                DeliveryPriority: '00',
                Route: 'Z00001',
                ForwardingAgent: '',
                GoodsIssueDate: '/Date(1755129600000)/',
                ShipToParty: '10082',
                DelivBlockReasonForSchedLine: ''
              }
            ]
          }
        }
      });

      const orders = await adapter.getOrdersDueForDelivery({ shippingPoint: '1120' });

      expect(mockClient.get).toHaveBeenCalledTimes(1);
      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain('/C_SalesOrderDueForDeliveryVH');
      expect(url).toContain("ShippingPoint eq '1120'");
      expect(url).toContain("DelivBlockReasonForSchedLine eq ''");

      expect(orders).toHaveLength(1);
      expect(orders[0].SalesOrder).toBe('5000104');
      expect(orders[0].DeliveryCreationDate).toBe('2025-08-14');
      expect(orders[0].ShipToParty).toBe('10082');
    });

    test('escapes embedded quotes in filters using odataString', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });

      await adapter.getOrdersDueForDelivery({ shippingPoint: "11'2" });
      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain("ShippingPoint eq '11''2'");
    });

    test('defaults to configured shipping points when no shipping point filter is provided', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });

      await adapter.getOrdersDueForDelivery({});
      const url = mockClient.get.mock.calls[0][0];
      const configuredSPs = s4Config.getShippingPoints() || ['1120'];
      if (configuredSPs.length > 1) {
        configuredSPs.forEach(sp => expect(url).toContain(`ShippingPoint eq '${sp}'`));
      } else {
        expect(url).toContain(`ShippingPoint eq '${configuredSPs[0]}'`);
      }
    });

    test('propagates mapped S/4 error when Gateway request fails', async () => {
      mockClient.get.mockRejectedValue({
        status: 500,
        message: 'Internal Gateway Error',
        response: {
          data: {
            error: {
              code: 'SY/530',
              message: { value: 'System error in backend' },
              innererror: {
                errordetails: [
                  { message: 'Database query timeout' }
                ]
              }
            }
          }
        }
      });

      await expect(adapter.getOrdersDueForDelivery({ shippingPoint: '1120' })).rejects.toThrow('Database query timeout');
    });
  });

  describe('getShippingPoints', () => {
    test('queries C_ShippingPointVH and returns mapped list', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              {
                ShippingPoint: '1120',
                ShippingPointName: '1130-FG Loading Area',
                ShippingPoint_Text: '1130-FG Loading Area',
                ActiveDepartureCountry: 'IN'
              },
              {
                ShippingPoint: '1112',
                ShippingPointName: '1112-Dispatch',
                ShippingPoint_Text: '1112-Dispatch',
                ActiveDepartureCountry: 'IN'
              }
            ]
          }
        }
      });

      const sps = await adapter.getShippingPoints();

      expect(mockClient.get).toHaveBeenCalledTimes(1);
      expect(mockClient.get.mock.calls[0][0]).toContain('/C_ShippingPointVH');
      expect(sps).toHaveLength(2);
      expect(sps[0].ShippingPoint).toBe('1120');
      expect(sps[0].ShippingPointName).toBe('1130-FG Loading Area');
    });
  });

  describe('createDeliveryFromOrder', () => {
    test('throws 400 when SalesOrder reference is missing', async () => {
      await expect(adapter.createDeliveryFromOrder({ salesOrder: '' })).rejects.toThrow('SalesOrder reference is required');
      await expect(adapter.createDeliveryFromOrder({})).rejects.toThrow('SalesOrder reference is required');
    });

    test('POSTs minimal payload with ReferenceSDDocument and ShippingPoint only', async () => {
      mockClient.post.mockResolvedValue({
        status: 201,
        data: {
          d: {
            OutboundDelivery: '13000526',
            ReferenceSDDocument: '5000104',
            ShippingPoint: '1120',
            DeliveryDocumentType: 'ZLF',
            DeliveryDate: null
          }
        }
      });

      const result = await adapter.createDeliveryFromOrder({
        salesOrder: '5000104',
        shippingPoint: '1120'
      });

      expect(mockClient.post).toHaveBeenCalledTimes(1);
      const [url, callOptions] = mockClient.post.mock.calls[0];
      expect(url).toContain('/C_DelivWthRefQuickCreate');
      expect(callOptions.data).toEqual({
        ReferenceSDDocument: '5000104',
        ShippingPoint: '1120'
      });

      expect(result.OutboundDelivery).toBe('13000526');
      expect(result.ReferenceSDDocument).toBe('5000104');
      expect(result.ShippingPoint).toBe('1120');
    });

    test('includes DeliveryDate in /Date(ms)/ format when specified', async () => {
      mockClient.post.mockResolvedValue({
        status: 201,
        data: {
          d: {
            OutboundDelivery: '13000527',
            ReferenceSDDocument: '5000104',
            ShippingPoint: '1120',
            DeliveryDate: '/Date(1755129600000)/'
          }
        }
      });

      const dateStr = '2025-08-14';
      await adapter.createDeliveryFromOrder({
        salesOrder: '5000104',
        shippingPoint: '1120',
        deliveryDate: dateStr
      });

      const callOptions = mockClient.post.mock.calls[0][1];
      expect(callOptions.data.DeliveryDate).toMatch(/^\/Date\(\d+\)\/$/);
    });

    test('maps SAP approval block error V2/478 with clean status and message', async () => {
      mockClient.post.mockRejectedValue({
        status: 400,
        response: {
          data: {
            error: {
              code: 'V2/478',
              message: {
                lang: 'en',
                value: 'Subsequent documents not possible due to approval status of the document.'
              },
              innererror: {
                errordetails: [
                  {
                    code: 'V2/478',
                    message: 'Subsequent documents not possible due to approval status of the document.'
                  }
                ]
              }
            }
          }
        }
      });

      await expect(
        adapter.createDeliveryFromOrder({
          salesOrder: '5000461',
          shippingPoint: 'WAVG'
        })
      ).rejects.toThrow('Subsequent documents not possible due to approval status of the document.');
    });
  });
});
