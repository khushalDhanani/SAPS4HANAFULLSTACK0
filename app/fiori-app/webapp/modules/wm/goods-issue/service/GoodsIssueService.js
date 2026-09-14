sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/goods-issue";

    var GoodsIssueService = {
        /**
         * Fetch distinct open reservations for Goods Issue from SAP S/4HANA
         * @param {string} [sPlant]
         * @returns {Promise<Array>}
         */
        fetchOpenReservations: function (sPlant) {
            var sQuery = "";
            if (sPlant && sPlant.trim()) {
                sQuery = "?$filter=Plant eq '" + encodeURIComponent(sPlant.trim()) + "'";
            }

            return ODataClient.get(BASE_PATH + "/OpenReservations" + sQuery)
                .then(function (oData) {
                    return (oData && oData.value) ? oData.value : [];
                });
        },

        /**
         * Fetch open reservation items by OrderNo or ReservationNo
         * @param {string} [sOrderNo]
         * @param {string} [sReservNo]
         * @returns {Promise<Array>}
         */
        fetchOpenItems: function (sOrderNo, sReservNo) {
            var aFilters = [];
            if (sOrderNo && sOrderNo.trim()) {
                aFilters.push("OrderNo eq '" + encodeURIComponent(sOrderNo.trim()) + "'");
            }
            if (sReservNo && sReservNo.trim()) {
                aFilters.push("ReservationNo eq '" + encodeURIComponent(sReservNo.trim()) + "'");
            }

            var sQuery = "";
            if (aFilters.length > 0) {
                sQuery = "?$filter=" + aFilters.join(" or ");
            }

            return ODataClient.get(BASE_PATH + "/GIItems" + sQuery)
                .then(function (oData) {
                    return (oData && oData.value) ? oData.value : [];
                });
        },

        /**
         * Fetch available batches for a material with SLED information and FEFO sort
         * @param {string} sMaterial
         * @param {string} [sPlant]
         * @param {string} [sStorageLocation]
         * @returns {Promise<Array>}
         */
        fetchMaterialBatches: function (sMaterial, sPlant, sStorageLocation) {
            if (!sMaterial || !sMaterial.trim()) {
                return Promise.reject(new Error("Material is required to fetch batches"));
            }

            var sQuery = "?$filter=Material eq '" + encodeURIComponent(sMaterial.trim()) + "'";
            if (sPlant && sPlant.trim()) {
                sQuery += " and Plant eq '" + encodeURIComponent(sPlant.trim()) + "'";
            }
            if (sStorageLocation && sStorageLocation.trim()) {
                sQuery += " and StorageLocation eq '" + encodeURIComponent(sStorageLocation.trim()) + "'";
            }

            return ODataClient.get(BASE_PATH + "/MaterialBatches" + sQuery)
                .then(function (oData) {
                    return (oData && oData.value) ? oData.value : [];
                });
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
                FinalIssue: Boolean(oPayload.FinalIssue)
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
