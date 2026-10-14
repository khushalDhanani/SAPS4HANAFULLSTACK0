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

        getOpenReservations: function (oFilterParams) {
            const p = oFilterParams || {};
            const sUrl = SERVICE_URL + "/getOpenReservations(plant='" + encodeURIComponent((p.Plant || "").trim()) +
                "',movementType='" + encodeURIComponent((p.MovementType || "").trim()) + "')";
            return ODataClient.get(sUrl).then(function (data) {
                return (data && data.value) ? data.value : (Array.isArray(data) ? data : []);
            });
        },

        getEntry: function (sResNo, sItem) {
            const sUrl = SERVICE_URL + "/ReservationEntries(ReservationNo='" + sResNo + "',ReservationItem='" + (sItem || "0001") + "')?$expand=Status,Logs";
            return ODataClient.get(sUrl);
        },

        // Live detail from SAP for a reservation not tracked locally (created outside this app).
        getReservationDetail: function (sResNo, sItem) {
            const sUrl = SERVICE_URL + "/getReservationDetail(ReservationNo='" + encodeURIComponent(sResNo) +
                "',ReservationItem='" + encodeURIComponent(sItem || "0001") + "')";
            return ODataClient.get(sUrl).then(function (data) {
                return (data && data.value) ? data.value : data;
            });
        },

        getStatuses: function () {
            const sUrl = SERVICE_URL + "/ReservationStatuses";
            return ODataClient.get(sUrl).then(function (data) {
                return (data && data.value) ? data.value : (Array.isArray(data) ? data : []);
            });
        },

        createReservation: function (oPayload) {
            const sUrl = SERVICE_URL + "/createReservation";
            return ODataClient.post(sUrl, oPayload);
        },

        createTransferRequirement: function (sResNo, sItem, sWh) {
            const sUrl = SERVICE_URL + "/createTransferRequirement";
            return ODataClient.post(sUrl, {
                ReservationNo: sResNo,
                ReservationItem: sItem || "0001",
                WarehouseNumber: sWh || ""
            });
        },

        createTOFromTR: function (sResNo, sItem, sWh, sTr, bAutoConfirm) {
            const sUrl = SERVICE_URL + "/createTOFromTR";
            const oPayload = {
                ReservationNo: sResNo,
                ReservationItem: sItem || "0001",
                WarehouseNumber: sWh || "",
                TRNumber: sTr || ""
            };
            if (bAutoConfirm !== undefined) {
                oPayload.autoConfirm = Boolean(bAutoConfirm);
            }
            return ODataClient.post(sUrl, oPayload);
        },

        confirmTransferOrder: function (sResNo, sItem, sWh, sTo) {
            const sUrl = SERVICE_URL + "/confirmTransferOrder";
            return ODataClient.post(sUrl, {
                ReservationNo: sResNo,
                ReservationItem: sItem || "0001",
                WarehouseNumber: sWh || "",
                TransferOrder: sTo || ""
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
