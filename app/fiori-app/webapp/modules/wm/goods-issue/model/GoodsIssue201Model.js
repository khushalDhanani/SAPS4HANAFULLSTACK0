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

    var GoodsIssue201Model = {
        /**
         * Create initial state object for Goods Issue 201
         * @returns {Object}
         */
        getInitialData: function () {
            var sToday = _getTodayYMD();
            return {
                // Form Header / Movement Context
                movementType: "201",
                movementTypeName: "Goods Issue to Cost Center",
                postingDate: sToday,
                documentDate: sToday,
                headerText: "",

                // Planned-reservation linkage (populated only when completing a 201 from the Pending list)
                reservationNo: "",
                reservationItem: "",
                fromReservation: false,

                // Cost Assignment
                costCenter: "",
                costCenterName: "",
                glAccount: "", // Read-only derived display

                // Material & Location — start blank; the user selects plant/storage location via value
                // help. Never presume a specific plant/SLoc (it would flow into the SAP posting).
                material: "",
                materialName: "",
                plant: "",
                plantName: "",
                storageLocation: "",
                storageLocationName: "",

                // Quantity & Unit
                quantity: 1,
                unit: "EA",
                isUnitEditable: false,

                // Batch Management
                isBatchManaged: false,
                batch: "",

                // Serial Management
                isSerialManaged: false,
                serialInput: "",
                serialNumbers: [],

                // Scan-to-complete (unit-managed reservations: serial or storage-unit)
                scanEnabled: false,
                scanUnitKind: "",           // "SERIAL" | "SU" (derived per scan) - label only
                scanInput: "",
                scannedUnits: [],           // [{ barcode, material, serial, isSerial }]
                requiredScanCount: 0,
                lastScanState: "None",      // MessageStrip state: Success | Error | Warning | None
                lastScanText: "",

                // Active Stock Information
                availableStock: null,
                stockLoading: false,

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
                    material: "",
                    plant: "",
                    storageLocation: "",
                    costCenter: "",
                    quantity: "",
                    unit: "",
                    postingDate: "",
                    documentDate: "",
                    batch: "",
                    serials: ""
                },
                isValid: false
            };
        },

        /**
         * Create a new UI5 JSONModel initialized with Goods Issue 201 data
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
                material: "",
                plant: "",
                storageLocation: "",
                costCenter: "",
                quantity: "",
                unit: "",
                postingDate: "",
                documentDate: "",
                batch: "",
                serials: ""
            };
            var bValid = true;

            // 1. Cost Center (Mandatory for 201, max 10 chars, uppercase alphanumeric)
            var sCC = (oData.costCenter != null) ? String(oData.costCenter).trim() : "";
            if (!sCC) {
                errors.costCenter = "Cost Center is required for Movement 201";
                bValid = false;
            } else if (sCC.length > 10) {
                errors.costCenter = "Cost Center cannot exceed 10 characters";
                bValid = false;
            } else if (!/^[A-Z0-9_-]+$/i.test(sCC)) {
                errors.costCenter = "Cost Center contains invalid characters";
                bValid = false;
            }

            // 2. Material (Mandatory)
            var sMat = (oData.material != null) ? String(oData.material).trim() : "";
            if (!sMat) {
                errors.material = "Material is required";
                bValid = false;
            }

            // 3. Plant (Mandatory, 4 chars)
            var sPlant = (oData.plant != null) ? String(oData.plant).trim().toUpperCase() : "";
            if (!sPlant) {
                errors.plant = "Plant is required";
                bValid = false;
            } else if (sPlant.length !== 4) {
                errors.plant = "Plant must be 4 characters";
                bValid = false;
            }

            // 4. Storage Location (Mandatory, 4 chars)
            var sSLoc = (oData.storageLocation != null) ? String(oData.storageLocation).trim().toUpperCase() : "";
            if (!sSLoc) {
                errors.storageLocation = "Storage Location is required";
                bValid = false;
            } else if (sSLoc.length !== 4) {
                errors.storageLocation = "Storage Location must be 4 characters";
                bValid = false;
            }

            // 5. Quantity (> 0, max 3 decimal places)
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

            // 6. Unit of Measure (Mandatory, max 3 chars)
            var sUnit = (oData.unit != null) ? String(oData.unit).trim().toUpperCase() : "";
            if (!sUnit) {
                errors.unit = "Unit of Measure is required";
                bValid = false;
            } else if (sUnit.length > 3) {
                errors.unit = "Unit cannot exceed 3 characters";
                bValid = false;
            }

            // 7. Dates (Valid YYYY-MM-DD)
            if (!oData.postingDate || !_isValidDate(oData.postingDate)) {
                errors.postingDate = "Valid Posting Date is required (YYYY-MM-DD)";
                bValid = false;
            }
            if (!oData.documentDate || !_isValidDate(oData.documentDate)) {
                errors.documentDate = "Valid Document Date is required (YYYY-MM-DD)";
                bValid = false;
            }

            // 8. Batch Management (Required if material is batch managed)
            if (oData.isBatchManaged) {
                var sBatch = (oData.batch != null) ? String(oData.batch).trim() : "";
                if (!sBatch) {
                    errors.batch = "Batch is required for batch-managed material";
                    bValid = false;
                }
            }

            // 9. Serial Numbers Management (Required if material is serial managed)
            if (oData.isSerialManaged) {
                var aSerials = Array.isArray(oData.serialNumbers) ? oData.serialNumbers : [];
                var nExpected = Math.floor(nQty);
                if (aSerials.length !== nExpected) {
                    errors.serials = "Serial numbers count (" + aSerials.length + ") must match quantity (" + nExpected + ")";
                    bValid = false;
                } else {
                    // Check duplicate serials
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

            // 10. Scan-to-complete (unit-managed reservations): every required unit must be scanned.
            if (oData.scanEnabled) {
                var nScanned = Array.isArray(oData.scannedUnits) ? oData.scannedUnits.length : 0;
                var nReq = Number(oData.requiredScanCount) || 0;
                if (nScanned !== nReq) {
                    errors.scan = "Scan " + nReq + " unit(s) to complete this reservation (" + nScanned + " scanned).";
                    bValid = false;
                }
            }

            return {
                isValid: bValid,
                errors: errors
            };
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
        /**
         * Apply a resolveStockUnit result for ONE scan against the current line. Auto-detects serial
         * vs storage unit, gives clear pass/fail feedback (matched / wrong material / already issued /
         * duplicate / quantity exceeded) and, on a match, appends to scannedUnits. Never a silent fill.
         * @param {Object} oData model data
         * @param {Object} oRes StockUnitResolution from resolveStockUnit
         * @param {string} sBarcode the raw scanned barcode
         * @returns {{ ok: boolean, state: string, text: string }}
         */
        applyScanResolution: function (oData, oRes, sBarcode) {
            var sExpectedMat = String(oData.material || "").trim().toUpperCase();
            var nRequired = Number(oData.requiredScanCount) || 0;
            var aScanned = Array.isArray(oData.scannedUnits) ? oData.scannedUnits : [];
            var sScan = String(sBarcode || "").trim();

            if (!oRes || oRes.SuExists === false) {
                return { ok: false, state: "Error", text: (oRes && oRes.SuNotFoundReason) || ("Unit '" + sScan + "' not found in unrestricted stock for this reservation.") };
            }
            var sResMat = String(oRes.Material || "").trim().toUpperCase();
            if (sExpectedMat && sResMat && sResMat !== sExpectedMat) {
                return { ok: false, state: "Error", text: "Wrong material: scanned unit belongs to " + sResMat + ", expected " + sExpectedMat + "." };
            }
            var sSerial = String(oRes.DeterminedSerial || oRes.SerialNumber || "").trim();
            var sKey = sSerial || sScan;
            if (aScanned.some(function (u) { return u.key === sKey; })) {
                return { ok: false, state: "Warning", text: "Unit " + sKey + " was already scanned." };
            }
            if (aScanned.length >= nRequired) {
                return { ok: false, state: "Warning", text: "Quantity exceeded: " + nRequired + " unit(s) already scanned for this line." };
            }
            aScanned.push({ key: sKey, barcode: sScan, material: sResMat, serial: sSerial, isSerial: !!oRes.IsSerialManaged });
            oData.scannedUnits = aScanned;
            var sLabel = sSerial ? ("serial " + sSerial) : ("unit " + sKey);
            return { ok: true, state: "Success", text: "Matched " + sLabel + " (" + aScanned.length + " of " + nRequired + ")." };
        },

        toBackendPayload: function (oData) {
            var sCC = String(oData.costCenter || "").trim().toUpperCase();
            var sPlant = String(oData.plant || "").trim().toUpperCase();
            var sSLoc = String(oData.storageLocation || "").trim().toUpperCase();
            var sMat = String(oData.material || "").trim().toUpperCase();
            var sUnit = String(oData.unit || "").trim().toUpperCase();
            var sBatch = oData.isBatchManaged ? String(oData.batch || "").trim().toUpperCase() : "";
            var aSerials = oData.isSerialManaged ? (oData.serialNumbers || []).map(_cleanBarcode) : [];
            // Scan-to-complete: carry any serials captured from scanned units (storage-unit scans that
            // are not serial-managed contribute no serials - the goods issue is by quantity).
            if (oData.scanEnabled && Array.isArray(oData.scannedUnits)) {
                var aScanSerials = oData.scannedUnits
                    .filter(function (u) { return u.isSerial && u.serial; })
                    .map(function (u) { return _cleanBarcode(u.serial); });
                if (aScanSerials.length > 0) {
                    aSerials = aScanSerials;
                }
            }

            return {
                MovementType: "201",
                CostCenter: sCC,
                Material: sMat,
                Plant: sPlant,
                StorageLocation: sSLoc,
                IssueQty: Number(oData.quantity),
                Unit: sUnit,
                Batch: sBatch,
                PostingDate: oData.postingDate,
                DocumentDate: oData.documentDate,
                HeaderText: oData.headerText ? String(oData.headerText).trim() : ("GI CC " + sCC),
                SerialNumbers: aSerials,
                // Reservation linkage: empty for an unplanned 201, populated when completing a
                // planned cost-center reservation opened from the 201 Pending list.
                ReservationNo: oData.reservationNo ? String(oData.reservationNo).trim() : "",
                ReservationItem: oData.reservationItem ? String(oData.reservationItem).trim() : ""
                // GLAccount intentionally omitted: system-determined via OBYC/GBB-VBR for
                // Movement 201 and read-only in this UI (see glAccount in getInitialData above);
                // the backend also rejects a caller-supplied GLAccount for 201 independently.
            };
        }
    };

    return GoodsIssue201Model;
});
