sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (ODataClient, Filter, FilterOperator) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/outbound-delivery";

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

    var _oModel = null;

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
        var oTargetModel = oModel || _oModel;
        if (!oTargetModel || typeof oTargetModel.bindList !== "function") {
            var sUrl = SERVICE_BASE + sEntitySet;
            var aParts = [];
            if (aFilters && aFilters.length > 0) {
                var aFilterParts = aFilters.map(function (f) {
                    var sVal = f.oValue1 !== undefined ? f.oValue1 : (f.getValue1 ? f.getValue1() : "");
                    var sPath = f.sPath || (f.getPath ? f.getPath() : "");
                    return sPath + " eq '" + encodeURIComponent(sVal) + "'";
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

        var oListBinding = oTargetModel.bindList(sEntitySet, undefined, undefined, aFilters, mParameters);
        return oListBinding.requestContexts(0, Infinity).then(function (aContexts) {
            return aContexts.map(function (oCtx) { return oCtx.getObject(); });
        });
    }

    /**
     * OutboundDeliveryService
     * Encapsulates Outbound Delivery API communication with the CAP backend.
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
         * Fetch orders due for delivery.
         *
         * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
         * @param {sap.ui.model.Filter[]} [aFilters]
         * @param {Object} [mParameters]
         * @returns {Promise<Array>}
         */
        getOrdersDueForDelivery: function (oModel, aFilters, mParameters) {
            if (oModel && typeof oModel.bindList !== "function") {
                mParameters = aFilters;
                aFilters = oModel;
                oModel = _oModel;
            }
            return _readEntitySet(oModel || _oModel, "/OrdersDueForDelivery", aFilters, mParameters);
        },

        /**
         * Fetch shipping point value help list.
         *
         * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
         * @param {sap.ui.model.Filter[]} [aFilters]
         * @param {Object} [mParameters]
         * @returns {Promise<Array>}
         */
        getShippingPoints: function (oModel, aFilters, mParameters) {
            if (oModel && typeof oModel.bindList !== "function") {
                mParameters = aFilters;
                aFilters = oModel;
                oModel = _oModel;
            }
            return _readEntitySet(oModel || _oModel, "/ShippingPointVH", aFilters, mParameters);
        },

        /**
         * KPI figures computed by the server over the full due-for-delivery set (not the loaded page).
         * Rejects on failure so the caller can show "-" instead of a number.
         *
         * @returns {Promise<{scheduleLineCount: number, shippingPointCount: number}>}
         */
        getOrdersDueMetrics: function () {
            return ODataClient.get(SERVICE_BASE + "/getOrdersDueMetrics()").then(function (result) {
                var oData = (result && result.value) || result;
                if (!oData || typeof oData.scheduleLineCount !== "number" || typeof oData.shippingPointCount !== "number") {
                    throw new Error("getOrdersDueMetrics returned no figures");
                }
                return { scheduleLineCount: oData.scheduleLineCount, shippingPointCount: oData.shippingPointCount };
            });
        },

        /**
         * Fetch default configured shipping point information.
         *
         * @returns {Promise<{ShippingPoint: string, ShippingPoints: string[]}>}
         */
        getDefaultShippingPoint: function () {
            return ODataClient.get(SERVICE_BASE + "/getDefaultShippingPoint()").then(function (result) {
                var oData = (result && result.value) || result;
                if (!oData || typeof oData !== "object") {
                    return { ShippingPoint: "", ShippingPoints: [] };
                }
                return {
                    ShippingPoint: oData.ShippingPoint || "",
                    ShippingPoints: Array.isArray(oData.ShippingPoints) ? oData.ShippingPoints : []
                };
            }).catch(function () {
                return { ShippingPoint: "", ShippingPoints: [] };
            });
        },

        /**
         * Create an Outbound Delivery from a Sales Order.
         *
         * @param {Object} mParams
         * @param {string} mParams.salesOrder Reference sales order document number
         * @param {string} [mParams.shippingPoint] Shipping point
         * @param {string} [mParams.deliveryDate] Delivery date (YYYY-MM-DD)
         * @returns {Promise<string>} Created Outbound Delivery document number
         */
        createOutboundDelivery: function (mParams) {
            var sSalesOrder = (mParams && (mParams.salesOrder || mParams.SalesOrder)) || "";
            var sShippingPoint = (mParams && (mParams.shippingPoint || mParams.ShippingPoint)) || "";
            var sDeliveryDate = (mParams && (mParams.deliveryDate || mParams.DeliveryDate)) || null;

            if (!sSalesOrder) {
                return Promise.reject(new Error("Sales Order is required to create an outbound delivery."));
            }

            var oPayload = {
                SalesOrder: String(sSalesOrder).trim(),
                ShippingPoint: sShippingPoint ? String(sShippingPoint).trim() : null,
                DeliveryDate: sDeliveryDate ? String(sDeliveryDate).trim() : null
            };

            return ODataClient.post(SERVICE_BASE + "/createOutboundDelivery", oPayload).then(function (result) {
                var sDeliveryNo = (result && result.value !== undefined) ? result.value : result;
                return String(sDeliveryNo || "");
            });
        },

        /** Delivery header statuses from SAP (picking / goods movement / billing). Rejects when SAP has no such delivery. */
        getDeliveryStatus: function (sDelivery) {
            if (!sDelivery) { return Promise.reject(new Error("Delivery number is required.")); }
            return ODataClient.get(SERVICE_BASE + "/getDeliveryStatus(DeliveryDocument='" + encodeURIComponent(String(sDelivery).trim()) + "')").then(function (result) {
                var o = (result && result.value !== undefined && typeof result.value === "object") ? result.value : result;
                if (!o || !o.DeliveryDocument) { throw new Error("getDeliveryStatus returned no data"); }
                return o;
            });
        },

        /** Post goods issue for a delivery. Resolves with SAP's PostGoodsReturnInfo-based result; rejects with SAP's message. */
        postGoodsIssue: function (sDelivery) {
            if (!sDelivery) { return Promise.reject(new Error("Delivery number is required.")); }
            return ODataClient.post(SERVICE_BASE + "/postGoodsIssue", { DeliveryDocument: String(sDelivery).trim() });
        },

        /** Billing document types SAP allows for this delivery (never a hardcoded list). */
        getBillingDocumentTypes: function (sDelivery) {
            if (!sDelivery) { return Promise.reject(new Error("Delivery number is required.")); }
            return ODataClient.get(SERVICE_BASE + "/getBillingDocumentTypes(DeliveryDocument='" + encodeURIComponent(String(sDelivery).trim()) + "')").then(function (result) {
                var aRows = (result && Array.isArray(result.value)) ? result.value : (Array.isArray(result) ? result : []);
                return aRows;
            });
        },

        /** Create a billing document for a delivery; the number comes only from SAP. */
        createBillingDocument: function (mParams) {
            if (!mParams || !mParams.delivery) { return Promise.reject(new Error("Delivery number is required.")); }
            return ODataClient.post(SERVICE_BASE + "/createBillingDocument", {
                DeliveryDocument: String(mParams.delivery).trim(),
                BillingDocumentType: mParams.billingType ? String(mParams.billingType).trim() : null,
                BillingDocumentDate: mParams.billingDate ? String(mParams.billingDate).trim() : null
            });
        },

        /**
         * Fetch supported delivery document types for delivery without reference.
         *
         * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
         * @param {sap.ui.model.Filter[]} [aFilters]
         * @param {Object} [mParameters]
         * @returns {Promise<Array>}
         */
        getDeliveryWithoutRefTypes: function (oModel, aFilters, mParameters) {
            if (oModel && typeof oModel.bindList !== "function") {
                mParameters = aFilters;
                aFilters = oModel;
                oModel = _oModel;
            }
            return _readEntitySet(oModel || _oModel, "/DeliveryWithoutRefTypes", aFilters, mParameters);
        },

        /**
         * Fetch ship-to parties value help for delivery without reference.
         *
         * @param {sap.ui.model.odata.v4.ODataModel} [oModel]
         * @param {sap.ui.model.Filter[]} [aFilters]
         * @param {Object} [mParameters]
         * @returns {Promise<Array>}
         */
        getDeliveryWithoutRefShipToParties: function (oModel, aFilters, mParameters) {
            if (oModel && typeof oModel.bindList !== "function") {
                mParameters = aFilters;
                aFilters = oModel;
                oModel = _oModel;
            }
            return _readEntitySet(oModel || _oModel, "/DeliveryWithoutRefShipToParties", aFilters, mParameters);
        },

        /**
         * Create an Outbound Delivery without reference in S/4HANA (LE_SHP_QC_DLVNOREF_SRV).
         *
         * @param {Object} mParams
         * @returns {Promise<Object>} Created Outbound Delivery details from S/4HANA
         */
        createDeliveryWithoutRef: function (mParams) {
            if (!mParams || !mParams.shippingPoint || !mParams.shipToParty || !mParams.plant || !mParams.storageLocation) {
                return Promise.reject(new Error("ShippingPoint, ShipToParty, Plant, and StorageLocation are required."));
            }
            var aItems = (mParams.items || []).map(function (item) {
                return {
                    Material: String(item.material || item.Material || "").trim(),
                    ActualDeliveryQuantity: String(item.quantity || item.ActualDeliveryQuantity || "1"),
                    DeliveryQuantityUnit: String(item.uom || item.DeliveryQuantityUnit || "KG").trim()
                };
            });

            var oPayload = {
                ShippingPoint: String(mParams.shippingPoint).trim(),
                DeliveryDocumentType: mParams.deliveryType ? String(mParams.deliveryType).trim() : "LO2",
                SalesOrganization: mParams.salesOrg ? String(mParams.salesOrg).trim() : "1000",
                DistributionChannel: mParams.distChannel ? String(mParams.distChannel).trim() : "10",
                Division: mParams.division ? String(mParams.division).trim() : "52",
                ShipToParty: String(mParams.shipToParty).trim(),
                Plant: String(mParams.plant).trim(),
                StorageLocation: String(mParams.storageLocation).trim(),
                PlannedGoodsIssueDate: mParams.plannedGoodsIssueDate ? String(mParams.plannedGoodsIssueDate).trim() : null,
                Items: aItems
            };

            return ODataClient.post(SERVICE_BASE + "/createDeliveryWithoutRef", oPayload).then(function (result) {
                return (result && result.value !== undefined) ? result.value : result;
            });
        },

        /**
         * Reads an Outbound Delivery created without reference directly back from S/4HANA.
         *
         * @param {string} sDeliveryId
         * @returns {Promise<Object>}
         */
        getDeliveryWithoutRef: function (sDeliveryId) {
            if (!sDeliveryId) { return Promise.reject(new Error("Delivery ID is required.")); }
            return ODataClient.get(SERVICE_BASE + "/getDeliveryWithoutRef(OutboundDelivery='" + encodeURIComponent(String(sDeliveryId).trim()) + "')").then(function (result) {
                return (result && result.value !== undefined) ? result.value : result;
            });
        }
    };
});
