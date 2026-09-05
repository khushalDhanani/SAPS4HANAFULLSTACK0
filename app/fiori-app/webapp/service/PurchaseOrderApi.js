sap.ui.define([], function () {
    "use strict";

    var BASE_URL = "/odata/v4/purchase-order";

    return {
        /**
         * Dispatches a createPurchaseOrder action request to the CAP service.
         *
         * @param {Object} oPayload
         * @param {Object} oPayload.header
         * @param {Array<Object>} oPayload.items
         * @returns {Promise<string>} Created Purchase Order ID
         */
        createPurchaseOrder: function (oPayload) {
            return fetch(BASE_URL + "/createPurchaseOrder", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(oPayload)
            })
                .then(function (response) {
                    if (!response.ok) {
                        return response.text().then(function (txt) {
                            var sMsg;
                            try {
                                var oJson = JSON.parse(txt);
                                sMsg = (oJson.error && oJson.error.message) ? oJson.error.message : (oJson.message || txt);
                            } catch (e) {
                                sMsg = txt || "Server error occurred while creating Purchase Order.";
                            }
                            throw new Error(sMsg);
                        });
                    }
                    return response.json();
                })
                .then(function (result) {
                    return result.value || result.PurchaseOrder || result;
                });
        }
    };
});
