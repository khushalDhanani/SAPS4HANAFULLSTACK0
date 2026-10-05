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

    var GoodsIssue261Model = {
        /**
         * Create initial state object for Goods Issue 261
         * @returns {Object}
         */
        getInitialData: function () {
            var sToday = _getTodayYMD();
            return {
                // Form Header / Movement Context
                movementType: "261",
                movementTypeName: "Goods Issue for Order",
                postingDate: sToday,
                documentDate: sToday,
                headerText: "",

                // Planned vs Unplanned Mode Toggle
                isUnplanned: false,

                // Reservation Assignment (Mandatory in planned mode)
                reservationNo: "",
                reservationItem: "",

                // Order/Network: populated from reservation in planned mode; user-entered in unplanned mode.
                orderNo: "",

                // Material & Location - derived from the resolved reservation item, read-only in planned mode
                material: "",
                materialName: "",
                plant: "",
                storageLocation: "",

                // Quantity & Unit
                quantity: 1,
                unit: "",
                isUnitEditable: false,
                openQty: null,

                // Batch Management
                isBatchManaged: false,
                batch: "",
                availableBatches: [],

                // Planned-reservation linkage (populated when completing from Open Reservations list)
                fromReservation: false,

                // Serial Management
                isSerialManaged: false,
                serialInput: "",
                serialNumbers: [],

                // Scan-to-complete (unit-managed reservations: serial or storage-unit)
                scanEnabled: false,
                scanUnitKind: "",           // "SERIAL" | "SU" (derived per scan) - label only
                scanInput: "",
                scannedUnits: [],           // [{ key, storageUnit, barcode, material, plant, storageLocation, serial, isSerial, qty, unit, batch }]
                scannedQty: 0,              // quantity covered by scannedUnits (see scannedQty())
                requiredScanCount: 0,       // quantity the scans must cover (open reservation quantity)
                suggestedUnits: [],         // suggested SUs (FEFO/FIFO order)
                suggestedUnitsCount: 0,     // count of suggested SUs
                availableUnits: [],         // all valid SUs in stock from SAP
                partialInstruction: "",     // partial drum instruction before scanning e.g. "18 kg from SU X"
                excludedUnconfirmedNote: "",// note on SUs excluded due to unconfirmed posting
                excludedUnconfirmedCount: 0,
                noSuDataGap: "",            // gap message when no SU data exists in SAP
                lastScanState: "None",      // MessageStrip state: Success | Error | Warning | None
                lastScanText: "",

                // Reservation Item lookup state
                itemLoading: false,

                // Process & Execution States
                busy: false,
                postingStatus: "",
                hasPosted: false,
                postedDocument: "",
                postedYear: "",
                postingAttemptDocument: "",
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
                    scannedUnits: ""
                },
                isValid: false
            };
        },

        /**
         * Create a new UI5 JSONModel initialized with Goods Issue 261 data
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
                scannedUnits: ""
            };
            if (oData && oData.isUnplanned) {
                errors.orderNo = "";
            }
            var bValid = true;

            if (!oData.isUnplanned) {
                // 1. Reservation No (Mandatory in planned mode)
                var sResv = (oData.reservationNo != null) ? String(oData.reservationNo).trim() : "";
                if (!sResv) {
                    errors.reservationNo = "Reservation Number is required for Movement 261";
                    bValid = false;
                } else if (sResv.length > 10) {
                    errors.reservationNo = "Reservation Number cannot exceed 10 characters";
                    bValid = false;
                }

                // 2. Reservation Item (Mandatory in planned mode)
                var sItem = (oData.reservationItem != null) ? String(oData.reservationItem).trim() : "";
                if (!sItem) {
                    errors.reservationItem = "Reservation Item is required for Movement 261";
                    bValid = false;
                } else if (sItem.length > 4) {
                    errors.reservationItem = "Reservation Item cannot exceed 4 characters";
                    bValid = false;
                }
            } else {
                // Unplanned mode: Order Number is mandatory
                var sOrder = (oData.orderNo != null) ? String(oData.orderNo).trim() : "";
                if (!sOrder) {
                    errors.orderNo = "Order Number is required for unplanned Goods Issue";
                    bValid = false;
                } else if (sOrder.length > 12) {
                    errors.orderNo = "Order Number cannot exceed 12 characters";
                    bValid = false;
                }
            }

            // 3. Material
            var sMat = (oData.material != null) ? String(oData.material).trim() : "";
            if (!sMat) {
                errors.material = oData.isUnplanned ? "Material number is required" : "Material is required - select a Reservation Item first";
                bValid = false;
            }

            // 4. Plant (4 chars)
            var sPlant = (oData.plant != null) ? String(oData.plant).trim().toUpperCase() : "";
            if (!sPlant) {
                errors.plant = oData.isUnplanned ? "Plant is required" : "Plant is required - select a Reservation Item first";
                bValid = false;
            } else if (sPlant.length !== 4) {
                errors.plant = "Plant must be 4 characters";
                bValid = false;
            }

            // 5. Storage Location (4 chars)
            var sSLoc = (oData.storageLocation != null) ? String(oData.storageLocation).trim().toUpperCase() : "";
            if (!sSLoc) {
                errors.storageLocation = oData.isUnplanned ? "Storage Location is required" : "Storage Location is required - select a Reservation Item first";
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
                } else if (oData.fromReservation && oData.openQty != null && nQty > Number(oData.openQty)) {
                    // Partial issue is allowed, more than the open reservation quantity is not.
                    errors.quantity = "Quantity cannot exceed the open reservation quantity (" + oData.openQty + ")";
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

            // Scan-to-complete (Required if unit-managed reservation line)
            if (oData.scanEnabled) {
                var aScannedUnits = Array.isArray(oData.scannedUnits) ? oData.scannedUnits : [];
                var nScannedQty = this.scannedQty(oData);
                var nRequiredUnits = Number(oData.requiredScanCount) || 0;

                if (aScannedUnits.length === 0) {
                    errors.scannedUnits = "At least one Storage Unit must be scanned";
                    bValid = false;
                } else {
                    var seenSu = {};
                    for (var k = 0; k < aScannedUnits.length; k++) {
                        var suObj = aScannedUnits[k];
                        var suKey = suObj.key || suObj.storageUnit || suObj.barcode;
                        if (seenSu[suKey]) {
                            errors.scannedUnits = "Storage Unit " + suKey + " has already been scanned.";
                            bValid = false;
                            break;
                        }
                        seenSu[suKey] = true;

                        var uMat = String(suObj.material || "").trim().toUpperCase();
                        var expMat = String(oData.material || "").trim().toUpperCase();
                        if (expMat && uMat && uMat !== expMat) {
                            errors.scannedUnits = "Wrong material: scanned unit belongs to " + uMat + ", expected " + expMat + ".";
                            bValid = false;
                            break;
                        }
                        var uPlant = String(suObj.plant || "").trim().toUpperCase();
                        var expPlant = String(oData.plant || "").trim().toUpperCase();
                        if (expPlant && uPlant && uPlant !== expPlant) {
                            errors.scannedUnits = "Wrong plant: scanned unit is in plant " + uPlant + ", expected " + expPlant + ".";
                            bValid = false;
                            break;
                        }
                        var uSLoc = String(suObj.storageLocation || "").trim().toUpperCase();
                        var expSLoc = String(oData.storageLocation || "").trim().toUpperCase();
                        if (expSLoc && uSLoc && uSLoc !== expSLoc) {
                            errors.scannedUnits = "Wrong storage location: scanned unit is in storage location " + uSLoc + ", expected " + expSLoc + ".";
                            bValid = false;
                            break;
                        }
                    }

                    if (!errors.scannedUnits) {
                        var nDiff = Math.abs(nScannedQty - nRequiredUnits);
                        if (nDiff > 0.001) {
                            if (nScannedQty < nRequiredUnits) {
                                errors.scannedUnits = "Required " + nRequiredUnits + " units scanned, currently " + nScannedQty;
                            } else {
                                errors.scannedUnits = "Scanned quantity (" + nScannedQty + ") exceeds required quantity (" + nRequiredUnits + "). Over-issue blocked.";
                            }
                            bValid = false;
                        }
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
            oData.unit = oItem.Unit || "";
            oData.isUnitEditable = !oItem.Unit;
            oData.isSerialManaged = !!oItem.IsSerialManaged;
            oData.isBatchManaged = !!(oItem.Batch || oItem.BatchStatusState);
            oData.batch = oItem.Batch || "";
            oData.openQty = (oItem.OpenQty !== undefined && oItem.OpenQty !== null) ? oItem.OpenQty : null;
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
         * Suggest SUs (FEFO/FIFO order) until the required quantity is met.
         * Never assumes fixed drum sizes (handles 6-drum, 8-drum, variable weights, partial last drum).
         * @param {Array<Object>} aAvailableUnits - Available stock units sorted by FEFO/FIFO
         * @param {number} nRequiredQty - Target quantity to cover
         * @returns {Array<Object>}
         */
        calculateSuggestedUnits: function (aAvailableUnits, nRequiredQty) {
            if (!Array.isArray(aAvailableUnits) || aAvailableUnits.length === 0 || !(nRequiredQty > 0)) {
                return [];
            }
            var aSuggested = [];
            var nAccumulated = 0;
            for (var i = 0; i < aAvailableUnits.length; i++) {
                var su = aAvailableUnits[i];
                var nQty = Number(su.AvailableStock != null ? su.AvailableStock : (su.CurrentStock != null ? su.CurrentStock : (su.SuStockQty != null ? su.SuStockQty : su.qty))) || 0;
                if (nQty <= 0) continue;
                var nRemainingNeeded = Math.round((nRequiredQty - nAccumulated) * 1000) / 1000;
                if (nRemainingNeeded <= 0) break;

                var isPartial = nQty > nRemainingNeeded;
                var nSuggestedQty = isPartial ? nRemainingNeeded : nQty;

                aSuggested.push(Object.assign({}, su, {
                    SuggestedQty: nSuggestedQty,
                    IsPartial: isPartial
                }));
                nAccumulated += nSuggestedQty;
                if (nAccumulated >= nRequiredQty - 1e-9) {
                    break;
                }
            }
            return aSuggested;
        },

        /**
         * Derive partial drum instruction string for display before scanning
         * e.g. "18 kg from SU DRUM_10"
         * @param {Array<Object>} aSuggested - Suggested stock units
         * @returns {string}
         */
        getPartialInstruction: function (aSuggested) {
            if (!Array.isArray(aSuggested) || aSuggested.length === 0) {
                return "";
            }
            var oPartial = aSuggested.find(function (su) {
                return su && (su.IsPartial === true || su.isPartial === true);
            });
            if (!oPartial) {
                return "";
            }
            var sQty = String(oPartial.SuggestedQty != null ? oPartial.SuggestedQty : "");
            var sUnit = (oPartial.Unit || "").toLowerCase();
            var sSu = String(oPartial.StorageUnit || "").trim();
            var sUnitPart = sUnit ? " " + sUnit : "";
            return sQty + sUnitPart + " from SU " + sSu;
        },

        /**
         * Apply a resolveStockUnit result for ONE scan against the current line. Auto-detects serial
         * vs storage unit, gives clear pass/fail feedback (matched / wrong material / already issued /
         * duplicate / quantity exceeded) and, on a match, appends to scannedUnits. Never a silent fill.
         * Supports explicit partial quantity on the last SU capped at remaining open quantity.
         * @param {Object} oData model data
         * @param {Object} oRes StockUnitResolution from resolveStockUnit
         * @param {string} sBarcode the raw scanned barcode
         * @returns {{ ok: boolean, state: string, text: string }}
         */
        applyScanResolution: function (oData, oRes, sBarcode) {
            var sExpectedMat = String(oData.material || "").trim().toUpperCase();
            var sExpectedPlant = String(oData.plant || "").trim().toUpperCase();
            var sExpectedSLoc = String(oData.storageLocation || "").trim().toUpperCase();
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
            var sResPlant = String(oRes.Plant || "").trim().toUpperCase();
            if (sExpectedPlant && sResPlant && sResPlant !== sExpectedPlant) {
                return { ok: false, state: "Error", text: "Wrong plant: scanned unit is in plant " + sResPlant + ", expected " + sExpectedPlant + "." };
            }
            var sResSLoc = String(oRes.StorageLocation || "").trim().toUpperCase();
            if (sExpectedSLoc && sResSLoc && sResSLoc !== sExpectedSLoc) {
                return { ok: false, state: "Error", text: "Wrong storage location: scanned unit is in storage location " + sResSLoc + ", expected " + sExpectedSLoc + "." };
            }
            var sSerial = String(oRes.DeterminedSerial || oRes.SerialNumber || "").trim();
            var sKey = sSerial || sScan;
            if (aScanned.some(function (u) { return u.key === sKey || u.barcode === sScan || (u.storageUnit && u.storageUnit === sKey); })) {
                return { ok: false, state: "Warning", text: "Storage Unit " + sKey + " was already scanned." };
            }

            var nUnitQty = Number(oRes.SuStockQty != null ? oRes.SuStockQty : (oRes.CurrentStock != null ? oRes.CurrentStock : (oRes.AvailableStock != null ? oRes.AvailableStock : 0))) || 0;
            if (nUnitQty <= 0 && !oRes.IsSerialManaged) {
                nUnitQty = 1;
            }

            var nCurrentScanned = this.scannedQty(oData);
            if (nRequired > 0 && nCurrentScanned >= nRequired - 1e-9) {
                return { ok: false, state: "Warning", text: "Quantity exceeded: " + nRequired + " already covered by the scanned unit(s) for this line." };
            }

            var nIssuedQty = nUnitQty;
            var bIsPartial = false;
            if (nRequired > 0 && (nCurrentScanned + nUnitQty) > (nRequired + 1e-9)) {
                if (oRes.IsSerialManaged) {
                    return { ok: false, state: "Error", text: "Over-issue blocked: serial unit cannot be partially issued." };
                }
                var nRemaining = Math.round((nRequired - nCurrentScanned) * 1000) / 1000;
                nIssuedQty = nRemaining;
                bIsPartial = true;
            }

            // One goods issue line posts one batch: a unit from another batch cannot be mixed in.
            var sUnitBatch = String(oRes.DeterminedBatch || oRes.Batch || "").trim().toUpperCase();
            var sLineBatch = String(oData.batch || "").trim().toUpperCase();
            if (sUnitBatch && sLineBatch && sUnitBatch !== sLineBatch) {
                return { ok: false, state: "Error", text: "Unit " + sKey + " is batch " + sUnitBatch + ", but this issue is for batch " + sLineBatch + "." };
            }

            aScanned.push({
                key: sKey,
                storageUnit: sKey,
                barcode: sScan,
                material: sResMat || sExpectedMat,
                plant: sResPlant || sExpectedPlant,
                storageLocation: sResSLoc || sExpectedSLoc,
                serial: sSerial,
                isSerial: !!oRes.IsSerialManaged,
                qty: nIssuedQty,
                availableStock: nUnitQty,
                isPartial: bIsPartial,
                unit: oRes.BaseUnit || oRes.Unit || oData.unit || "",
                batch: sUnitBatch
            });
            oData.scannedUnits = aScanned;
            if (sUnitBatch && !sLineBatch) {
                oData.batch = sUnitBatch;
                oData.isBatchManaged = true;
            }
            var sLabel = sSerial ? ("serial " + sSerial) : ("unit " + sKey);
            var sPartialNote = bIsPartial ? (" (partial " + nIssuedQty + " of " + nUnitQty + ")") : "";
            return { ok: true, state: "Success", text: "Matched " + sLabel + sPartialNote + " (" + this.scannedQty(oData) + " of " + nRequired + ")." };
        },

        /**
         * Quantity covered by the scanned units: a serial covers 1, a storage unit covers the stock
         * it holds (a unit whose stock is unknown counts as 1).
         * @param {Object} oData model data
         * @returns {number}
         */
        scannedQty: function (oData) {
            return (Array.isArray(oData.scannedUnits) ? oData.scannedUnits : []).reduce(function (nSum, u) {
                return nSum + (!u.isSerial && u.qty > 0 ? u.qty : 1);
            }, 0);
        },

        /**
         * Build clean backend payload for postGoodsIssue
         * @param {Object} oData
         * @returns {Object}
         */
        toBackendPayload: function (oData) {
            var sResv = oData.isUnplanned ? "" : String(oData.reservationNo || "").trim();
            var rawItem = oData.reservationItem != null ? String(oData.reservationItem).trim() : "";
            var sItem = (oData.isUnplanned || !rawItem) ? "" : rawItem.padStart(4, "0");
            var sOrder = String(oData.orderNo || "").trim();
            var sMat = String(oData.material || "").trim().toUpperCase();
            var sPlant = String(oData.plant || "").trim().toUpperCase();
            var sSLoc = String(oData.storageLocation || "").trim().toUpperCase();
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

            var aStorageUnits = [];
            var nLastSuQty = null;
            if (oData.scanEnabled && Array.isArray(oData.scannedUnits)) {
                aStorageUnits = oData.scannedUnits
                    .filter(function (u) { return !u.isSerial && (u.storageUnit || u.barcode || u.key); })
                    .map(function (u) { return String(u.storageUnit || u.barcode || u.key).trim(); });
                var lastUnit = oData.scannedUnits[oData.scannedUnits.length - 1];
                if (lastUnit && !lastUnit.isSerial && lastUnit.isPartial && lastUnit.qty > 0) {
                    nLastSuQty = lastUnit.qty;
                }
            }

            var oPayload = {
                MovementType: "261",
                ReservationNo: sResv,
                ReservationItem: sItem,
                OrderNo: sOrder,
                Material: sMat,
                Plant: sPlant,
                StorageLocation: sSLoc,
                IssueQty: Number(oData.quantity),
                Unit: sUnit,
                Batch: sBatch,
                PostingDate: oData.postingDate,
                DocumentDate: oData.documentDate,
                HeaderText: oData.headerText ? String(oData.headerText).trim() : (sResv ? ("GI Resv " + sResv) : ("GI Order " + sOrder)),
                SerialNumbers: aSerials,
                StorageUnits: aStorageUnits
            };

            if (nLastSuQty != null) {
                oPayload.LastStorageUnitQty = nLastSuQty;
            }

            // Unique per user posting attempt: lets the backend treat a second deliberate
            // posting of the same item/quantity/day as a new attempt instead of replaying
            // the first attempt's outcome.
            oPayload.ClientAttemptId = ("GIA" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).toUpperCase();

            return oPayload;
        }
    };

    return GoodsIssue261Model;
});
