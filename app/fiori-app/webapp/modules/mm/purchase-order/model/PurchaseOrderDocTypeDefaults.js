(function () {
    "use strict";

    var _rules = null;
    if (typeof require === "function") {
        try {
            _rules = require("./PurchaseOrderRules");
        } catch (e) {}
    }

    var DEFAULT_DOC_TYPE_FALLBACK = {
        code: "ZDOM",
        text: "Dom. Aether In.LTD."
    };

    var PurchaseOrderDocTypeDefaults = {
        DEFAULT_DOC_TYPE_FALLBACK: DEFAULT_DOC_TYPE_FALLBACK,

        /**
         * Resolves the active default Document Type and description.
         *
         * @param {Object} [oConfigData]
         * @param {{ code: string, text: string }} [oFallback]
         * @returns {{ code: string, text: string }}
         */
        getDefaultDocType: function (oConfigData, oFallback) {
            var oDefault = oFallback || DEFAULT_DOC_TYPE_FALLBACK;
            if (oConfigData && Array.isArray(oConfigData.documentTypes)) {
                var oMatch = oConfigData.documentTypes.find(function (dt) {
                    return dt && dt.PurchasingDocumentType === oDefault.code;
                });
                if (oMatch) {
                    return {
                        code: oMatch.PurchasingDocumentType,
                        text: oMatch.PurchasingDocumentType_Text || oDefault.text
                    };
                }
            }
            return oDefault;
        },

        /**
         * Sets and validates Document Type on the model, enforcing domain rules (Z-prefix and max length 4).
         * Reconciles header, line items, and dynamic UI rules according to the PO Type's configuration.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sDocType
         * @param {Object} [oConfigData]
         * @param {string} [sDocTypeText]
         * @param {Object} [oValidator]
         * @param {Function} [fnUpdateStatus]
         * @param {Function} [fnMarkUserModified]
         * @param {Function} [fnApplyConfigDefaults]
         * @param {{ code: string, text: string }} [oDefaultDocType]
         * @param {Object} [oRules]
         */
        setDocumentType: function (oModel, sDocType, oConfigData, sDocTypeText, oValidator, fnUpdateStatus, fnMarkUserModified, fnApplyConfigDefaults, oDefaultDocType, oRules) {
            if (!oModel) return;
            var oEffectiveRules = oRules || _rules;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var sTrimmed = String(sDocType || "").trim().toUpperCase();

            if (typeof oConfigData === "string" && !sDocTypeText) {
                sDocTypeText = oConfigData;
                oConfigData = null;
            }

            var fnSetProperty = function (sPath, vVal) {
                if (typeof oModel.setProperty === "function") {
                    oModel.setProperty(sPath, vVal);
                } else if (oData) {
                    var aParts = sPath.replace(/^\//, "").split("/");
                    var oTarget = oData;
                    for (var i = 0; i < aParts.length - 1; i++) {
                        if (!oTarget[aParts[i]]) oTarget[aParts[i]] = {};
                        oTarget = oTarget[aParts[i]];
                    }
                    oTarget[aParts[aParts.length - 1]] = vVal;
                }
            };

            var fnMark = fnMarkUserModified || function (m, f, v) {
                if (typeof m.setProperty === "function") {
                    m.setProperty("/userModified/" + f, v);
                    if (v) m.setProperty("/configDerived/" + f, false);
                } else if (oData) {
                    oData.userModified = oData.userModified || {};
                    oData.userModified[f] = v;
                    if (v && oData.configDerived) oData.configDerived[f] = false;
                }
            };

            var fnValidate = function (m, f) {
                if (oValidator && typeof oValidator.validateSingleField === "function") {
                    oValidator.validateSingleField(m, f);
                }
            };

            if (!sTrimmed) {
                fnMark(oModel, "PurchaseOrderType", false);
                if (oConfigData && typeof fnApplyConfigDefaults === "function") {
                    fnApplyConfigDefaults(oModel, oConfigData);
                } else {
                    var oDefaultDoc = this.getDefaultDocType(oConfigData, oDefaultDocType);
                    fnSetProperty("/header/PurchaseOrderType", oDefaultDoc.code);
                    fnSetProperty("/header/PurchaseOrderTypeText", oDefaultDoc.text);
                    fnSetProperty("/errors/PurchaseOrderType", { state: "None", text: "" });
                }
                fnValidate(oModel, "PurchaseOrderType");
            } else {
                fnMark(oModel, "PurchaseOrderType", true);
                var oValidation = oValidator && typeof oValidator.validateDocType === "function"
                    ? oValidator.validateDocType(sTrimmed)
                    : { valid: sTrimmed.startsWith("Z") && sTrimmed.length <= 4, state: "None", text: "" };
                if (oValidation.valid) {
                    fnSetProperty("/header/PurchaseOrderType", sTrimmed);
                    if (sDocTypeText !== undefined && sDocTypeText !== null) {
                        fnSetProperty("/header/PurchaseOrderTypeText", sDocTypeText);
                    }
                    fnSetProperty("/errors/PurchaseOrderType", { state: "None", text: "" });

                    // Reconcile dynamic UI rules and header/item defaults for PO Type
                    var oPoRule = (oEffectiveRules && oEffectiveRules.PO_TYPES && oEffectiveRules.PO_TYPES[sTrimmed]) || null;
                    if (oPoRule) {
                        var oUiRules = {
                            materialRequired: oPoRule.materialRequired !== false,
                            storageLocationRequired: oPoRule.storageLocationRequired !== false,
                            isService: !!oPoRule.isService,
                            isStockTransfer: !!oPoRule.isStockTransfer,
                            isReturn: !!oPoRule.isReturn,
                            isSubcontracting: !!oPoRule.isSubcontracting,
                            showAccountAssignment: !!(oPoRule.allowedAcctAssignmentCategories && oPoRule.allowedAcctAssignmentCategories.some(function (c) { return c !== ""; })),
                            showItemCategory: true,
                            allowedItemCategories: oPoRule.allowedItemCategories || ["0"],
                            allowedAcctAssignmentCategories: oPoRule.allowedAcctAssignmentCategories || [""]
                        };
                        fnSetProperty("/uiRules", oUiRules);

                        var oHeader = (oData && oData.header) || {};

                        // Reconcile Company Code
                        if (oPoRule.allowedCompanyCodes && oPoRule.allowedCompanyCodes.length > 0) {
                            var sDefCo = oPoRule.defaultCompanyCode || oPoRule.allowedCompanyCodes[0];
                            if (!oHeader.CompanyCode || !oPoRule.allowedCompanyCodes.includes(oHeader.CompanyCode) || (!oData.userModified || !oData.userModified.CompanyCode)) {
                                fnSetProperty("/header/CompanyCode", sDefCo);
                                fnValidate(oModel, "CompanyCode");
                            }
                        }

                        // Reconcile Purchasing Organization
                        if (oPoRule.allowedPurchOrgs && oPoRule.allowedPurchOrgs.length > 0) {
                            var sDefPo = oPoRule.defaultPurchOrg || oPoRule.allowedPurchOrgs[0];
                            if (!oHeader.PurchasingOrganization || !oPoRule.allowedPurchOrgs.includes(oHeader.PurchasingOrganization) || (!oData.userModified || !oData.userModified.PurchasingOrganization)) {
                                fnSetProperty("/header/PurchasingOrganization", sDefPo);
                                fnValidate(oModel, "PurchasingOrganization");
                            }
                        }

                        // Reconcile Currency
                        if (oPoRule.allowedCurrencies && oPoRule.allowedCurrencies.length > 0) {
                            var sDefCurr = oPoRule.defaultCurrency || oPoRule.allowedCurrencies[0];
                            if (!oHeader.Currency || !oPoRule.allowedCurrencies.includes(oHeader.Currency) || (!oData.userModified || !oData.userModified.Currency)) {
                                fnSetProperty("/header/Currency", sDefCurr);
                                fnValidate(oModel, "Currency");
                            }
                        }

                        // Reconcile Supplier if current supplier account group conflicts
                        if (oPoRule.supplierAccountGroup) {
                            var sCurrentGrp = (oData && oData.header && oData.header.SupplierAccountGroup) || "";
                            if (sCurrentGrp && sCurrentGrp !== oPoRule.supplierAccountGroup) {
                                fnSetProperty("/header/Supplier", "");
                                fnSetProperty("/header/SupplierName", "");
                                fnSetProperty("/header/SupplierAccountGroup", "");
                                fnValidate(oModel, "Supplier");
                            }
                        }

                        // Reconcile Items
                        var aItems = (oData && oData.items) || [];
                        aItems.forEach(function (item) {
                            if (oPoRule.allowedItemCategories && oPoRule.allowedItemCategories.length > 0) {
                                if (!item.PurchaseOrderItemCategory || !oPoRule.allowedItemCategories.includes(item.PurchaseOrderItemCategory) || (item.PurchaseOrderItemCategory === "0" && oPoRule.defaultItemCategory && oPoRule.defaultItemCategory !== "0")) {
                                    item.PurchaseOrderItemCategory = oPoRule.defaultItemCategory || oPoRule.allowedItemCategories[0];
                                }
                            }
                            if (oPoRule.allowedAcctAssignmentCategories) {
                                if (!item.AccountAssignmentCategory || !oPoRule.allowedAcctAssignmentCategories.includes(item.AccountAssignmentCategory) || (item.AccountAssignmentCategory === "" && oPoRule.defaultAcctAssignmentCategory)) {
                                    item.AccountAssignmentCategory = oPoRule.defaultAcctAssignmentCategory || "";
                                }
                            }
                            if (oPoRule.allowedPlantPrefix && item.Plant && !String(item.Plant).startsWith(oPoRule.allowedPlantPrefix)) {
                                item.Plant = "";
                                item.StorageLocation = "";
                            }
                        });
                        fnSetProperty("/items", aItems);
                    }

                    fnValidate(oModel, "PurchaseOrderType");
                } else {
                    fnSetProperty("/header/PurchaseOrderType", "");
                    fnSetProperty("/header/PurchaseOrderTypeText", "");
                    fnSetProperty("/errors/PurchaseOrderType", {
                        state: "Error",
                        text: oValidation.text
                    });
                }
            }

            if (typeof fnUpdateStatus === "function") {
                fnUpdateStatus(oModel);
            }
        },

        /**
         * Handles live change input for Document Type, validating domain prefix on keystroke.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sVal
         * @param {Object} [oValidator]
         * @param {Function} [fnUpdateStatus]
         * @param {Function} [fnMarkUserModified]
         */
        updateDocTypeLive: function (oModel, sVal, oValidator, fnUpdateStatus, fnMarkUserModified) {
            if (!oModel) return;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var fnMark = fnMarkUserModified || function (m, f, v) {
                if (typeof m.setProperty === "function") {
                    m.setProperty("/userModified/" + f, v);
                    if (v) m.setProperty("/configDerived/" + f, false);
                } else if (oData) {
                    oData.userModified = oData.userModified || {};
                    oData.userModified[f] = v;
                    if (v && oData.configDerived) oData.configDerived[f] = false;
                }
            };

            var bIsValid = oValidator && typeof oValidator.isValidDocType === "function"
                ? oValidator.isValidDocType
                : function (s) { var v = String(s || "").trim().toUpperCase(); return v.startsWith("Z") && v.length <= 4; };

            if (sVal !== null && sVal !== undefined) {
                fnMark(oModel, "PurchaseOrderType", true);
                var sTrim = String(sVal).trim().toUpperCase();
                if (bIsValid(sTrim)) {
                    if (typeof oModel.setProperty === "function") {
                        oModel.setProperty("/header/PurchaseOrderType", sTrim);
                        oModel.setProperty("/errors/PurchaseOrderType", { state: "None", text: "" });
                    } else if (oData && oData.header) {
                        oData.header.PurchaseOrderType = sTrim;
                        if (oData.errors) oData.errors.PurchaseOrderType = { state: "None", text: "" };
                    }
                }
            }

            if (oValidator && typeof oValidator.validateSingleField === "function") {
                oValidator.validateSingleField(oModel, "PurchaseOrderType");
            }
            if (typeof fnUpdateStatus === "function") {
                fnUpdateStatus(oModel);
            }
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = PurchaseOrderDocTypeDefaults;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return PurchaseOrderDocTypeDefaults;
        });
    }
})();
