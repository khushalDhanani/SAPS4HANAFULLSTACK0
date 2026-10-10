sap.ui.define([
    "sap/ui/base/Object"
], function (BaseObject) {
    "use strict";

    const SERVICE_URL = "/odata/v4/reservation-entry";

    return BaseObject.extend("saps4hana.fiori.modules.wm.reservation-entry.service.ReservationEntryService", {
        constructor: function (oModel) {
            BaseObject.prototype.constructor.apply(this, arguments);
            this._oModel = oModel;
        },

        getEntries: function (oFilterParams) {
            let sUrl = SERVICE_URL + "/ReservationEntries?$expand=Status,Logs&$orderby=ReservationNo desc";
            const aFilters = [];

            if (oFilterParams) {
                if (oFilterParams.MovementType) {
                    aFilters.push("MovementType eq '" + oFilterParams.MovementType + "'");
                }
                if (oFilterParams.Status) {
                    aFilters.push("Status_code eq '" + oFilterParams.Status + "'");
                }
                if (oFilterParams.Plant) {
                    aFilters.push("Plant eq '" + oFilterParams.Plant + "'");
                }
            }

            if (aFilters.length > 0) {
                sUrl += "&$filter=" + encodeURIComponent(aFilters.join(" and "));
            }

            return fetch(sUrl, {
                headers: { "Accept": "application/json" }
            }).then(function (oRes) {
                if (!oRes.ok) throw new Error("Failed to load reservation entries (" + oRes.status + ")");
                return oRes.json();
            }).then(function (data) {
                return data.value || [];
            });
        },

        getEntry: function (sResNo, sItem) {
            const sUrl = SERVICE_URL + "/ReservationEntries(ReservationNo='" + sResNo + "',ReservationItem='" + (sItem || "0001") + "')?$expand=Status,Logs";
            return fetch(sUrl, {
                headers: { "Accept": "application/json" }
            }).then(function (oRes) {
                if (!oRes.ok) throw new Error("Failed to load reservation " + sResNo + " (" + oRes.status + ")");
                return oRes.json();
            });
        },

        getStatuses: function () {
            const sUrl = SERVICE_URL + "/ReservationStatuses";
            return fetch(sUrl, {
                headers: { "Accept": "application/json" }
            }).then(function (oRes) {
                if (!oRes.ok) throw new Error("Failed to load statuses");
                return oRes.json();
            }).then(function (data) {
                return data.value || [];
            });
        },

        createReservationEntry: function (oPayload) {
            const sUrl = SERVICE_URL + "/createReservationEntry";
            return fetch(sUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify(oPayload)
            }).then(function (oRes) {
                return oRes.json().then(function (data) {
                    if (!oRes.ok) {
                        const sMsg = (data.error && data.error.message) ? data.error.message : ("Error " + oRes.status);
                        throw new Error(sMsg);
                    }
                    return data;
                });
            });
        }
    });
});
