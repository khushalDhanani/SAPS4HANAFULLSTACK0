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

            var oBody = {
                MovementType: "201",
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
                GLAccount: oPayload.GLAccount ? String(oPayload.GLAccount).trim() : "",
                ReservationNo: "",
                ReservationItem: "",
                DifferenceQty: 0,
                DifferenceReason: "",
                DifferenceStorageType: "",
                FinalIssue: false
            };

            return ODataClient.post(BASE_PATH_GI + "/postGoodsIssue", oBody);
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
        }
    };

    return GoodsIssue201Service;
});
