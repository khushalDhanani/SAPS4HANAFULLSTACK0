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
        return ODataClient.readEntitySet(SERVICE_BASE, oModel || _oModel, sEntitySet, aFilters, mParameters,
            { useFilterGetters: true });
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

        releaseInvoiceToAccounting: function (sBillingDocument, oModel, mOptions) {
            var oTargetModel = (oModel && typeof oModel.bindContext === "function") ? oModel : _oModel;
            var options = (mOptions && typeof mOptions === "object") ? mOptions : (!oModel || typeof oModel.bindContext === "function" ? {} : oModel);
            var sDoc = String(sBillingDocument || "").trim();
            var sETag = options.etag || options.ifMatch || "";

            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oAction = oTargetModel.bindContext("/releaseInvoiceToAccounting(...)");
                oAction.setParameter("BillingDocument", sDoc);
                if (sETag) {
                    oAction.setParameter("ETag", sETag);
                }
                return oAction.execute().then(function () {
                    var oCtx = oAction.getBoundContext();
                    return oCtx ? oCtx.getObject() : null;
                });
            }

            var oPayload = { BillingDocument: sDoc };
            if (sETag) {
                return ODataClient.post(SERVICE_BASE + "/releaseInvoiceToAccounting", oPayload, { "If-Match": sETag });
            }
            return ODataClient.post(SERVICE_BASE + "/releaseInvoiceToAccounting", oPayload);
        },

        cancelBillingDocument: function (sBillingDocument, oModel, mOptions) {
            var oTargetModel = (oModel && typeof oModel.bindContext === "function") ? oModel : _oModel;
            var options = (mOptions && typeof mOptions === "object") ? mOptions : (!oModel || typeof oModel.bindContext === "function" ? {} : oModel);
            var sDoc = String(sBillingDocument || "").trim();
            var sETag = options.etag || options.ifMatch || "";

            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oAction = oTargetModel.bindContext("/cancelBillingDocument(...)");
                oAction.setParameter("BillingDocument", sDoc);
                return oAction.execute().then(function () {
                    var oCtx = oAction.getBoundContext();
                    return oCtx ? oCtx.getObject() : null;
                });
            }

            var oPayload = { BillingDocument: sDoc };
            if (sETag) {
                return ODataClient.post(SERVICE_BASE + "/cancelBillingDocument", oPayload, { "If-Match": sETag });
            }
            return ODataClient.post(SERVICE_BASE + "/cancelBillingDocument", oPayload);
        }
    };
});
