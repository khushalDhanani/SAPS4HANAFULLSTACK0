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
         * Fetch default configured shipping point information.
         *
         * @returns {Promise<{ShippingPoint: string, ShippingPoints: string[]}>}
         */
        getDefaultShippingPoint: function () {
            return ODataClient.get(SERVICE_BASE + "/getDefaultShippingPoint()").then(function (result) {
                return (result && result.value) || result || { ShippingPoint: "1120", ShippingPoints: ["1120", "1112", "1108", "1109"] };
            });
        },

        /**
         * Create an Outbound Delivery from a Sales Order.
         *
         * @param {Object} mParams
         * @param {string} mParams.salesOrder Reference sales order document number
         * @param {string} [mParams.shippingPoint] Shipping point (defaults to 1120 if omitted)
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
        }
    };
});
