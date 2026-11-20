sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "./PurchaseOrderValidator",
    "./PurchaseOrderDefaults",
    "./PurchaseOrderInitialState",
    "./PurchaseOrderOperations"
], function (JSONModel, InjectedValidator, InjectedDefaults, InjectedInitialState, InjectedOperations) {
    "use strict";

    var _validator = InjectedValidator;
    var _defaults = InjectedDefaults;
    var _initialState = InjectedInitialState;
    var _operations = InjectedOperations;

    if (typeof require === "function") {
        if (!_validator) { try { _validator = require("./PurchaseOrderValidator"); } catch (e) {} }
        if (!_defaults) { try { _defaults = require("./PurchaseOrderDefaults"); } catch (e) {} }
        if (!_initialState) { try { _initialState = require("./PurchaseOrderInitialState"); } catch (e) {} }
        if (!_operations) { try { _operations = require("./PurchaseOrderOperations"); } catch (e) {} }
    }

    var DEFAULT_DOC_TYPE = {
        code: "ZDOM",
        text: "Dom. Aether In.LTD."
    };

    var PurchaseOrderModel = {
        validator: _validator,
        defaults: _defaults,
        rules: _validator ? _validator.rules : null,
        initialState: _initialState,
        operations: _operations,

        DEFAULT_DOC_TYPE: DEFAULT_DOC_TYPE,
        HEADER_FIELD_CONFIG: (_initialState && _initialState.HEADER_FIELD_CONFIG) || {},
        ITEM_FIELD_CONFIG: (_initialState && _initialState.ITEM_FIELD_CONFIG) || {},

        _fnTextResolver: null,

        setTextResolver: function (fnResolver) {
            this._fnTextResolver = fnResolver;
            if (_validator && typeof _validator.setTextResolver === "function") {
                _validator.setTextResolver(fnResolver);
            }
        },

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

        getCurrentUserName: function (oComponent) {
            try {
                var oGlobal = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
                var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                if (oSap && oSap.ui && typeof oSap.ui.require === "function") {
                    var AuthService = oSap.ui.require("saps4hana/fiori/service/AuthService");
                    if (AuthService && typeof AuthService.getCurrentUserName === "function") {
                        return AuthService.getCurrentUserName(oComponent);
                    }
                }
            } catch (e) {}

            if (oComponent && oComponent.getModel) {
                var oAuthModel = oComponent.getModel("auth");
                if (oAuthModel && oAuthModel.getProperty) {
                    var sAuthUser = oAuthModel.getProperty("/user/username");
                    if (sAuthUser && typeof sAuthUser === "string" && sAuthUser.trim() !== "") {
                        return sAuthUser.trim();
                    }
                }
                var oUserModel = oComponent.getModel("user");
                if (oUserModel && oUserModel.getProperty && oUserModel.getProperty("/username")) {
                    var sUser = oUserModel.getProperty("/username");
                    if (sUser && typeof sUser === "string" && sUser.trim() !== "") {
                        return sUser.trim();
                    }
                }
            }
            return "";
        },

        createInitialModel: function (sUser) {
            return _initialState ? _initialState.createInitialModel(sUser, JSONModel) : null;
        },

        addItem: function (oModel, sUser) {
            return _operations ? _operations.addItem(oModel, sUser, _validator) : undefined;
        },

        deleteItem: function (oModel, iIndex) {
            return _operations ? _operations.deleteItem(oModel, iIndex) : undefined;
        },

        calculateItemNetAmount: function (oModel, sPath) {
            return _operations ? _operations.calculateItemNetAmount(oModel, sPath) : undefined;
        },

        computeStatus: function (oData) {
            return _operations
                ? _operations.computeStatus(oData, this.getText.bind(this), this.validateUI.bind(this))
                : { text: "Draft", state: "Warning", icon: "sap-icon://alert", complete: false };
        },

        updateStatus: function (oModel) {
            return _operations ? _operations.updateStatus(oModel, this.computeStatus.bind(this)) : null;
        },

        markUserModified: function (oModel, sField, bModified) {
            if (!oModel || !sField) return;
            var bVal = bModified !== undefined ? bModified : true;
            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/userModified/" + sField, bVal);
                if (bVal) {
                    oModel.setProperty("/configDerived/" + sField, false);
                }
            } else {
                var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
                if (oData) {
                    oData.userModified = oData.userModified || {};
                    oData.userModified[sField] = bVal;
                    if (bVal && oData.configDerived) {
                        oData.configDerived[sField] = false;
                    }
                }
            }
        },

        /* Delegated Facades to PurchaseOrderValidator */
        isValidDocType: function (sDocType) {
            return _validator ? _validator.isValidDocType(sDocType) : false;
        },

        validateDocType: function (sDocType) {
            return _validator ? _validator.validateDocType(sDocType, this.getText.bind(this)) : { valid: false, state: "None", text: "" };
        },

        validateUI: function (oData) {
            return _validator ? _validator.validateUI(oData) : [];
        },

        validateSingleField: function (oModel, sField, sValue, iItemIndex) {
            return _validator ? _validator.validateSingleField(oModel, sField, sValue, iItemIndex, this.getText.bind(this), this.validateForm.bind(this)) : { state: "None", text: "" };
        },

        validateForm: function (oModel) {
            return _validator ? _validator.validateForm(oModel, this.getText.bind(this)) : { isValid: false, errorCount: 0, errorList: [], errorMessage: "" };
        },

        applyBackendErrors: function (oModel, oError) {
            return _validator ? _validator.applyBackendErrors(oModel, oError, this.getText.bind(this), this.HEADER_FIELD_CONFIG, this.ITEM_FIELD_CONFIG) : { errorCount: 0, errorList: [], errorMessage: "" };
        },

        clearErrors: function (oModel) {
            return _validator ? _validator.clearErrors(oModel) : undefined;
        },

        setFieldValidation: function (oModel, sField, sState, sText) {
            return _validator ? _validator.setFieldValidation(oModel, sField, sState, sText) : undefined;
        },

        validateCompanyCodePurchasingOrg: function (oModel, oConfigData) {
            return _validator ? _validator.validateCompanyCodePurchasingOrg(oModel, oConfigData, this.getText.bind(this), this.setFieldValidation.bind(this)) : { isValid: false, message: "" };
        },

        /* Delegated Facades to PurchaseOrderDefaults */
        getDefaultDocType: function (oConfigData) {
            return _defaults ? _defaults.getDefaultDocType(oConfigData, this.DEFAULT_DOC_TYPE) : this.DEFAULT_DOC_TYPE;
        },

        setDocumentType: function (oModel, sDocType, oConfigData, sDocTypeText) {
            return _defaults ? _defaults.setDocumentType(
                oModel,
                sDocType,
                oConfigData,
                sDocTypeText,
                _validator,
                this.updateStatus.bind(this),
                this.markUserModified.bind(this),
                this.applyConfigurationDefaults.bind(this),
                this.DEFAULT_DOC_TYPE
            ) : undefined;
        },

        updateDocTypeLive: function (oModel, sVal) {
            return _defaults ? _defaults.updateDocTypeLive(oModel, sVal, _validator, this.updateStatus.bind(this), this.markUserModified.bind(this)) : undefined;
        },

        applyMaterialDefaults: function (oModel, vItem, oMaterialData, bForce) {
            return _defaults ? _defaults.applyMaterialDefaults(oModel, vItem, oMaterialData, bForce) : {};
        },

        applyConfigurationDefaults: function (oModel, oConfigData) {
            return _defaults ? _defaults.applyConfigurationDefaults(oModel, oConfigData, this.DEFAULT_DOC_TYPE, _validator, this.updateStatus.bind(this)) : {};
        },

        deriveSupplierDefaults: function (oModel, sSupplier, oDefaults) {
            return _defaults ? _defaults.deriveSupplierDefaults(oModel, sSupplier, oDefaults, _validator, this.updateStatus.bind(this)) : {};
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = PurchaseOrderModel;
    }
    return PurchaseOrderModel;
});
