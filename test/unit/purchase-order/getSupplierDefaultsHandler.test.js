jest.mock('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter', () => ({
    readFsData: jest.fn(),
    createPurchaseOrder: jest.fn(),
    getDashboardMetrics: jest.fn()
}));

const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const registerPurchaseOrderHandlers = require('../../../srv/mm/purchase-order/handlers/purchaseOrder.handler');

function getAllHandlers() {
    const handlers = {};
    registerPurchaseOrderHandlers({ on: (event, ...args) => { handlers[event] = args[args.length - 1]; } });
    return handlers;
}

function getSupplierDefaultsHandler() {
    return getAllHandlers().getSupplierDefaults;
}

describe('Unit: getSupplierDefaults CAP handler', () => {
    beforeEach(() => {
        purchaseOrderAdapter.readFsData.mockReset();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('should return unconfigured defaults when Supplier is blank', async () => {
        const req = {
            data: { Supplier: '' }
        };
        const result = await getSupplierDefaultsHandler()(req);

        expect(result).toEqual({
            Supplier: '',
            Currency: '',
            PaymentTerms: '',
            IncotermsClassification: '',
            IncotermsLocation1: '',
            derived: false,
            source: '',
            lastPurchaseOrder: ''
        });
        expect(purchaseOrderAdapter.readFsData).not.toHaveBeenCalled();
    });

    it('should query C_PurchaseOrderFs sorted by PurchaseOrder desc and return defaults from last PO', async () => {
        let capturedQuery = null;
        purchaseOrderAdapter.readFsData.mockImplementation(async (query) => {
            capturedQuery = query;
            return [{
                PurchaseOrder: '4500000888',
                DocumentCurrency: 'EUR',
                PaymentTerms: '0001',
                IncotermsClassification: 'EXW',
                IncotermsTransferLocation: 'BERLIN',
                CompanyCode: '1010'
            }];
        });

        const req = {
            data: {
                Supplier: '10300001',
                CompanyCode: '1010',
                PurchasingOrganization: '1010'
            }
        };

        const result = await getSupplierDefaultsHandler()(req);

        expect(purchaseOrderAdapter.readFsData).toHaveBeenCalled();
        // Verify sorting by PurchaseOrder desc
        expect(capturedQuery.SELECT.orderBy).toEqual([
            { ref: ['PurchaseOrder'], sort: 'desc' }
        ]);
        // Verify columns contain PurchaseOrder
        const columnNames = capturedQuery.SELECT.columns.map(c => (typeof c === 'string' ? c : c.ref?.[0]));
        expect(columnNames).toContain('PurchaseOrder');
        expect(columnNames).toContain('DocumentCurrency');
        expect(columnNames).toContain('PaymentTerms');

        // Verify returned payload
        expect(result).toEqual({
            Supplier: '10300001',
            Currency: 'EUR',
            PaymentTerms: '0001',
            IncotermsClassification: 'EXW',
            IncotermsLocation1: 'BERLIN',
            derived: true,
            source: 'from last PO',
            lastPurchaseOrder: '4500000888'
        });
    });

    it('should filter out obsolete PaymentTerms AT01 from historical PO while keeping valid defaults', async () => {
        purchaseOrderAdapter.readFsData.mockResolvedValue([{
            PurchaseOrder: '300000001',
            DocumentCurrency: 'INR',
            PaymentTerms: 'AT01',
            IncotermsClassification: 'EXW',
            IncotermsTransferLocation: 'MUMBAI',
            CompanyCode: '1000'
        }]);

        const req = {
            data: {
                Supplier: '100102',
                CompanyCode: '1000',
                PurchasingOrganization: 'AE01'
            }
        };

        const result = await getSupplierDefaultsHandler()(req);

        expect(result).toEqual({
            Supplier: '100102',
            Currency: 'INR',
            PaymentTerms: '', // AT01 cleanly omitted!
            IncotermsClassification: 'EXW',
            IncotermsLocation1: 'MUMBAI',
            derived: true,
            source: 'from last PO',
            lastPurchaseOrder: '300000001'
        });
    });

    it('should validate against getValidPaymentTerms when available', async () => {
        purchaseOrderAdapter.getValidPaymentTerms = jest.fn().mockResolvedValue(new Set(['0002', '0003', 'PT00']));
        purchaseOrderAdapter.readFsData.mockResolvedValue([{
            PurchaseOrder: '300000005',
            DocumentCurrency: 'INR',
            PaymentTerms: '0002',
            IncotermsClassification: '',
            IncotermsTransferLocation: '',
            CompanyCode: '1000'
        }]);

        const req = {
            data: {
                Supplier: '100102',
                CompanyCode: '1000',
                PurchasingOrganization: 'AE01'
            }
        };

        const result = await getSupplierDefaultsHandler()(req);

        expect(result.PaymentTerms).toBe('0002');
    });

    it('should return derived: false when no historical PO exists for supplier', async () => {
        purchaseOrderAdapter.readFsData.mockResolvedValue([]);

        const req = {
            data: {
                Supplier: 'NEW_VENDOR',
                CompanyCode: '1010',
                PurchasingOrganization: '1010'
            }
        };

        const result = await getSupplierDefaultsHandler()(req);

        expect(result).toEqual({
            Supplier: 'NEW_VENDOR',
            Currency: '',
            PaymentTerms: '',
            IncotermsClassification: '',
            IncotermsLocation1: '',
            derived: false,
            source: '',
            lastPurchaseOrder: ''
        });
    });
});
