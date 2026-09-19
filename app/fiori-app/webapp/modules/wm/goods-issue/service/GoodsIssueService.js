sap.ui.define([
    "saps4hana/fiori/service/ODataClient",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (ODataClient, Filter, FilterOperator) {
    "use strict";

    var BASE_PATH = "/odata/v4/goods-issue";

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
     * @param {string} sEntitySet - Entity set path e.g. "/OpenReservations"
     * @param {sap.ui.model.Filter[]} [aFilters]
     * @returns {Promise<Array>}
     */
    function _readEntitySet(oModel, sEntitySet, aFilters) {
        if (!oModel || typeof oModel.bindList !== "function") {
            // Fallback: use ODataClient for backward compatibility
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

    var GoodsIssueService = {
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
         * Fetch distinct open reservations for Goods Issue from SAP S/4HANA
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrPlant] - Model or Plant code
         * @param {string} [sPlant] - Plant code if model is provided
         * @returns {Promise<Array>}
         */
        fetchOpenReservations: function (oModelOrPlant, sPlant) {
            var oModel = _isModel(oModelOrPlant) ? oModelOrPlant : _oModel;
            var sPlantVal = _isModel(oModelOrPlant) ? sPlant : oModelOrPlant;
            var aFilters = [];
            if (sPlantVal && typeof sPlantVal === "string" && sPlantVal.trim()) {
                aFilters.push(new _Filter("Plant", _FilterOperator.EQ, sPlantVal.trim()));
            }
            return _readEntitySet(oModel, "/OpenReservations", aFilters);
        },

        /**
         * Fetch open reservation items by OrderNo or ReservationNo
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrOrder] - Model or OrderNo
         * @param {string} [sOrderOrReserv] - OrderNo or ReservationNo
         * @param {string} [sReservNo] - ReservationNo if model is provided
         * @returns {Promise<Array>}
         */
        fetchOpenItems: function (oModelOrOrder, sOrderOrReserv, sReservNo) {
            var oModel = _isModel(oModelOrOrder) ? oModelOrOrder : _oModel;
            var sOrderNo = _isModel(oModelOrOrder) ? sOrderOrReserv : oModelOrOrder;
            var sReserv = _isModel(oModelOrOrder) ? sReservNo : sOrderOrReserv;
            var aFilters = [];
            if (sOrderNo && typeof sOrderNo === "string" && sOrderNo.trim()) {
                aFilters.push(new _Filter("OrderNo", _FilterOperator.EQ, sOrderNo.trim()));
            }
            if (sReserv && typeof sReserv === "string" && sReserv.trim()) {
                aFilters.push(new _Filter("ReservationNo", _FilterOperator.EQ, sReserv.trim()));
            }
            // If multiple filters, combine with OR (matching original behavior)
            var aCombined = aFilters.length > 1
                ? [new _Filter({ filters: aFilters, and: false })]
                : aFilters;
            return _readEntitySet(oModel, "/GIItems", aCombined);
        },

        /**
         * Fetch available batches for a material with SLED information and FEFO sort
         * @param {sap.ui.model.odata.v4.ODataModel|string} [oModelOrMat] - Model or Material code
         * @param {string} [sMatOrPlant] - Material or Plant
         * @param {string} [sPlantOrSLoc] - Plant or StorageLocation
         * @param {string} [sSLoc] - StorageLocation if model is provided
         * @returns {Promise<Array>}
         */
        fetchMaterialBatches: function (oModelOrMat, sMatOrPlant, sPlantOrSLoc, sSLoc) {
            var oModel = _isModel(oModelOrMat) ? oModelOrMat : _oModel;
            var sMaterial = _isModel(oModelOrMat) ? sMatOrPlant : oModelOrMat;
            var sPlant = _isModel(oModelOrMat) ? sPlantOrSLoc : sMatOrPlant;
            var sStorageLocation = _isModel(oModelOrMat) ? sSLoc : sPlantOrSLoc;

            if (!sMaterial || typeof sMaterial !== "string" || !sMaterial.trim()) {
                return Promise.reject(new Error("Material is required to fetch batches"));
            }

            var aFilters = [new _Filter("Material", _FilterOperator.EQ, sMaterial.trim())];
            if (sPlant && typeof sPlant === "string" && sPlant.trim()) {
                aFilters.push(new _Filter("Plant", _FilterOperator.EQ, sPlant.trim()));
            }
            if (sStorageLocation && typeof sStorageLocation === "string" && sStorageLocation.trim()) {
                aFilters.push(new _Filter("StorageLocation", _FilterOperator.EQ, sStorageLocation.trim()));
            }
            return _readEntitySet(oModel, "/MaterialBatches", aFilters);
        },

        /**
         * Post Goods Issue 261 for a single component line
         * @param {Object} oPayload
         * @param {string} oPayload.ReservationNo
         * @param {string} oPayload.ReservationItem
         * @param {string} [oPayload.Material]
         * @param {number} oPayload.IssueQty
         * @param {string} [oPayload.Unit]
         * @param {string} [oPayload.Batch]
         * @returns {Promise<Object>}
         */
        postGoodsIssue: function (oPayload) {
            if (!oPayload.ReservationNo || !oPayload.ReservationItem) {
                return Promise.reject(new Error("ReservationNo and ReservationItem are required"));
            }
            var nQty = Number(oPayload.IssueQty);
            if (isNaN(nQty) || nQty <= 0) {
                return Promise.reject(new Error("Issue quantity must be greater than zero"));
            }

            var oBody = {
                ReservationNo: String(oPayload.ReservationNo).trim(),
                ReservationItem: String(oPayload.ReservationItem).trim(),
                Material: oPayload.Material || "",
                IssueQty: nQty,
                Unit: oPayload.Unit || "PC",
                Batch: oPayload.Batch || "",
                DifferenceQty: Number(oPayload.DifferenceQty) || 0,
                DifferenceReason: oPayload.DifferenceReason || "",
                DifferenceStorageType: oPayload.DifferenceStorageType || "999",
                FinalIssue: Boolean(oPayload.FinalIssue),
                OrderNo: oPayload.OrderNo ? String(oPayload.OrderNo).trim() : "",
                MaterialDesc: oPayload.MaterialDesc ? String(oPayload.MaterialDesc).trim() : "",
                Plant: oPayload.Plant ? String(oPayload.Plant).trim() : "",
                StorageLocation: oPayload.StorageLocation ? String(oPayload.StorageLocation).trim() : ""
            };

            return ODataClient.post(BASE_PATH + "/postGoodsIssue", oBody);
        },

        /**
         * Submit Goods Issue batch in a single LUW
         * @param {Object} oPayload
         * @param {string} [oPayload.ReservationNo]
         * @param {string} [oPayload.OrderNo]
         * @param {Array} oPayload.Items
         * @returns {Promise<Object>}
         */
        /**
         * Resolve a scanned barcode/identifier through the multi-tier SAP resolution engine
         * @param {string} sBarcode - Scanned barcode or SAP identifier
         * @returns {Promise<Object>} GoodsIssueResolution object
         */
        resolveIdentifier: function (sBarcode) {
            if (!sBarcode || !sBarcode.trim()) {
                return Promise.reject(new Error("Barcode or SAP identifier is required"));
            }

            var sEncoded = encodeURIComponent(sBarcode.trim());
            return ODataClient.get(BASE_PATH + "/resolveIdentifier(barcode='" + sEncoded + "')")
                .then(function (oData) {
                    return oData || {};
                });
        },

        /**
         * Submit Goods Issue batch in a single LUW
         * @param {Object} oPayload
         * @param {string} [oPayload.ReservationNo]
         * @param {string} [oPayload.OrderNo]
         * @param {Array} oPayload.Items
         * @returns {Promise<Object>}
         */
        submitGoodsIssueRequest: function (oPayload) {
            if (!oPayload.ReservationNo && !oPayload.OrderNo) {
                return Promise.reject(new Error("ReservationNo or OrderNo must be provided"));
            }
            if (!Array.isArray(oPayload.Items) || oPayload.Items.length === 0) {
                return Promise.reject(new Error("At least one item must be provided for batch submission"));
            }

            var oBody = {
                ReservationNo: oPayload.ReservationNo ? String(oPayload.ReservationNo).trim() : "",
                OrderNo: oPayload.OrderNo ? String(oPayload.OrderNo).trim() : "",
                Items: oPayload.Items.map(function (it) {
                    return {
                        ReservationItem: String(it.ReservationItem).trim(),
                        Material: it.Material || "",
                        IssueQty: Number(it.IssueQty || 0),
                        Batch: it.Batch || "",
                        DifferenceQty: Number(it.DifferenceQty) || 0,
                        DifferenceReason: it.DifferenceReason || "",
                        DifferenceStorageType: it.DifferenceStorageType || "999",
                        FinalIssue: Boolean(it.FinalIssue)
                    };
                })
            };

            return ODataClient.post(BASE_PATH + "/submitGoodsIssueRequest", oBody);
        },

        /**
         * Retrieve summary of pending Dispatch Queue items
         * @returns {Promise<Object>}
         */
        getQueueSummary: function () {
            return ODataClient.get(BASE_PATH + "/getQueueSummary()")
                .then(function (oData) {
                    return oData || { QueuedCount: 0, Items: [] };
                });
        },

        /**
         * Retry posting a queued Goods Issue transaction to S/4HANA
         * @param {string} sQueueReference
         * @returns {Promise<Object>}
         */
        retryQueuedGoodsIssue: function (sQueueReference) {
            if (!sQueueReference) {
                return Promise.reject(new Error("QueueReference is required to retry sync"));
            }
            return ODataClient.post(BASE_PATH + "/retryQueuedGoodsIssue", {
                QueueReference: sQueueReference
            });
        },

        /**
         * Remove an item from the local Dispatch Queue
         * @param {string} sQueueReference
         * @returns {Promise<boolean>}
         */
        clearQueuedGoodsIssue: function (sQueueReference) {
            if (!sQueueReference) {
                return Promise.reject(new Error("QueueReference is required"));
            }
            return ODataClient.post(BASE_PATH + "/clearQueuedGoodsIssue", {
                QueueReference: sQueueReference
            });
        },

        /**
         * Drain the entire Goods Issue dispatch queue to SAP S/4HANA
         * @returns {Promise<Object>} QueueDrainResult
         */
        drainQueue: function () {
            return ODataClient.post(BASE_PATH + "/drainQueue", {});
        },

        // ──────────────────────────────────────────────────────────
        // Stock Unit (SU) Barcode → Batch Determination
        // ──────────────────────────────────────────────────────────

        /**
         * Resolve Stock Unit barcode against SAP:
         * SU → Delivery → Material → Stock → Batch → Reservation Validation
         *
         * @param {string} sSuBarcode - Scanned SU barcode (Delivery Document Number)
         * @param {string} sReservationNo - Current reservation number
         * @param {string} sReservationItem - Current reservation item
         * @returns {Promise<Object>} StockUnitResolution
         */
        resolveStockUnit: function (sSuBarcode, sReservationNo, sReservationItem) {
            if (!sSuBarcode || !sSuBarcode.trim()) {
                return Promise.reject(new Error("SU barcode is required"));
            }
            if (!sReservationNo || !sReservationItem) {
                return Promise.reject(new Error("Reservation number and item are required for SU resolution"));
            }

            var sQuery = "?suBarcode=" + encodeURIComponent(sSuBarcode.trim()) +
                         "&reservationNo=" + encodeURIComponent(String(sReservationNo).trim()) +
                         "&reservationItem=" + encodeURIComponent(String(sReservationItem).trim());

            return ODataClient.get(BASE_PATH + "/resolveStockUnit(" +
                "suBarcode='" + encodeURIComponent(sSuBarcode.trim()) + "'," +
                "reservationNo='" + encodeURIComponent(String(sReservationNo).trim()) + "'," +
                "reservationItem='" + encodeURIComponent(String(sReservationItem).trim()) + "'" +
                ")");
        },

        /**
         * Revalidate SAP stock immediately before Goods Issue posting.
         * Prevents posting with stale data.
         *
         * @param {string} sMaterial
         * @param {string} sPlant
         * @param {string} sStorageLocation
         * @param {string} sBatch
         * @param {number} nRequiredQty
         * @returns {Promise<Object>} StockRevalidationResult
         */
        revalidateStock: function (sMaterial, sPlant, sStorageLocation, sBatch, nRequiredQty) {
            if (!sMaterial) {
                return Promise.reject(new Error("Material is required for stock revalidation"));
            }

            return ODataClient.get(BASE_PATH + "/revalidateStock(" +
                "material='" + encodeURIComponent(String(sMaterial).trim()) + "'," +
                "plant='" + encodeURIComponent(String(sPlant || '').trim()) + "'," +
                "storageLocation='" + encodeURIComponent(String(sStorageLocation || '').trim()) + "'," +
                "batch='" + encodeURIComponent(String(sBatch || '').trim()) + "'," +
                "requiredQty=" + (Number(nRequiredQty) || 0) +
                ")");
        }
    };

    return GoodsIssueService;
});
