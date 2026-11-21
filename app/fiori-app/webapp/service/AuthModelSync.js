sap.ui.define([], function () {
    "use strict";

    /**
     * AuthModelSync
     *
     * Synchronizes authorization headers to all active OData V4 models.
     */
    return {
        sync: function (oComponent, sToken, bForce, sLastSyncedAuthHeader, Log) {
            if (!oComponent) {
                return sLastSyncedAuthHeader;
            }
            var sAuthHeader = sToken ? ("Bearer " + sToken) : undefined;
            if (!bForce && sLastSyncedAuthHeader === sAuthHeader) {
                return sLastSyncedAuthHeader;
            }
            var mHeaders = { "Authorization": sAuthHeader };
            var aModelNames = ["", "salesInquiry", "salesOrder", "goodsReceipt", "outboundDelivery", "customerInvoice", "customerReturn"];
            aModelNames.forEach(function (sModelName) {
                var oModel = sModelName ? oComponent.getModel(sModelName) : oComponent.getModel();
                if (oModel && typeof oModel.changeHttpHeaders === "function") {
                    try {
                        oModel.changeHttpHeaders(mHeaders);
                    } catch (err) {
                        if (Log && typeof Log.warning === "function") {
                            Log.warning("AuthService: Unable to update " + (sModelName || "default") + " model headers: " + (err && err.message));
                        }
                    }
                }
            });
            return sAuthHeader;
        }
    };
});
