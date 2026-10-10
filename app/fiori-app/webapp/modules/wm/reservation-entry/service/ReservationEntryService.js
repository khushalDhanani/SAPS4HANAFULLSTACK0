sap.ui.define([
    "sap/ui/base/Object",
    "saps4hana/fiori/service/ODataClient"
], function (BaseObject, ODataClient) {
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
                if (oFilterParams.DateFrom) {
                    aFilters.push("createdAt ge " + oFilterParams.DateFrom + "T00:00:00Z");
                }
                if (oFilterParams.DateTo) {
                    aFilters.push("createdAt le " + oFilterParams.DateTo + "T23:59:59Z");
                }
            }

            if (aFilters.length > 0) {
                sUrl += "&$filter=" + encodeURIComponent(aFilters.join(" and "));
            }

            return ODataClient.get(sUrl).then(function (data) {
                return (data && data.value) ? data.value : (Array.isArray(data) ? data : []);
            });
        },

        getEntry: function (sResNo, sItem) {
            const sUrl = SERVICE_URL + "/ReservationEntries(ReservationNo='" + sResNo + "',ReservationItem='" + (sItem || "0001") + "')?$expand=Status,Logs";
            return ODataClient.get(sUrl);
        },

        getStatuses: function () {
            const sUrl = SERVICE_URL + "/ReservationStatuses";
            return ODataClient.get(sUrl).then(function (data) {
                return (data && data.value) ? data.value : (Array.isArray(data) ? data : []);
            });
        },

        createReservationEntry: function (oPayload) {
            const sUrl = SERVICE_URL + "/createReservationEntry";
            return ODataClient.post(sUrl, oPayload);
        },

        retryStep: function (sResNo, sItem, sStep) {
            const sUrl = SERVICE_URL + "/retryStep";
            return ODataClient.post(sUrl, {
                ReservationNo: sResNo,
                ReservationItem: sItem || "0001",
                Step: sStep || "AUTO"
            });
        },

        getApplicationLogs: function (sResNo, sItem) {
            const sUrl = SERVICE_URL + "/getApplicationLogs(ReservationNo='" + sResNo + "',ReservationItem='" + (sItem || "0001") + "')";
            return ODataClient.get(sUrl).then(function (data) {
                return (data && data.value) ? data.value : (Array.isArray(data) ? data : []);
            });
        }
    });
});
