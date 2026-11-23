(function () {
    "use strict";

    var PurchaseOrderSupplierDefaults = {
        /**
         * Derives configured commercial terms (Currency, Payment Terms, Incoterms, Incoterms Location)
         * from supplier master data when available.
         *
         * Rules:
         * 1. Derives Currency, Payment Terms, Incoterms, Incoterms Location where available.
         * 2. Never invents defaults: If not configured, field remains empty.
         * 3. Never overwrites user-entered values unexpectedly: checks userModified map.
         * 4. Shows clear validation when a default cannot be derived.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sSupplier
         * @param {Object} [oDefaults]
         * @param {Object} [oValidator]
         * @param {Function} [fnUpdateStatus]
         * @returns {Object} Report of applied fields, preserved fields, and derivation warnings
         */
        deriveSupplierDefaults: function (oModel, sSupplier, oDefaults, oValidator, fnUpdateStatus) {
            if (!oModel) return null;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            if (!oData || !oData.header) return null;

            var oHeader = oData.header;
            var oUserModified = oData.userModified || {};
            var oConfigDerived = oData.configDerived || {};
            var oDefs = oDefaults || {};

            var oReport = {
                applied: {},
                preserved: {},
                missing: []
            };

            if (!sSupplier || String(sSupplier).trim() === "") {
                return oReport;
            }

            var fnValidate = function (m, f, v) {
                if (oValidator && typeof oValidator.validateSingleField === "function") {
                    oValidator.validateSingleField(m, f, v);
                }
            };

            var fnSetValidation = function (m, f, s, t) {
                if (oValidator && typeof oValidator.setFieldValidation === "function") {
                    oValidator.setFieldValidation(m, f, s, t);
                }
            };

            // 1. Currency Derivation
            if (oDefs.Currency && String(oDefs.Currency).trim() !== "") {
                if (!oUserModified.Currency || !oHeader.Currency) {
                    var sCurr = String(oDefs.Currency).trim().toUpperCase();
                    oHeader.Currency = sCurr;
                    oConfigDerived.Currency = true;
                    oReport.applied.Currency = sCurr;
                    fnValidate(oModel, "Currency", sCurr);
                } else {
                    oReport.preserved.Currency = oHeader.Currency;
                }
            } else {
                if (!oHeader.Currency) {
                    oReport.missing.push("Currency");
                    fnSetValidation(oModel, "Currency", "Information", "Currency could not be derived from supplier master; please enter manually.");
                }
            }

            // 2. Payment Terms Derivation
            if (oDefs.PaymentTerms && String(oDefs.PaymentTerms).trim() !== "") {
                if (!oUserModified.PaymentTerms || !oHeader.PaymentTerms) {
                    var sPayTerms = String(oDefs.PaymentTerms).trim().toUpperCase();
                    oHeader.PaymentTerms = sPayTerms;
                    oConfigDerived.PaymentTerms = true;
                    oReport.applied.PaymentTerms = sPayTerms;
                    fnValidate(oModel, "PaymentTerms", sPayTerms);
                } else {
                    oReport.preserved.PaymentTerms = oHeader.PaymentTerms;
                }
            } else {
                if (!oHeader.PaymentTerms) {
                    oReport.missing.push("PaymentTerms");
                    fnSetValidation(oModel, "PaymentTerms", "Information", "No payment terms configured for this supplier; please select if required.");
                }
            }

            // 3. Incoterms Classification Derivation
            if (oDefs.IncotermsClassification && String(oDefs.IncotermsClassification).trim() !== "") {
                if (!oUserModified.IncotermsClassification || !oHeader.IncotermsClassification) {
                    var sInco = String(oDefs.IncotermsClassification).trim().toUpperCase();
                    oHeader.IncotermsClassification = sInco;
                    oConfigDerived.IncotermsClassification = true;
                    oReport.applied.IncotermsClassification = sInco;
                    fnValidate(oModel, "IncotermsClassification", sInco);
                } else {
                    oReport.preserved.IncotermsClassification = oHeader.IncotermsClassification;
                }
            }

            // 4. Incoterms Location 1 Derivation
            if (oDefs.IncotermsLocation1 && String(oDefs.IncotermsLocation1).trim() !== "") {
                if (!oUserModified.IncotermsLocation1 || !oHeader.IncotermsLocation1) {
                    var sIncoLoc = String(oDefs.IncotermsLocation1).trim();
                    oHeader.IncotermsLocation1 = sIncoLoc;
                    oConfigDerived.IncotermsLocation1 = true;
                    oReport.applied.IncotermsLocation1 = sIncoLoc;
                    fnValidate(oModel, "IncotermsLocation1", sIncoLoc);
                } else {
                    oReport.preserved.IncotermsLocation1 = oHeader.IncotermsLocation1;
                }
            } else if (oHeader.IncotermsClassification && !oHeader.IncotermsLocation1) {
                oReport.missing.push("IncotermsLocation1");
                fnSetValidation(oModel, "IncotermsLocation1", "Error", "Incoterms Location 1 is required when Incoterms is specified.");
            }

            var bAnyApplied = Object.keys(oReport.applied).length > 0;
            var bDerivedFlag = bAnyApplied || !!oDefs.derived;
            var sLastPo = oDefs.lastPurchaseOrder || "";
            var sSourceText = "";
            var sMessageText = "";
            if (bDerivedFlag) {
                sSourceText = sLastPo ? ("from last PO " + sLastPo) : (oDefs.source || "from last PO");
                sMessageText = "Commercial terms derived from last PO" + (sLastPo ? " (" + sLastPo + ")" : "") + ". Verify before submitting.";
            }

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/header", oHeader);
                oModel.setProperty("/userModified", oUserModified);
                oModel.setProperty("/configDerived", oConfigDerived);
                oModel.setProperty("/supplierDefaultsDerived", bDerivedFlag);
                oModel.setProperty("/supplierDefaultsSource", sSourceText);
                oModel.setProperty("/supplierDefaultsLastPo", sLastPo);
                oModel.setProperty("/supplierDefaultsMessage", sMessageText);
            } else {
                oData.supplierDefaultsDerived = bDerivedFlag;
                oData.supplierDefaultsSource = sSourceText;
                oData.supplierDefaultsLastPo = sLastPo;
                oData.supplierDefaultsMessage = sMessageText;
            }

            oReport.derived = bDerivedFlag;
            oReport.source = sSourceText;
            oReport.lastPurchaseOrder = sLastPo;

            if (typeof fnUpdateStatus === "function") {
                fnUpdateStatus(oModel);
            }
            return oReport;
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = PurchaseOrderSupplierDefaults;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return PurchaseOrderSupplierDefaults;
        });
    }
})();
