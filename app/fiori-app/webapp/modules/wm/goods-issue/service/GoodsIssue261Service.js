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
            if (!sResv) {
                return Promise.reject(new Error("Reservation Number is required for Movement 261"));
            }

            var sItem = String(oPayload.ReservationItem || "").trim();
            if (!sItem) {
                return Promise.reject(new Error("Reservation Item is required for Movement 261"));
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

            // Isolated 261 action: send only Movement 261 fields (no MovementType / difference / cost center).
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
                SerialNumbers: aSerials
            };

            return ODataClient.post(BASE_PATH_GI + "/postGoodsIssue261", oBody);
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
            var sUrl = BASE_PATH_GI + "/OpenReservations?$filter=" + encodeURIComponent("MovementType eq '261'") + "&$top=200";
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
        }
    };

    return GoodsIssue261Service;
});
