const cds = require('@sap/cds');
const purchaseOrderAdapter = require('./integration/s4hana/PurchaseOrderAdapter');

module.exports = cds.service.impl(async function() {
    // Delegate READ operations to the dedicated S/4HANA integration adapters
    const fsEntities = ['PurchaseOrders', 'CurrencyVH', 'UnitOfMeasureVH', 'DocumentTypeVH', 'TaxCodeVH'];
    this.on('READ', fsEntities, async (req) => {
        return await purchaseOrderAdapter.readFsData(req.query);
    });

    const maintEntities = [
        'SupplierVH', 'CompanyCodeVH', 'PurchasingOrgVH', 
        'PurchasingGroupVH', 'MaterialVH', 'PlantVH', 'StorageLocationVH', 'MaterialGroupVH', 'IncotermsClassificationVH', 'PaymentTermsVH'
    ];
    this.on('READ', maintEntities, async (req) => {
        return await purchaseOrderAdapter.readMaintData(req.query);
    });

    this.on('createPurchaseOrder', async (req) => {
        const { header, items } = req.data;
        if (!header || !items || items.length === 0) {
            req.error(400, 'Header and at least one Item are required');
            return;
        }

        // Map payload for S/4HANA MM_PUR_PO_MAINT_V2_SRV
        const payload = {
            PurchaseOrderType: header.PurchaseOrderType,
            CompanyCode: header.CompanyCode,
            PurchasingOrganization: header.PurchasingOrganization,
            PurchasingGroup: header.PurchasingGroup,
            Supplier: header.Supplier,
            PurchaseOrderDate: header.DocumentDate ? `/Date(${new Date(header.DocumentDate).getTime()})/` : undefined,
            DocumentCurrency: header.Currency,
            IncotermsClassification: header.IncotermsClassification,
            IncotermsLocation1: header.IncotermsLocation1,
            PaymentTerms: header.PaymentTerms,
            to_PurchaseOrderItemTP: items.map(item => ({
                PurchaseOrderItem: item.PurchaseOrderItem || "10",
                Material: item.Material,
                MaterialGroup: item.MaterialGroup,
                PurchaseOrderItemCategory: item.PurchaseOrderItemCategory,
                AccountAssignmentCategory: item.AccountAssignmentCategory,
                Plant: item.Plant,
                StorageLocation: item.StorageLocation,
                OrderQuantity: String(item.OrderQuantity),
                PurchaseOrderQuantityUnit: item.UnitOfMeasure,
                NetPriceAmount: String(item.NetPriceAmount || "0.00"),
                TaxCode: item.TaxCode,
                NetAmount: String(item.NetAmount || "0.00"),
                RequisitionerName: item.RequisitionerName || "Fiori User",
                to_PurOrdScheduleLineTP: [
                    {
                        ScheduleLine: "0001",
                        ScheduleLineOrderQuantity: String(item.OrderQuantity),
                        ScheduleLineDeliveryDate: header.DocumentDate ? `/Date(${new Date(header.DocumentDate).getTime()})/` : undefined
                    }
                ]
            }))
        };

        try {
            const result = await purchaseOrderAdapter.createPurchaseOrder(payload);
            return result.PurchaseOrder || "PO Created but no ID returned";
        } catch (error) {
            console.error(error.message, error.response?.data);
            const sapError = error.response?.data?.error?.message?.value || error.message;
            req.error(500, `Failed to create Purchase Order: ${sapError}`);
        }
    });
});
