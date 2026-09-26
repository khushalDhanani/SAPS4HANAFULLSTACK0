(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        var PurchaseOrderRules = require("./PurchaseOrderRules");
        module.exports = factory(PurchaseOrderRules);
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define([
            "./PurchaseOrderRules"
        ], factory);
    }
})(this, function (InjectedRules) {
    "use strict";

    var _rules = InjectedRules;
    if (!_rules && typeof require === "function") {
        try {
            _rules = require("./PurchaseOrderRules");
        } catch (e) {}
    }

    var DEFAULT_DOC_TYPE_FALLBACK = {
        code: "ZDOM",
        text: "Dom. Aether In.LTD."
    };

    var PurchaseOrderDefaults = {
        /** Reference to authoritative schema rules */
        rules: _rules,

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
         * Applies Material master data configuration to a specific line item:
         * Sets Material, Description (if not already entered), and directly sets UnitOfMeasure
         * from the Material's master data Base Unit of Measure configuration (MaterialBaseUnit).
         * Clears any validation errors on Material and UnitOfMeasure.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string|number} vItem Item index or binding path
         * @param {Object} oMaterialData Material master data object containing Material, MaterialBaseUnit, etc.
         * @param {boolean} [bForce]
         * @returns {Object} Report of applied fields
         */
        applyMaterialDefaults: function (oModel, vItem, oMaterialData, bForce) {
            if (!oModel || vItem === undefined || vItem === null || !oMaterialData) return {};
            var sPath = typeof vItem === "number" ? "/items/" + vItem : (String(vItem).indexOf("/") === 0 ? vItem : "/items/" + vItem);
            var oReport = {};

            if (oMaterialData.Material) {
                oModel.setProperty(sPath + "/Material", oMaterialData.Material);
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
                oReport.Material = oMaterialData.Material;
            }

            var sDesc = oMaterialData.MaterialName || oMaterialData.Material_Text;
            var sCurrentDesc = oModel.getProperty(sPath + "/PurchaseOrderItemText");
            if (sDesc && (bForce || !sCurrentDesc)) {
                oModel.setProperty(sPath + "/PurchaseOrderItemText", sDesc);
                oReport.PurchaseOrderItemText = sDesc;
            }

            var sUnit = oMaterialData.MaterialBaseUnit || oMaterialData.BaseUnit || oMaterialData.UnitOfMeasure;
            if (sUnit) {
                oModel.setProperty(sPath + "/UnitOfMeasure", sUnit);
                oModel.setProperty(sPath + "/errors/UnitOfMeasure", { state: "None", text: "" });
                oReport.UnitOfMeasure = sUnit;
            }

            if (oMaterialData.MaterialGroup) {
                oModel.setProperty(sPath + "/MaterialGroup", oMaterialData.MaterialGroup);
                oReport.MaterialGroup = oMaterialData.MaterialGroup;
            }

            if (oMaterialData.Plant && !oModel.getProperty(sPath + "/Plant")) {
                oModel.setProperty(sPath + "/Plant", oMaterialData.Plant);
                oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
                oReport.Plant = oMaterialData.Plant;
            }

            return oReport;
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
         */
        setDocumentType: function (oModel, sDocType, oConfigData, sDocTypeText, oValidator, fnUpdateStatus, fnMarkUserModified, fnApplyConfigDefaults, oDefaultDocType) {
            if (!oModel) return;
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
                    var oPoRule = (_rules && _rules.PO_TYPES && _rules.PO_TYPES[sTrimmed]) || null;
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
                        aItems.forEach(function (item, idx) {
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
        },

        /**
         * Dynamically applies configuration-driven defaults and dependencies from loaded SAP master data:
         * 1. Document Date = Today (yyyy-MM-dd)
         * 2. Document Type (e.g. ZDOM) drives applicable configuration
         * 3. Company Code = 1000 and Purchasing Organization = AE01 ONLY when confirmed valid/configured
         * 4. Strictly protects user-modified fields from unexpected overwrites
         * 5. Shows clear validation when a default cannot be derived
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {{ documentTypes?: Array, companyCodes?: Array, purchasingOrgs?: Array, purchasingGroups?: Array }} oConfigData
         * @param {{ code: string, text: string }} [oDefaultDocType]
         * @param {Object} [oValidator]
         * @param {Function} [fnUpdateStatus]
         * @returns {Object} Report of applied defaults, user preserved fields, and unconfirmed values
         */
        applyConfigurationDefaults: function (oModel, oConfigData, oDefaultDocType, oValidator, fnUpdateStatus) {
            if (!oModel) return null;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            if (!oData || !oData.header) return null;

            var oHeader = oData.header;
            var oUserModified = oData.userModified || {};
            var oConfigDerived = oData.configDerived || {};
            var oConfig = oConfigData || {};

            var aDocTypes = oConfig.documentTypes || [];
            var aCompanyCodes = oConfig.companyCodes || [];
            var aPurchOrgs = oConfig.purchasingOrgs || [];
            var aPurchGroups = oConfig.purchasingGroups || [];

            var oReport = {
                applied: {},
                skippedDueToUser: {},
                unconfirmed: []
            };

            var fnValidate = function (m, f, v) {
                if (oValidator && typeof oValidator.validateSingleField === "function") {
                    oValidator.validateSingleField(m, f, v);
                }
            };

            // 1. Document Date = Today
            var sToday = new Date().toISOString().split("T")[0];
            if (!oHeader.DocumentDate) {
                oHeader.DocumentDate = sToday;
                oReport.applied.DocumentDate = sToday;
            }

            // 2. Document Type driving applicable configuration
            var oDefaultDoc = oDefaultDocType || DEFAULT_DOC_TYPE_FALLBACK;
            var sDefaultCode = oDefaultDoc.code || "ZDOM";
            var sDefaultText = oDefaultDoc.text || "Dom. Aether In.LTD.";
            var sCurrentDocType = (oHeader.PurchaseOrderType || "").trim();
            var bDefaultAvailable = aDocTypes.some(function (dt) {
                return dt && (dt.PurchasingDocumentType === sDefaultCode);
            });

            // If Document Type is not user modified, and default is available in config, select default
            if (!oUserModified.PurchaseOrderType && bDefaultAvailable && sCurrentDocType === "") {
                oHeader.PurchaseOrderType = sDefaultCode;
                oHeader.PurchaseOrderTypeText = sDefaultText;
                sCurrentDocType = sDefaultCode;
                oConfigDerived.PurchaseOrderType = true;
                oReport.applied.PurchaseOrderType = sDefaultCode;
            } else if (oHeader.PurchaseOrderType === sDefaultCode && !oHeader.PurchaseOrderTypeText) {
                oHeader.PurchaseOrderTypeText = sDefaultText;
            }

            // 3. Confirm Company Code from PO Rule or fallback 1000 ONLY when confirmed valid/configured in master data
            var oPoRule = (_rules && _rules.PO_TYPES && _rules.PO_TYPES[sCurrentDocType]) || null;
            var sTargetCoCode = (oPoRule && oPoRule.defaultCompanyCode) || "1000";
            var bCoCodeConfirmed = aCompanyCodes.some(function (cc) {
                return cc && (cc.CompanyCode === sTargetCoCode);
            });

            if (bCoCodeConfirmed) {
                if (!oUserModified.CompanyCode) {
                    oHeader.CompanyCode = sTargetCoCode;
                    oConfigDerived.CompanyCode = true;
                    oReport.applied.CompanyCode = sTargetCoCode;
                    fnValidate(oModel, "CompanyCode", sTargetCoCode);
                } else {
                    oReport.skippedDueToUser.CompanyCode = oHeader.CompanyCode;
                }
            } else {
                oReport.unconfirmed.push("CompanyCode " + sTargetCoCode + " is not configured or valid in SAP master data.");
            }

            // 4. Confirm Purchasing Organization from PO Rule or fallback AE01 ONLY when confirmed valid/configured
            var sTargetPurchOrg = (oPoRule && oPoRule.defaultPurchOrg) || "AE01";
            var bPurchOrgConfirmed = aPurchOrgs.some(function (po) {
                var bIdMatch = po && (po.PurchasingOrganization === sTargetPurchOrg);
                var bCoMatch = !po.CompanyCode || po.CompanyCode === sTargetCoCode;
                return bIdMatch && bCoMatch;
            });

            if (bPurchOrgConfirmed) {
                if (!oUserModified.PurchasingOrganization) {
                    oHeader.PurchasingOrganization = sTargetPurchOrg;
                    oConfigDerived.PurchasingOrganization = true;
                    oReport.applied.PurchasingOrganization = sTargetPurchOrg;
                    fnValidate(oModel, "PurchasingOrganization", sTargetPurchOrg);
                } else {
                    oReport.skippedDueToUser.PurchasingOrganization = oHeader.PurchasingOrganization;
                }
            } else {
                oReport.unconfirmed.push("Purchasing Organization " + sTargetPurchOrg + " is not configured or valid for Company Code " + sTargetCoCode + ".");
            }

            // 5. Purchasing Group validation/defaulting (prefer 100-series, e.g. 101 Procurement Team-E)
            if (!oHeader.PurchasingGroup && !oUserModified.PurchasingGroup) {
                var oDefGroup = aPurchGroups.find(function (pg) {
                    return pg && pg.PurchasingGroup === "101";
                }) || aPurchGroups.find(function (pg) {
                    return pg && pg.PurchasingGroup && String(pg.PurchasingGroup).startsWith("1");
                }) || aPurchGroups.find(function (pg) {
                    return pg && pg.PurchasingGroup === "001";
                });
                if (oDefGroup) {
                    oHeader.PurchasingGroup = oDefGroup.PurchasingGroup;
                    oConfigDerived.PurchasingGroup = true;
                    oReport.applied.PurchasingGroup = oDefGroup.PurchasingGroup;
                    fnValidate(oModel, "PurchasingGroup", oDefGroup.PurchasingGroup);
                }
            }

            // Save state back to model
            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/header", oHeader);
                oModel.setProperty("/userModified", oUserModified);
                oModel.setProperty("/configDerived", oConfigDerived);
            }

            if (typeof fnUpdateStatus === "function") {
                fnUpdateStatus(oModel);
            }
            return oReport;
        },

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
                // Default cannot be derived
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
                // Incoterms present but location missing
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

            // Update model
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

    return PurchaseOrderDefaults;
});
