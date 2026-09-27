sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/tr-to";
    var _oModel = null;

    /**
     * TrToService
     * Client service for Warehouse Management Transfer Requirement (TR)
     * to Transfer Order (TO) mobile RF workflow.
     */
    var TrToService = {
        /**
         * Set the OData V4 model
         * @param {sap.ui.model.odata.v4.ODataModel} oModel
         */
        setModel: function (oModel) {
            _oModel = oModel;
        },

        /**
         * Get the current OData V4 model
         * @returns {sap.ui.model.odata.v4.ODataModel|null}
         */
        getModel: function () {
            return _oModel;
        },

        /**
         * Retrieve open Transfer Requirements for the warehouse
         * @param {string} [sLgnum='W01'] - Warehouse Number
         * @param {string} [sMvt] - Optional movement type filter (e.g. '319')
         * @returns {Promise<Array>}
         */
        getOpenTRs: function (sLgnum, sMvt) {
            var sWh = sLgnum || "W01";
            var sMvtParam = sMvt ? sMvt.trim() : "";
            if (TrToService.isSimulationActive()) {
                return Promise.resolve(TrToService.getMockOpenTRs(sWh, sMvtParam));
            }
            var sUrl = BASE_PATH + "/getOpenTRs(lgnum='" + encodeURIComponent(sWh.trim()) + "',mvt='" + encodeURIComponent(sMvtParam) + "')";
            return ODataClient.get(sUrl).then(function (oData) {
                var aItems = (oData && oData.value) ? oData.value : (Array.isArray(oData) ? oData : []);
                return aItems;
            });
        },

        /**
         * Retrieve Transfer Requirement header and line items
         * @param {string} sTbnum - TR Number or Production Order Number
         * @param {string} [sLgnum='W01'] - Warehouse Number
         * @returns {Promise<Object>}
         */
        getTR: function (sTbnum, sLgnum) {
            if (!sTbnum) {
                return Promise.reject(new Error("Transfer Requirement number is required"));
            }
            var sWh = sLgnum || "W01";
            if (TrToService.isSimulationActive()) {
                return Promise.resolve(TrToService.getMockTR(sTbnum, sWh));
            }
            var sUrl = BASE_PATH + "/getTR(tbnum='" + encodeURIComponent(sTbnum.trim()) + "',lgnum='" + encodeURIComponent(sWh.trim()) + "')";

            return ODataClient.get(sUrl).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        },

        /**
         * Validate scanned Storage Unit against Transfer Requirement
         * @param {string} sLenum - Storage Unit Number
         * @param {string} sTbnum - Transfer Requirement Number
         * @param {string} [sLgnum='W01'] - Warehouse Number
         * @returns {Promise<Object>}
         */
        checkSU: function (sLenum, sTbnum, sLgnum) {
            if (!sLenum) {
                return Promise.reject(new Error("Storage Unit number is required"));
            }
            var sWh = sLgnum || "W01";
            if (TrToService.isSimulationActive()) {
                return Promise.resolve(TrToService.getMockSU(sLenum, sTbnum, sWh));
            }
            var sUrl = BASE_PATH + "/checkSU(lenum='" + encodeURIComponent(sLenum.trim()) + "',tbnum='" + encodeURIComponent(sTbnum ? sTbnum.trim() : "") + "',lgnum='" + encodeURIComponent(sWh.trim()) + "')";

            return ODataClient.get(sUrl).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        },

        /**
         * Synchronously create Transfer Order (and optional 1-step confirm)
         * @param {Object} oPayload
         * @param {string} oPayload.lgnum
         * @param {string} oPayload.tbnum
         * @param {string} oPayload.tbpos
         * @param {string} oPayload.lenum
         * @param {number} oPayload.qty
         * @param {number} [oPayload.openQty]
         * @param {string} [oPayload.unit='KG']
         * @param {boolean} [oPayload.confirmImmediate=true]
         * @returns {Promise<Object>}
         */
        createTO: function (oPayload) {
            if (!oPayload || !oPayload.tbnum) {
                return Promise.reject(new Error("Transfer Requirement number is required"));
            }
            if (!oPayload.lenum) {
                return Promise.reject(new Error("Storage Unit number is required"));
            }
            if (!oPayload.qty || parseFloat(oPayload.qty) <= 0) {
                return Promise.reject(new Error("Quantity must be greater than zero"));
            }
            if (oPayload.openQty !== undefined && parseFloat(oPayload.qty) > parseFloat(oPayload.openQty)) {
                return Promise.reject(new Error("Requested quantity (" + oPayload.qty + ") exceeds open TR quantity (" + oPayload.openQty + ")"));
            }

            if (TrToService.isSimulationActive()) {
                return Promise.resolve(TrToService.mockCreateTO(oPayload));
            }

            var sUrl = BASE_PATH + "/createTO";
            return ODataClient.post(sUrl, oPayload).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        },

        /**
         * Simulation mode flag for decoupled development while ABAP Basis team registers Gateway service
         */
        _bSimulationMode: false,

        setSimulationActive: function (bActive) {
            this._bSimulationMode = !!bActive;
        },

        isSimulationActive: function () {
            return this._bSimulationMode;
        },

        /**
         * Mock data generator matching live DS4 220 empirical TR 0001000663
         */
        getMockTR: function (sTbnum, sLgnum) {
            return {
                Lgnum: sLgnum || "W01",
                Tbnum: String(sTbnum).padStart(10, "0"),
                Bwlvs: "319",
                Betyp: "P",
                Benum: "0001002749",
                Rsnum: "0000517858",
                Bdatu: "2026-09-26",
                Statu: "",
                Vltyp: "001",
                Vlpla: "STAGE-01",
                Nltyp: "100",
                Nlpla: "PROD-AIL",
                Items: [
                    {
                        Lgnum: sLgnum || "W01",
                        Tbnum: String(sTbnum).padStart(10, "0"),
                        Tbpos: "0001",
                        Material: "1000000867",
                        MaterialDesc: "IPA, Extra Pure",
                        Plant: "1120",
                        StorageLocation: "CS01",
                        Batch: "IN25003572",
                        RequiredQty: 17323.2,
                        ProcessedQty: 0.0,
                        OpenQty: 17323.2,
                        Unit: "KG",
                        DeliveryCompleted: false,
                        DestStorageType: "100",
                        DestStorageBin: "PROD-AIL"
                    },
                    {
                        Lgnum: sLgnum || "W01",
                        Tbnum: String(sTbnum).padStart(10, "0"),
                        Tbpos: "0002",
                        Material: "1000000869",
                        MaterialDesc: "SOLVESSO 108",
                        Plant: "1120",
                        StorageLocation: "CS01",
                        Batch: "",
                        RequiredQty: 13929.6,
                        ProcessedQty: 0.0,
                        OpenQty: 13929.6,
                        Unit: "KG",
                        DeliveryCompleted: false,
                        DestStorageType: "100",
                        DestStorageBin: "PROD-AIL"
                    }
                ]
            };
        },

        getMockSU: function (sLenum, sTbnum, sLgnum) {
            return {
                Lgnum: sLgnum || "W01",
                Lenum: String(sLenum).padStart(20, "0"),
                StorageUnit: String(sLenum).padStart(20, "0"),
                Tbnum: String(sTbnum || "").padStart(10, "0"),
                StorageType: "OH1",
                StorageBin: "ONHOLD",
                SUType: "E1",
                IsValid: true,
                ErrorCode: "",
                ErrorMessage: "Storage Unit verified successfully for picking",
                Quants: [
                    {
                        Lgnum: sLgnum || "W01",
                        Quant: "0001035375",
                        QuantNumber: "0001035375",
                        StorageUnit: String(sLenum).padStart(20, "0"),
                        Material: "1000000867",
                        MaterialDesc: "IPA, Extra Pure",
                        Plant: "1120",
                        StorageLocation: "CS01",
                        Batch: "IN25003572",
                        AvailableStock: 11210.0,
                        Unit: "KG",
                        StorageType: "OH1",
                        StorageBin: "ONHOLD"
                    }
                ]
            };
        },

        getMockOpenTRs: function (sLgnum, sMvt) {
            var aAll = [
                {
                    Lgnum: sLgnum || "W01",
                    Tbnum: "0001000663",
                    Bwlvs: "319",
                    Betyp: "P",
                    Benum: "0001002749",
                    Rsnum: "0000517858",
                    Bdatu: "2026-09-23",
                    Statu: "",
                    DisplayText: "TR 1000663 (Mvt 319 | Order: 1002749)",
                    Description: "Date: 2026-09-23 | Type: P | Res: 517858"
                },
                {
                    Lgnum: sLgnum || "W01",
                    Tbnum: "0001000653",
                    Bwlvs: "319",
                    Betyp: "P",
                    Benum: "0002000611",
                    Rsnum: "0000517575",
                    Bdatu: "2026-09-22",
                    Statu: "",
                    DisplayText: "TR 1000653 (Mvt 319 | Order: 2000611)",
                    Description: "Date: 2026-09-22 | Type: P | Res: 517575"
                },
                {
                    Lgnum: sLgnum || "W01",
                    Tbnum: "0001000637",
                    Bwlvs: "319",
                    Betyp: "P",
                    Benum: "0002000608",
                    Rsnum: "0000515905",
                    Bdatu: "2026-09-16",
                    Statu: "",
                    DisplayText: "TR 1000637 (Mvt 319 | Order: 2000608)",
                    Description: "Date: 2026-09-16 | Type: P | Res: 515905"
                },
                {
                    Lgnum: sLgnum || "W01",
                    Tbnum: "0001000446",
                    Bwlvs: "301",
                    Betyp: "",
                    Benum: "",
                    Rsnum: "",
                    Bdatu: "2026-03-03",
                    Statu: "T",
                    DisplayText: "TR 1000446 (Mvt 301)",
                    Description: "Date: 2026-03-03 | Type: Stock Transfer"
                },
                {
                    Lgnum: sLgnum || "W01",
                    Tbnum: "0001000033",
                    Bwlvs: "101",
                    Betyp: "D",
                    Benum: "",
                    Rsnum: "",
                    Bdatu: "2025-09-25",
                    Statu: "",
                    DisplayText: "TR 1000033 (Mvt 101)",
                    Description: "Date: 2025-09-25 | Type: Goods Receipt"
                }
            ];
            if (sMvt) {
                return aAll.filter(function (t) { return t.Bwlvs === sMvt; });
            }
            return aAll;
        },

        mockCreateTO: function (oPayload) {
            var sGeneratedTanum = "00010" + Math.floor(10000 + Math.random() * 90000);
            return {
                TransferOrder: sGeneratedTanum,
                Success: true,
                Message: "Transfer Order " + sGeneratedTanum + " created and confirmed successfully.",
                Confirmed: !!oPayload.confirmImmediate
            };
        }
    };

    return TrToService;
});
