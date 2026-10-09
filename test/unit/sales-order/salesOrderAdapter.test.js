const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

describe('Unit: Sales Order Adapter Integration', () => {
    let adapter;

    beforeEach(() => {
        adapter = new salesInquiryAdapter.SalesInquiryAdapter();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('createSalesOrder via Deep Insert', () => {
        test('constructs atomic OData Deep Insert payload and returns generated document number', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000460',
                        NetAmount: '1250.00',
                        DocumentCurrency: 'INR'
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                PurchaseOrderNumber: 'PO-DEEP-001',
                RequestedDeliveryDate: '2026-09-30',
                TransactionCurrency: 'INR'
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 5,
                    OrderQuantityUnit: 'KG',
                    Plant: '1120',
                    NetPriceAmount: 250.00,
                    RequestedDeliveryDate: '2026-09-30'
                }
            ];

            const result = await adapter.createSalesOrder(header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000460');
            expect(result.SalesDocument).toBe('5000460');
            expect(result.TotalNetAmount).toBe('1250.00');
            expect(result.TransactionCurrency).toBe('INR');

            // 1 atomic POST + 1 GET read-back
            expect(mockExecute).toHaveBeenCalledTimes(2);
            const callConfig = mockExecute.mock.calls[0][1];
            expect(callConfig.method).toBe('post');
            expect(callConfig.url).toContain('/HeaderSet');

            // Verify Deep Insert structure
            const payload = callConfig.data;
            expect(payload.SalesOrderTypeCode).toBe('ZDOM');
            expect(payload.SalesOrganization).toBe('1000');
            expect(payload.DistributionChannel).toBe('10');
            expect(payload.Division).toBe('52');
            expect(payload.SoldToPartyID).toBe('10135');
            expect(payload.PurchaseOrderNumber).toBe('PO-DEEP-001');
            expect(payload.RequestedDeliveryDate).toMatch(/^\/Date\(\d+\)\/$/);

            // Verify nested ItemSet
            expect(payload.ItemSet).toHaveLength(1);
            expect(payload.ItemSet[0].MaterialID).toBe('4000000123');
            expect(payload.ItemSet[0].OrderQty).toBe('5.000');
            expect(payload.ItemSet[0].SalesUnit).toBe('KG');
            expect(payload.ItemSet[0].Plant).toBe('1120');
            expect(payload.ItemSet[0].RequestedDeliveryDate).toMatch(/^\/Date\(\d+\)\/$/);

            // Verify nested PriceCondSet inside ItemSet
            expect(payload.ItemSet[0].PriceCondSet).toHaveLength(1);
            expect(payload.ItemSet[0].PriceCondSet[0].CondTypeCode).toBe('ZPR1');
            expect(payload.ItemSet[0].PriceCondSet[0].AmountInternal).toBe('250.00');
        });

        test('reads authentic NetAmount, TotalAmount, TaxAmount and DocumentCurrency from S/4HANA instead of local qty x price formula', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000465',
                        NetAmount: '950.00',
                        TotalAmount: '1121.00',
                        TaxAmount: '171.00',
                        DocumentCurrency: 'EUR'
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                TransactionCurrency: 'EUR'
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 10,
                    OrderQuantityUnit: 'KG',
                    NetPriceAmount: 100.00 // qty * price = 1000.00, but SAP computed NetAmount = 950.00 (with discount)
                }
            ];

            const result = await adapter.createSalesOrder(header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000465');
            expect(result.TotalNetAmount).toBe('950.00'); // SAP authentic NetAmount, NOT 1000.00
            expect(result.NetAmount).toBe('950.00');
            expect(result.TotalAmount).toBe('1121.00');
            expect(result.TaxAmount).toBe('171.00');
            expect(result.TransactionCurrency).toBe('EUR');
        });

        test('leaves PurchaseOrderNumber empty when omitted instead of defaulting to item text or SALES ORDER', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000461',
                        NetAmount: '500.00',
                        DocumentCurrency: 'INR'
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135',
                PurchaseOrderNumber: '',
                PurchaseOrderByCustomer: ''
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    SalesOrderItemText: 'Some Material Text',
                    OrderQuantity: 2,
                    OrderQuantityUnit: 'PC',
                    NetPriceAmount: 250.00
                }
            ];

            const result = await adapter.createSalesOrder(header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000461');
            const callConfig = mockExecute.mock.calls[0][1];
            expect(callConfig.data.PurchaseOrderNumber).toBe('');
        });

        test('rejects createSalesOrder when SalesOrganization, DistributionChannel, or Division is missing or blank', async () => {
            const baseHeader = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                TransactionCurrency: 'INR',
                SoldToParty: '10135'
            };

            const orgFields = ['SalesOrganization', 'DistributionChannel', 'OrganizationDivision'];
            for (const field of orgFields) {
                const missing = { ...baseHeader };
                delete missing[field];
                await expect(
                    adapter.createSalesOrder(missing, [], {
                        destination: { url: 'http://sap.mock' },
                        executeHttpRequest: jest.fn()
                    })
                ).rejects.toThrow();

                const blank = { ...baseHeader, [field]: '   ' };
                await expect(
                    adapter.createSalesOrder(blank, [], {
                        destination: { url: 'http://sap.mock' },
                        executeHttpRequest: jest.fn()
                    })
                ).rejects.toThrow();
            }
        });

        test('propagates SAP error message when Deep Insert fails', async () => {
            const mockExecute = jest.fn().mockRejectedValue({
                response: {
                    status: 400,
                    data: {
                        error: {
                            message: { value: 'Material 4000000091 is not listed for customer 10135' }
                        }
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135'
            };

            await expect(
                adapter.createSalesOrder(header, [], {
                    destination: { url: 'http://sap.mock' },
                    executeHttpRequest: mockExecute
                })
            ).rejects.toThrow('Material 4000000091 is not listed for customer 10135');
        });

        test('transmits PurchaseOrderDate, distinct ShipToParty via HeaderPartnerSet, PaymentTermCode, and custom ItemDescr in Deep Insert payload', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000468',
                        PaymentTermCode: '0001',
                        NetAmount: '500.00',
                        DocumentCurrency: 'INR'
                    }
                }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                ShipToParty: '1000000001',
                CustomerPurchaseOrderDate: '2026-09-25',
                PaymentTerms: '0001',
                TransactionCurrency: 'INR'
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    SalesOrderItemText: 'Custom item description for chemical order',
                    OrderQuantity: 2,
                    OrderQuantityUnit: 'KG',
                    Plant: '1120',
                    NetPriceAmount: 250.00
                }
            ];

            const result = await adapter.createSalesOrder(header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000468');

            const callConfig = mockExecute.mock.calls[0][1];
            const payload = callConfig.data;

            // Verify PO Date
            expect(payload.PurchaseOrderDate).toMatch(/^\/Date\(\d+\)\/$/);

            // Verify HeaderPartnerSet with SH partner
            expect(payload.HeaderPartnerSet).toEqual([
                {
                    PartnerFunctionCode: 'SH',
                    CustomerID: '1000000001'
                }
            ]);

            // Verify PaymentTermCode
            expect(payload.PaymentTermCode).toBe('0001');

            // Verify ItemDescr on ItemSet
            expect(payload.ItemSet[0].ItemDescr).toBe('Custom item description for chemical order');
        });

        test('filters out unsupported extension fields and returns them in notTransmitted for sales order', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000469',
                        NetAmount: '500.00',
                        DocumentCurrency: 'INR'
                    }
                }
            });

            jest.spyOn(adapter, '_getLeanOrderFields').mockResolvedValue({
                header: new Set(['SalesOrderTypeCode', 'SalesOrganization', 'DistributionChannel', 'Division']),
                item: new Set(['MaterialID', 'OrderQty', 'SalesUnit'])
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                CustomerGroup2: 'SEA',
                PortOfLoading: 'NHAVA SHEVA',
                PortOfDischarge: 'BARCELONA'
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 2,
                    OrderQuantityUnit: 'KG',
                    Plant: '1120'
                }
            ];

            const result = await adapter.createSalesOrder(header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000469');
            expect(result.notTransmitted).toEqual(
                expect.arrayContaining(['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge'])
            );

            const callConfig = mockExecute.mock.calls[0][1];
            const payload = callConfig.data;
            expect(payload.CustomerGroup2).toBeUndefined();
            expect(payload.PortOfLoading).toBeUndefined();
            expect(payload.PortOfDischarge).toBeUndefined();
        });

        test('unsupported ContactPerson shows a visible error when metadata lacks ContactPerson and HeaderPartner CustomerID', async () => {
            const mockExecute = jest.fn();
            jest.spyOn(adapter, '_getLeanOrderFields').mockResolvedValue({
                header: new Set(['SalesOrderTypeCode', 'SalesOrganization', 'DistributionChannel', 'Division']),
                item: new Set(['MaterialID', 'OrderQty', 'SalesUnit']),
                partner: new Set()
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                ContactPerson: '24789'
            };

            await expect(
                adapter.createSalesOrder(header, [], {
                    destination: { url: 'http://sap.mock' },
                    executeHttpRequest: mockExecute
                })
            ).rejects.toThrow('Contact Person is not supported by the SAP backend service');
        });

        test('transmits ContactPerson via HeaderPartnerSet with partner function ZP when HeaderPartner metadata has CustomerID', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000470',
                        NetAmount: '500.00',
                        DocumentCurrency: 'INR'
                    }
                }
            });
            jest.spyOn(adapter, '_getLeanOrderFields').mockResolvedValue({
                header: new Set(['SalesOrderTypeCode', 'SalesOrganization', 'DistributionChannel', 'Division']),
                item: new Set(['MaterialID', 'OrderQty', 'SalesUnit']),
                partner: new Set(['PartnerFunctionCode', 'CustomerID'])
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                ContactPerson: '24789'
            };

            const result = await adapter.createSalesOrder(header, [], {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000470');
            const callConfig = mockExecute.mock.calls[0][1];
            expect(callConfig.data.ContactPerson).toBeUndefined();
            expect(callConfig.data.HeaderPartnerSet).toEqual([
                {
                    PartnerFunctionCode: 'ZP',
                    CustomerID: '24789'
                }
            ]);
        });

        test('transmits both ShipToParty and ContactPerson in HeaderPartnerSet', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000470',
                        NetAmount: '500.00',
                        DocumentCurrency: 'INR'
                    }
                }
            });
            jest.spyOn(adapter, '_getLeanOrderFields').mockResolvedValue({
                header: new Set(['SalesOrderTypeCode', 'SalesOrganization', 'DistributionChannel', 'Division']),
                item: new Set(['MaterialID', 'OrderQty', 'SalesUnit']),
                partner: new Set(['PartnerFunctionCode', 'CustomerID'])
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                ShipToParty: '1000000001',
                ContactPerson: '24789'
            };

            const result = await adapter.createSalesOrder(header, [], {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000470');
            const callConfig = mockExecute.mock.calls[0][1];
            expect(callConfig.data.HeaderPartnerSet).toEqual([
                {
                    PartnerFunctionCode: 'SH',
                    CustomerID: '1000000001'
                },
                {
                    PartnerFunctionCode: 'ZP',
                    CustomerID: '24789'
                }
            ]);
        });

        test('transmits ContactPerson when supported by metadata HeaderSet', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '5000470',
                        ContactPerson: '24789'
                    }
                }
            });
            jest.spyOn(adapter, '_getLeanOrderFields').mockResolvedValue({
                header: new Set(['SalesOrderTypeCode', 'SalesOrganization', 'DistributionChannel', 'Division', 'ContactPerson']),
                item: new Set(['MaterialID', 'OrderQty', 'SalesUnit']),
                partner: new Set(['PartnerFunctionCode', 'CustomerID'])
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                ContactPerson: '24789'
            };

            const result = await adapter.createSalesOrder(header, [], {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000470');
            const callConfig = mockExecute.mock.calls[0][1];
            expect(callConfig.data.ContactPerson).toBe('24789');
        });

        test('read-back succeeds when Contact Person matches in HeaderPartnerSet with leading zero differences', async () => {
            const mockExecute = jest.fn()
                .mockResolvedValueOnce({
                    status: 201,
                    data: { d: { SalesOrderID: '5000472' } }
                })
                .mockResolvedValueOnce({
                    status: 200,
                    data: {
                        d: {
                            SalesOrderID: '5000472',
                            PaymentTermCode: 'PT11',
                            HeaderPartnerSet: {
                                results: [
                                    {
                                        PartnerFunctionCode: 'ZP',
                                        CustomerID: '0000024789' // zero-padded in SAP
                                    }
                                ]
                            }
                        }
                    }
                });
            jest.spyOn(adapter, '_getLeanOrderFields').mockResolvedValue({
                header: new Set(['SalesOrderTypeCode', 'SalesOrganization', 'DistributionChannel', 'Division', 'PaymentTermCode']),
                item: new Set(['MaterialID', 'OrderQty', 'SalesUnit']),
                partner: new Set(['PartnerFunctionCode', 'CustomerID'])
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                PaymentTerms: 'PT11',
                ContactPerson: '24789'
            };

            const result = await adapter.createSalesOrder(header, [], {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesOrder).toBe('5000472');
        });

        test('read-back detects mismatch and throws error', async () => {
            const mockExecute = jest.fn()
                .mockResolvedValueOnce({
                    status: 201,
                    data: { d: { SalesOrderID: '5000471' } }
                })
                .mockResolvedValueOnce({
                    status: 200,
                    data: {
                        d: {
                            SalesOrderID: '5000471',
                            PaymentTermCode: 'PT01' // mismatch from PT11
                        }
                    }
                });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135',
                PaymentTerms: 'PT11'
            };

            await expect(
                adapter.createSalesOrder(header, [], {
                    destination: { url: 'http://sap.mock' },
                    executeHttpRequest: mockExecute
                })
            ).rejects.toThrow(/read-back verification failed.*Payment Terms expected 'PT11' but found 'PT01'/);
        });
    });

    describe('createSalesDocument Routing', () => {
        test('routes ZIN to sequential 3-step POSTs', async () => {
            const mockExecute = jest.fn()
                // Header POST
                .mockResolvedValueOnce({ status: 201, data: { d: { SalesOrderID: '1000530' } } })
                // Item POST
                .mockResolvedValueOnce({ status: 201, data: { d: {} } })
                // Condition POST
                .mockResolvedValueOnce({ status: 201, data: { d: {} } });

            const header = {
                SalesInquiryType: 'ZIN',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135'
            };

            const items = [
                {
                    SalesInquiryItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 1,
                    OrderQuantityUnit: 'PC',
                    NetPriceAmount: 100
                }
            ];

            const result = await adapter.createSalesDocument('ZIN', header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesDocument).toBe('1000530');
            expect(result.SalesInquiry).toBe('1000530');
            // 3 sequential calls
            // 3 POSTs + 1 GET read-back for the document totals
            expect(mockExecute).toHaveBeenCalledTimes(4);
        });

        test('routes ZDOM to single Deep Insert POST', async () => {
            const mockExecute = jest.fn().mockResolvedValue({
                status: 201,
                data: { d: { SalesOrderID: '5000461', NetAmount: '500.00', DocumentCurrency: 'INR' } }
            });

            const header = {
                SalesOrderType: 'ZDOM',
                SalesOrganization: '1000',
                DistributionChannel: '10',
                OrganizationDivision: '52',
                SoldToParty: '10135'
            };

            const items = [
                {
                    SalesOrderItem: '000010',
                    Material: '4000000123',
                    OrderQuantity: 2,
                    OrderQuantityUnit: 'KG',
                    Plant: '1120',
                    NetPriceAmount: 250
                }
            ];

            const result = await adapter.createSalesDocument('ZDOM', header, items, {
                destination: { url: 'http://sap.mock' },
                executeHttpRequest: mockExecute
            });

            expect(result.SalesDocument).toBe('5000461');
            expect(result.SalesOrder).toBe('5000461');
            // 1 atomic POST + 1 GET read-back
            expect(mockExecute).toHaveBeenCalledTimes(2);
        });
    });

    describe('getSalesOrders and getSalesOrder', () => {
        test('getSalesOrders runs query on s4hanaSO service', async () => {
            const mockRun = jest.fn().mockResolvedValue([{ SalesOrder: '5000455' }]);
            adapter.s4hanaSO = { run: mockRun };

            const result = await adapter.getSalesOrders();
            expect(result).toEqual([{ SalesOrder: '5000455' }]);
            expect(mockRun).toHaveBeenCalled();
        });

        test('getSalesOrders maps query to remote entity C_SalesOrderWl_F1873 and preserves $count', async () => {
            const mockList = [{ SalesOrder: '2500085' }];
            mockList.$count = 894;
            const mockRun = jest.fn().mockResolvedValue(mockList);
            adapter.s4hanaSO = { run: mockRun };

            const incomingQuery = {
                SELECT: {
                    from: { ref: ['SalesOrders'] },
                    columns: [{ ref: ['SalesOrder'] }],
                    orderBy: [{ ref: ['CreationDate'], sort: 'desc' }],
                    limit: { rows: { val: 25 }, offset: { val: 0 } },
                    count: true
                }
            };

            const result = await adapter.getSalesOrders(incomingQuery);
            expect(result).toHaveLength(1);
            expect(result.$count).toBe(894);
            expect(mockRun).toHaveBeenCalled();
            const calledQuery = mockRun.mock.calls[0][0];
            const targetFrom = calledQuery.SELECT.from?.ref?.[0] || calledQuery.SELECT.from;
            expect(targetFrom).toBe('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873');
            expect(calledQuery.SELECT.count).toBe(true);
        });

        test('getSalesOrders HTTP fallback normalizes OData V2 date strings and preserves $count', async () => {
            adapter.s4hanaSO = null;
            const rawV2 = [
                {
                    SalesOrder: '2500085',
                    CreationDate: '/Date(1789948800000)/',
                    SalesOrderDate: '/Date(1789948800000)/',
                    RequestedDeliveryDate: '/Date(1789948800000)/',
                    LastChangeDateTime: '/Date(1789970480693+0000)/'
                }
            ];
            const mockExecute = jest.fn().mockResolvedValue({
                data: {
                    d: {
                        __count: '894',
                        results: rawV2
                    }
                }
            });

            const result = await adapter.getSalesOrders({ SELECT: { count: true } }, { executeHttpRequest: mockExecute });
            expect(result).toHaveLength(1);
            expect(result.$count).toBe(894);
            expect(result[0].CreationDate).toBe('2026-09-21');
            expect(result[0].SalesOrderDate).toBe('2026-09-21');
            expect(result[0].RequestedDeliveryDate).toBe('2026-09-21');
            expect(result[0].LastChangeDateTime).toContain('2026-09-21');
        });

        test('getSalesOrders HTTP fallback preserves $filter from query.SELECT.where', async () => {
            adapter.s4hanaSO = null;
            const mockExecute = jest.fn().mockResolvedValue({
                data: { d: { results: [{ SalesOrder: '5000104', SoldToParty: '10082' }] } }
            });

            const query = {
                SELECT: {
                    where: [{ ref: ['SoldToParty'] }, '=', { val: '10082' }]
                }
            };

            const result = await adapter.getSalesOrders(query, { executeHttpRequest: mockExecute });
            expect(result).toHaveLength(1);
            expect(mockExecute).toHaveBeenCalled();
            const calledUrl = mockExecute.mock.calls[0][1].url;
            expect(calledUrl).toContain("$filter=SoldToParty eq '10082'");
        });

        test('getSalesOrders HTTP fallback preserves compound $filter with contains/substringof and ne', async () => {
            adapter.s4hanaSO = null;
            const mockExecute = jest.fn().mockResolvedValue({
                data: { d: { results: [] } }
            });

            const query = {
                SELECT: {
                    where: [
                        { func: 'contains', args: [{ ref: ['SalesOrder'] }, { val: '500' }] },
                        'and',
                        { ref: ['OverallSDProcessStatus'] },
                        '!=',
                        { val: 'C' }
                    ]
                }
            };

            await adapter.getSalesOrders(query, { executeHttpRequest: mockExecute });
            expect(mockExecute).toHaveBeenCalled();
            const calledUrl = mockExecute.mock.calls[0][1].url;
            expect(calledUrl).toContain("substringof('500', SalesOrder)");
            expect(calledUrl).toContain("OverallSDProcessStatus ne 'C'");
        });

        test('getSalesOrders HTTP fallback preserves custom $top, $skip, and $orderby', async () => {
            adapter.s4hanaSO = null;
            const mockExecute = jest.fn().mockResolvedValue({
                data: { d: { results: [] } }
            });

            const query = {
                SELECT: {
                    limit: { rows: { val: 20 }, offset: { val: 40 } },
                    orderBy: [{ ref: ['SalesOrder'], sort: 'asc' }]
                }
            };

            await adapter.getSalesOrders(query, { executeHttpRequest: mockExecute });
            expect(mockExecute).toHaveBeenCalled();
            const calledUrl = mockExecute.mock.calls[0][1].url;
            expect(calledUrl).toContain('$top=20');
            expect(calledUrl).toContain('$skip=40');
            expect(calledUrl).toContain('$orderby=SalesOrder asc');
        });

        test('getSalesOrders HTTP fallback throws error when filter is present but cannot be safely translated', async () => {
            adapter.s4hanaSO = null;
            const mockExecute = jest.fn();

            const query = {
                SELECT: {
                    where: [{ unparseableObject: true }]
                }
            };

            await expect(adapter.getSalesOrders(query, { executeHttpRequest: mockExecute })).rejects.toMatchObject({
                message: expect.stringContaining('Cannot safely translate sales order query filter')
            });
            expect(mockExecute).not.toHaveBeenCalled();
        });

        test('_cqnWhereToODataFilter translates AST tokens, operators, parentheses, and plain objects', () => {
            expect(adapter._cqnWhereToODataFilter(null)).toBe('');
            expect(adapter._cqnWhereToODataFilter('')).toBe('');
            expect(adapter._cqnWhereToODataFilter("SalesOrder eq '5000104'")).toBe("SalesOrder eq '5000104'");

            // Plain object
            expect(adapter._cqnWhereToODataFilter({ SoldToParty: '10082', SalesOrderType: 'ZDOM' })).toBe(
                "SoldToParty eq '10082' and SalesOrderType eq 'ZDOM'"
            );

            // AST with entity prefix stripped
            const ast1 = [{ ref: ['SalesOrders', 'SoldToParty'] }, '=', { val: '10082' }];
            expect(adapter._cqnWhereToODataFilter(ast1)).toBe("SoldToParty eq '10082'");

            // Nested parentheses
            const ast2 = ['(', { ref: ['SalesOrder'] }, '=', { val: '5000104' }, ')', 'or', '(', { ref: ['SalesOrder'] }, '=', { val: '5000105' }, ')'];
            expect(adapter._cqnWhereToODataFilter(ast2)).toBe("(SalesOrder eq '5000104') or (SalesOrder eq '5000105')");
        });

        test('getSalesOrders throws 502 when backend read fails', async () => {
            adapter.s4hanaSO = null;
            const mockExecute = jest.fn().mockRejectedValue(new Error('Network error'));
            await expect(adapter.getSalesOrders(null, { executeHttpRequest: mockExecute })).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Sales orders cannot be read')
            });
        });

        test('getSalesOrder reads single order with item navigation', async () => {
            const mockOrder = { SalesOrder: '5000455', to_SalesDocumentItemWl: [{ SalesDocumentItem: '10' }] };
            const mockRun = jest.fn().mockResolvedValue(mockOrder);
            adapter.s4hanaSO = { run: mockRun };

            const result = await adapter.getSalesOrder('5000455');
            expect(result).toEqual(mockOrder);
            expect(mockRun).toHaveBeenCalled();
        });

        test('getSalesOrderDefaults returns valid order defaults', async () => {
            const defaults = await adapter.getSalesOrderDefaults();
            expect(defaults.SalesOrderType).toBe('ZDOM');
            expect(defaults.SalesOrganization).toBe('1000');
            expect(defaults.DistributionChannel).toBe('10');
            expect(defaults.OrganizationDivision).toBe('52');
            expect(defaults.Plant).toBe('1120');
            expect(defaults.TransactionCurrency).toBe('INR');
            expect(defaults.RequestedDeliveryDate).toBeDefined();
        });

        test('getCustomerDefaults validates sales area and returns validForSalesArea: false for mismatched sales area', async () => {
            adapter.s4hanaWL = {
                run: jest.fn().mockImplementation((q) => {
                    const sFrom = q?.SELECT?.from?.ref?.[0] || '';
                    if (sFrom.includes('I_Customer_VH')) {
                        return Promise.resolve([{ Customer: '10629', CustomerName: 'SUN PHARMACEUTICAL INDUSTRIES LTD.', CityName: 'Vadodara', Country: 'IN' }]);
                    }
                    return Promise.resolve([]);
                })
            };

            adapter.client = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        d: {
                            results: [
                                {
                                    Customer: '10629',
                                    CustomerName: 'SUN PHARMACEUTICAL INDUSTRIES LTD.',
                                    CompanyCode: '1000',
                                    SalesOrganization: '1000',
                                    DistributionChannel: '10',
                                    Division: '00',
                                    SalesOffice: 'SO10',
                                    SalesGroup: '100',
                                    CustomerPaymentTerms: 'PT11'
                                }
                            ]
                        }
                    }
                })
            };

            const result = await adapter.getCustomerDefaults('10629', '1000', '10', '52');
            expect(result.Customer).toBe('10629');
            expect(result.CustomerName).toBe('SUN PHARMACEUTICAL INDUSTRIES LTD.');
            expect(result.validForSalesArea).toBe(false);
            expect(result.salesAreaError).toContain('Sold-to party 10629 not maintained for sales area 1000 10 52');
            expect(result.maintainedSalesAreasSummary).toBe('1000 10 00');
        });

        test('getCustomerDefaults validates sales area and returns validForSalesArea: true and authentic PaymentTerms when matched', async () => {
            adapter.s4hanaWL = {
                run: jest.fn().mockImplementation((q) => {
                    const sFrom = q?.SELECT?.from?.ref?.[0] || '';
                    if (sFrom.includes('I_Customer_VH')) {
                        return Promise.resolve([{ Customer: '10135', CustomerName: "Divi's Laboratories Limited", CityName: 'Hyderabad', Country: 'IN' }]);
                    }
                    return Promise.resolve([]);
                })
            };

            adapter.client = {
                get: jest.fn().mockResolvedValue({
                    data: {
                        d: {
                            results: [
                                {
                                    Customer: '10135',
                                    CustomerName: "Divi's Laboratories Limited",
                                    CompanyCode: '1000',
                                    SalesOrganization: '1000',
                                    DistributionChannel: '10',
                                    Division: '52',
                                    SalesOffice: 'SO10',
                                    SalesGroup: '100',
                                    CustomerPaymentTerms: 'PT01'
                                }
                            ]
                        }
                    }
                })
            };

            const result = await adapter.getCustomerDefaults('10135', '1000', '10', '52');
            expect(result.Customer).toBe('10135');
            expect(result.validForSalesArea).toBe(true);
            expect(result.PaymentTerms).toBe('PT01');
            expect(result.salesAreaError).toBe('');
        });
    });

    describe('Commercial Value Helps', () => {
        test('getPaymentTerms returns valid payment terms via RFC readTable', async () => {
            adapter.rfc = {
                readTable: jest.fn().mockResolvedValue([
                    { ZTERM: '0001', TEXT1: 'Payable immediately' },
                    { ZTERM: 'AD03', TEXT1: '100% Advance' }
                ])
            };

            const terms = await adapter.getPaymentTerms();
            expect(terms).toHaveLength(2);
            expect(terms[0].PaymentTerms).toBe('0001');
            expect(terms[0].PaymentTermsName).toBe('Payable immediately');
            // whole table (no 50-row cap): the CAP value-help handler filters in memory
            expect(adapter.rfc.readTable).toHaveBeenCalledWith('T052U', ['ZTERM', 'TEXT1'], ["SPRAS = 'E'"], 0);
        });

        test('getPaymentTerms serves the second call from the 5-minute cache', async () => {
            adapter.rfc = {
                readTable: jest.fn().mockResolvedValue([{ ZTERM: '0001', TEXT1: 'Payable immediately' }])
            };

            await adapter.getPaymentTerms();
            await adapter.getPaymentTerms();
            expect(adapter.rfc.readTable).toHaveBeenCalledTimes(1);
        });

        test('getPaymentTerms fails with 503 instead of serving a local list when RFC readTable fails', async () => {
            adapter.rfc = {
                readTable: jest.fn().mockRejectedValue(new Error('RFC connection failed'))
            };

            await expect(adapter.getPaymentTerms()).rejects.toMatchObject({ status: 503, message: expect.stringContaining('T052U') });
        });

        test('getContactPersons filters by Customer and formats FullName', async () => {
            adapter.rfc = {
                readTable: jest.fn().mockResolvedValue([
                    { PARNR: '0000025799', KUNNR: '0000010514', NAME1: 'Suthar', NAMEV: 'Pradip', TELF1: '' }
                ])
            };

            const query = {
                SELECT: {
                    where: [{ ref: ['Customer'] }, '=', { val: '10514' }]
                }
            };

            const contacts = await adapter.getContactPersons(query);
            expect(contacts).toHaveLength(1);
            expect(contacts[0].ContactPerson).toBe('0000025799');
            expect(contacts[0].FullName).toBe('Pradip Suthar');
            expect(adapter.rfc.readTable).toHaveBeenCalledWith(
                'KNVK',
                ['PARNR', 'KUNNR', 'NAME1', 'NAMEV', 'TELF1'],
                ["KUNNR = '0000010514'"],
                0
            );
            // Customer is returned without leading zeros so the client's `Customer eq '10514'` matches in memory
            expect(contacts[0].Customer).toBe('10514');
        });

        test('getContactPersons fails with 503 instead of serving local contacts when RFC is unavailable', async () => {
            adapter.rfc = {
                readTable: jest.fn().mockRejectedValue(new Error('RFC not available'))
            };

            await expect(adapter.getContactPersons({
                SELECT: { where: [{ ref: ['Customer'] }, '=', { val: '10514' }] }
            })).rejects.toMatchObject({ status: 503 });
        });
    });
});
