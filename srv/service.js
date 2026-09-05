const cds = require('@sap/cds');
const purchaseOrderAdapter = require('./integration/s4hana/PurchaseOrderAdapter');

module.exports = cds.service.impl(async function() {
    // Delegate READ operations to the dedicated S/4HANA integration adapters
    const fsEntities = ['PurchaseOrders', 'CurrencyVH', 'UnitOfMeasureVH', 'DocumentTypeVH', 'TaxCodeVH'];
    this.on('READ', fsEntities, async (req) => {
        const results = await purchaseOrderAdapter.readFsData(req.query);
        if (req.target.name.endsWith('CurrencyVH') && Array.isArray(results)) {
            const seen = new Set();
            const filtered = results.filter(item => {
                if (!item || !item.Currency) return true;
                if (seen.has(item.Currency)) return false;
                seen.add(item.Currency);
                return true;
            });
            if (results.$count !== undefined) {
                filtered.$count = results.$count;
            }
            return filtered;
        }
        return results;
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
            IncotermsClassification: header.IncotermsClassification || undefined,
            IncotermsLocation1: header.IncotermsLocation1 || undefined,
            PaymentTerms: header.PaymentTerms || undefined,
            to_PurchaseOrderItemTP: items.map(item => ({
                PurchaseOrderItem: item.PurchaseOrderItem || "10",
                Material: item.Material,
                MaterialGroup: item.MaterialGroup || undefined,
                PurchaseOrderItemCategory: item.PurchaseOrderItemCategory || undefined,
                AccountAssignmentCategory: item.AccountAssignmentCategory || undefined,
                Plant: item.Plant,
                StorageLocation: item.StorageLocation || undefined,
                OrderQuantity: String(item.OrderQuantity),
                PurchaseOrderQuantityUnit: item.UnitOfMeasure,
                NetPriceAmount: String(item.NetPriceAmount || "0.00"),
                TaxCode: item.TaxCode || undefined,
                NetAmount: item.NetAmount ? String(item.NetAmount) : undefined,
                RequisitionerName: item.RequisitionerName || "Fiori User",
                to_PurOrdScheduleLineTP: [
                    {
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
            let sapError = error.response?.data?.error?.message?.value;
            if (!sapError) {
                // Try parsing JSON embedded in fetch error message
                const jsonMatch = error.message.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        sapError = parsed.error?.message?.value;
                        const details = parsed.error?.innererror?.errordetails;
                        if (Array.isArray(details) && details.length > 0) {
                            const detailMsgs = details.map(d => d.message).filter(Boolean);
                            if (detailMsgs.length > 0) {
                                sapError = detailMsgs.join('; ');
                            }
                        }
                    } catch (e) {}
                }
            }
            if (!sapError) {
                sapError = error.message;
            }
            req.error(500, `Failed to create Purchase Order: ${sapError}`);
        }
    });
});
