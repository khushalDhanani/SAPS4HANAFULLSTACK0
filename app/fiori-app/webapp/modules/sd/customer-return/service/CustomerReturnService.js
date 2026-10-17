sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Messaging"
], function (ODataClient, Filter, FilterOperator, Messaging) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/customer-return";

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
                    return oCtx ? oCtx.getObject() : [];
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
                    return oCtx ? oCtx.getObject() : [];
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
