sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH_GI = "/odata/v4/goods-issue";
    var BASE_PATH_MM = "/odata/v4/purchase-order";

    var GoodsIssue311Service = {
        /**
         * Post a Movement 311 Goods Issue against an SAP Reservation
         * @param {Object} oPayload
         * @returns {Promise<Object>}
         */
        postGoodsIssue: function (oPayload) {
            if (!oPayload) {
                return Promise.reject(new Error("Goods Issue payload is required"));
            }

            var sResv = String(oPayload.ReservationNo || "").trim();
            if (!sResv) {
                return Promise.reject(new Error("Reservation Number is required for Movement 311"));
            }

            var sItem = String(oPayload.ReservationItem || "").trim();
            if (!sItem) {
                return Promise.reject(new Error("Reservation Item is required for Movement 311"));
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

            // Isolated 311 action: send only Movement 311 fields (no MovementType / difference / cost center).
            var oBody = {
                ReservationNo: sResv,
                ReservationItem: sItem,
                Material: sMat,
                Plant: sPlant,
                StorageLocation: sSLoc,
                IssueQty: nQty,
                Unit: sUnit,
                Batch: oPayload.Batch ? String(oPayload.Batch).trim().toUpperCase() : "",
                PostingDate: oPayload.PostingDate || null,
                DocumentDate: oPayload.DocumentDate || null,
                SerialNumbers: aSerials,
                ReceivingPlant: oPayload.ReceivingPlant ? String(oPayload.ReceivingPlant).trim().toUpperCase() : "",
                ReceivingStorageLocation: oPayload.ReceivingStorageLocation ? String(oPayload.ReceivingStorageLocation).trim().toUpperCase() : ""
            };

            return ODataClient.post(BASE_PATH_GI + "/postGoodsIssue311", oBody);
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
         * Fetch open SAP Reservations for Movement 311 only (server-side filtered via the
         * same OpenReservations MovementType-equality filter the generic Goods Issue page uses).
         * @returns {Promise<Array>}
         */
        fetchOpenReservations: function () {
            var sUrl = BASE_PATH_GI + "/OpenReservations?$filter=" + encodeURIComponent("MovementType eq '311'") + "&$top=200";
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
         * Fetch Plants for the Receiving Plant value help
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
         * Fetch Storage Locations for the Receiving Storage Location value help
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

    return GoodsIssue311Service;
});
