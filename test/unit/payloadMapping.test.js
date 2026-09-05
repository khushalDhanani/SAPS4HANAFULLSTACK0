const { mapToS4Payload } = require('../../srv/integration/s4hana/PurchaseOrderMapper');
const validPayload = require('../fixtures/validPOPayload.json');

describe('Unit: Payload Mapping', () => {

    it('should map valid CAP header and item to S/4HANA OData structure', () => {
        const s4Payload = mapToS4Payload(validPayload.header, validPayload.items);

        expect(s4Payload.PurchaseOrderType).toBe('NB');
        expect(s4Payload.CompanyCode).toBe('1010');
        expect(s4Payload.PurchasingOrganization).toBe('1010');
        expect(s4Payload.PurchasingGroup).toBe('001');
        expect(s4Payload.Supplier).toBe('10300001');
        expect(s4Payload.DocumentCurrency).toBe('EUR');
        expect(s4Payload.IncotermsClassification).toBe('EXW');
        expect(s4Payload.IncotermsLocation1).toBe('MUMBAI');
        expect(s4Payload.PaymentTerms).toBe('0001');

        expect(s4Payload.to_PurchaseOrderItemTP).toBeInstanceOf(Array);
        expect(s4Payload.to_PurchaseOrderItemTP).toHaveLength(1);

        const firstItem = s4Payload.to_PurchaseOrderItemTP[0];
        expect(firstItem.PurchaseOrderItem).toBe('10');
        expect(firstItem.Material).toBe('TG11');
        expect(firstItem.Plant).toBe('1010');
        expect(firstItem.StorageLocation).toBe('101A');
        expect(firstItem.OrderQuantity).toBe('10');
        expect(firstItem.PurchaseOrderQuantityUnit).toBe('PC');
        expect(firstItem.NetPriceAmount).toBe('25.00');
        expect(firstItem.TaxCode).toBe('V1');

        expect(firstItem.to_PurOrdScheduleLineTP).toBeInstanceOf(Array);
        expect(firstItem.to_PurOrdScheduleLineTP).toHaveLength(1);
        expect(firstItem.to_PurOrdScheduleLineTP[0].ScheduleLineOrderQuantity).toBe('10');
        expect(firstItem.to_PurOrdScheduleLineTP[0].ScheduleLineDeliveryDate).toMatch(/^\/Date\(\d+\)\/$/);
    });

    it('should support multiple items with correct numbering and schedule lines', () => {
        const items = [
            {
                Material: 'MAT1',
                Plant: '1010',
                StorageLocation: '101A',
                OrderQuantity: 5,
                UnitOfMeasure: 'PC',
                NetPriceAmount: '12.50'
            },
            {
                Material: 'MAT2',
                Plant: '1010',
                StorageLocation: '101B',
                OrderQuantity: 20,
                UnitOfMeasure: 'KG',
                NetPriceAmount: '8.00'
            }
        ];

        const s4Payload = mapToS4Payload(validPayload.header, items);

        expect(s4Payload.to_PurchaseOrderItemTP).toHaveLength(2);
        expect(s4Payload.to_PurchaseOrderItemTP[0].PurchaseOrderItem).toBe('10');
        expect(s4Payload.to_PurchaseOrderItemTP[0].OrderQuantity).toBe('5');
        expect(s4Payload.to_PurchaseOrderItemTP[1].PurchaseOrderItem).toBe('20');
        expect(s4Payload.to_PurchaseOrderItemTP[1].OrderQuantity).toBe('20');
    });

    it('should omit undefined optional header and item fields', () => {
        const minimalHeader = {
            PurchaseOrderType: 'NB',
            CompanyCode: '1010',
            PurchasingOrganization: '1010',
            PurchasingGroup: '001',
            Supplier: '10300001',
            Currency: 'EUR'
        };

        const minimalItems = [
            {
                Material: 'TG11',
                Plant: '1010',
                OrderQuantity: 1,
                UnitOfMeasure: 'PC'
            }
        ];

        const s4Payload = mapToS4Payload(minimalHeader, minimalItems);

        expect(s4Payload.IncotermsClassification).toBeUndefined();
        expect(s4Payload.IncotermsLocation1).toBeUndefined();
        expect(s4Payload.PaymentTerms).toBeUndefined();
        expect(s4Payload.PurchaseOrderDate).toBeUndefined();

        const item = s4Payload.to_PurchaseOrderItemTP[0];
        expect(item.StorageLocation).toBeUndefined();
        expect(item.TaxCode).toBeUndefined();
        expect(item.MaterialGroup).toBeUndefined();
    });

    it('should throw if header is null or missing', () => {
        expect(() => mapToS4Payload(null, validPayload.items)).toThrow('Header is required');
    });

    it('should throw if items array is empty or missing', () => {
        expect(() => mapToS4Payload(validPayload.header, [])).toThrow('At least one item is required');
        expect(() => mapToS4Payload(validPayload.header, null)).toThrow('At least one item is required');
    });

    it('should derive RequisitionerName from options.user or fallback to SYSTEM when item RequisitionerName is absent', () => {
        const itemWithoutReq = [
            {
                Material: 'TG11',
                Plant: '1010',
                OrderQuantity: 1,
                UnitOfMeasure: 'PC'
            }
        ];

        // 1. With options.user
        const payloadWithUser = mapToS4Payload(validPayload.header, itemWithoutReq, { user: 'AUTH_TESTER' });
        expect(payloadWithUser.to_PurchaseOrderItemTP[0].RequisitionerName).toBe('AUTH_TESTER');

        // 2. Without options.user -> fallback to SYSTEM
        const payloadWithoutUser = mapToS4Payload(validPayload.header, itemWithoutReq);
        expect(payloadWithoutUser.to_PurchaseOrderItemTP[0].RequisitionerName).toBe('SYSTEM');

        // 3. Explicit item RequisitionerName overrides options.user
        const itemWithExplicitReq = [
            {
                Material: 'TG11',
                Plant: '1010',
                OrderQuantity: 1,
                UnitOfMeasure: 'PC',
                RequisitionerName: 'CUSTOM_REQ'
            }
        ];
        const payloadWithExplicit = mapToS4Payload(validPayload.header, itemWithExplicitReq, { user: 'AUTH_TESTER' });
        expect(payloadWithExplicit.to_PurchaseOrderItemTP[0].RequisitionerName).toBe('CUSTOM_REQ');
    });

});
