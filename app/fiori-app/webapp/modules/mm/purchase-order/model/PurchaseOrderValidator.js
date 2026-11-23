(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        var PurchaseOrderRules = require("./PurchaseOrderRules");
        var PurchaseOrderBackendErrorMapper = require("./PurchaseOrderBackendErrorMapper");
        module.exports = factory(
            PurchaseOrderRules,
            PurchaseOrderBackendErrorMapper,
            require("./PurchaseOrderValidationLimits"),
            require("./PurchaseOrderFieldValidator"),
            require("./PurchaseOrderFormValidator"),
            require("./PurchaseOrderHeaderValidator")
        );
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define([
            "./PurchaseOrderRules",
            "./PurchaseOrderBackendErrorMapper",
            "./PurchaseOrderValidationLimits",
            "./PurchaseOrderFieldValidator",
            "./PurchaseOrderFormValidator",
            "./PurchaseOrderHeaderValidator"
        ], factory);
    }
})(this, function (InjectedRules, InjectedBackendErrorMapper, Limits, _fieldValidator, _formValidator, _headerValidator) {
    "use strict";

    var _rules = InjectedRules;
    if (!_rules && typeof require === "function") {
        try {
            _rules = require("./PurchaseOrderRules");
        } catch (e) {}
    }

    var _backendErrorMapper = InjectedBackendErrorMapper;
    if (!_backendErrorMapper && typeof require === "function") {
        try {
            _backendErrorMapper = require("./PurchaseOrderBackendErrorMapper");
        } catch (e) {}
    }
    var DOC_TYPE_PREFIX_REGEX = Limits.DOC_TYPE_PREFIX_REGEX;
    var DOC_TYPE_MAX_LEN = Limits.DOC_TYPE_MAX_LEN;

    var PurchaseOrderValidator = {
        /** Reference to authoritative schema rules */
        rules: _rules,

        /**
         * Optional external text resolver function (e.g. bound BaseController.getText)
         */
        _fnTextResolver: null,

        setTextResolver: function (fnResolver) {
            this._fnTextResolver = fnResolver;
        },

        /**
         * Resolves text via external resolver, UI5 Core library bundle, or formatted fallback.
         * @param {string} sKey - i18n key
         * @param {string[]} [aArgs] - optional positional arguments for {0}, {1}
         * @param {string} [sFallback] - optional default English string
         * @returns {string}
         */
        getText: function (sKey, aArgs, sFallback) {
            if (typeof this._fnTextResolver === "function") {
                var sResolved = this._fnTextResolver(sKey, aArgs, sFallback);
                if (sResolved && sResolved !== sKey) {
                    return sResolved;
                }
            }
            try {
                var oGlobal = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
                var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                if (oSap && oSap.ui && typeof oSap.ui.getCore === "function") {
                    var oCore = oSap.ui.getCore();
                    var oBundle = oCore.getLibraryResourceBundle ? oCore.getLibraryResourceBundle("saps4hana.fiori") : null;
                    if (oBundle && typeof oBundle.getText === "function") {
                        var sBundled = oBundle.getText(sKey, aArgs);
                        if (sBundled && sBundled !== sKey) {
                            return sBundled;
                        }
                    }
                }
            } catch (e) {}

            var sResult = sFallback !== undefined ? sFallback : sKey;
            if (Array.isArray(aArgs) && aArgs.length > 0) {
                aArgs.forEach(function (arg, idx) {
                    sResult = sResult.replace(new RegExp("\\{" + idx + "\\}", "g"), arg);
                });
            }
            return sResult;
        },

        /**
         * Checks whether a Document Type satisfies domain rules:
         * Must start with 'Z' and not exceed 4 characters (e.g. ZDOM, ZDOS, ZIMP, ZCAP).
         *
         * @param {string} sDocType
         * @returns {boolean}
         */
        isValidDocType: function (sDocType) {
            var s = String(sDocType || "").trim().toUpperCase();
            return DOC_TYPE_PREFIX_REGEX.test(s) && s.length <= DOC_TYPE_MAX_LEN;
        },

        /**
         * Validates a Purchase Order Document Type against domain rules.
         *
         * @param {string} sDocType
         * @param {Function} [fnTextResolver]
         * @returns {{ valid: boolean, state: string, text: string }}
         */
        validateDocType: function (sDocType, fnTextResolver) {
            var fnResolve = fnTextResolver || this.getText.bind(this);
            var sValTrim = String(sDocType || "").trim().toUpperCase();
            if (!sValTrim) {
                return {
                    valid: false,
                    state: "Error",
                    text: fnResolve("poValDocTypeRequired", null, "Document Type is required (e.g. ZDOM).")
                };
            }
            if (this.isValidDocType(sValTrim)) {
                return {
                    valid: true,
                    state: "None",
                    text: ""
                };
            }
            return {
                valid: false,
                state: "Error",
                text: fnResolve("poValDocTypeZRequired", null, "Only Z-related document types (e.g. ZDOM, ZDOS, ZIMP, ZCAP) are supported.")
            };
        },

        /**
         * Validates the PO form data at the client-side UI level for immediate UX feedback.
         *
         * @param {Object} oData
         * @returns {string[]} Array of error messages, empty if valid
         */
        validateUI: function (oData) {
            return _fieldValidator.validateUI(oData);
        },

        /**
         * Validates a single field contextually and updates that field's state.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {any} [sValue]
         * @param {number} [iItemIndex]
         * @param {Function} [fnTextResolver]
         * @param {Function} [fnValidateForm]
         * @returns {{ state: string, text: string }}
         */
        validateSingleField: function (oModel, sField, sValue, iItemIndex, fnTextResolver, fnValidateForm) {
            return _fieldValidator.validateSingleField(this, oModel, sField, sValue, iItemIndex, fnTextResolver, fnValidateForm);
        },

        /**
         * Validates the form data and updates field error states on the model for UI binding.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Function} [fnTextResolver]
         * @returns {{ isValid: boolean, errorCount: number, errorList: Array<{title: string, field: string, description: string, controlId: any}>, errorMessage: string }}
         */
        validateForm: function (oModel, fnTextResolver) {
            return _formValidator.validateForm(this, oModel, fnTextResolver);
        },

        /**
         * Applies backend error details from S/4HANA or CAP to the model fields and error list.
         * Delegates to PurchaseOrderBackendErrorMapper.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oError
         * @param {Function} [fnTextResolver]
         * @param {Object} [mHeaderConfig]
         * @param {Object} [mItemConfig]
         * @returns {{ errorCount: number, errorList: Array, errorMessage: string }}
         */
        applyBackendErrors: function (oModel, oError, fnTextResolver, mHeaderConfig, mItemConfig) {
            var fnResolve = fnTextResolver || this.getText.bind(this);
            if (_backendErrorMapper && typeof _backendErrorMapper.applyBackendErrors === "function") {
                return _backendErrorMapper.applyBackendErrors(oModel, oError, fnResolve, mHeaderConfig, mItemConfig);
            }
            return { errorCount: 0, errorList: [], errorMessage: "" };
        },

        /**
         * Clears all validation error states on the model.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         */
        clearErrors: function (oModel) {
            if (!oModel) return;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oHeaderErrors = {
                PurchaseOrderType: { state: "None", text: "" },
                CompanyCode: { state: "None", text: "" },
                PurchasingOrganization: { state: "None", text: "" },
                PurchasingGroup: { state: "None", text: "" },
                Supplier: { state: "None", text: "" },
                Currency: { state: "None", text: "" },
                DocumentDate: { state: "None", text: "" },
                IncotermsClassification: { state: "None", text: "" },
                IncotermsLocation1: { state: "None", text: "" },
                PaymentTerms: { state: "None", text: "" }
            };

            var aItems = oData.items || [];
            aItems.forEach(function (item) {
                if (item.errors) {
                    item.errors.Plant = { state: "None", text: "" };
                    item.errors.StorageLocation = { state: "None", text: "" };
                    item.errors.Material = { state: "None", text: "" };
                    item.errors.OrderQuantity = { state: "None", text: "" };
                    item.errors.UnitOfMeasure = { state: "None", text: "" };
                    item.errors.NetPriceAmount = { state: "None", text: "" };
                    item.errors.TaxCode = { state: "None", text: "" };
                    item.errors.PurchaseOrderItemText = { state: "None", text: "" };
                    item.errors.PurchaseOrderItemCategory = { state: "None", text: "" };
                    item.errors.AccountAssignmentCategory = { state: "None", text: "" };
                }
            });

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", false);
                oModel.setProperty("/errorMessage", "");
                oModel.setProperty("/errorCount", 0);
                oModel.setProperty("/errorList", []);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = false;
                oData.errorMessage = "";
                oData.errorCount = 0;
                oData.errorList = [];
            }
        },

        /**
         * Sets validation state and text on a specific header field.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {string} sState ("None" | "Information" | "Warning" | "Error")
         * @param {string} sText
         */
        setFieldValidation: function (oModel, sField, sState, sText) {
            if (!oModel || !sField) return;
            var oStateObj = { state: sState || "None", text: sText || "" };
            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors/" + sField, oStateObj);
            } else {
                var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
                if (oData && oData.errors) {
                    oData.errors[sField] = oStateObj;
                }
            }
        },

        /**
         * Cross-validates Company Code and Purchasing Organization compatibility:
         * If Purchasing Org is assigned to a different Company Code in SAP master data,
         * flags error or clears it.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {{ purchasingOrgs?: Array }} oConfigData
         * @param {Function} [fnTextResolver]
         * @param {Function} [fnSetValidation]
         * @returns {{ isValid: boolean, message: string }}
         */
        validateCompanyCodePurchasingOrg: function (oModel, oConfigData, fnTextResolver, fnSetValidation) {
            return _headerValidator.validateCompanyCodePurchasingOrg(this, oModel, oConfigData, fnTextResolver, fnSetValidation);
        }
    };

    return PurchaseOrderValidator;
});
