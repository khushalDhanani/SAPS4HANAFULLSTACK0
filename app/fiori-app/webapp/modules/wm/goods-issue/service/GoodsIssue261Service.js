sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH_GI = "/odata/v4/goods-issue";
    var BASE_PATH_MM = "/odata/v4/purchase-order";

    var GoodsIssue261Service = {
        /**
         * Post a Movement 261 Goods Issue against an SAP Reservation
         * @param {Object} oPayload
         * @returns {Promise<Object>}
         */
        postGoodsIssue: function (oPayload) {
            if (!oPayload) {
                return Promise.reject(new Error("Goods Issue payload is required"));
            }

            var sResv = String(oPayload.ReservationNo || "").trim();
            var sItem = String(oPayload.ReservationItem || "").trim();
            var sOrder = String(oPayload.OrderNo || oPayload.OrderID || "").trim();

            if (!sResv && !sOrder) {
                return Promise.reject(new Error("Either Reservation Number or Order Number is required for Movement 261"));
            }
            if (sResv && !sItem) {
                return Promise.reject(new Error("Reservation Item is required when Reservation Number is specified"));
            }

            var nQty = Number(oPayload.IssueQty);
            if (isNaN(nQty) || nQty <= 0) {
                return Promise.reject(new Error("Quantity must be greater than zero"));
            }

            var sMat = String(oPayload.Material || "").trim().toUpperCase();
            if (!sMat) {
                return Promise.reject(new Error("Material is required"));
            }

            var sPlant = String(oPayload.Plant || "").trim().toUpperCase();
            var sSLoc = String(oPayload.StorageLocation || "").trim().toUpperCase();
            var sUnit = String(oPayload.Unit || "").trim().toUpperCase();

            var aSerials = Array.isArray(oPayload.SerialNumbers) ? oPayload.SerialNumbers : [];
            var aStorageUnits = Array.isArray(oPayload.StorageUnits) ? oPayload.StorageUnits : [];

            // Isolated 261 action: send only Movement 261 fields (no MovementType / difference / cost center).
            var oBody = {
                ReservationNo: sResv,
                ReservationItem: sItem,
                OrderNo: sOrder,
                Material: sMat,
                Plant: sPlant,
                StorageLocation: sSLoc,
                IssueQty: nQty,
                Unit: sUnit,
                Batch: oPayload.Batch ? String(oPayload.Batch).trim().toUpperCase() : "",
                PostingDate: oPayload.PostingDate || null,
                DocumentDate: oPayload.DocumentDate || null,
                SerialNumbers: aSerials
            };

            if (aStorageUnits.length > 0) {
                oBody.StorageUnits = aStorageUnits;
            }
            if (oPayload.LastStorageUnitQty != null && !isNaN(Number(oPayload.LastStorageUnitQty))) {
                oBody.LastStorageUnitQty = Number(oPayload.LastStorageUnitQty);
            }
            if (oPayload.ClientAttemptId) {
                oBody.ClientAttemptId = String(oPayload.ClientAttemptId);
            }

            return ODataClient.post(BASE_PATH_GI + "/postGoodsIssue261", oBody);
        },

        /**
         * Fetch distinct manufacturing/production orders available in system for value help
         * @returns {Promise<Array<{OrderNo: string, Plant: string, Description: string}>>}
         */
        fetchDistinctOrders: function () {
            // Only orders derived from live SAP reservations. Never inject placeholder orders or a
            // default plant — an invented order/plant in the value help would let the user post
            // against data that does not exist in SAP. Errors propagate so the caller can surface them.
            return this.fetchOpenReservations()
                .then(function (aResvs) {
                    var mOrders = {};
                    (aResvs || []).forEach(function (r) {
                        var ord = String(r.OrderNo || r.OrderID || "").trim();
                        if (ord && !mOrders[ord]) {
                            mOrders[ord] = {
                                OrderNo: ord,
                                Plant: String(r.Plant || "").trim(),
                                Description: r.DisplayText || ("Manufacturing Order " + ord)
                            };
                        }
                    });
                    return Object.keys(mOrders).map(function (k) { return mOrders[k]; });
                });
        },

        /**
         * Reverse a posted Material Document via CancelHeader
         * @param {string} sMaterialDocument
         * @param {string} sMaterialDocYear
         * @param {string} [sPostingDate]
         * @param {string} [sReversalReason]
         * @returns {Promise<Object>}
         */
        reverseGoodsIssue: function (sMaterialDocument, sMaterialDocYear, sPostingDate, sReversalReason) {
            if (!sMaterialDocument || !sMaterialDocYear) {
                return Promise.reject(new Error("Material Document number and year are required for reversal"));
            }

            var oBody = {
                MaterialDocument: String(sMaterialDocument).trim(),
                MaterialDocYear: String(sMaterialDocYear).trim(),
                PostingDate: sPostingDate || null,
                ReversalReason: sReversalReason || "01"
            };

            return ODataClient.post(BASE_PATH_GI + "/reverseGoodsIssue", oBody);
        },

        /**
         * Fetch open SAP Reservations for Movement 261 only (server-side filtered via the
         * same OpenReservations MovementType-equality filter the generic Goods Issue page uses).
         * @returns {Promise<Array>}
         */
        fetchOpenReservations: function () {
            var sUrl = BASE_PATH_GI + "/OpenReservations?$filter=" + encodeURIComponent("MovementType eq '261'");
            return ODataClient.get(sUrl)
                .then(function (oData) {
                    return (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                });
        },

        /**
         * Fetch the open reservation items (GIItems) for a given Reservation Number
         * @param {string} sReservationNo
         * @returns {Promise<Array>}
         */
        fetchReservationItems: function (sReservationNo) {
            if (!sReservationNo) {
                return Promise.resolve([]);
            }
            var sClean = encodeURIComponent(String(sReservationNo).trim());
            var sUrl = BASE_PATH_GI + "/GIItems?$filter=" + encodeURIComponent("ReservationNo eq '") + sClean + encodeURIComponent("'");
            return ODataClient.get(sUrl)
                .then(function (oData) {
                    return (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                });
        },

        /**
         * List the scannable stock units valid for a reservation line (correct material/plant/sloc,
         * in stock). Used to decide whether the item is unit-managed (scan-to-complete) or plain
         * quantity (skip straight to quantity/order confirmation).
         * @param {string} sReservationNo
         * @param {string} sReservationItem
         * @returns {Promise<Object>} StockUnitList (StockUnits[], Material, Plant, StorageLocation)
         */
        fetchStockUnitsForItem: function (sReservationNo, sReservationItem) {
            var sUrl = BASE_PATH_GI + "/getStockUnitsForItem(reservationNo='" +
                encodeURIComponent(String(sReservationNo || "").trim()) + "',reservationItem='" +
                encodeURIComponent(String(sReservationItem || "").trim()) + "')";
            return ODataClient.get(sUrl);
        },

        /**
         * Resolve ONE scanned unit barcode against a reservation line. Auto-detects serial vs storage
         * unit and validates it against S/4 (correct material, in unrestricted stock, not already
         * issued): returns a StockUnitResolution with SuExists / SuNotFoundReason / Material /
         * IsSerialManaged / DeterminedSerial / CurrentStock.
         * @param {string} sBarcode
         * @param {string} sReservationNo
         * @param {string} sReservationItem
         * @returns {Promise<Object>}
         */
        resolveScanUnit: function (sBarcode, sReservationNo, sReservationItem) {
            var sUrl = BASE_PATH_GI + "/resolveStockUnit(suBarcode='" +
                encodeURIComponent(String(sBarcode || "").trim()) + "',reservationNo='" +
                encodeURIComponent(String(sReservationNo || "").trim()) + "',reservationItem='" +
                encodeURIComponent(String(sReservationItem || "").trim()) + "')";
            return ODataClient.get(sUrl);
        },

        /**
         * Fetch material metadata (Base Unit, Description, Batch/Serial flags, Stock)
         * @param {string} sMaterial
         * @param {string} [sPlant]
         * @returns {Promise<Object>}
         */
        fetchMaterialDetails: function (sMaterial, sPlant) {
            if (!sMaterial) {
                return Promise.resolve(null);
            }
            var sMatClean = encodeURIComponent(String(sMaterial).trim());
            var sUrl = BASE_PATH_MM + "/MaterialVH?$filter=Material eq '" + sMatClean + "'";
            if (sPlant) {
                sUrl += " and Plant eq '" + encodeURIComponent(String(sPlant).trim()) + "'";
            }
            sUrl += "&$top=1";

            return ODataClient.get(sUrl)
                .then(function (oData) {
                    var aItems = (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                    var oMat = aItems[0] || null;

                    if (sPlant) {
                        var sBatchUrl = BASE_PATH_GI + "/MaterialBatches?$filter=Material eq '" + sMatClean + "' and Plant eq '" + encodeURIComponent(sPlant) + "'";
                        return ODataClient.get(sBatchUrl)
                            .then(function (oBatchData) {
                                var aBatches = (oBatchData && oBatchData.value) || (Array.isArray(oBatchData) ? oBatchData : []);
                                var nTotalStock = 0;
                                var bBatchManaged = aBatches.length > 0;
                                aBatches.forEach(function (b) {
                                    nTotalStock += Number(b.AvailableStock) || 0;
                                });

                                return {
                                    material: sMaterial,
                                    materialName: oMat ? (oMat.MaterialName || oMat.Material_Text || "") : "",
                                    unit: oMat ? (oMat.MaterialBaseUnit || "") : "",
                                    isBatchManaged: bBatchManaged,
                                    availableStock: bBatchManaged ? nTotalStock : null,
                                    batches: aBatches
                                };
                            })
                            .catch(function () {
                                return {
                                    material: sMaterial,
                                    materialName: oMat ? (oMat.MaterialName || oMat.Material_Text || "") : "",
                                    unit: oMat ? (oMat.MaterialBaseUnit || "") : "",
                                    isBatchManaged: false,
                                    availableStock: null,
                                    batches: []
                                };
                            });
                    }

                    return {
                        material: sMaterial,
                        materialName: oMat ? (oMat.MaterialName || oMat.Material_Text || "") : "",
                        unit: oMat ? (oMat.MaterialBaseUnit || "") : "",
                        isBatchManaged: false,
                        availableStock: null,
                        batches: []
                    };
                });
        }
    };

    return GoodsIssue261Service;
});
