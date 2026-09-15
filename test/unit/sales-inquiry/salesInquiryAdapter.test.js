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

    test('should return inquiry types exactly as SAP describes them, deriving only the active status', async () => {
        const mockRun = jest.fn().mockResolvedValue([
            { SalesDocumentType: 'ZIN', SalesDocumentType_Text: 'Inquiry', SDDocumentCategory: 'A', IsLocked: '', NumberRangeForIntIDAssignment: 'Z1', ScreenSequenceGroup: 'AG' },
            { SalesDocumentType: 'ZBIN', SalesDocumentType_Text: 'Budgetary Inquiry', SDDocumentCategory: 'A', IsLocked: '', NumberRangeForIntIDAssignment: 'Q7', ScreenSequenceGroup: 'AG' },
            { SalesDocumentType: 'IN', SalesDocumentType_Text: 'Inquiry', SDDocumentCategory: 'A', IsLocked: 'X', NumberRangeForIntIDAssignment: '03' }
        ]);
        salesInquiryAdapter.s4hanaFS = { run: mockRun };

        const results = await salesInquiryAdapter.getInquiryTypes();
        expect(results).toHaveLength(3);

        const zin = results.find(r => r.SalesDocumentType === 'ZIN');
        expect(zin).toEqual({
            SalesDocumentType: 'ZIN',
            SalesDocumentType_Text: 'Inquiry',
            SalesDocumentTypeName: 'Inquiry',
            SDDocumentCategory: 'A',
            SDDocumentCategoryName: 'Inquiry',
            IsLocked: '',
            IsActive: true,
            StatusText: 'Active',
            StatusState: 'Success',
            ScreenSequenceGroup: 'AG',
            NumberRangeForIntIDAssignment: 'Z1',
            NumberRangeForExtIDAssignment: null,
            TextDeterminationProcedure: null,
            PartnerDeterminationProcedure: null
        });

        const zbin = results.find(r => r.SalesDocumentType === 'ZBIN');
        expect(zbin.SalesDocumentTypeName).toBe('Budgetary Inquiry');

        const inqy = results.find(r => r.SalesDocumentType === 'IN');
        expect(inqy.IsActive).toBe(false);
        expect(inqy.StatusText).toBe('Inactive');
        expect(inqy.StatusState).toBe('Warning');
        expect(inqy.ScreenSequenceGroup).toBeNull();

        results.forEach(r => {
            expect(r).not.toHaveProperty('Classification');
            expect(r).not.toHaveProperty('Purpose');
        });
    });

    test('should read the WL value help only when the factsheet service returns no types', async () => {
        salesInquiryAdapter.s4hanaFS = { run: jest.fn().mockResolvedValue([]) };
        salesInquiryAdapter.s4hanaWL = { run: jest.fn().mockResolvedValue([{ SalesDocumentType: 'ZIN', SalesDocumentType_Text: 'Standard Inquiry' }]) };

        const results = await salesInquiryAdapter.getInquiryTypes();
        expect(results.map(r => [r.SalesDocumentType, r.SalesDocumentTypeName, r.IsActive])).toEqual([['ZIN', 'Standard Inquiry', true]]);
        expect(salesInquiryAdapter.s4hanaWL.run).toHaveBeenCalledTimes(1);
    });

    test('should fail with 502, not a built-in list, when both SAP services fail', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        salesInquiryAdapter.s4hanaFS = { run: jest.fn().mockRejectedValue(new Error('FS Network Error')) };
        salesInquiryAdapter.s4hanaWL = { run: jest.fn().mockRejectedValue(new Error('WL Network Error')) };

        await expect(salesInquiryAdapter.getInquiryTypes()).rejects.toMatchObject({
            status: 502,
            message: expect.stringMatching(/FS Network Error[\s\S]*WL Network Error/)
        });
        console.warn.mockRestore();
    });

    test('should return an empty list when SAP answers successfully with no inquiry types', async () => {
        salesInquiryAdapter.s4hanaFS = { run: jest.fn().mockResolvedValue([]) };
        salesInquiryAdapter.s4hanaWL = { run: jest.fn().mockResolvedValue([]) };
        await expect(salesInquiryAdapter.getInquiryTypes()).resolves.toEqual([]);
    });

    describe('createSalesQuoteFromInquiry (UI_SALESQUOTATIONMANAGE)', () => {
        afterEach(() => jest.restoreAllMocks());

        test('validates inquiry number is provided', async () => {
            await expect(salesInquiryAdapter.createSalesQuoteFromInquiry(''))
                .rejects.toThrow('Sales Inquiry number is required.');
        });

        test('delegates to the V4 client with the inquiry, quotation type and dialog header values', async () => {
            const quotationClient = { createFromInquiry: jest.fn().mockResolvedValue({ SalesQuotation: '20000512', verified: true }) };
            jest.spyOn(console, 'info').mockImplementation(() => {});

            const res = await salesInquiryAdapter.createSalesQuoteFromInquiry(' 1000536 ', {
                quotationClient,
                SalesQuotationType: 'ZQT',
                SalesQuotationDate: '2026-09-14',
                BindingPeriodValidityEndDate: '2026-10-14',
                PurchaseOrderByCustomer: 'PO-77',
                CustomerPurchaseOrderDate: '2026-09-14'
            });

            expect(res).toEqual({ SalesQuote: '20000512', SalesQuotation: '20000512', verified: true, createdVia: 'UI_SALESQUOTATIONMANAGE' });
            expect(quotationClient.createFromInquiry).toHaveBeenCalledWith({
                salesInquiry: '1000536',
                salesQuotationType: 'ZQT',
                header: {
                    SalesQuotationDate: '2026-09-14',
                    BindingPeriodValidityEndDate: '2026-10-14',
                    PurchaseOrderByCustomer: 'PO-77'
                }
            });
        });

        test('propagates the SAP business error unchanged', async () => {
            const sapError = Object.assign(new Error('Inquiry 1000539 is incomplete in SAP and cannot be converted to a Sales Quotation. Complete the inquiry in VA22 before creating the quotation.'), { status: 400, sapCode: 'SLS_LORD/166' });
            const quotationClient = { createFromInquiry: jest.fn().mockRejectedValue(sapError) };
            jest.spyOn(console, 'error').mockImplementation(() => {});

            await expect(salesInquiryAdapter.createSalesQuoteFromInquiry('1000539', { quotationClient }))
                .rejects.toBe(sapError);
        });
    });

    describe('_getQuotationDestination (dedicated technical SAP user)', () => {
        const KEYS = ['S4_QUOTATION_DESTINATION_NAME', 'S4_QUOTATION_USERNAME', 'S4_QUOTATION_PASSWORD', 'S4_DESTINATION_URL', 'S4_USERNAME', 'S4_PASSWORD', 'S4_CLIENT'];
        let saved;
        beforeEach(() => {
            saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
            KEYS.forEach(k => delete process.env[k]);
            process.env.S4_DESTINATION_URL = 'http://s4:8000';
            process.env.S4_CLIENT = '220';
            process.env.S4_USERNAME = 'KHUSHAL';
            process.env.S4_PASSWORD = 'shared-secret';
            jest.spyOn(console, 'warn').mockImplementation(() => {});
        });
        afterEach(() => {
            KEYS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
            jest.restoreAllMocks();
        });

        test('uses the dedicated user credentials when configured, never the shared user', async () => {
            process.env.S4_QUOTATION_USERNAME = 'QTN_TECH';
            process.env.S4_QUOTATION_PASSWORD = 'tech-secret';

            const dest = await salesInquiryAdapter._getQuotationDestination();

            expect(dest).toEqual({ url: 'http://s4:8000', username: 'QTN_TECH', password: 'tech-secret', headers: { 'sap-client': '220' } });
            expect(console.warn).not.toHaveBeenCalled();
        });

        test('refuses an incomplete dedicated-user configuration instead of silently falling back', async () => {
            process.env.S4_QUOTATION_USERNAME = 'QTN_TECH';
            await expect(salesInquiryAdapter._getQuotationDestination()).rejects.toThrow('Dedicated quotation user is incomplete');
        });

        test('warns when the "dedicated" user is the shared user', async () => {
            process.env.S4_QUOTATION_USERNAME = 'khushal';
            process.env.S4_QUOTATION_PASSWORD = 'x';
            await salesInquiryAdapter._getQuotationDestination();
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not a dedicated technical user'));
        });

        test('falls back to the shared destination with an explicit warning when nothing is configured', async () => {
            jest.spyOn(salesInquiryAdapter, '_getDestination').mockResolvedValue({ url: 'http://shared', username: 'KHUSHAL' });
            const dest = await salesInquiryAdapter._getQuotationDestination();
            expect(dest.username).toBe('KHUSHAL');
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('shared SAP destination, not a dedicated technical user'));
        });
    });
});
