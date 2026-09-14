const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

describe('Unit: Sales Inquiry Adapter', () => {
    test('should provide standard Sales Inquiry creation defaults', async () => {
        const defaults = await salesInquiryAdapter.getSalesInquiryDefaults();
        expect(defaults.SalesInquiryType).toBe('ZIN');
        expect(defaults.SalesOrganization).toBe('1000');
        expect(defaults.DistributionChannel).toBe('10');
        expect(defaults.OrganizationDivision).toBe('52');
        expect(defaults.TransactionCurrency).toBe('INR');
        expect(defaults.SalesInquiryDate).toBeDefined();
        expect(defaults.BindingPeriodValidityStartDate).toBeDefined();
        expect(defaults.BindingPeriodValidityEndDate).toBeDefined();
        expect(defaults.derived).toBe(true);
    });

    test('should return customer defaults with fallback for empty input', async () => {
        const result = await salesInquiryAdapter.getCustomerDefaults('', '', '', '');
        expect(result.Customer).toBe('');
        expect(result.SalesOffice).toBe('');
        expect(result.SalesGroup).toBe('');
        expect(result.derived).toBe(false);
    });

    test('should return inquiry details with SalesOffice and SalesGroup populated and described', async () => {
        const mockWL = {
            run: jest.fn().mockImplementation((query) => {
                // Return inquiry with expanded to_SalesOffice and to_SalesGroup
                return Promise.resolve({
                    SalesInquiry: '100003',
                    SalesOrganization: '1000',
                    DistributionChannel: '10',
                    OrganizationDivision: '52',
                    SalesOffice: 'SO10',
                    SalesGroup: '100',
                    to_SalesOffice: { SalesOfficeName: 'Surat' },
                    to_SalesGroup: { SalesGroupName: 'Surat' },
                    SoldToParty: '10083'
                });
            })
        };
        const mockFS = {
            run: jest.fn().mockImplementation((query) => {
                return Promise.resolve({
                    SalesInquiry: '100003',
                    CustomerPurchaseOrderDate: '2025-12-26',
                    to_SDDocumentPartnerCard: [
                        { PartnerFunction: 'WE', Customer: '10083', FullName: 'Bajaj Healthcare' }
                    ]
                });
            })
        };

        const adapter = new salesInquiryAdapter.SalesInquiryAdapter();
        adapter.s4hanaWL = mockWL;
        adapter.s4hanaFS = mockFS;

        const result = await adapter.getInquiry('100003');
        expect(result).toBeDefined();
        expect(result.header.SalesInquiry).toBe('100003');
        expect(result.header.SalesOffice).toBe('SO10');
        expect(result.header.SalesOfficeName).toBe('Surat');
        expect(result.header.SalesGroup).toBe('100');
        expect(result.header.SalesGroupName).toBe('Surat');
    });

    test('should dynamically derive SalesOffice and SalesGroup from SAP when inquiry header has empty fields', async () => {
        let callCount = 0;
        const mockWL = {
            run: jest.fn().mockImplementation((query) => {
                callCount++;
                if (callCount === 1) {
                    // First call: inquiry header with empty SalesOffice
                    return Promise.resolve({
                        SalesInquiry: '100000',
                        SalesOrganization: '1000',
                        DistributionChannel: '10',
                        OrganizationDivision: '52',
                        SalesOffice: '',
                        SalesGroup: '',
                        SoldToParty: '10135'
                    });
                }
                if (callCount === 2) {
                    // Second call: customer historical inquiry lookup
                    return Promise.resolve([
                        { SalesOffice: 'SO10', SalesGroup: '100' }
                    ]);
                }
                if (callCount === 3) {
                    // Third call: SalesOffice VH lookup
                    return Promise.resolve({ SalesOfficeName: 'Surat' });
                }
                if (callCount === 4) {
                    // Fourth call: SalesGroup VH lookup
                    return Promise.resolve({ SalesGroupName: 'Surat' });
                }
                return Promise.resolve(null);
            })
        };
        const mockFS = {
            run: jest.fn().mockImplementation(() => Promise.resolve({
                SalesInquiry: '100000',
                to_SDDocumentPartnerCard: []
            }))
        };

        const adapter = new salesInquiryAdapter.SalesInquiryAdapter();
        adapter.s4hanaWL = mockWL;
        adapter.s4hanaFS = mockFS;

        const result = await adapter.getInquiry('100000');
        expect(result).toBeDefined();
        expect(result.header.SalesInquiry).toBe('100000');
        expect(result.header.SalesOffice).toBe('SO10');
        expect(result.header.SalesOfficeName).toBe('Surat');
        expect(result.header.SalesGroup).toBe('100');
        expect(result.header.SalesGroupName).toBe('Surat');
    });

    test('should create sales inquiry directly via S/4HANA OData service and return SAP-assigned number', async () => {
        const header = {
            SalesInquiryType: 'ZIN',
            SalesOrganization: '1000',
            DistributionChannel: '10',
            OrganizationDivision: '52',
            SoldToParty: '10135',
            PurchaseOrderByCustomer: 'TEST-PO-REF',
            TransactionCurrency: 'INR'
        };

        const items = [
            {
                SalesInquiryItem: '000010',
                Material: '4000000091',
                SalesInquiryItemText: 'Active Raw Material',
                OrderQuantity: 1,
                OrderQuantityUnit: 'KG',
                NetPriceAmount: 250,
                NetAmount: 250
            }
        ];

        const mockExecuteHttpRequest = jest.fn()
            // 1st call: HeaderSet POST
            .mockResolvedValueOnce({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '1000522',
                        SalesOrderTypeCode: 'ZIN',
                        SalesOrganization: '1000',
                        NetValue: '250.00',
                        Currency: 'INR'
                    }
                }
            })
            // 2nd call: ItemSet POST
            .mockResolvedValueOnce({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '1000522',
                        ItemID: '000010',
                        MaterialID: '4000000091'
                    }
                }
            })
            // 3rd call: PriceCondSet POST
            .mockResolvedValueOnce({
                status: 201,
                data: {
                    d: {
                        SalesOrderID: '1000522',
                        ItemID: '000010',
                        CondTypeCode: 'ZPR1',
                        AmountInternal: '50.00'
                    }
                }
            });

        const created = await salesInquiryAdapter.createSalesInquiry(header, items, {
            destination: { url: 'http://mock-s4hana' },
            executeHttpRequest: mockExecuteHttpRequest
        });

        expect(created.SalesInquiry).toBe('1000522');
        expect(created.TotalNetAmount).toBe('250.00');
        expect(created.TransactionCurrency).toBe('INR');

        // Check calls
        expect(mockExecuteHttpRequest).toHaveBeenCalledTimes(3);
        const headerCall = mockExecuteHttpRequest.mock.calls[0];
        expect(headerCall[1].method).toBe('post');
        expect(headerCall[1].url).toContain('/HeaderSet');
        expect(headerCall[1].data.SalesOrderTypeCode).toBe('ZIN');
        expect(headerCall[1].data.SoldToPartyID).toBe('10135');
        expect(headerCall[1].data.PurchaseOrderNumber).toBe('TEST-PO-REF');

        // Check item call
        const itemCall = mockExecuteHttpRequest.mock.calls[1];
        expect(itemCall[1].method).toBe('post');
        expect(itemCall[1].url).toMatch(/\/HeaderSet\((?:'|%27)1000522(?:'|%27)\)\/ItemSet/);
        expect(itemCall[1].data.SalesOrderID).toBe('1000522');
        expect(itemCall[1].data.ItemID).toBe('000010');
        expect(itemCall[1].data.MaterialID).toBe('4000000091');

        // Check price condition call
        const condCall = mockExecuteHttpRequest.mock.calls[2];
        expect(condCall[1].method).toBe('post');
        expect(condCall[1].url).toMatch(/\/HeaderSet\((?:'|%27)1000522(?:'|%27)\)\/PriceCondSet/);
        expect(condCall[1].data.SalesOrderID).toBe('1000522');
        expect(condCall[1].data.ItemID).toBe('000010');
        expect(condCall[1].data.CondTypeCode).toBe('ZPR1');
        expect(condCall[1].data.AmountInternal).toBe('250.00');
    });

    test('should fallback PurchaseOrderByCustomer to first item text if reference is empty', async () => {
        const header = {
            SalesInquiryType: 'ZIN',
            SoldToParty: '10135',
            PurchaseOrderByCustomer: ''
        };
        const items = [
            {
                SalesInquiryItem: '000010',
                Material: '4000000091',
                SalesInquiryItemText: 'High Grade Chemical Reagent',
                OrderQuantity: 5
            }
        ];

        const mockExecuteHttpRequest = jest.fn()
            .mockResolvedValueOnce({
                status: 201,
                data: { d: { SalesOrderID: '1000523' } }
            })
            .mockResolvedValueOnce({
                status: 201,
                data: { d: { SalesOrderID: '1000523', ItemID: '000010' } }
            });

        const created = await salesInquiryAdapter.createSalesInquiry(header, items, {
            destination: { url: 'http://mock-s4hana' },
            executeHttpRequest: mockExecuteHttpRequest
        });

        expect(created.SalesInquiry).toBe('1000523');
        const headerCall = mockExecuteHttpRequest.mock.calls[0];
        expect(headerCall[1].data.PurchaseOrderNumber).toBe('High Grade Chemical Reagent');
    });

    test('should propagate SAP S/4HANA backend error message when creation fails', async () => {
        const header = { SalesInquiryType: 'ZIN', SoldToParty: '99999' };
        const mockExecuteHttpRequest = jest.fn().mockRejectedValue({
            message: 'Request failed with status code 400',
            response: {
                data: {
                    error: {
                        code: 'SLS_LORD/005',
                        message: {
                            lang: 'en',
                            value: 'Customer 99999 does not exist in sales area 1000/10/52'
                        }
                    }
                }
            }
        });

        await expect(salesInquiryAdapter.createSalesInquiry(header, [], {
            destination: { url: 'http://mock-s4hana' },
            executeHttpRequest: mockExecuteHttpRequest
        })).rejects.toThrow('Customer 99999 does not exist in sales area 1000/10/52');
    });

    test('should query Finished Goods materials with ZFRT/FERT condition and map MaterialName', async () => {
        const mockRun = jest.fn().mockResolvedValue([
            { Material: '4000000001', Material_Text: 'X-265', MaterialType: 'ZFRT', MaterialGroup: '164', MaterialBaseUnit: 'KG' },
            { Material: '4000000177', Material_Text: '2-Chloroethanol test', MaterialType: 'FERT', MaterialGroup: '164', MaterialBaseUnit: 'KG' }
        ]);
        salesInquiryAdapter.s4hanaFS = { run: mockRun };

        const results = await salesInquiryAdapter.getMaterials();
        expect(results).toHaveLength(2);
        expect(results[0].Material).toBe('4000000001');
        expect(results[0].MaterialName).toBe('X-265');
        expect(results[0].MaterialType).toBe('ZFRT');
        expect(results[1].Material).toBe('4000000177');
        expect(results[1].MaterialName).toBe('2-Chloroethanol test');
        expect(results[1].MaterialType).toBe('FERT');

        expect(mockRun).toHaveBeenCalled();
        const queryArg = mockRun.mock.calls[0][0];
        expect(JSON.stringify(queryArg.SELECT.where)).toContain('ZFRT');
        expect(JSON.stringify(queryArg.SELECT.where)).toContain('FERT');
    });

    test('should merge user search filters when querying Finished Goods materials', async () => {
        const mockRun = jest.fn().mockResolvedValue([
            { Material: '4000000009', Material_Text: '1-Decene', MaterialType: 'ZFRT', MaterialGroup: '164', MaterialBaseUnit: 'KG' }
        ]);
        salesInquiryAdapter.s4hanaFS = { run: mockRun };

        const userQuery = {
            SELECT: {
                where: [
                    { func: 'contains', args: [{ ref: ['Material'] }, { val: 'Decene' }] },
                    'or',
                    { func: 'contains', args: [{ ref: ['MaterialName'] }, { val: 'Decene' }] }
                ],
                limit: { rows: 25, offset: 0 }
            }
        };

        const results = await salesInquiryAdapter.getMaterials(userQuery);
        expect(results).toHaveLength(1);
        expect(results[0].Material).toBe('4000000009');
        expect(results[0].MaterialName).toBe('1-Decene');

        const queryArg = mockRun.mock.calls[0][0];
        const whereStr = JSON.stringify(queryArg.SELECT.where);
        expect(whereStr).toContain('Material_Text');
        expect(whereStr).toContain('ZFRT');
        expect(whereStr).toContain('FERT');
    });

    test('should return empty array gracefully when s4hanaFS is unavailable or fails', async () => {
        salesInquiryAdapter.s4hanaFS = {
            run: jest.fn().mockRejectedValue(new Error('S/4 Gateway Connection Timeout'))
        };

        const results = await salesInquiryAdapter.getMaterials();
        expect(results).toEqual([]);
    });

    test('should query I_SalesDocumentType and enrich metadata for inquiry types', async () => {
        const mockRun = jest.fn().mockResolvedValue([
            {
                SalesDocumentType: 'ZIN',
                SalesDocumentType_Text: 'Inquiry',
                SDDocumentCategory: 'A',
                IsLocked: '',
                NumberRangeForIntIDAssignment: 'Z1',
                ScreenSequenceGroup: 'AG'
            },
            {
                SalesDocumentType: 'ZBIN',
                SalesDocumentType_Text: 'Budgetary Inquiry',
                SDDocumentCategory: 'A',
                IsLocked: '',
                NumberRangeForIntIDAssignment: 'Q7',
                ScreenSequenceGroup: 'AG'
            },
            {
                SalesDocumentType: 'IN',
                SalesDocumentType_Text: 'Inquiry',
                SDDocumentCategory: 'A',
                IsLocked: 'X',
                NumberRangeForIntIDAssignment: '03',
                ScreenSequenceGroup: 'AG'
            }
        ]);
        salesInquiryAdapter.s4hanaFS = { run: mockRun };

        const results = await salesInquiryAdapter.getInquiryTypes();
        expect(results).toHaveLength(3);

        const zin = results.find(r => r.SalesDocumentType === 'ZIN');
        expect(zin.IsActive).toBe(true);
        expect(zin.StatusText).toBe('Active');
        expect(zin.StatusState).toBe('Success');
        expect(zin.Classification).toBe('Commercial Sales');
        expect(zin.SalesDocumentTypeName).toBe('Standard Inquiry');
        expect(zin.NumberRangeForIntIDAssignment).toBe('Z1');
        expect(zin.SDDocumentCategoryName).toBe('Inquiry');

        const zbin = results.find(r => r.SalesDocumentType === 'ZBIN');
        expect(zbin.IsActive).toBe(true);
        expect(zbin.Classification).toBe('Budgetary / Estimation');
        expect(zbin.SalesDocumentTypeName).toBe('Budgetary Inquiry');
        expect(zbin.NumberRangeForIntIDAssignment).toBe('Q7');

        const inqy = results.find(r => r.SalesDocumentType === 'IN');
        expect(inqy.IsActive).toBe(false);
        expect(inqy.StatusText).toBe('Inactive');
        expect(inqy.StatusState).toBe('Warning');
        expect(inqy.Classification).toBe('Standard Reference');
    });

    test('should fallback to baseline inquiry types when remote services fail', async () => {
        salesInquiryAdapter.s4hanaFS = {
            run: jest.fn().mockRejectedValue(new Error('FS Network Error'))
        };
        salesInquiryAdapter.s4hanaWL = {
            run: jest.fn().mockRejectedValue(new Error('WL Network Error'))
        };

        const results = await salesInquiryAdapter.getInquiryTypes();
        expect(results.length).toBeGreaterThanOrEqual(6);
        expect(results.some(r => r.SalesDocumentType === 'ZIN')).toBe(true);
        expect(results.some(r => r.SalesDocumentType === 'ZBIN')).toBe(true);
    });

    describe('createSalesQuoteFromInquiry', () => {
        test('validates inquiry number is provided', async () => {
            await expect(salesInquiryAdapter.createSalesQuoteFromInquiry(''))
                .rejects.toThrow('Sales Inquiry number is required.');
        });

        test('throws if inquiry document not found', async () => {
            jest.spyOn(salesInquiryAdapter, 'getInquiry').mockResolvedValue(null);
            await expect(salesInquiryAdapter.createSalesQuoteFromInquiry('9999999'))
                .rejects.toThrow('Sales Inquiry 9999999 not found.');
        });

        test('constructs quotation payload and calls S/4 API returning quote number', async () => {
            jest.spyOn(salesInquiryAdapter, 'getInquiry').mockResolvedValue({
                header: {
                    SalesInquiry: '1000539',
                    SoldToParty: '10003',
                    SalesOrganization: '1000',
                    DistributionChannel: '10',
                    OrganizationDivision: '52',
                    TransactionCurrency: 'INR',
                    TotalNetAmount: '123000.00'
                },
                items: [
                    {
                        SalesInquiryItem: '000010',
                        Material: '4000000085',
                        OrderQuantity: '100.000',
                        OrderQuantityUnit: 'KG'
                    }
                ]
            });

            salesInquiryAdapter._cachedQuotationService = {
                technicalServiceName: 'VERIFIED_QUOTATION_SRV',
                servicePath: '/sap/opu/odata/sap/VERIFIED_QUOTATION_SRV',
                entitySet: 'SalesQuotationSet'
            };

            const mockExecute = jest.fn().mockResolvedValue({
                data: {
                    d: {
                        SalesQuotation: '2000045'
                    }
                }
            });

            const res = await salesInquiryAdapter.createSalesQuoteFromInquiry('1000539', {
                executeHttpRequest: mockExecute,
                destination: { url: 'http://test' }
            });

            expect(res.SalesQuote).toBe('2000045');
            expect(mockExecute).toHaveBeenCalledWith(
                { url: 'http://test' },
                expect.objectContaining({
                    method: 'post',
                    url: '/sap/opu/odata/sap/VERIFIED_QUOTATION_SRV/SalesQuotationSet',
                    data: expect.objectContaining({
                        SalesQuotationType: 'ZQT',
                        SoldToParty: '10003',
                        ReferenceSDDocument: '1000539',
                        to_Item: expect.arrayContaining([
                            expect.objectContaining({
                                Material: '4000000085',
                                ReferenceSDDocument: '1000539'
                            })
                        ])
                    })
                }),
                expect.any(Object)
            );
        });

        test('throws error when catalog does not expose an operational quotation creation service', async () => {
            salesInquiryAdapter._cachedQuotationService = null;
            jest.spyOn(salesInquiryAdapter, 'getInquiry').mockResolvedValue({
                header: { SalesInquiry: '1000539', SoldToParty: '10003' },
                items: []
            });

            const mockExecute = jest.fn().mockImplementation((dest, config) => {
                if (config.url.includes('CATALOGSERVICE')) {
                    return Promise.resolve({
                        data: {
                            d: {
                                results: [
                                    {
                                        TechnicalServiceName: 'SD_F1852_QUOT_WL_SRV',
                                        ServiceUrl: '/sap/opu/odata/sap/SD_F1852_QUOT_WL_SRV'
                                    }
                                ]
                            }
                        }
                    });
                }
                // Candidate metadata is read-only
                if (config.url.includes('$metadata')) {
                    return Promise.resolve({
                        status: 200,
                        data: '<EntitySet Name="C_SalesQuotationWl" sap:creatable="false" />'
                    });
                }
                return Promise.resolve({});
            });

            await expect(salesInquiryAdapter.createSalesQuoteFromInquiry('1000539', {
                executeHttpRequest: mockExecute,
                destination: { url: 'http://test' }
            })).rejects.toThrow("The SAP S/4HANA service catalog in DEV does not expose an operational Sales Quotation creation service.");
        });

        test('getSalesQuotationCatalogService resolves from live catalog collection when metadata validation succeeds', async () => {
            salesInquiryAdapter._cachedQuotationService = null;
            const mockExecute = jest.fn().mockImplementation((dest, config) => {
                if (config.url.includes('CATALOGSERVICE')) {
                    return Promise.resolve({
                        data: {
                            d: {
                                results: [
                                    {
                                        TechnicalServiceName: 'SD_SALES_QUOTATION_SRV',
                                        Title: 'SD_SALES_QUOTATION_SRV',
                                        Description: 'Sales Quotation Service',
                                        ServiceUrl: 'http://172.27.100.32:8000/sap/opu/odata/sap/SD_SALES_QUOTATION_SRV'
                                    }
                                ]
                            }
                        }
                    });
                }
                if (config.url.includes('$metadata')) {
                    return Promise.resolve({
                        status: 200,
                        data: '<EntityContainer><EntitySet Name="SalesQuotationHeaderSet" sap:creatable="true" /></EntityContainer>'
                    });
                }
                return Promise.resolve({});
            });

            const svc = await salesInquiryAdapter.getSalesQuotationCatalogService({
                executeHttpRequest: mockExecute,
                destination: { url: 'http://test' }
            });

            expect(svc.technicalServiceName).toBe('SD_SALES_QUOTATION_SRV');
            expect(svc.servicePath).toBe('/sap/opu/odata/sap/SD_SALES_QUOTATION_SRV');
            expect(svc.entitySet).toBe('SalesQuotationHeaderSet');
        });

        test('getSalesQuotationCatalogService falls back to local catalog file and validates metadata', async () => {
            salesInquiryAdapter._cachedQuotationService = null;
            const mockExecute = jest.fn().mockImplementation((dest, config) => {
                if (config.url.includes('CATALOGSERVICE')) {
                    return Promise.reject(new Error('Gateway down'));
                }
                if (config.url.includes('$metadata')) {
                    return Promise.resolve({
                        status: 200,
                        data: '<EntityContainer><EntitySet Name="A_SalesQuotation" sap:creatable="true" /></EntityContainer>'
                    });
                }
                return Promise.resolve({});
            });

            const svc = await salesInquiryAdapter.getSalesQuotationCatalogService({
                executeHttpRequest: mockExecute,
                destination: { url: 'http://test' }
            });

            expect(svc.technicalServiceName).toBeDefined();
            expect(svc.servicePath).toBeDefined();
            expect(svc.entitySet).toBe('A_SalesQuotation');
        });

        test('dispatches directly to API_SALES_QUOTATION_SRV/A_SalesQuotation when servicePath is configured or defaulted', async () => {
            salesInquiryAdapter._cachedQuotationService = null;
            jest.spyOn(salesInquiryAdapter, 'getInquiry').mockResolvedValue({
                header: {
                    SalesInquiry: '1000539',
                    SoldToParty: '10003',
                    SalesOrganization: '1000',
                    DistributionChannel: '10',
                    OrganizationDivision: '52',
                    TransactionCurrency: 'INR'
                },
                items: [
                    {
                        SalesInquiryItem: '000010',
                        Material: '4000000085',
                        OrderQuantity: '1.000',
                        OrderQuantityUnit: 'PC'
                    }
                ]
            });

            const mockExecute = jest.fn().mockImplementation((dest, config) => {
                if (config.method === 'post') {
                    return Promise.resolve({
                        data: {
                            d: {
                                SalesQuotation: '2000050'
                            }
                        }
                    });
                }
                return Promise.resolve({});
            });

            const res = await salesInquiryAdapter.createSalesQuoteFromInquiry('1000539', {
                executeHttpRequest: mockExecute,
                destination: { url: 'http://test' },
                servicePath: '/sap/opu/odata/sap/API_SALES_QUOTATION_SRV',
                entitySet: 'A_SalesQuotation'
            });

            expect(res.SalesQuote).toBe('2000050');
            expect(mockExecute).toHaveBeenCalledWith(
                { url: 'http://test' },
                expect.objectContaining({
                    method: 'post',
                    url: '/sap/opu/odata/sap/API_SALES_QUOTATION_SRV/A_SalesQuotation',
                    data: expect.objectContaining({
                        SalesQuotationType: 'ZQT',
                        SoldToParty: '10003',
                        ReferenceSDDocument: '1000539'
                    })
                }),
                expect.any(Object)
            );
        });

        test('deep-insert payload includes custom prompt fields, to_Partner, and document flow references on header and items', async () => {
            salesInquiryAdapter._cachedQuotationService = null;
            jest.spyOn(salesInquiryAdapter, 'getInquiry').mockResolvedValue({
                header: {
                    SalesInquiry: '1000539',
                    SoldToParty: '10003',
                    ShipToParty: '10083',
                    SalesOrganization: '1000',
                    DistributionChannel: '10',
                    OrganizationDivision: '52',
                    TransactionCurrency: 'INR',
                    TotalNetAmount: '123000.00'
                },
                items: [
                    {
                        SalesInquiryItem: '000010',
                        Material: '4000000085',
                        SalesInquiryItemText: 'High Grade Reagent',
                        OrderQuantity: '100.000',
                        OrderQuantityUnit: 'KG',
                        NetAmount: '123000.00'
                    }
                ]
            });

            const mockExecute = jest.fn().mockResolvedValue({
                data: {
                    d: {
                        SalesQuotation: '2000099'
                    }
                }
            });

            const res = await salesInquiryAdapter.createSalesQuoteFromInquiry('1000539', {
                executeHttpRequest: mockExecute,
                destination: { url: 'http://test' },
                servicePath: '/sap/opu/odata/sap/API_SALES_QUOTATION_SRV',
                entitySet: 'A_SalesQuotation',
                quotationType: 'ZBQT',
                quotationDate: '2026-04-01',
                bindingPeriodValidityEndDate: '2026-05-01',
                purchaseOrderByCustomer: 'PO-CUSTOM-77',
                customerPurchaseOrderDate: '2026-04-01'
            });

            expect(res.SalesQuote).toBe('2000099');
            const sentPayload = mockExecute.mock.calls[0][1].data;
            expect(sentPayload.SalesQuotationType).toBe('ZBQT');
            expect(sentPayload.PurchaseOrderByCustomer).toBe('PO-CUSTOM-77');
            expect(sentPayload.ReferenceSDDocument).toBe('1000539');
            expect(sentPayload.SalesQuotationDate).toMatch(/\/Date\(\d+\)\//);
            expect(sentPayload.BindingPeriodValidityEndDate).toMatch(/\/Date\(\d+\)\//);

            // Partners: Sold-to and Ship-to
            expect(sentPayload.to_Partner).toBeDefined();
            expect(sentPayload.to_Partner).toHaveLength(2);
            expect(sentPayload.to_Partner).toEqual(expect.arrayContaining([
                expect.objectContaining({ PartnerFunction: 'AG', Customer: '10003' }),
                expect.objectContaining({ PartnerFunction: 'WE', Customer: '10083' })
            ]));

            // Items: Reference link
            expect(sentPayload.to_Item).toBeDefined();
            expect(sentPayload.to_Item).toHaveLength(1);
            expect(sentPayload.to_Item[0].SalesQuotationItem).toBe('000010');
            expect(sentPayload.to_Item[0].Material).toBe('4000000085');
            expect(sentPayload.to_Item[0].ReferenceSDDocument).toBe('1000539');
            expect(sentPayload.to_Item[0].ReferenceSDDocumentItem).toBe('000010');
        });

        test('enriches error message with /IWFND/MAINT_SERVICE guidance when SAP Gateway reports missing system alias', async () => {
            salesInquiryAdapter._cachedQuotationService = null;
            jest.spyOn(salesInquiryAdapter, 'getInquiry').mockResolvedValue({
                header: { SalesInquiry: '1000539', SoldToParty: '10003' },
                items: []
            });

            const mockExecute = jest.fn().mockRejectedValue({
                response: {
                    status: 500,
                    data: {
                        error: {
                            code: '/IWFND/CM_COS/064',
                            message: {
                                value: "No System Alias found for Service 'ZAPI_SALES_QUOTATION_SRV_0001' and user 'KHUSHAL'"
                            }
                        }
                    }
                }
            });

            await expect(salesInquiryAdapter.createSalesQuoteFromInquiry('1000539', {
                executeHttpRequest: mockExecute,
                destination: { url: 'http://test' },
                servicePath: '/sap/opu/odata/sap/API_SALES_QUOTATION_SRV',
                entitySet: 'A_SalesQuotation'
            })).rejects.toThrow("/IWFND/MAINT_SERVICE");
        });
    });
});
