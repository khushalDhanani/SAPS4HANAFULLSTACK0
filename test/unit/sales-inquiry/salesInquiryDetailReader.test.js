'use strict';

const detailReader = require('../../../srv/integration/s4hana/sd/sales-inquiry/salesInquiryDetailReader');

describe('Unit: salesInquiryDetailReader', () => {
    test('getInquiry reads header, partner cards, and items in parallel', async () => {
        let wlCalled = false;
        let fsHeaderCalled = false;
        let fsItemsCalled = false;

        const mockAdapter = {
            init: jest.fn().mockResolvedValue(),
            s4hanaWL: {
                run: jest.fn().mockImplementation(() => {
                    wlCalled = true;
                    return Promise.resolve({
                        SalesInquiry: '100005',
                        SalesOrganization: '1000',
                        DistributionChannel: '10',
                        OrganizationDivision: '52',
                        SalesOffice: 'SO10',
                        SalesGroup: '100',
                        SoldToParty: '10083'
                    });
                })
            },
            s4hanaFS: {
                run: jest.fn().mockImplementation((q) => {
                    const sFrom = String(q?.SELECT?.from?.ref?.[0] || '');
                    if (sFrom.includes('C_Inquiryfs')) {
                        fsHeaderCalled = true;
                        return Promise.resolve({
                            SalesInquiry: '100005',
                            CustomerPurchaseOrderDate: '2026-11-20',
                            to_SDDocumentPartnerCard: [
                                { PartnerFunction: 'WE', Customer: '10083', FullName: 'Bajaj Healthcare' },
                                { PartnerFunction: 'ZP', Personnel: '5001', FullName: 'John Doe' },
                                { PartnerFunction: 'ZE', Personnel: '9001', FullName: 'Jane Rep' }
                            ]
                        });
                    }
                    if (sFrom.includes('C_Inquiryitemfs')) {
                        fsItemsCalled = true;
                        return Promise.resolve([
                            { SalesInquiry: '100005', SalesInquiryItem: '10', NetPriceAmount: 250 }
                        ]);
                    }
                    return Promise.resolve(null);
                })
            },
            salesOfficeVhCache: {
                getOrSet: jest.fn().mockResolvedValue('Surat Office')
            },
            salesGroupVhCache: {
                getOrSet: jest.fn().mockResolvedValue('Surat Group')
            }
        };

        const result = await detailReader.getInquiry(mockAdapter, '100005');
        expect(wlCalled).toBe(true);
        expect(fsHeaderCalled).toBe(true);
        expect(fsItemsCalled).toBe(true);
        expect(result.header.ShipToParty).toBe('10083');
        expect(result.header.ShipToPartyName).toBe('Bajaj Healthcare');
        expect(result.header.ContactPersonName).toBe('John Doe');
        expect(result.header.SalesEmployeeName).toBe('Jane Rep');
        expect(result.header.SalesOfficeName).toBe('Surat Office');
        expect(result.header.SalesGroupName).toBe('Surat Group');
        expect(result.items).toHaveLength(1);
        expect(result.items[0].NetPriceAmount).toBe('250');
    });

    test('getInquiry throws 502 when both WL and FS services fail', async () => {
        const mockAdapter = {
            init: jest.fn().mockResolvedValue(),
            s4hanaWL: {
                run: jest.fn().mockRejectedValue(new Error('WL down 503'))
            },
            s4hanaFS: {
                run: jest.fn().mockRejectedValue(new Error('FS down 503'))
            }
        };

        await expect(detailReader.getInquiry(mockAdapter, '100001')).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining('Sales Inquiry 100001 could not be read')
        });
    });

    test('getInquiry marks itemsUnavailable when factsheet items service fails but header succeeds', async () => {
        const mockAdapter = {
            init: jest.fn().mockResolvedValue(),
            s4hanaWL: {
                run: jest.fn().mockResolvedValue({
                    SalesInquiry: '100002',
                    SoldToParty: '10083'
                })
            },
            s4hanaFS: {
                run: jest.fn().mockImplementation((q) => {
                    const sFrom = String(q?.SELECT?.from?.ref?.[0] || '');
                    if (sFrom.includes('C_Inquiryfs')) {
                        return Promise.resolve({ SalesInquiry: '100002' });
                    }
                    if (sFrom.includes('C_Inquiryitemfs')) {
                        return Promise.reject(new Error('Item service timeout'));
                    }
                    return Promise.resolve(null);
                })
            },
            salesOfficeVhCache: { getOrSet: jest.fn() },
            salesGroupVhCache: { getOrSet: jest.fn() }
        };

        const result = await detailReader.getInquiry(mockAdapter, '100002');
        expect(result.itemsUnavailable).toBe(true);
        expect(result.itemsUnavailableReason).toBe('Item service timeout');
        expect(result.items).toEqual([]);
    });
});
