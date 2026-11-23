sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Messaging"
], function (ODataClient, Filter, FilterOperator, Messaging) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/customer-return";

    var _oModel = null;

    /** Rows of a function that returns `array of`: OData V4 delivers them as { value: [...] }, not as an array. */
    function _rows(oResult) {
        if (Array.isArray(oResult)) {
            return oResult;
        }
        return oResult && Array.isArray(oResult.value) ? oResult.value : [];
    }

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

        getCustomerReturns: function (oModel, aFilters, mParameters) {
            return _readEntitySet(oModel, "/CustomerReturns", aFilters, mParameters);
        },

        getCustomerReturnItems: function (sReturnNumber, oModel) {
            var aFilters = [new Filter("CustomerReturn", FilterOperator.EQ, sReturnNumber)];
            return _readEntitySet(oModel, "/CustomerReturnItems", aFilters);
        },

        getMetrics: function (oModel) {
            var oTargetModel = oModel || _oModel;
            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oContextBinding = oTargetModel.bindContext("/getReturnMetrics(...)");
                return oContextBinding.execute().then(function () {
                    var oCtx = oContextBinding.getBoundContext();
                    return oCtx ? oCtx.getObject() : null;
                });
            }
            return ODataClient.get(SERVICE_BASE + "/getReturnMetrics()").then(function (res) {
                return (res && res.value) || res || {};
            });
        },

        getReturnReasons: function (oModel) {
            var oTargetModel = oModel || _oModel;
            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oContextBinding = oTargetModel.bindContext("/getReturnReasons(...)");
                return oContextBinding.execute().then(function () {
                    var oCtx = oContextBinding.getBoundContext();
                    return _rows(oCtx && oCtx.getObject());
                });
            }
            return ODataClient.get(SERVICE_BASE + "/getReturnReasons()").then(function (res) {
                return (res && res.value) || res || [];
            });
        },

        getCustomers: function (sSearch, iTop) {
            var sSearchVal = sSearch ? String(sSearch).trim() : "";
            var iTopVal = iTop || 50;
            var sUrl = SERVICE_BASE + "/getCustomers(search='" + encodeURIComponent(sSearchVal) + "',top=" + iTopVal + ")";
            return ODataClient.get(sUrl).then(function (res) {
                return (res && res.value) || res || [];
            });
        },

        getMaterials: function (sSearch, iTop) {
            var sSearchVal = sSearch ? String(sSearch).trim() : "";
            var iTopVal = iTop || 50;
            var sUrl = SERVICE_BASE + "/getMaterials(search='" + encodeURIComponent(sSearchVal) + "',top=" + iTopVal + ")";
            return ODataClient.get(sUrl).then(function (res) {
                return (res && res.value) || res || [];
            });
        },

        getPlants: function () {
            var sUrl = SERVICE_BASE + "/getPlants()";
            return ODataClient.get(sUrl).then(function (res) {
                return (res && res.value) || res || [];
            });
        },

        getDocumentTypes: function () {
            var sUrl = SERVICE_BASE + "/getDocumentTypes()";
            return ODataClient.get(sUrl).then(function (res) {
                return (res && res.value) || res || [];
            });
        },

        getReferenceDocuments: function (sSearch, iTop, oModel) {
            var oTargetModel = oModel || _oModel;
            var sSearchVal = sSearch ? String(sSearch).trim() : "";
            var iTopVal = iTop || 50;

            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oContextBinding = oTargetModel.bindContext("/getReferenceDocuments(...)");
                oContextBinding.setParameter("search", sSearchVal);
                oContextBinding.setParameter("top", iTopVal);
                return oContextBinding.execute().then(function () {
                    var oCtx = oContextBinding.getBoundContext();
                    return _rows(oCtx && oCtx.getObject());
                });
            }

            var sUrl = SERVICE_BASE + "/getReferenceDocuments(search='" + encodeURIComponent(sSearchVal) + "',top=" + iTopVal + ")";
            return ODataClient.get(sUrl).then(function (res) {
                return (res && res.value) || res || [];
            });
        },

        createCustomerReturn: function (oPayload, oModel) {
            var oTargetModel = oModel || _oModel;

            if (oTargetModel && typeof oTargetModel.bindContext === "function") {
                var oAction = oTargetModel.bindContext("/createCustomerReturn(...)");
                Object.keys(oPayload).forEach(function (key) {
                    oAction.setParameter(key, oPayload[key]);
                });
                return oAction.execute().then(function () {
                    var oCtx = oAction.getBoundContext();
                    return oCtx ? oCtx.getObject() : null;
                }).catch(function (oErr) {
                    var sBackendMsg = "";
                    try {
                        var aMessages = [];
                        if (typeof Messaging !== "undefined" && Messaging && typeof Messaging.getMessageModel === "function") {
                            aMessages = Messaging.getMessageModel().getData() || [];
                        }
                        if (Array.isArray(aMessages)) {
                            for (var i = aMessages.length - 1; i >= 0; i--) {
                                if (aMessages[i].type === "Error" && aMessages[i].message && aMessages[i].message.indexOf("Communication error") === -1) {
                                    sBackendMsg = aMessages[i].message;
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                    if (sBackendMsg) {
                        var oRichErr = new Error(sBackendMsg);
                        oRichErr.originalError = oErr;
                        throw oRichErr;
                    }
                    throw oErr;
                });
            }

            return ODataClient.post(SERVICE_BASE + "/createCustomerReturn", oPayload);
        }
    };
});
