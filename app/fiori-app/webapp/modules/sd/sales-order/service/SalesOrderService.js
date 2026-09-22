sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (ODataClient, Filter, FilterOperator) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/sales-order";

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
     * SalesOrderService
     * Encapsulates Sales Order API communication with the CAP backend.
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
         * Sanitizes payload against CAP OrderHeader and OrderItem schema.
         * Strips UI-only and unmapped client-state properties.
         *
         * @private
         * @param {Object} oPayload
         * @returns {Object}
         */
        _sanitizePayload: function (oPayload) {
            if (!oPayload || typeof oPayload !== "object") return oPayload;
            var rawHeader = oPayload.header || {};
            var rawItems = Array.isArray(oPayload.items) ? oPayload.items : [];

            var ALLOWED_HEADER_FIELDS = [
                "SalesOrderType",
                "SalesOrganization",
                "DistributionChannel",
                "OrganizationDivision",
                "SalesOffice",
                "SalesGroup",
                "SoldToParty",
                "CustomerName",
                "ShipToParty",
                "PurchaseOrderNumber",
                "PurchaseOrderByCustomer",
                "CustomerPurchaseOrderDate",
                "SalesOrderDate",
                "RequestedDeliveryDate",
                "TransactionCurrency",
                "TotalNetAmount",
                "CustomerGroup2",
                "PortOfLoading",
                "PortOfDischarge",
                "ContactPerson"
            ];

            var ALLOWED_ITEM_FIELDS = [
                "SalesOrderItem",
                "Material",
                "SalesOrderItemText",
                "OrderQuantity",
                "OrderQuantityUnit",
                "NetPriceAmount",
                "NetAmount",
                "TransactionCurrency",
                "Plant",
                "RequestedDeliveryDate"
            ];

            var cleanHeader = {};
            ALLOWED_HEADER_FIELDS.forEach(function (field) {
                if (rawHeader[field] !== undefined && rawHeader[field] !== null) {
                    cleanHeader[field] = rawHeader[field];
                }
            });

            var cleanItems = rawItems.map(function (item) {
                var cleanItem = {};
                ALLOWED_ITEM_FIELDS.forEach(function (field) {
                    if (item[field] !== undefined && item[field] !== null) {
                        cleanItem[field] = item[field];
                    }
                });
                return cleanItem;
            });

            return {
                header: cleanHeader,
                items: cleanItems
            };
        },

        /**
         * Dispatches createSalesOrder action to the CAP OData service.
         *
         * @param {Object} oPayload
         * @param {Object} oPayload.header
         * @param {Array<Object>} oPayload.items
         * @returns {Promise<string>} Resolves to created Sales Order ID
         */
        createSalesOrder: function (oPayload) {
            var sUrl = SERVICE_BASE + "/createSalesOrder";
            var oCleanPayload = this._sanitizePayload(oPayload);
            return ODataClient.post(sUrl, oCleanPayload).then(function (result) {
                if (!result) return "";
                return result.value || result.SalesOrder || result;
            });
        },

        /**
         * Queries Sales Orders list from CAP OData service.
         *
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrQuery]
         * @param {string} [sQuery] Optional OData query string (e.g. "?$top=10")
         * @returns {Promise<Array<Object>>}
         */
        getSalesOrders: function (oModelOrQuery, sQuery) {
            var oModel = _isModel(oModelOrQuery) ? oModelOrQuery : _oModel;
            var sQueryVal = _isModel(oModelOrQuery) ? sQuery : oModelOrQuery;
            if (oModel) {
                return _readEntitySet(oModel, "/SalesOrders");
            }
            var sUrl = SERVICE_BASE + "/SalesOrders" + (sQueryVal || "");
            return ODataClient.get(sUrl).then(function (result) {
                if (!result) return [];
                return result.value || (result.d && result.d.results) || [];
            });
        },

        /**
         * Fetches full Sales Order details.
         *
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrOrder]
         * @param {string|boolean} [sOrderNumber]
         * @param {boolean} [bForceRefresh]
         * @returns {Promise<Object>}
         */
        getSalesOrder: function (oModelOrOrder, sOrderNumber, bForceRefresh) {
            var oModel = _isModel(oModelOrOrder) ? oModelOrOrder : _oModel;
            var sOrderVal = _isModel(oModelOrOrder) ? sOrderNumber : oModelOrOrder;
            var bForce = typeof sOrderNumber === "boolean" ? sOrderNumber : !!bForceRefresh;
            if (oModel && typeof oModel.bindContext === "function") {
                var oContextBinding = oModel.bindContext("/SalesOrders('" + encodeURIComponent(sOrderVal) + "')", undefined, {
                    $expand: "to_SalesDocumentItemWl"
                });
                if (bForce && typeof oContextBinding.refresh === "function") {
                    oContextBinding.refresh();
                }
                return oContextBinding.requestObject();
            }
            var sUrl = SERVICE_BASE + "/SalesOrders('" + encodeURIComponent(sOrderVal) + "')?$expand=to_SalesDocumentItemWl";
            if (bForce) {
                sUrl += "&_t=" + Date.now();
            }
            return ODataClient.get(sUrl);
        },

        /**
         * Loads actual configuration and master data concurrently from CAP service:
         * Order Types, Sales Organizations, Distribution Channels, and Divisions.
         *
         * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
         * @returns {Promise<{ orderTypes: Array<Object>, salesOrgs: Array<Object>, distChannels: Array<Object>, divisions: Array<Object> }>}
         */
        loadConfiguration: function (oModel) {
            var m = _isModel(oModel) ? oModel : _oModel;
            if (m) {
                return Promise.all([
                    _readEntitySet(m, "/SalesOrderTypeVH"),
                    _readEntitySet(m, "/SalesOrganizationVH"),
                    _readEntitySet(m, "/DistributionChannelVH"),
                    _readEntitySet(m, "/DivisionVH")
                ]).then(function (aResults) {
                    return {
                        orderTypes: aResults[0] || [],
                        salesOrgs: aResults[1] || [],
                        distChannels: aResults[2] || [],
                        divisions: aResults[3] || []
                    };
                }).catch(function (err) {
                    console.warn("[SalesOrderService] Error loading configuration data:", err);
                    return {
                        orderTypes: [],
                        salesOrgs: [],
                        distChannels: [],
                        divisions: []
                    };
                });
            }

            return Promise.all([
                ODataClient.get(SERVICE_BASE + "/SalesOrderTypeVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/SalesOrganizationVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/DistributionChannelVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/DivisionVH").then(function (res) { return (res && res.value) || []; })
            ]).then(function (aResults) {
                return {
                    orderTypes: aResults[0] || [],
                    salesOrgs: aResults[1] || [],
                    distChannels: aResults[2] || [],
                    divisions: aResults[3] || []
                };
            }).catch(function (err) {
                console.warn("[SalesOrderService] Error loading configuration data:", err);
                return {
                    orderTypes: [],
                    salesOrgs: [],
                    distChannels: [],
                    divisions: []
                };
            });
        },

        /**
         * Retrieves commercial defaults for a specific customer from S/4HANA.
         *
         * @param {string} sCustomer
         * @param {string} [sSalesOrg]
         * @param {string} [sDistChannel]
         * @param {string} [sDivision]
         * @returns {Promise<Object>}
         */
        getCustomerDefaults: function (sCustomer, sSalesOrg, sDistChannel, sDivision) {
            if (!sCustomer || String(sCustomer).trim() === "") {
                return Promise.resolve({
                    Customer: "",
                    CustomerName: "",
                    City: "",
                    Country: "",
                    Currency: "",
                    ShipToParty: "",
                    ShipToPartyName: "",
                    derived: false
                });
            }

            var sParams = "Customer='" + encodeURIComponent(String(sCustomer).trim()) + "'";
            if (sSalesOrg) sParams += ",SalesOrganization='" + encodeURIComponent(String(sSalesOrg).trim()) + "'";
            if (sDistChannel) sParams += ",DistributionChannel='" + encodeURIComponent(String(sDistChannel).trim()) + "'";
            if (sDivision) sParams += ",Division='" + encodeURIComponent(String(sDivision).trim()) + "'";

            var sUrl = SERVICE_BASE + "/getCustomerDefaults(" + sParams + ")";
            return ODataClient.get(sUrl).then(function (result) {
                return result || {
                    Customer: sCustomer,
                    CustomerName: "",
                    City: "",
                    Country: "",
                    Currency: "",
                    ShipToParty: sCustomer,
                    ShipToPartyName: "",
                    derived: false
                };
            }).catch(function () {
                return {
                    Customer: sCustomer,
                    CustomerName: "",
                    City: "",
                    Country: "",
                    Currency: "",
                    ShipToParty: sCustomer,
                    ShipToPartyName: "",
                    derived: false
                };
            });
        },

        /**
         * Retrieves standard initial defaults for VA01 Sales Order creation.
         */
        getSalesOrderDefaults: function () {
            var sUrl = SERVICE_BASE + "/getSalesOrderDefaults()";
            return ODataClient.get(sUrl).catch(function () {
                return {
                    SalesOrderType: "",
                    SalesOrganization: "",
                    DistributionChannel: "",
                    OrganizationDivision: "",
                    SalesOrderDate: "",
                    CreationDate: "",
                    RequestedDeliveryDate: "",
                    TransactionCurrency: "",
                    Plant: "",
                    derived: false
                };
            });
        },

        /**
         * Looks up Material master data details including MaterialBaseUnit from S/4HANA.
         *
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrMaterial]
         * @param {string} [sMaterial]
         * @returns {Promise<Object|null>}
         */
        getMaterialDetails: function (oModelOrMaterial, sMaterial) {
            var oModel = _isModel(oModelOrMaterial) ? oModelOrMaterial : _oModel;
            var sMatVal = _isModel(oModelOrMaterial) ? sMaterial : oModelOrMaterial;

            if (!sMatVal || String(sMatVal).trim() === "") {
                return Promise.resolve(null);
            }
            var sClean = String(sMatVal).trim();

            if (oModel) {
                var aFilters = [new _Filter("Material", _FilterOperator.EQ, sClean)];
                return _readEntitySet(oModel, "/MaterialVH", aFilters, { $top: 1 }).then(function (aItems) {
                    return aItems.length > 0 ? aItems[0] : null;
                }).catch(function (err) {
                    console.warn("[SalesOrderService] Error fetching material for " + sClean + ":", err);
                    return null;
                });
            }

            var sFilter =
                "?$filter=Material eq '" + encodeURIComponent(sClean) + "' or " +
                "MaterialName eq '" + encodeURIComponent(sClean) + "' or " +
                "contains(MaterialName,'" + encodeURIComponent(sClean) + "')&$top=1";

            return ODataClient.get(SERVICE_BASE + "/MaterialVH" + sFilter)
                .then(function (res) {
                    var aItems = (res && (res.value || (res.d && res.d.results))) || [];
                    return aItems.length > 0 ? aItems[0] : null;
                })
                .catch(function (err) {
                    console.warn("[SalesOrderService] Error fetching material for " + sMatVal + ":", err);
                    return null;
                });
        },

        /**
         * Directly retrieves the configured Base Unit of Measure for a Material.
         *
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrMaterial]
         * @param {string} [sMaterial]
         * @returns {Promise<string|null>}
         */
        getMaterialUnit: function (oModelOrMaterial, sMaterial) {
            return this.getMaterialDetails(oModelOrMaterial, sMaterial).then(function (oMaterial) {
                return (oMaterial && (oMaterial.MaterialBaseUnit || oMaterial.BaseUnit || oMaterial.OrderQuantityUnit)) || null;
            });
        },

        /**
         * Calls CheckATP action in CAP service to check Availability to Promise.
         *
         * @param {string} sSalesOrderId - Existing Sales Document ID (10 chars)
         * @param {string} sItemId - Item ID (e.g. "10")
         * @returns {Promise<{ RequestedQty: number, ConfirmedQty: number, ReqDlvDate: string, CnfDlvDate: string, SalesUnit: string }>}
         */
        checkATP: function (sSalesOrderId, sItemId) {
            var sUrl = SERVICE_BASE + "/checkATP";
            var oPayload = {
                SalesOrderID: String(sSalesOrderId || "").trim(),
                ItemID: String(sItemId || "10").trim()
            };
            return ODataClient.post(sUrl, oPayload).then(function (result) {
                return result || {};
            });
        }
    };
});
