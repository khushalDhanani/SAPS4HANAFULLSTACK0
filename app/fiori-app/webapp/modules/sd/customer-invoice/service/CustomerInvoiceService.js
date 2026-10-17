sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (ODataClient, Filter, FilterOperator) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/customer-invoice";

    var _FilterOperator = FilterOperator || {
        EQ: "EQ",
        NE: "NE",
        Contains: "Contains"
    };

    var _oModel = null;

    /**
     * Read entity set via OData V4 list binding or ODataClient fallback.
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

    return {
        setModel: function (oModel) {
            _oModel = oModel;
        },

        getModel: function () {
            return _oModel;
        },

        getInvoices: function (oModel, aFilters, mParameters) {
            return _readEntitySet(oModel, "/CustomerInvoices", aFilters, mParameters);
        },

        getMetrics: function (oModel) {
            var oTargetModel = oModel || _oModel;
            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oContextBinding = oTargetModel.bindContext("/getInvoiceMetrics(...)");
                return oContextBinding.execute().then(function () {
                    var oCtx = oContextBinding.getBoundContext();
                    return oCtx ? oCtx.getObject() : null;
                });
            }
            return ODataClient.get(SERVICE_BASE + "/getInvoiceMetrics()").then(function (res) {
                return (res && res.value) || res || {};
            });
        },

        releaseInvoiceToAccounting: function (sBillingDocument, oModel) {
            var oTargetModel = oModel || _oModel;
            var sDoc = String(sBillingDocument || "").trim();

            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oAction = oTargetModel.bindContext("/releaseInvoiceToAccounting(...)");
                oAction.setParameter("BillingDocument", sDoc);
                return oAction.execute().then(function () {
                    var oCtx = oAction.getBoundContext();
                    return oCtx ? oCtx.getObject() : null;
                });
            }

            return ODataClient.post(SERVICE_BASE + "/releaseInvoiceToAccounting", {
                BillingDocument: sDoc
            });
        },

        cancelBillingDocument: function (sBillingDocument, oModel) {
            var oTargetModel = oModel || _oModel;
            var sDoc = String(sBillingDocument || "").trim();

            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oAction = oTargetModel.bindContext("/cancelBillingDocument(...)");
                oAction.setParameter("BillingDocument", sDoc);
                return oAction.execute().then(function () {
                    var oCtx = oAction.getBoundContext();
                    return oCtx ? oCtx.getObject() : null;
                });
            }

            return ODataClient.post(SERVICE_BASE + "/cancelBillingDocument", {
                BillingDocument: sDoc
            });
        }
    };
});
