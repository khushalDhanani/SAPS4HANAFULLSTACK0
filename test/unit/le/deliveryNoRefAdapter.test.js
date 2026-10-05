const { DeliveryNoRefAdapter, _formatODataV2Date, _parseODataV2Date } = require('../../../srv/integration/s4hana/le/delivery-no-ref/DeliveryNoRefAdapter');

describe('Unit: DeliveryNoRefAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      get: jest.fn().mockResolvedValue({ status: 200, data: { d: { results: [] } } }),
      post: jest.fn()
    };
    adapter = new DeliveryNoRefAdapter({ client: mockClient });
    jest.clearAllMocks();
  });

  describe('Date Helpers', () => {
    test('_formatODataV2Date formats Date and ISO strings to /Date(ms)/', () => {
      expect(_formatODataV2Date(null)).toBeUndefined();
      expect(_formatODataV2Date('invalid')).toBeUndefined();
      expect(_formatODataV2Date('/Date(1755129600000)/')).toBe('/Date(1755129600000)/');

      const d = new Date('2026-10-01T00:00:00.000Z');
      expect(_formatODataV2Date(d)).toBe(`/Date(${d.getTime()})/`);
    });

    test('_parseODataV2Date parses /Date(ms)/ to YYYY-MM-DD', () => {
      expect(_parseODataV2Date(null)).toBeNull();
      expect(_parseODataV2Date('/Date(1790467200000)/')).toBe('2026-09-27');
      const d = new Date('2026-10-01T00:00:00.000Z');
      expect(_parseODataV2Date(d)).toBe('2026-10-01');
    });
  });

  describe('createDeliveryWithoutRef', () => {
    test('validates required fields: shippingPoint, shipToParty, plant, storageLocation, and items', async () => {
      await expect(adapter.createDeliveryWithoutRef({})).rejects.toThrow('ShippingPoint is required');
      await expect(adapter.createDeliveryWithoutRef({ shippingPoint: '1104' })).rejects.toThrow('ShipToParty is required');
      await expect(adapter.createDeliveryWithoutRef({ shippingPoint: '1104', shipToParty: '10135' })).rejects.toThrow('Plant is required');
      await expect(adapter.createDeliveryWithoutRef({ shippingPoint: '1104', shipToParty: '10135', plant: '1110' })).rejects.toThrow('StorageLocation is required');
      await expect(adapter.createDeliveryWithoutRef({ shippingPoint: '1104', shipToParty: '10135', plant: '1110', storageLocation: 'FG01' })).rejects.toThrow('At least one item is required');
      await expect(adapter.createDeliveryWithoutRef({
        shippingPoint: '1104',
        shipToParty: '10135',
        plant: '1110',
        storageLocation: 'FG01',
        items: [{ material: '' }]
      })).rejects.toThrow('Material is required');
    });

    test('successfully posts deep insert payload and returns SAP delivery number', async () => {
      mockClient.post.mockResolvedValue({
        status: 201,
        data: {
          d: {
            OutboundDelivery: '80000059',
            ShippingPoint: '1104',
            DeliveryDocumentType: 'LO2',
            Plant: '1110',
            StorageLocation: 'FG01',
            ShipToParty: '10135',
            PlannedGoodsIssueDate: '/Date(1790467200000)/'
          }
        }
      });

      const result = await adapter.createDeliveryWithoutRef({
        shippingPoint: '1104',
        deliveryType: 'LO2',
        salesOrg: '1000',
        distChannel: '10',
        division: '52',
        shipToParty: '10135',
        plant: '1110',
        storageLocation: 'FG01',
        plannedGoodsIssueDate: '2026-10-01',
        items: [
          { material: '4000000186', quantity: 2, uom: 'KG' }
        ]
      });

      expect(result.OutboundDelivery).toBe('80000059');
      expect(result.ShippingPoint).toBe('1104');
      expect(result.DeliveryDocumentType).toBe('LO2');
      expect(result.ItemCount).toBe(1);

      expect(mockClient.post).toHaveBeenCalledWith(
        '/sap/opu/odata/sap/LE_SHP_QC_DLVNOREF_SRV/C_DelivWthoutRefQuickCreate',
        expect.objectContaining({
          data: expect.objectContaining({
            ShippingPoint: '1104',
            DeliveryDocumentType: 'LO2',
            Plant: '1110',
            StorageLocation: 'FG01',
            ShipToParty: '10135',
            to_DeliveryItemQuickCreate: [
              {
                DeliveryDocumentItem: '000010',
                Material: '4000000186',
                ActualDeliveryQuantity: '2.000',
                DeliveryQuantityUnit: 'KG'
              }
            ]
          })
        })
      );
    });

    test('throws mapped error when S/4HANA returns error response', async () => {
      const s4Error = new Error('Document is incomplete');
      s4Error.status = 400;
      s4Error.response = {
        status: 400,
        data: {
          error: {
            code: 'VU/013',
            message: { value: 'Document is incomplete' }
          }
        }
      };
      mockClient.post.mockRejectedValue(s4Error);

      await expect(adapter.createDeliveryWithoutRef({
        shippingPoint: '1104',
        shipToParty: '10135',
        plant: '1110',
        storageLocation: 'FG01',
        items: [{ material: '4000000186', quantity: 1, uom: 'KG' }]
      })).rejects.toThrow('Document is incomplete');
    });
  });

  describe('getDeliveryWithoutRef', () => {
    test('throws 400 if deliveryId is missing', async () => {
      await expect(adapter.getDeliveryWithoutRef('')).rejects.toThrow('OutboundDelivery ID is required');
    });

    test('reads both header and items and combines them', async () => {
      mockClient.get.mockImplementation((url) => {
        if (url.includes('C_DelivWthoutRefQuickCreate')) {
          return Promise.resolve({
            status: 200,
            data: {
              d: {
                OutboundDelivery: '80000059',
                ShippingPoint: '1104',
                ShippingPointName: '1110-FG Loading Area',
                DeliveryDocumentType: 'LO2',
                DeliveryDocumentTypeName: 'Delivery w/o Ref.',
                ShipToParty: '10135',
                CustomerName: "Divi's Laboratories Limited",
                Plant: '1110',
                StorageLocation: 'FG01'
              }
            }
          });
        }
        if (url.includes('C_DelivItmWthoutRefQuickCrte')) {
          return Promise.resolve({
            status: 200,
            data: {
              d: {
                results: [
                  {
                    OutboundDelivery: '80000059',
                    DeliveryDocumentItem: '000010',
                    Material: '4000000186',
                    MaterialName: 'NODG 150 Kgs Packing',
                    ActualDeliveryQuantity: '1.000',
                    DeliveryQuantityUnit: 'KG'
                  }
                ]
              }
            }
          });
        }
        return Promise.reject(new Error('Unknown url'));
      });

      const res = await adapter.getDeliveryWithoutRef('80000059');
      expect(res.OutboundDelivery).toBe('80000059');
      expect(res.ShippingPoint).toBe('1104');
      expect(res.CustomerName).toBe("Divi's Laboratories Limited");
      expect(res.Items).toHaveLength(1);
      expect(res.Items[0].Material).toBe('4000000186');
    });
  });

  describe('Value Helps', () => {
    test('getDeliveryTypes reads C_DelivTypeNoRefVH', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              { DeliveryDocumentType: 'LO', DeliveryDocumentTypeName: 'Delivery w/o Ref.', SDDocumentCategory: 'J', PrecedingDocumentRequirement: '' },
              { DeliveryDocumentType: 'LO2', DeliveryDocumentTypeName: 'Delivery w/o Ref.', SDDocumentCategory: 'J', PrecedingDocumentRequirement: '' }
            ]
          }
        }
      });

      const types = await adapter.getDeliveryTypes();
      expect(types).toHaveLength(2);
      expect(types[0].DeliveryDocumentType).toBe('LO');
    });

    test('getShippingPoints reads C_ShippingPointVH', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              { ShippingPoint: '1104', ShippingPointName: '1110-FG Loading Area', ActiveDepartureCountry: 'IN' }
            ]
          }
        }
      });

      const points = await adapter.getShippingPoints();
      expect(points).toHaveLength(1);
      expect(points[0].ShippingPoint).toBe('1104');
    });

    test('getShipToParties reads C_DeliveryShipToPartyVH', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              { Customer: '10135', CustomerName: "Divi's Laboratories Limited", CityName: 'Hyderabad', Country: 'IN' }
            ]
          }
        }
      });

      const parties = await adapter.getShipToParties(10);
      expect(parties).toHaveLength(1);
      expect(parties[0].Customer).toBe('10135');
    });

    test('getMaterials reads C_Materialvaluehelp', async () => {
      mockClient.get.mockResolvedValue({
        status: 200,
        data: {
          d: {
            results: [
              { Material: '4000000186', Material_Text: 'NODG 150 Kgs Packing', MaterialType: 'ZFRT', MaterialBaseUnit: 'KG' }
            ]
          }
        }
      });

      const mats = await adapter.getMaterials(10);
      expect(mats).toHaveLength(1);
      expect(mats[0].Material).toBe('4000000186');
    });
  });
});
