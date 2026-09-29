sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH_GI = "/odata/v4/goods-issue";
    var BASE_PATH_MM = "/odata/v4/purchase-order";

    var GoodsIssue201Service = {
        /**
         * Post a Movement 201 Goods Issue to Cost Center
         * @param {Object} oPayload
         * @returns {Promise<Object>}
         */
        postGoodsIssue: function (oPayload) {
            if (!oPayload) {
                return Promise.reject(new Error("Goods Issue payload is required"));
            }

            var nQty = Number(oPayload.IssueQty);
            if (isNaN(nQty) || nQty <= 0) {
                return Promise.reject(new Error("Quantity must be greater than zero"));
            }

            var sCC = String(oPayload.CostCenter || "").trim().toUpperCase();
            if (!sCC) {
                return Promise.reject(new Error("Cost Center is required for Movement 201"));
            }

            var sMat = String(oPayload.Material || "").trim().toUpperCase();
            if (!sMat) {
                return Promise.reject(new Error("Material is required"));
            }

            var sPlant = String(oPayload.Plant || "").trim().toUpperCase();
            var sSLoc = String(oPayload.StorageLocation || "").trim().toUpperCase();
            var sUnit = String(oPayload.Unit || "").trim().toUpperCase();

            var aSerials = Array.isArray(oPayload.SerialNumbers) ? oPayload.SerialNumbers : [];

            // Isolated 201 action: send only Movement 201 fields (no MovementType / G/L / difference).
            // ReservationNo/Item are optional: empty for an unplanned 201, populated when completing a
            // planned cost-center reservation from the 201 Pending list.
            var oBody = {
                CostCenter: sCC,
                Material: sMat,
                Plant: sPlant,
                StorageLocation: sSLoc,
                IssueQty: nQty,
                Unit: sUnit,
                Batch: oPayload.Batch ? String(oPayload.Batch).trim().toUpperCase() : "",
                PostingDate: oPayload.PostingDate || null,
                DocumentDate: oPayload.DocumentDate || null,
                SerialNumbers: aSerials,
                ReservationNo: oPayload.ReservationNo ? String(oPayload.ReservationNo).trim() : "",
                ReservationItem: oPayload.ReservationItem ? String(oPayload.ReservationItem).trim() : ""
            };

            return ODataClient.post(BASE_PATH_GI + "/postGoodsIssue201", oBody);
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

                    // Query available batches/stock if available
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
                                    unit: oMat ? (oMat.MaterialBaseUnit || "EA") : "EA",
                                    isBatchManaged: bBatchManaged,
                                    availableStock: bBatchManaged ? nTotalStock : null,
                                    batches: aBatches
                                };
                            })
                            .catch(function () {
                                return {
                                    material: sMaterial,
                                    materialName: oMat ? (oMat.MaterialName || oMat.Material_Text || "") : "",
                                    unit: oMat ? (oMat.MaterialBaseUnit || "EA") : "EA",
                                    isBatchManaged: false,
                                    availableStock: null,
                                    batches: []
                                };
                            });
                    }

                    return {
                        material: sMaterial,
                        materialName: oMat ? (oMat.MaterialName || oMat.Material_Text || "") : "",
                        unit: oMat ? (oMat.MaterialBaseUnit || "EA") : "EA",
                        isBatchManaged: false,
                        availableStock: null,
                        batches: []
                    };
                })
                .catch(function (err) {
                    return Promise.reject(err);
                });
        },

        /**
         * Fetch Cost Centers for value help
         * @param {string} [sSearchTerm]
         * @returns {Promise<Array>}
         */
        fetchCostCenters: function (sSearchTerm) {
            var sUrl = BASE_PATH_MM + "/CostCenterVH?$top=50";
            if (sSearchTerm) {
                var sTerm = encodeURIComponent(String(sSearchTerm).trim());
                sUrl += "&$filter=contains(CostCenter, '" + sTerm + "') or contains(CostCenterName, '" + sTerm + "')";
            }
            return ODataClient.get(sUrl)
                .then(function (oData) {
                    return (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                });
        },

        /**
         * Fetch Plants for value help
         * @returns {Promise<Array>}
         */
        fetchPlants: function () {
            var sUrl = BASE_PATH_MM + "/PlantVH?$top=50";
            return ODataClient.get(sUrl)
                .then(function (oData) {
                    return (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                });
        },

        /**
         * Fetch Storage Locations for a plant
         * @param {string} sPlant
         * @returns {Promise<Array>}
         */
        fetchStorageLocations: function (sPlant) {
            var sUrl = BASE_PATH_MM + "/StorageLocationVH?$top=50";
            if (sPlant) {
                sUrl += "&$filter=Plant eq '" + encodeURIComponent(String(sPlant).trim()) + "'";
            }
            return ODataClient.get(sUrl)
                .then(function (oData) {
                    return (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                });
        },

        /**
         * Fetch OPEN reservations for Movement 201 (Goods Issue to Cost Center) awaiting posting -
         * the "201 pending" source. These are real planned cost-center-consumption reservations in SAP.
         * @param {string} [sPlant]
         * @returns {Promise<Array>}
         */
        fetchPendingReservations: function (sPlant) {
            var sUrl = BASE_PATH_GI + "/OpenReservations?$filter=MovementType eq '201'";
            if (sPlant) {
                sUrl += " and Plant eq '" + encodeURIComponent(String(sPlant).trim()) + "'";
            }
            sUrl += "&$top=200";
            return ODataClient.get(sUrl)
                .then(function (oData) {
                    return (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                });
        },

        /**
         * Fetch the item detail of a 201 reservation (material, plant, storage location, unit,
         * open quantity, cost center) used to pre-fill the create page from the pending list.
         * @param {string} sReservationNo
         * @returns {Promise<Array>}
         */
        fetchReservationItems: function (sReservationNo) {
            var sResv = encodeURIComponent(String(sReservationNo || "").trim());
            var sUrl = BASE_PATH_GI + "/GIItems?$filter=ReservationNo eq '" + sResv + "'";
            return ODataClient.get(sUrl)
                .then(function (oData) {
                    return (oData && oData.value) || (Array.isArray(oData) ? oData : []);
                });
        },

        /**
         * List the scannable stock units valid for a reservation line (correct material/plant/sloc,
         * in stock). Used to decide whether the item is unit-managed (scan-to-complete) or plain
         * quantity (skip straight to qty/cost-center confirmation).
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
         * IsSerialManaged / DeterminedSerial / CurrentStock. Rejects (throws) for hard SAP conditions
         * such as no remaining open quantity.
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
        }
    };

    return GoodsIssue201Service;
});
