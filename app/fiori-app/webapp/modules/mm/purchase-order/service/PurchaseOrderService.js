sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/purchase-order";

    /**
     * PurchaseOrderService
     * Encapsulates Purchase Order business API communication with the CAP backend.
     */
    return {
        /**
         * Dispatches createPurchaseOrder action to the CAP OData service.
         *
         * @param {Object} oPayload
         * @param {Object} oPayload.header
         * @param {Array<Object>} oPayload.items
         * @returns {Promise<string>} Resolves to created Purchase Order ID
         */
        createPurchaseOrder: function (oPayload) {
            var sUrl = SERVICE_BASE + "/createPurchaseOrder";
            return ODataClient.post(sUrl, oPayload).then(function (result) {
                if (!result) return "";
                return result.value || result.PurchaseOrder || result;
            });
        },

        /**
         * Queries Purchase Orders list from CAP OData service.
         *
         * @param {string} [sQuery] Optional OData query string (e.g. "?$top=10")
         * @returns {Promise<Array<Object>>}
         */
        getPurchaseOrders: function (sQuery) {
            var sUrl = SERVICE_BASE + "/PurchaseOrders" + (sQuery || "");
            return ODataClient.get(sUrl).then(function (result) {
                if (!result) return [];
                return result.value || (result.d && result.d.results) || [];
            });
        },

        /**
         * Queries a single Purchase Order by key.
         *
         * @param {string} sPoNumber
         * @returns {Promise<Object>}
         */
        getPurchaseOrder: function (sPoNumber) {
            var sUrl = SERVICE_BASE + "/PurchaseOrders('" + encodeURIComponent(sPoNumber) + "')";
            return ODataClient.get(sUrl);
        },

        /**
         * Loads actual configuration and master data from CAP OData service concurrently:
         * Document Types, Company Codes, Purchasing Organizations, and Purchasing Groups.
         *
         * @returns {Promise<{ documentTypes: Array<Object>, companyCodes: Array<Object>, purchasingOrgs: Array<Object>, purchasingGroups: Array<Object> }>}
         */
        loadConfiguration: function () {
            return Promise.all([
                ODataClient.get(SERVICE_BASE + "/DocumentTypeVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/CompanyCodeVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/PurchasingOrgVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/PurchasingGroupVH").then(function (res) { return (res && res.value) || []; })
            ]).then(function (aResults) {
                return {
                    documentTypes: aResults[0] || [],
                    companyCodes: aResults[1] || [],
                    purchasingOrgs: aResults[2] || [],
                    purchasingGroups: aResults[3] || []
                };
            }).catch(function (err) {
                console.warn("[PurchaseOrderService] Error loading configuration data:", err);
                return {
                    documentTypes: [],
                    companyCodes: [],
                    purchasingOrgs: [],
                    purchasingGroups: []
                };
            });
        },

        /**
         * Retrieves configured commercial defaults for a specific supplier from S/4HANA:
         * Currency, Payment Terms, Incoterms, and Incoterms Location.
         *
         * @param {string} sSupplier
         * @param {string} [sCompanyCode]
         * @param {string} [sPurchasingOrg]
         * @returns {Promise<{ Supplier: string, Currency: string, PaymentTerms: string, IncotermsClassification: string, IncotermsLocation1: string, derived: boolean }>}
         */
        getSupplierDefaults: function (sSupplier, sCompanyCode, sPurchasingOrg) {
            if (!sSupplier || String(sSupplier).trim() === "") {
                return Promise.resolve({
                    Supplier: "",
                    Currency: "",
                    PaymentTerms: "",
                    IncotermsClassification: "",
                    IncotermsLocation1: "",
                    derived: false
                });
            }

            var sCleanSupplier = String(sSupplier).trim();
            var sCleanCoCode = sCompanyCode ? String(sCompanyCode).trim() : "";
            var sCleanPurchOrg = sPurchasingOrg ? String(sPurchasingOrg).trim() : "";

            var sFunctionUrl = SERVICE_BASE + "/getSupplierDefaults(Supplier='" + encodeURIComponent(sCleanSupplier) +
                "',CompanyCode='" + encodeURIComponent(sCleanCoCode) +
                "',PurchasingOrganization='" + encodeURIComponent(sCleanPurchOrg) + "')";

            return ODataClient.get(sFunctionUrl).then(function (res) {
                var result = (res && res.value !== undefined) ? res.value : res;
                if (result && (result.Currency || result.PaymentTerms || result.IncotermsClassification || result.derived)) {
                    return {
                        Supplier: sCleanSupplier,
                        Currency: result.Currency || "",
                        PaymentTerms: result.PaymentTerms || "",
                        IncotermsClassification: result.IncotermsClassification || "",
                        IncotermsLocation1: result.IncotermsLocation1 || "",
                        derived: true
                    };
                }
                // If function returned no data, try fallback
                return null;
            }).catch(function () {
                // Function endpoint unavailable, proceed to fallback query
                return null;
            }).then(function (oResult) {
                if (oResult) return oResult;

                // Resilient Fallback: Query historical PurchaseOrders for this supplier
                var sFilter = "Supplier eq '" + encodeURIComponent(sCleanSupplier) + "'";
                if (sCleanPurchOrg) {
                    sFilter += " and PurchasingOrganization eq '" + encodeURIComponent(sCleanPurchOrg) + "'";
                }
                var sPoUrl = SERVICE_BASE + "/PurchaseOrders?$filter=" + sFilter + "&$top=1&$select=DocumentCurrency,PaymentTerms,IncotermsClassification,IncotermsTransferLocation";

                return ODataClient.get(sPoUrl).then(function (res) {
                    var aItems = (res && res.value) || [];
                    if (aItems.length > 0) {
                        var po = aItems[0];
                        return {
                            Supplier: sCleanSupplier,
                            Currency: po.DocumentCurrency || "",
                            PaymentTerms: po.PaymentTerms || "",
                            IncotermsClassification: po.IncotermsClassification || "",
                            IncotermsLocation1: po.IncotermsTransferLocation || "",
                            derived: !!(po.DocumentCurrency || po.PaymentTerms || po.IncotermsClassification)
                        };
                    }
                    return {
                        Supplier: sCleanSupplier,
                        Currency: "",
                        PaymentTerms: "",
                        IncotermsClassification: "",
                        IncotermsLocation1: "",
                        derived: false
                    };
                }).catch(function () {
                    return {
                        Supplier: sCleanSupplier,
                        Currency: "",
                        PaymentTerms: "",
                        IncotermsClassification: "",
                        IncotermsLocation1: "",
                        derived: false
                    };
                });
            });
        },

        /**
         * Looks up Material master data details including MaterialBaseUnit from S/4HANA.
         * Optionally filters by Plant to retrieve the plant-specific master record.
         *
         * @param {string} sMaterial
         * @param {string} [sPlant]
         * @returns {Promise<Object|null>}
         */
        getMaterialDetails: function (sMaterial, sPlant) {
            if (!sMaterial || String(sMaterial).trim() === "") {
                return Promise.resolve(null);
            }
            var sMatClean = encodeURIComponent(String(sMaterial).trim());
            var sFilter = "?$filter=Material eq '" + sMatClean + "'";
            if (sPlant && String(sPlant).trim() !== "") {
                var sPlantFilter = sFilter + " and Plant eq '" + encodeURIComponent(String(sPlant).trim()) + "'&$top=1";
                return ODataClient.get(SERVICE_BASE + "/MaterialVH" + sPlantFilter).then(function (res) {
                    var aItems = (res && (res.value || (res.d && res.d.results))) || [];
                    if (aItems.length > 0) {
                        return aItems[0];
                    }
                    // Fallback to query without Plant if not found for specific plant
                    return ODataClient.get(SERVICE_BASE + "/MaterialVH" + sFilter + "&$top=1").then(function (resFallback) {
                        var aFallbackItems = (resFallback && (resFallback.value || (resFallback.d && resFallback.d.results))) || [];
                        return (aFallbackItems.length > 0) ? aFallbackItems[0] : null;
                    });
                }).catch(function (err) {
                    console.warn("[PurchaseOrderService] Error fetching material details for " + sMaterial + ":", err);
                    return null;
                });
            }

            return ODataClient.get(SERVICE_BASE + "/MaterialVH" + sFilter + "&$top=1").then(function (res) {
                var aItems = (res && (res.value || (res.d && res.d.results))) || [];
                return (aItems.length > 0) ? aItems[0] : null;
            }).catch(function (err) {
                console.warn("[PurchaseOrderService] Error fetching material details for " + sMaterial + ":", err);
                return null;
            });
        },

        /**
         * Directly retrieves the configured Base Unit of Measure for a Material.
         *
         * @param {string} sMaterial
         * @param {string} [sPlant]
         * @returns {Promise<string|null>}
         */
        getMaterialUnit: function (sMaterial, sPlant) {
            return this.getMaterialDetails(sMaterial, sPlant).then(function (oMaterial) {
                return (oMaterial && (oMaterial.MaterialBaseUnit || oMaterial.BaseUnit || oMaterial.UnitOfMeasure)) || null;
            });
        }
    };
});
