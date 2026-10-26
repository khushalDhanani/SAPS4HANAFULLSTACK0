const { OutboundDeliveryAdapter, _formatODataV2Date, _parseODataV2Date } = require('../../../srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter');

describe('Unit: OutboundDeliveryAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      get: jest.fn().mockResolvedValue({ status: 200, data: { d: { results: [] } } }),
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

      const orders = await adapter.getOrdersDueForDelivery({ shippingPoint: '1120', plant: '1120' });

      expect(mockClient.get).toHaveBeenCalledTimes(2);
      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain('/C_SalesOrderDueForDeliveryVH');
      expect(url).toContain("ShippingPoint eq '1120'");
      expect(url).not.toContain("DelivBlockReasonForSchedLine eq ''");

      expect(orders).toHaveLength(1);
      expect(orders[0].SalesOrder).toBe('5000104');
      expect(orders[0].DeliveryCreationDate).toBe('2025-08-14');
      expect(orders[0].ShipToParty).toBe('10082');
    });

    test('retains delivery blocked orders with their block reason', async () => {
      mockClient.get.mockResolvedValueOnce({
        status: 200,
        data: {
          d: {
            results: [
              {
                SalesOrder: '5000999',
                SalesOrderItem: '000010',
                ScheduleLine: '0001',
                ShippingPoint: '1120',
                DeliveryCreationDate: '/Date(1755129600000)/',
                DeliveryPriority: '00',
                Route: 'Z00001',
                ForwardingAgent: '',
                GoodsIssueDate: '/Date(1755129600000)/',
                ShipToParty: '10082',
                DelivBlockReasonForSchedLine: '01'
              }
            ]
          }
        }
      }).mockResolvedValueOnce({
        status: 200,
        data: { d: { results: [] } }
      });

      const orders = await adapter.getOrdersDueForDelivery({ shippingPoint: '1120', plant: '1120' });
      expect(orders).toHaveLength(1);
      expect(orders[0].SalesOrder).toBe('5000999');
      expect(orders[0].DelivBlockReasonForSchedLine).toBe('01');
    });

    test('enriches due orders with SalesDocApprovalStatus from SD_F1873_SO_WL_SRV', async () => {
      mockClient.get.mockResolvedValueOnce({
        status: 200,
        data: {
          d: {
            results: [
              {
                SalesOrder: '5000461',
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
      }).mockResolvedValueOnce({
        status: 200,
        data: {
          d: {
            results: [
              { SalesOrder: '5000461', SalesDocApprovalStatus: 'A' }
            ]
          }
        }
      });

       const orders = await adapter.getOrdersDueForDelivery({ salesOrder: '5000461', plant: '1120' });
      expect(orders).toHaveLength(1);
      expect(orders[0].SalesOrder).toBe('5000461');
      expect(orders[0].SalesDocApprovalStatus).toBe('A');
      expect(orders[0].IsDeliverable).toBe(false);
    });

    test('enriches released orders with SalesDocApprovalStatus B and marks IsDeliverable true', async () => {
      mockClient.get.mockResolvedValueOnce({
        status: 200,
        data: {
          d: {
            results: [
              {
                SalesOrder: '5000104',
                SalesOrderItem: '000010',
                ScheduleLine: '0001',
                ShippingPoint: '1120',
                DelivBlockReasonForSchedLine: ''
              }
            ]
          }
        }
      }).mockResolvedValueOnce({
        status: 200,
        data: {
          d: {
            results: [
              { SalesOrder: '5000104', SalesDocApprovalStatus: 'B' }
            ]
          }
        }
      });

      const orders = await adapter.getOrdersDueForDelivery({ salesOrder: '5000104', plant: '1120' });
      expect(orders).toHaveLength(1);
      expect(orders[0].SalesOrder).toBe('5000104');
      expect(orders[0].SalesDocApprovalStatus).toBe('B');
      expect(orders[0].IsDeliverable).toBe(true);
    });

    test('caches approval status map in-memory for 60s to prevent extra SAP calls on successive reads', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              { SalesOrder: '5000104', ShippingPoint: '1120', DelivBlockReasonForSchedLine: '' }
            ]
          }
        }
      });

      // First call - queries C_SalesOrderDueForDeliveryVH and _fetchApprovalStatusMap
      await adapter.getOrdersDueForDelivery({ shippingPoint: '1120', plant: '1120' });
      expect(mockClient.get).toHaveBeenCalledTimes(2);

      // Second call immediately after - uses cached approval map, queries only C_SalesOrderDueForDeliveryVH
      await adapter.getOrdersDueForDelivery({ shippingPoint: '1120', plant: '1120' });
      expect(mockClient.get).toHaveBeenCalledTimes(3); // 2 + 1 = 3 (approval map was not queried again)

      // Third call with forceRefresh - bypasses cache and queries approval map again
      await adapter.getOrdersDueForDelivery({ shippingPoint: '1120', plant: '1120' }, { forceRefresh: true });
      expect(mockClient.get).toHaveBeenCalledTimes(5); // 3 + 2 = 5
    });

    test('escapes embedded quotes in filters using odataString', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });

      await adapter.getOrdersDueForDelivery({ shippingPoint: "11'2", plant: '1120' });
      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain("ShippingPoint eq '11''2'");
    });

    test('fails closed (HTTP 400) when no plant resolves from query, options, or user context', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });

      await expect(adapter.getOrdersDueForDelivery({})).rejects.toMatchObject({
        status: 400,
        message: 'No plant resolved for orders due for delivery. Query failed closed.'
      });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    test('fails closed (HTTP 400) for an Admin without a Plant attribute and without a Plant filter', async () => {
      const user = { attr: {}, is: (r) => r === 'Admin' };
      await expect(adapter.getOrdersDueForDelivery({ query: { SELECT: {} } }, { user })).rejects.toMatchObject({ status: 400 });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    test('an Admin without a Plant attribute reads with the $filter Plant the worklist sends', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });
      const user = { attr: {}, is: (r) => r === 'Admin' };
      const req = { query: { SELECT: { where: [{ ref: ['Plant'] }, '=', { val: '1120' }] } } };
      await expect(adapter.getOrdersDueForDelivery(req, { user })).resolves.toEqual([]);
      expect(mockClient.get).toHaveBeenCalled();
    });

    test('reads the metrics function parameter Plant from req.data', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });
      const user = { attr: {}, is: (r) => r === 'Admin' };
      await expect(adapter.getOrdersDueForDelivery({ data: { Plant: '1120' } }, { user })).resolves.toEqual([]);
    });

    test('fails closed (HTTP 403) when authenticated non-admin user has no authorized plants', async () => {
      const user = { attr: { Plant: [] }, is: () => false };
      await expect(adapter.getOrdersDueForDelivery({}, { user })).rejects.toMatchObject({ status: 403, message: 'User has no authorized plants. Access denied.' });
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    test('tamper test: rejects query.plant outside authenticated non-admin user authorized plants with HTTP 403', async () => {
      const user = { attr: { Plant: ['1120'] }, is: () => false };
      await expect(adapter.getOrdersDueForDelivery({ plant: '1130' }, { user })).rejects.toThrow(
        "Plant '1130' is outside user's authorized plants: [1120]. Access denied."
      );
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    test('tamper test: rejects CAP request $filter Plant outside authenticated user authorized plants with HTTP 403', async () => {
      const capReq = {
        user: { attr: { Plant: ['1120'] }, is: () => false },
        query: {
          SELECT: {
            where: [{ ref: ['Plant'] }, '=', { val: '1130' }]
          }
        }
      };
      await expect(adapter.getOrdersDueForDelivery(capReq)).rejects.toThrow(
        "Plant '1130' is outside user's authorized plants: [1120]. Access denied."
      );
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    test('takes plant strictly from authenticated user attribute when query specifies no plant', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });
      const spyTvstz = jest.spyOn(adapter, 'getShippingPointsForPlant').mockResolvedValue(['1112', 'WAVG']);

      const user = { attr: { Plant: ['1120'] }, is: () => false };
      await adapter.getOrdersDueForDelivery({}, { user });

      expect(spyTvstz).toHaveBeenCalledWith('1120', expect.any(Object));
      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain("(ShippingPoint eq '1112' or ShippingPoint eq 'WAVG')");

      spyTvstz.mockRestore();
    });

    test('restores shipping point filter in getOrdersDueForDelivery using user plant and TVSTZ points with no config default', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });
      const spyTvstz = jest.spyOn(adapter, 'getShippingPointsForPlant').mockResolvedValue(['1112', 'WAVG']);

      await adapter.getOrdersDueForDelivery({ plant: '1120' });

      expect(spyTvstz).toHaveBeenCalledWith('1120', expect.any(Object));
      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain("(ShippingPoint eq '1112' or ShippingPoint eq 'WAVG')");

      spyTvstz.mockRestore();
    });

    test('filters by single TVSTZ point when plant has exactly one valid shipping point', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });
      const spyTvstz = jest.spyOn(adapter, 'getShippingPointsForPlant').mockResolvedValue(['WAVG']);

      await adapter.getOrdersDueForDelivery({ plant: '1120' });

      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain("ShippingPoint eq 'WAVG'");
      expect(url).not.toContain(' or ');

      spyTvstz.mockRestore();
    });

    test('derives plant from CAP request user attributes and applies TVSTZ points', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });
      const spyTvstz = jest.spyOn(adapter, 'getShippingPointsForPlant').mockResolvedValue(['1112', 'WAVG']);

      const capReq = {
        user: { attr: { Plant: ['1120'] } },
        query: { SELECT: { from: { ref: ['OrdersDueForDelivery'] } } }
      };

      await adapter.getOrdersDueForDelivery(capReq);

      expect(spyTvstz).toHaveBeenCalledWith('1120', expect.any(Object));
      const url = mockClient.get.mock.calls[0][0];
      expect(url).toContain("(ShippingPoint eq '1112' or ShippingPoint eq 'WAVG')");

      spyTvstz.mockRestore();
    });

    test('does not append $top or $skip for CAP requests so applyPaging manages pagination', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });

      const capReq = {
        user: { attr: { Plant: ['1120'] } },
        query: {
          SELECT: {
            limit: { rows: { val: 50 }, offset: { val: 50 } },
            where: [{ ref: ['ShippingPoint'] }, '=', { val: '1120' }]
          }
        }
      };

      await adapter.getOrdersDueForDelivery(capReq);
      const url = mockClient.get.mock.calls[0][0];
      expect(url).not.toContain('$top=');
      expect(url).not.toContain('$skip=');
      expect(url).toContain("ShippingPoint eq '1120'");
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

      await expect(adapter.getOrdersDueForDelivery({ shippingPoint: '1120', plant: '1120' })).rejects.toThrow('Database query timeout');
    });

    test('marks SalesDocApprovalStatus as unknown and invalidates cache when approval lookup fails', async () => {
      mockClient.get.mockResolvedValueOnce({
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
      }).mockRejectedValueOnce(new Error('Gateway timeout on approval status'));

      const orders = await adapter.getOrdersDueForDelivery({ shippingPoint: '1120', plant: '1120' });
      expect(orders).toHaveLength(1);
      expect(orders[0].SalesOrder).toBe('5000104');
      expect(orders[0].SalesDocApprovalStatus).toBe('unknown');

      // Verify that cache was cleared and does not store stale data
      expect(adapter._approvalCache.timestamp).toBe(0);
      expect(adapter._approvalCache.map.size).toBe(0);
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

    test('filters shipping points list to TVSTZ valid points when user plant is present', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              { ShippingPoint: '1104', ShippingPointName: 'Shipping Point 1104' },
              { ShippingPoint: '1112', ShippingPointName: 'Shipping Point 1112' },
              { ShippingPoint: 'WAVG', ShippingPointName: 'Shipping Point WAVG' },
              { ShippingPoint: '1000', ShippingPointName: 'Shipping Point 1000' }
            ]
          }
        }
      });
      const spyTvstz = jest.spyOn(adapter, 'getShippingPointsForPlant').mockResolvedValue(['1112', 'WAVG']);

      const points = await adapter.getShippingPoints({ plant: '1120' });

      expect(spyTvstz).toHaveBeenCalledWith('1120', expect.any(Object));
      expect(points).toHaveLength(2);
      expect(points.map(p => p.ShippingPoint)).toEqual(['1112', 'WAVG']);

      spyTvstz.mockRestore();
    });
  });

  describe('getShippingPointsForPlant (TVSTZ TTL Cache)', () => {
    let mockRfc;

    beforeEach(() => {
      mockRfc = {
        readTable: jest.fn().mockResolvedValue([
          { WERKS: '1120', VSTEL: '1112' },
          { WERKS: '1120', VSTEL: 'WAVG' }
        ])
      };
      adapter.clearTvstzCache();
    });

    test('reads TVSTZ via RFC on first call and caches entries in-memory', async () => {
      const points = await adapter.getShippingPointsForPlant('1120', { rfc: mockRfc });
      expect(points).toEqual(['1112', 'WAVG']);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);
      expect(mockRfc.readTable).toHaveBeenCalledWith('TVSTZ', ['WERKS', 'VSTEL'], ["WERKS = '1120'"]);

      // Verify cache entry structure
      const entry = adapter.getTvstzCacheEntry('1120');
      expect(entry).toBeDefined();
      expect(entry.points).toEqual(['1112', 'WAVG']);
      expect(entry.expiresAt).toBeGreaterThan(Date.now());
    });

    test('confirms second read uses TTL cache without re-querying RFC', async () => {
      // First read: populates cache
      await adapter.getShippingPointsForPlant('1120', { rfc: mockRfc });
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);

      // Second read immediately after: served from TTL cache
      const cachedPoints = await adapter.getShippingPointsForPlant('1120', { rfc: mockRfc });
      expect(cachedPoints).toEqual(['1112', 'WAVG']);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1); // Not called again!
    });

    test('re-queries TVSTZ when cached entry has expired', async () => {
      // Seed cache with expired entry
      adapter._tvstzCache.set('1120', {
        points: ['1112'],
        expiresAt: Date.now() - 500 // expired
      });

      const points = await adapter.getShippingPointsForPlant('1120', { rfc: mockRfc });
      expect(points).toEqual(['1112', 'WAVG']);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);
    });

    test('bypasses cache when forceRefresh: true is passed', async () => {
      // Seed cache with valid entry
      adapter._tvstzCache.set('1120', {
        points: ['1112'],
        expiresAt: Date.now() + 60000
      });

      const points = await adapter.getShippingPointsForPlant('1120', { rfc: mockRfc, forceRefresh: true });
      expect(points).toEqual(['1112', 'WAVG']);
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);
    });

    test('re-queries TVSTZ after clearTvstzCache()', async () => {
      await adapter.getShippingPointsForPlant('1120', { rfc: mockRfc });
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);

      adapter.clearTvstzCache();
      expect(adapter.getTvstzCacheEntry('1120')).toBeNull();

      await adapter.getShippingPointsForPlant('1120', { rfc: mockRfc });
      expect(mockRfc.readTable).toHaveBeenCalledTimes(2);
    });

    test('confirms getOrdersDueForDelivery uses the TVSTZ TTL cache for repeated plant queries', async () => {
      mockClient.get.mockResolvedValue({ status: 200, data: { d: { results: [] } } });

      // First call to getOrdersDueForDelivery queries TVSTZ via RFC
      await adapter.getOrdersDueForDelivery({ plant: '1120' }, { rfc: mockRfc });
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);

      // Second call for same plant uses cached TVSTZ points without re-reading RFC
      await adapter.getOrdersDueForDelivery({ plant: '1120' }, { rfc: mockRfc });
      expect(mockRfc.readTable).toHaveBeenCalledTimes(1);
    });
  });

  describe('createDeliveryFromOrder', () => {
    test('throws 400 when SalesOrder reference is missing', async () => {
      await expect(adapter.createDeliveryFromOrder({ salesOrder: '' })).rejects.toThrow('SalesOrder reference is required');
      await expect(adapter.createDeliveryFromOrder({})).rejects.toThrow('SalesOrder reference is required');
    });

    test('throws 400 when ShippingPoint is missing and never defaults to first list entry', async () => {
      await expect(adapter.createDeliveryFromOrder({ salesOrder: '5000104' })).rejects.toThrow('ShippingPoint is required to create an outbound delivery and cannot be defaulted.');
      await expect(adapter.createDeliveryFromOrder({ salesOrder: '5000104', shippingPoint: '' })).rejects.toThrow('ShippingPoint is required to create an outbound delivery and cannot be defaulted.');
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

    test('blocks with 502 when approval status check fails from Gateway', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('SD_F1873_SO_WL_SRV timeout'));

      await expect(
        adapter.createDeliveryFromOrder({
          salesOrder: '5000104',
          shippingPoint: '1120'
        })
      ).rejects.toThrow('Could not verify approval status for Sales Order 5000104. Outbound delivery creation blocked.');
    });

    test('blocks with 400 when order is unapproved (status A, C, or D)', async () => {
      mockClient.get.mockResolvedValueOnce({
        status: 200,
        data: {
          d: {
            results: [
              { SalesOrder: '5000461', SalesDocApprovalStatus: 'A' }
            ]
          }
        }
      });

      await expect(
        adapter.createDeliveryFromOrder({
          salesOrder: '5000461',
          shippingPoint: '1120'
        })
      ).rejects.toThrow('Sales Order 5000461 is in approval and cannot be delivered.');
    });

    test('bypasses approval check when skipApprovalCheck is true', async () => {
      mockClient.post.mockResolvedValue({
        status: 201,
        data: {
          d: {
            OutboundDelivery: '13000528',
            ReferenceSDDocument: '5000461',
            ShippingPoint: '1120'
          }
        }
      });

      const result = await adapter.createDeliveryFromOrder(
        { salesOrder: '5000461', shippingPoint: '1120' },
        { skipApprovalCheck: true }
      );

      expect(mockClient.get).not.toHaveBeenCalled();
      expect(result.OutboundDelivery).toBe('13000528');
    });
  });

  describe('postGoodsIssue (SD_SOFM_CREDIT_BLOCK_SRV/PostGoodsIssue)', () => {
    test('rejects without a delivery number', async () => {
      await expect(adapter.postGoodsIssue('')).rejects.toThrow('DeliveryDocument is required');
    });

    test('posts the function import with the delivery in the URL and reports SAP Done flag', async () => {
      mockClient.post.mockResolvedValue({ data: { d: { PostGoodsIssue: { Done: true, ErrorAny: false, ErrorInGoodsIssue: false } } } });
      const res = await adapter.postGoodsIssue('13000526');
      expect(mockClient.post.mock.calls[0][0]).toBe("/sap/opu/odata/sap/SD_SOFM_CREDIT_BLOCK_SRV/PostGoodsIssue?DeliveryNumber='13000526'");
      expect(res).toEqual({ DeliveryDocument: '13000526', Done: true, ErrorFlags: [] });
    });

    test('throws (never reports success) when SAP says Done=false and names the error flags', async () => {
      mockClient.post.mockResolvedValue({ data: { d: { Done: false, ErrorAny: true, ErrorInGoodsIssue: true, ErrorInFinalCheck: false } } });
      await expect(adapter.postGoodsIssue('13000526')).rejects.toThrow(/did not post goods issue.*ErrorInGoodsIssue/);
    });
  });

  describe('getBillingDocumentTypes / createBillingDocument (SD_CUSTOMER_INVOICES_CREATE)', () => {
    test('returns the types SAP lists for the delivery', async () => {
      mockClient.post.mockResolvedValue({ data: { d: { results: [{ BillingDocumentType: 'F2', BillingDocumentTypeName: 'Invoice' }, { BillingDocumentType: '', BillingDocumentTypeName: 'x' }] } } });
      const rows = await adapter.getBillingDocumentTypes('13000526');
      expect(mockClient.post.mock.calls[0][0]).toBe("/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_CREATE/GetBillingDocumentTypes?ReferenceSDDocument='13000526'");
      expect(rows).toEqual([{ BillingDocumentType: 'F2', BillingDocumentTypeName: 'Invoice' }]);
    });

    test('passes category J, the optional type and the optional date; without a type SAP determines it', async () => {
      mockClient.post.mockResolvedValueOnce({ data: { d: { results: [{ BillingDocument: '90000122' }] } } });
      await adapter.createBillingDocument({ deliveryDocument: '13000522' });
      const call0Url = mockClient.post.mock.calls[0][0];
      expect(call0Url).toContain("/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_CREATE/CreateBillingDocuments?");
      expect(call0Url).toContain("ReferenceSDDocument='13000522'");
      expect(call0Url).toContain("ReferenceSDDocumentCategory='J'");
      expect(call0Url).toContain("RefSDDocWithInvalidPartner=''");
      expect(call0Url).toContain("BillingDocumentType=''");

      mockClient.post.mockClear();
      mockClient.post.mockResolvedValue({ data: { d: { results: [{ BillingDocument: '90000123', MessageType: 'S', Message: 'Document 90000123 saved', BillToParty: '20021', BillToPartyName: 'ABC' }] } } });
      const res = await adapter.createBillingDocument({ deliveryDocument: '13000526', billingDocumentType: 'F2', billingDocumentDate: '2026-09-22' });
      const call1Url = mockClient.post.mock.calls[0][0];
      expect(call1Url).toContain("ReferenceSDDocument='13000526'");
      expect(call1Url).toContain("ReferenceSDDocumentCategory='J'");
      expect(call1Url).toContain("BillingDocumentType='F2'");
      expect(call1Url).toContain("BillingDocumentDate='20260922'");
      expect(call1Url).toContain("RequestedBillingDocumentDate='20260922'");
      expect(res.BillingDocument).toBe('90000123');
      expect(res.BillToParty).toBe('20021');
      expect(res.Messages).toEqual([{ MessageType: 'S', MessageId: '', Message: 'Document 90000123 saved' }]);
    });

    test('throws with SAP messages when no billing document number comes back', async () => {
      mockClient.post.mockResolvedValue({ data: { d: { results: [{ BillingDocument: '', MessageType: 'E', Message: 'Delivery has no goods issue' }] } } });
      await expect(adapter.createBillingDocument({ deliveryDocument: '13000526', billingDocumentType: 'F2' })).rejects.toThrow(/no billing document.*Delivery has no goods issue/);
    });
  });

  describe('getDeliveryStatus (SD_SOF/I_DeliveryDocument)', () => {
    test('reads the header statuses by $filter and returns null when SAP has no row', async () => {
      mockClient.get.mockResolvedValueOnce({ data: { d: { results: [{ DeliveryDocument: '13000515', DeliveryDocumentType: 'ZLF', OverallPickingStatus: 'C', OverallGoodsMovementStatus: 'A', OverallDelivReltdBillgStatus: 'A', ActualGoodsMovementDate: null }] } } });
      const s = await adapter.getDeliveryStatus('13000515');
      expect(mockClient.get.mock.calls[0][0]).toContain("/sap/opu/odata/sap/SD_SOF/I_DeliveryDocument?$filter=DeliveryDocument%20eq%20'13000515'");
      expect(s).toMatchObject({ DeliveryDocument: '13000515', OverallPickingStatus: 'C', OverallGoodsMovementStatus: 'A', ActualGoodsMovementDate: null });
      mockClient.get.mockResolvedValueOnce({ data: { d: { results: [] } } });
      expect(await adapter.getDeliveryStatus('99')).toBeNull();
    });
  });
});
