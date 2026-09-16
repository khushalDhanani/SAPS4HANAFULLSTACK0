sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (ODataClient, Filter, FilterOperator) {
    "use strict";

    var BASE_PATH = "/odata/v4/goods-receipt";

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
     * @param {string} sEntitySet - Entity set path e.g. "/OpenInboundDeliveries"
     * @param {sap.ui.model.Filter[]} [aFilters]
     * @returns {Promise<Array>}
     */
    function _readEntitySet(oModel, sEntitySet, aFilters) {
        if (!oModel || typeof oModel.bindList !== "function") {
            var sUrl = BASE_PATH + sEntitySet;
            if (aFilters && aFilters.length > 0) {
                var aParts = aFilters.map(function (f) {
                    return f.sPath + " eq '" + encodeURIComponent(f.oValue1) + "'";
                });
                sUrl += "?$filter=" + aParts.join(" and ");
            }
            return ODataClient.get(sUrl).then(function (oData) {
                if (Array.isArray(oData)) {
                    return oData;
                }
                return (oData && oData.value) ? oData.value : [];
            });
        }

        var oListBinding = oModel.bindList(sEntitySet, undefined, undefined, aFilters);
        return oListBinding.requestContexts(0, Infinity).then(function (aContexts) {
            return aContexts.map(function (oCtx) { return oCtx.getObject(); });
        });
    }

    var GoodsReceiptService = {
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
         * Fetch open Inbound Deliveries from SAP S/4HANA for storage unit selection
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrPlant] - Model or Plant code
         * @param {string} [sPlant] - Plant code if model is provided
         * @returns {Promise<Array>}
         */
        fetchOpenInboundDeliveries: function (oModelOrPlant, sPlant) {
            var oModel = _isModel(oModelOrPlant) ? oModelOrPlant : _oModel;
            var sPlantVal = _isModel(oModelOrPlant) ? sPlant : oModelOrPlant;
            var aFilters = [];
            if (sPlantVal && typeof sPlantVal === "string" && sPlantVal.trim()) {
                aFilters.push(new _Filter("Plant", _FilterOperator.EQ, sPlantVal.trim()));
            }
            return _readEntitySet(oModel, "/OpenInboundDeliveries", aFilters);
        },

        /**
         * Resolve scanned Storage Unit Number into authentic SAP Material, Batch, SLED, Plant, SLoc
         * @param {string} sStorageUnit
         * @returns {Promise<Object>}
         */
        resolveStorageUnit: function (sStorageUnit) {
            if (!sStorageUnit || !sStorageUnit.trim()) {
                return Promise.reject(new Error("Storage Unit Number is required."));
            }

            var sPath = BASE_PATH + "/getStorageUnitDetails(StorageUnit='" + encodeURIComponent(sStorageUnit.trim()) + "')";
            return ODataClient.get(sPath)
                .then(function (oData) {
                    return oData || {};
                });
        },

        /**
         * Fetch storage locations and bins for a material and plant
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrMat] - Model or Material
         * @param {string} [sMatOrPlant] - Material or Plant
         * @param {string} [sPlant] - Plant if model is provided
         * @returns {Promise<Array>}
         */
        fetchMaterialStorageLocations: function (oModelOrMat, sMatOrPlant, sPlant) {
            var oModel = _isModel(oModelOrMat) ? oModelOrMat : _oModel;
            var sMaterial = _isModel(oModelOrMat) ? sMatOrPlant : oModelOrMat;
            var sPlantVal = _isModel(oModelOrMat) ? sPlant : sMatOrPlant;

            if (!sMaterial || typeof sMaterial !== "string" || !sMaterial.trim()) {
                return Promise.resolve([]);
            }

            var aFilters = [new _Filter("Material", _FilterOperator.EQ, sMaterial.trim())];
            if (sPlantVal && typeof sPlantVal === "string" && sPlantVal.trim()) {
                aFilters.push(new _Filter("Plant", _FilterOperator.EQ, sPlantVal.trim()));
            }
            return _readEntitySet(oModel, "/MaterialStorageLocations", aFilters);
        },

        /**
         * Fetch usable batches with SLED information for a material
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrMat] - Model or Material
         * @param {string} [sMatOrPlant] - Material or Plant
         * @param {string} [sPlantOrSLoc] - Plant or StorageLocation
         * @param {string} [sSLoc] - StorageLocation if model is provided
         * @returns {Promise<Array>}
         */
        fetchMaterialBatches: function (oModelOrMat, sMatOrPlant, sPlantOrSLoc, sSLoc) {
            var oModel = _isModel(oModelOrMat) ? oModelOrMat : _oModel;
            var sMaterial = _isModel(oModelOrMat) ? sMatOrPlant : oModelOrMat;
            var sPlantVal = _isModel(oModelOrMat) ? sPlantOrSLoc : sMatOrPlant;
            var sStorageLocation = _isModel(oModelOrMat) ? sSLoc : sPlantOrSLoc;

            if (!sMaterial || typeof sMaterial !== "string" || !sMaterial.trim()) {
                return Promise.resolve([]);
            }

            var aFilters = [new _Filter("Material", _FilterOperator.EQ, sMaterial.trim())];
            if (sPlantVal && typeof sPlantVal === "string" && sPlantVal.trim()) {
                aFilters.push(new _Filter("Plant", _FilterOperator.EQ, sPlantVal.trim()));
            }
            if (sStorageLocation && typeof sStorageLocation === "string" && sStorageLocation.trim()) {
                aFilters.push(new _Filter("StorageLocation", _FilterOperator.EQ, sStorageLocation.trim()));
            }
            return _readEntitySet(oModel, "/MaterialBatches", aFilters);
        },

        /**
         * Posts Goods Receipt (101) directly to SAP S/4HANA
         * @param {Object} oPayload
         * @returns {Promise<Object>}
         */
        postGoodsReceipt: function (oPayload) {
            return ODataClient.post(BASE_PATH + "/postGoodsReceipt", oPayload);
        }
    };

    return GoodsReceiptService;
});
