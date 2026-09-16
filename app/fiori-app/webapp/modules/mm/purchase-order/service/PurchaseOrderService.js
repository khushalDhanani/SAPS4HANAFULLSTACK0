sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (ODataClient, Filter, FilterOperator) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/purchase-order";

    var _FilterOperator = FilterOperator || {
        EQ: "EQ",
        NE: "NE",
        GT: "GT",
        GE: "GE",
        LT: "LT",
        LE: "LE",
        BT: "BT",
        Contains: "Contains"
    };

    var _Filter = Filter || function (sPath, sOperator, oValue1, oValue2) {
        if (typeof sPath === "object") {
            this.aFilters = sPath.filters;
            this.bAnd = sPath.and;
        } else {
            this.sPath = sPath;
            this.sOperator = sOperator;
            this.oValue1 = oValue1;
            this.oValue2 = oValue2;
        }
    };

    var _oModel = null;

    function _isModel(o) {
        return !!(o && typeof o.bindList === "function");
    }

    /**
     * Read an entity set via the OData V4 model's list binding.
     * Falls back to ODataClient.get() if no model is provided.
     *
     * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
     * @param {string} sEntitySet
     * @param {sap.ui.model.Filter[]} [aFilters]
     * @param {Object} [mParameters]
     * @returns {Promise<Array>}
     */
    function _readEntitySet(oModel, sEntitySet, aFilters, mParameters) {
        if (!oModel || typeof oModel.bindList !== "function") {
            var sUrl = SERVICE_BASE + sEntitySet;
            var aParts = [];
            if (aFilters && aFilters.length > 0) {
                var aFilterParts = aFilters.map(function (f) {
                    return f.sPath + " eq '" + encodeURIComponent(f.oValue1) + "'";
                });
                aParts.push("$filter=" + aFilterParts.join(" and "));
            }
            if (mParameters && mParameters.$top) {
                aParts.push("$top=" + mParameters.$top);
            }
            if (aParts.length > 0) {
                sUrl += "?" + aParts.join("&");
            }
            return ODataClient.get(sUrl).then(function (result) {
                if (!result) return [];
                return result.value || (result.d && result.d.results) || [];
            });
        }

        var oListBinding = oModel.bindList(sEntitySet, undefined, undefined, aFilters, mParameters);
        return oListBinding.requestContexts(0, Infinity).then(function (aContexts) {
            return aContexts.map(function (oCtx) { return oCtx.getObject(); });
        });
    }

    /**
     * PurchaseOrderService
     * Encapsulates Purchase Order business API communication with the CAP backend.
     */
    return {
        /**
         * Set the OData V4 model for entity set reads
         * @param {sap.ui.model.odata.v4.ODataModel} oModel
         */
        setModel: function (oModel) {
            _oModel = oModel;
        },

        /**
         * Get the current OData V4 model
         * @returns {sap.ui.model.odata.v4.ODataModel|null}
         */
        getModel: function () {
            return _oModel;
        },

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
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrQuery]
         * @param {string} [sQuery] Optional OData query string (e.g. "?$top=10")
         * @returns {Promise<Array<Object>>}
         */
        getPurchaseOrders: function (oModelOrQuery, sQuery) {
            var oModel = _isModel(oModelOrQuery) ? oModelOrQuery : _oModel;
            var sQueryVal = _isModel(oModelOrQuery) ? sQuery : oModelOrQuery;
            if (oModel) {
                return _readEntitySet(oModel, "/PurchaseOrders");
            }
            var sUrl = SERVICE_BASE + "/PurchaseOrders" + (sQueryVal || "");
            return ODataClient.get(sUrl).then(function (result) {
                if (!result) return [];
                return result.value || (result.d && result.d.results) || [];
            });
        },

        /**
         * Queries a single Purchase Order by key.
         *
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrPo]
         * @param {string} [sPoNumber]
         * @returns {Promise<Object>}
         */
        getPurchaseOrder: function (oModelOrPo, sPoNumber) {
            var oModel = _isModel(oModelOrPo) ? oModelOrPo : _oModel;
            var sPoVal = _isModel(oModelOrPo) ? sPoNumber : oModelOrPo;
            if (oModel && typeof oModel.bindContext === "function") {
                var oContextBinding = oModel.bindContext("/PurchaseOrders('" + encodeURIComponent(sPoVal) + "')");
                return oContextBinding.requestObject();
            }
            var sUrl = SERVICE_BASE + "/PurchaseOrders('" + encodeURIComponent(sPoVal) + "')";
            return ODataClient.get(sUrl);
        },

        /**
         * Loads actual configuration and master data from CAP OData service concurrently:
         * Document Types, Company Codes, Purchasing Organizations, and Purchasing Groups.
         *
         * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
         * @returns {Promise<{ documentTypes: Array<Object>, companyCodes: Array<Object>, purchasingOrgs: Array<Object>, purchasingGroups: Array<Object> }>}
         */
        loadConfiguration: function (oModel) {
            var m = _isModel(oModel) ? oModel : _oModel;
            if (m) {
                return Promise.all([
                    _readEntitySet(m, "/DocumentTypeVH"),
                    _readEntitySet(m, "/CompanyCodeVH"),
                    _readEntitySet(m, "/PurchasingOrgVH"),
                    _readEntitySet(m, "/PurchasingGroupVH")
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
            }

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
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrMaterial]
         * @param {string} [sMaterialOrPlant]
         * @param {string} [sPlant]
         * @returns {Promise<Object|null>}
         */
        getMaterialDetails: function (oModelOrMaterial, sMaterialOrPlant, sPlant) {
            var oModel = _isModel(oModelOrMaterial) ? oModelOrMaterial : _oModel;
            var sMaterial = _isModel(oModelOrMaterial) ? sMaterialOrPlant : oModelOrMaterial;
            var sPlantVal = _isModel(oModelOrMaterial) ? sPlant : sMaterialOrPlant;

            if (!sMaterial || String(sMaterial).trim() === "") {
                return Promise.resolve(null);
            }
            var sMatClean = String(sMaterial).trim();

            if (oModel) {
                var aFilters = [new _Filter("Material", _FilterOperator.EQ, sMatClean)];
                if (sPlantVal && String(sPlantVal).trim() !== "") {
                    aFilters.push(new _Filter("Plant", _FilterOperator.EQ, String(sPlantVal).trim()));
                }
                return _readEntitySet(oModel, "/MaterialVH", aFilters, { $top: 1 }).then(function (aItems) {
                    if (aItems.length > 0) {
                        return aItems[0];
                    }
                    if (sPlantVal && String(sPlantVal).trim() !== "") {
                        return _readEntitySet(oModel, "/MaterialVH", [new _Filter("Material", _FilterOperator.EQ, sMatClean)], { $top: 1 }).then(function (aFallback) {
                            return aFallback.length > 0 ? aFallback[0] : null;
                        });
                    }
                    return null;
                }).catch(function (err) {
                    console.warn("[PurchaseOrderService] Error fetching material details for " + sMaterial + ":", err);
                    return null;
                });
            }

            var sFilter = "?$filter=Material eq '" + encodeURIComponent(sMatClean) + "'";
            if (sPlantVal && String(sPlantVal).trim() !== "") {
                var sPlantFilter = sFilter + " and Plant eq '" + encodeURIComponent(String(sPlantVal).trim()) + "'&$top=1";
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
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrMaterial]
         * @param {string} [sMaterialOrPlant]
         * @param {string} [sPlant]
         * @returns {Promise<string|null>}
         */
        getMaterialUnit: function (oModelOrMaterial, sMaterialOrPlant, sPlant) {
            return this.getMaterialDetails(oModelOrMaterial, sMaterialOrPlant, sPlant).then(function (oMaterial) {
                return (oMaterial && (oMaterial.MaterialBaseUnit || oMaterial.BaseUnit || oMaterial.UnitOfMeasure)) || null;
            });
        }
    };
});
