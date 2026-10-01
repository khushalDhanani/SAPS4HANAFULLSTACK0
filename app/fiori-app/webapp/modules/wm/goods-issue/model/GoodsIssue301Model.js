(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory();
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define([
            "sap/ui/model/json/JSONModel"
        ], function (JSONModel) {
            return factory(JSONModel);
        });
    }
})(this, function (JSONModel) {
    "use strict";

    /**
     * Format current date in YYYY-MM-DD
     */
    function _getTodayYMD() {
        var d = new Date();
        var yyyy = d.getFullYear();
        var mm = String(d.getMonth() + 1).padStart(2, "0");
        var dd = String(d.getDate()).padStart(2, "0");
        return yyyy + "-" + mm + "-" + dd;
    }

    /**
     * Validate YYYY-MM-DD calendar date string
     */
    function _isValidDate(sDate) {
        if (!sDate || typeof sDate !== "string") return false;
        var m = sDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return false;
        var y = parseInt(m[1], 10);
        var mo = parseInt(m[2], 10);
        var d = parseInt(m[3], 10);
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
        var dt = new Date(Date.UTC(y, mo - 1, d));
        return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === mo && dt.getUTCDate() === d;
    }

    /**
     * Clean and normalize barcode scanner string (strip CR/LF, prefixes)
     */
    function _cleanBarcode(sVal) {
        if (!sVal) return "";
        return String(sVal).replace(/[\r\n\t]/g, "").trim().toUpperCase();
    }

    var GoodsIssue301Model = {
        /**
         * Create initial state object for Goods Issue 301
         * @returns {Object}
         */
        getInitialData: function () {
            var sToday = _getTodayYMD();
            return {
                // Form Header / Movement Context
                movementType: "301",
                movementTypeName: "Plant-to-Plant Transfer",
                postingDate: sToday,
                documentDate: sToday,
                headerText: "",

                // Reservation Assignment (Mandatory) - this movement type only posts against an
                // existing SAP reservation; there is no "unplanned" posting path on the backend
                // (GoodsIssuePostingClient.postGoodsIssue throws when Reservation/Item are missing
                // for any movement type other than 201).
                reservationNo: "",
                reservationItem: "",
                fromReservation: false,

                // Order/Network: purely descriptive, populated only once a reservation item
                // resolves. Never an independent input, never independently validated.
                orderNo: "",

                // Receiving Plant / Storage Location (Transfer Posting - OPTIONAL, backend does not require them)
                receivingPlant: "",
                receivingPlantName: "",
                receivingStorageLocation: "",
                receivingStorageLocationName: "",

                // Material & Location - derived from the resolved reservation item, read-only
                material: "",
                materialName: "",
                plant: "",
                storageLocation: "",
                // True only when the reservation item carries no storage location: the user picks it.
                isStorageLocationEditable: false,

                // Quantity & Unit
                quantity: 1,
                unit: "",
                isUnitEditable: false,
                openQty: null,

                // Batch Management
                isBatchManaged: false,
                batch: "",

                // Serial Management
                isSerialManaged: false,
                serialInput: "",
                serialNumbers: [],

                // Reservation Item lookup state
                itemLoading: false,

                // Process & Execution States
                busy: false,
                hasPosted: false,
                postedDocument: "",
                postedYear: "",
                reversalBusy: false,
                hasReversed: false,
                reversalDocument: "",
                reversalYear: "",

                // Validation errors & status
                errors: {
                    reservationNo: "",
                    reservationItem: "",
                    material: "",
                    plant: "",
                    storageLocation: "",
                    quantity: "",
                    unit: "",
                    postingDate: "",
                    documentDate: "",
                    batch: "",
                    serials: "",
                    receivingPlant: "",
                    receivingStorageLocation: ""
                },
                isValid: false
            };
        },

        /**
         * Create a new UI5 JSONModel initialized with Goods Issue 301 data
         * @returns {sap.ui.model.json.JSONModel}
         */
        createInitialModel: function () {
            var oData = this.getInitialData();
            if (JSONModel) {
                return new JSONModel(oData);
            }
            return oData;
        },

        /**
         * Pure client-side validation adhering to backend business rules
         * @param {Object} oData
         * @returns {{ isValid: boolean, errors: Object }}
         */
        validate: function (oData) {
            var errors = {
                reservationNo: "",
                reservationItem: "",
                material: "",
                plant: "",
                storageLocation: "",
                quantity: "",
                unit: "",
                postingDate: "",
                documentDate: "",
                batch: "",
                serials: "",
                    receivingPlant: "",
                    receivingStorageLocation: ""
            };
            var bValid = true;

            // 1. Reservation No (Mandatory - this movement type has no unplanned posting path)
            var sResv = (oData.reservationNo != null) ? String(oData.reservationNo).trim() : "";
            if (!sResv) {
                errors.reservationNo = "Reservation Number is required for Movement 301";
                bValid = false;
            } else if (sResv.length > 10) {
                errors.reservationNo = "Reservation Number cannot exceed 10 characters";
                bValid = false;
            }

            // 2. Reservation Item (Mandatory)
            var sItem = (oData.reservationItem != null) ? String(oData.reservationItem).trim() : "";
            if (!sItem) {
                errors.reservationItem = "Reservation Item is required for Movement 301";
                bValid = false;
            } else if (sItem.length > 4) {
                errors.reservationItem = "Reservation Item cannot exceed 4 characters";
                bValid = false;
            }

            // 3. Material (derived from the resolved reservation item, still validated present)
            var sMat = (oData.material != null) ? String(oData.material).trim() : "";
            if (!sMat) {
                errors.material = "Material is required - select a Reservation Item first";
                bValid = false;
            }

            // 4. Plant (derived, 4 chars)
            var sPlant = (oData.plant != null) ? String(oData.plant).trim().toUpperCase() : "";
            if (!sPlant) {
                errors.plant = "Plant is required - select a Reservation Item first";
                bValid = false;
            } else if (sPlant.length !== 4) {
                errors.plant = "Plant must be 4 characters";
                bValid = false;
            }

            // 5. Storage Location (derived, 4 chars)
            var sSLoc = (oData.storageLocation != null) ? String(oData.storageLocation).trim().toUpperCase() : "";
            if (!sSLoc) {
                errors.storageLocation = oData.isStorageLocationEditable
                    ? "Storage Location is required - the reservation has none, select one"
                    : "Storage Location is required - select a Reservation Item first";
                bValid = false;
            } else if (sSLoc.length !== 4) {
                errors.storageLocation = "Storage Location must be 4 characters";
                bValid = false;
            }

            // 6. Quantity (> 0, max 3 decimal places)
            var nQty = Number(oData.quantity);
            if (isNaN(nQty) || nQty <= 0) {
                errors.quantity = "Quantity must be greater than 0";
                bValid = false;
            } else {
                var sQtyStr = String(oData.quantity).trim();
                var parts = sQtyStr.split(".");
                if (parts.length > 1 && parts[1].length > 3) {
                    errors.quantity = "Quantity cannot exceed 3 decimal places";
                    bValid = false;
                }
            }

            // 7. Unit of Measure (Mandatory, max 3 chars)
            var sUnit = (oData.unit != null) ? String(oData.unit).trim().toUpperCase() : "";
            if (!sUnit) {
                errors.unit = "Unit of Measure is required";
                bValid = false;
            } else if (sUnit.length > 3) {
                errors.unit = "Unit cannot exceed 3 characters";
                bValid = false;
            }

            // 8. Dates (Valid YYYY-MM-DD)
            if (!oData.postingDate || !_isValidDate(oData.postingDate)) {
                errors.postingDate = "Valid Posting Date is required (YYYY-MM-DD)";
                bValid = false;
            }
            if (!oData.documentDate || !_isValidDate(oData.documentDate)) {
                errors.documentDate = "Valid Document Date is required (YYYY-MM-DD)";
                bValid = false;
            }

            // 9. Batch Management (Required if material is batch managed)
            if (oData.isBatchManaged) {
                var sBatch = (oData.batch != null) ? String(oData.batch).trim() : "";
                if (!sBatch) {
                    errors.batch = "Batch is required for batch-managed material";
                    bValid = false;
                }
            }

            // 10. Receiving Plant / Storage Location (Transfer Posting - Plant-to-Plant)
            // Receiving Plant is mandatory (pre-filled when the reservation carries it) and plant-to-plant
            // invariants apply:
            // - ReceivingPlant must differ from issuing Plant (inverse of 311's same-plant rule)
            // - ReceivingStorageLocation can match or differ from issuing StorageLocation
            var sRecvPlant = (oData.receivingPlant != null) ? String(oData.receivingPlant).trim().toUpperCase() : "";
            if (!sRecvPlant) {
                errors.receivingPlant = "Receiving Plant is required for Movement 301";
                bValid = false;
            } else if (sRecvPlant.length !== 4) {
                errors.receivingPlant = "Receiving Plant must be 4 characters";
                bValid = false;
            } else if (sRecvPlant && sPlant && sRecvPlant === sPlant) {
                errors.receivingPlant = "Movement 301 is a plant-to-plant transfer: receiving plant '" + sRecvPlant + "' must differ from issuing plant '" + sPlant + "'";
                bValid = false;
            }
            var sRecvSLoc = (oData.receivingStorageLocation != null) ? String(oData.receivingStorageLocation).trim().toUpperCase() : "";
            if (sRecvSLoc && sRecvSLoc.length !== 4) {
                errors.receivingStorageLocation = "Receiving Storage Location must be 4 characters";
                bValid = false;
            }

            // Serial Numbers Management (Required if material is serial managed)
            if (oData.isSerialManaged) {
                var aSerials = Array.isArray(oData.serialNumbers) ? oData.serialNumbers : [];
                var nExpected = Math.floor(nQty);
                if (aSerials.length !== nExpected) {
                    errors.serials = "Serial numbers count (" + aSerials.length + ") must match quantity (" + nExpected + ")";
                    bValid = false;
                } else {
                    var seen = {};
                    for (var i = 0; i < aSerials.length; i++) {
                        var sn = _cleanBarcode(aSerials[i]);
                        if (!sn) {
                            errors.serials = "Serial number at row " + (i + 1) + " cannot be blank";
                            bValid = false;
                            break;
                        }
                        if (sn.length > 18) {
                            errors.serials = "Serial number '" + sn + "' exceeds 18 characters";
                            bValid = false;
                            break;
                        }
                        if (seen[sn]) {
                            errors.serials = "Duplicate serial number: " + sn;
                            bValid = false;
                            break;
                        }
                        seen[sn] = true;
                    }
                }
            }

            return {
                isValid: bValid,
                errors: errors
            };
        },

        /**
         * Apply a resolved GIItems row (from a SAP reservation) onto the model data.
         * @param {Object} oData - Target model data
         * @param {Object} oItem - GIItems row: ReservationItem, Material, MaterialDesc, Plant,
         *   StorageLocation, Unit, OrderNo, Batch, IsSerialManaged, OpenQty
         */
        applyReservationItem: function (oData, oItem) {
            if (!oItem) return;
            var rawItem = oItem.ReservationItem != null ? String(oItem.ReservationItem).trim() : "";
            oData.reservationItem = rawItem ? rawItem.padStart(4, "0") : "";
            oData.orderNo = oItem.OrderNo || "";
            oData.material = oItem.Material || "";
            oData.materialName = oItem.MaterialDesc || "";
            oData.plant = oItem.Plant || "";
            oData.storageLocation = oItem.StorageLocation || "";
            oData.isStorageLocationEditable = !oItem.StorageLocation;
            oData.unit = oItem.Unit || "";
            oData.isUnitEditable = !oItem.Unit;
            oData.isSerialManaged = !!oItem.IsSerialManaged;
            oData.isBatchManaged = !!(oItem.IsBatchManaged || oItem.Batch || (oItem.BatchStatusText && oItem.BatchStatusText !== "NO BATCH"));
            oData.batch = oItem.Batch || "";
            oData.openQty = (oItem.OpenQty !== undefined && oItem.OpenQty !== null) ? oItem.OpenQty : null;
            if (oItem.ReceivingPlant) {
                oData.receivingPlant = oItem.ReceivingPlant;
            }
            if (oItem.ReceivingStorageLocation) {
                oData.receivingStorageLocation = oItem.ReceivingStorageLocation;
            }
            oData.fromReservation = true;
        },

        /**
         * Add a serial number to the serial numbers array
         * @param {Object} oData - Target model data
         * @param {string} sRawSerial - Input serial number
         * @returns {{ success: boolean, message?: string }}
         */
        addSerialNumber: function (oData, sRawSerial) {
            var sSerial = _cleanBarcode(sRawSerial);
            if (!sSerial) {
                return { success: false, message: "Serial number cannot be empty" };
            }
            if (sSerial.length > 18) {
                return { success: false, message: "Serial number cannot exceed 18 characters" };
            }
            if (!Array.isArray(oData.serialNumbers)) {
                oData.serialNumbers = [];
            }
            var nRequired = Math.floor(Number(oData.quantity) || 1);
            if (oData.serialNumbers.length >= nRequired) {
                return {
                    success: false,
                    message: "Maximum serial numbers reached for quantity " + nRequired
                };
            }
            if (oData.serialNumbers.indexOf(sSerial) !== -1) {
                return { success: false, message: "Serial number '" + sSerial + "' already added" };
            }

            oData.serialNumbers.push(sSerial);
            oData.serialInput = "";
            return { success: true };
        },

        /**
         * Remove serial number by index
         * @param {Object} oData
         * @param {number} nIndex
         */
        removeSerialNumber: function (oData, nIndex) {
            if (Array.isArray(oData.serialNumbers) && nIndex >= 0 && nIndex < oData.serialNumbers.length) {
                oData.serialNumbers.splice(nIndex, 1);
            }
        },

        /**
         * Build clean backend payload for postGoodsIssue
         * @param {Object} oData
         * @returns {Object}
         */
        toBackendPayload: function (oData) {
            var sResv = String(oData.reservationNo || "").trim();
            var rawItem = oData.reservationItem != null ? String(oData.reservationItem).trim() : "";
            var sItem = rawItem ? rawItem.padStart(4, "0") : "";
            var sMat = String(oData.material || "").trim().toUpperCase();
            var sPlant = String(oData.plant || "").trim().toUpperCase();
            var sSLoc = String(oData.storageLocation || "").trim().toUpperCase();
            var sUnit = String(oData.unit || "").trim().toUpperCase();
            var sBatch = oData.isBatchManaged ? String(oData.batch || "").trim().toUpperCase() : "";
            var aSerials = oData.isSerialManaged ? (oData.serialNumbers || []).map(_cleanBarcode) : [];

            return {
                MovementType: "301",
                ReservationNo: sResv,
                ReservationItem: sItem,
                Material: sMat,
                Plant: sPlant,
                StorageLocation: sSLoc,
                IssueQty: Number(oData.quantity),
                Unit: sUnit,
                Batch: sBatch,
                PostingDate: oData.postingDate,
                DocumentDate: oData.documentDate,
                HeaderText: oData.headerText ? String(oData.headerText).trim() : ("GI Resv " + sResv),
                SerialNumbers: aSerials,
                ReceivingPlant: String(oData.receivingPlant || "").trim().toUpperCase(),
                ReceivingStorageLocation: String(oData.receivingStorageLocation || "").trim().toUpperCase()
                // GLAccount / CostCenter intentionally never sent: this movement type has no
                // cost-center assignment and G/L account is not applicable.
            };
        }
    };

    return GoodsIssue301Model;
});
