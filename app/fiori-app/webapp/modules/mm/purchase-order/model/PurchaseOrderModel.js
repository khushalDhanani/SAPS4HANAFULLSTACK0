sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "./PurchaseOrderValidator",
    "./PurchaseOrderDefaults"
], function (JSONModel, InjectedValidator, InjectedDefaults) {
    "use strict";

    var _validator = InjectedValidator;
    var _defaults = InjectedDefaults;

    // In unit test harnesses where sap.ui.define mock only passes MockJSONModel:
    if (!_validator && typeof require === "function") {
        try {
            _validator = require("./PurchaseOrderValidator");
        } catch (e) {}
    }
    if (!_defaults && typeof require === "function") {
        try {
            _defaults = require("./PurchaseOrderDefaults");
        } catch (e) {}
    }

    var PurchaseOrderModel = {
        /** Reference to extracted validator and defaults modules */
        validator: _validator,
        defaults: _defaults,

        /**
         * Resolves the current logged-in user name from Fiori Launchpad container or owner component user model.
         *
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @returns {string}
         */
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
            } catch (e) {
                // AuthService not loaded (e.g. unit tests): no user name available.
            }

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

        DEFAULT_DOC_TYPE: {
            code: "ZDOM",
            text: "Dom. Aether In.LTD."
        },

        /**
         * Optional external text resolver function (e.g. bound BaseController.getText)
         */
        _fnTextResolver: null,

        setTextResolver: function (fnResolver) {
            this._fnTextResolver = fnResolver;
            if (_validator && typeof _validator.setTextResolver === "function") {
                _validator.setTextResolver(fnResolver);
            }
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

        HEADER_FIELD_CONFIG: {
            PurchaseOrderType: { controlId: "inDocType", label: "Document Type", section: "General Data", example: "ZDOM" },
            CompanyCode: { controlId: "inCompanyCode", label: "Company Code", section: "General Data", example: "1010" },
            PurchasingOrganization: { controlId: "inPurchOrg", label: "Purchasing Organization", section: "General Data", example: "1010" },
            PurchasingGroup: { controlId: "inPurchGrp", label: "Purchasing Group", section: "General Data", example: "001" },
            DocumentDate: { controlId: "inDocDate", label: "Document Date", section: "General Data", example: "DD-MM-YYYY" },
            Supplier: { controlId: "inSupplier", label: "Supplier", section: "Supplier & Commercial Terms", example: "10300001" },
            Currency: { controlId: "inCurrency", label: "Currency", section: "Supplier & Commercial Terms", example: "EUR" },
            IncotermsClassification: { controlId: "inIncoterms", label: "Incoterms", section: "Supplier & Commercial Terms", example: "EXW" },
            IncotermsLocation1: { controlId: "inIncotermsLoc", label: "Incoterms Location 1", section: "Supplier & Commercial Terms", example: "MUMBAI" },
            PaymentTerms: { controlId: "inPaymentTerms", label: "Payment Terms", section: "Supplier & Commercial Terms", example: "0001" }
        },

        ITEM_FIELD_CONFIG: {
            Plant: { cellIndex: 1, label: "Plant", example: "1010" },
            StorageLocation: { cellIndex: 2, label: "Storage Location", example: "101A" },
            Material: { cellIndex: 3, label: "Material", example: "TG11" },
            PurchaseOrderItemText: { cellIndex: 4, label: "Description", example: "Polypropylene Resin" },
            OrderQuantity: { cellIndex: 5, label: "Quantity", example: "10" },
            UnitOfMeasure: { cellIndex: 6, label: "Unit of Measure", example: "PC" },
            NetPriceAmount: { cellIndex: 7, label: "Net Price", example: "100.00" },
            TaxCode: { cellIndex: 8, label: "Tax Code", example: "V1" }
        },

        /**
         * Creates and returns a fresh JSONModel initialized for Purchase Order creation.
         *
         * @param {string} [sUser] - Default requisitioner name
         * @returns {sap.ui.model.json.JSONModel}
         */
        createInitialModel: function (sUser) {
            var oData = {
                hasError: false,
                errorMessage: "",
                errorCount: 0,
                errorList: [],
                userModified: {
                    PurchaseOrderType: false,
                    CompanyCode: false,
                    PurchasingOrganization: false,
                    PurchasingGroup: false,
                    Supplier: false,
                    DocumentDate: false,
                    Currency: false,
                    PaymentTerms: false,
                    IncotermsClassification: false,
                    IncotermsLocation1: false
                },
                supplierDefaultsDerived: false,
                supplierDefaultsSource: "",
                supplierDefaultsLastPo: "",
                supplierDefaultsMessage: "",
                configDerived: {
                    PurchaseOrderType: false,
                    CompanyCode: false,
                    PurchasingOrganization: false,
                    Currency: false,
                    PaymentTerms: false,
                    IncotermsClassification: false,
                    IncotermsLocation1: false
                },
                errors: {
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
                },
                header: {
                    PurchaseOrderType: "",
                    PurchaseOrderTypeText: "",
                    CompanyCode: "",
                    PurchasingOrganization: "",
                    PurchasingGroup: "",
                    Supplier: "",
                    DocumentDate: new Date().toISOString().split("T")[0],
                    Currency: "",
                    IncotermsClassification: "",
                    IncotermsLocation1: "",
                    PaymentTerms: "",
                    StatusText: "Draft",
                    StatusState: "Warning",
                    StatusIcon: "sap-icon://alert",
                    PurchasingCompletenessStatus: false
                },
                items: [
                    {
                        PurchaseOrderItem: "10",
                        PurchaseOrderItemCategory: "0",
                        AccountAssignmentCategory: "",
                        Material: "",
                        PurchaseOrderItemText: "",
                        MaterialGroup: "",
                        Plant: "",
                        StorageLocation: "",
                        OrderQuantity: "",
                        UnitOfMeasure: "",
                        NetPriceAmount: "",
                        TaxCode: "",
                        NetAmount: "0.00",
                        NetAmountIsEstimate: true,
                        RequisitionerName: sUser || "",
                        errors: {
                            Plant: { state: "None", text: "" },
                            StorageLocation: { state: "None", text: "" },
                            Material: { state: "None", text: "" },
                            OrderQuantity: { state: "None", text: "" },
                            UnitOfMeasure: { state: "None", text: "" },
                            NetPriceAmount: { state: "None", text: "" },
                            TaxCode: { state: "None", text: "" }
                        }
                    }
                ]
            };
            return new JSONModel(oData);
        },

        /**
         * Appends a new item line to the model with standard 10-increment numbering.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} [sUser]
         */
        addItem: function (oModel, sUser) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            var iNextItemNo = (aItems.length + 1) * 10;

            aItems.push({
                PurchaseOrderItem: iNextItemNo.toString(),
                PurchaseOrderItemCategory: "0",
                AccountAssignmentCategory: "",
                Material: "",
                PurchaseOrderItemText: "",
                MaterialGroup: "",
                Plant: "",
                StorageLocation: "",
                OrderQuantity: "",
                UnitOfMeasure: "",
                NetPriceAmount: "",
                TaxCode: "",
                NetAmount: "0.00",
                NetAmountIsEstimate: true,
                RequisitionerName: sUser || "",
                errors: {
                    Plant: { state: "None", text: "" },
                    StorageLocation: { state: "None", text: "" },
                    Material: { state: "None", text: "" },
                    OrderQuantity: { state: "None", text: "" },
                    UnitOfMeasure: { state: "None", text: "" },
                    NetPriceAmount: { state: "None", text: "" },
                    TaxCode: { state: "None", text: "" }
                }
            });
            oModel.setProperty("/items", aItems);
        },

        /**
         * Deletes an item by index and re-numbers all remaining items sequentially.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {number} iIndex
         */
        deleteItem: function (oModel, iIndex) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            if (iIndex < 0 || iIndex >= aItems.length) return;

            aItems.splice(iIndex, 1);

            // Re-number remaining items with 10-increment sequence
            aItems.forEach(function (item, idx) {
                item.PurchaseOrderItem = ((idx + 1) * 10).toString();
            });

            oModel.setProperty("/items", aItems);
        },

        /**
         * Calculates estimated line item NetAmount from OrderQuantity and NetPriceAmount
         * in the browser before SAP S/4HANA prices the document.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sPath
         */
        calculateItemNetAmount: function (oModel, sPath) {
            if (!oModel || !sPath) return;
            var oItem = oModel.getProperty(sPath);
            if (!oItem) return;

            var fQuantity = parseFloat(oItem.OrderQuantity) || 0;
            var fNetPrice = parseFloat(oItem.NetPriceAmount) || 0;
            var fNetAmount = fQuantity * fNetPrice;

            oModel.setProperty(sPath + "/NetAmount", fNetAmount.toFixed(2));
            oModel.setProperty(sPath + "/NetAmountIsEstimate", true);
        },

        /**
         * Computes the PO status based on Document Type and data completeness.
         *
         * @param {Object} oData
         * @returns {{ text: string, state: string, icon: string, complete: boolean }}
         */
        computeStatus: function (oData) {
            if (!oData || !oData.header) {
                return {
                    text: this.getText("poStatusDraftIncomplete", null, "Draft (Incomplete)"),
                    state: "Warning",
                    icon: "sap-icon://alert",
                    complete: false
                };
            }

            var sDocType = (oData.header.PurchaseOrderType || "").trim();
            var aErrors = this.validateUI(oData);
            var bComplete = aErrors.length === 0;

            if (bComplete) {
                return {
                    text: this.getText("poStatusReadyToCreate", null, "Ready to Create"),
                    state: "Success",
                    icon: "sap-icon://accept",
                    complete: true
                };
            }

            if (sDocType) {
                return {
                    text: this.getText("poStatusDraft", null, "Draft"),
                    state: "Information",
                    icon: "sap-icon://edit",
                    complete: false
                };
            }

            return {
                text: this.getText("poStatusDraft", null, "Draft"),
                state: "Warning",
                icon: "sap-icon://alert",
                complete: false
            };
        },

        /**
         * Evaluates current model state and updates the status properties on /header.
         *
         * @param {sap.ui.model.json.JSONModel|Object} oModel
         * @returns {{ text: string, state: string, icon: string, complete: boolean }}
         */
        updateStatus: function (oModel) {
            if (!oModel) return null;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oStatus = this.computeStatus(oData);

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/header/StatusText", oStatus.text);
                oModel.setProperty("/header/StatusState", oStatus.state);
                oModel.setProperty("/header/StatusIcon", oStatus.icon);
                oModel.setProperty("/header/PurchasingCompletenessStatus", oStatus.complete);
            } else if (oData && oData.header) {
                oData.header.StatusText = oStatus.text;
                oData.header.StatusState = oStatus.state;
                oData.header.StatusIcon = oStatus.icon;
                oData.header.PurchasingCompletenessStatus = oStatus.complete;
            }

            return oStatus;
        },

        /**
         * Marks a header field as manually modified by the user.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {boolean} [bModified=true]
         */
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

        /* -------------------------------------------------------------------------
         * Delegated Facades to PurchaseOrderValidator
         * ------------------------------------------------------------------------- */

        /**
         * Checks whether a Document Type satisfies domain rules:
         * Must start with 'Z' and not exceed 4 characters (e.g. ZDOM, ZDOS, ZIMP, ZCAP).
         *
         * @param {string} sDocType
         * @returns {boolean}
         */
        isValidDocType: function (sDocType) {
            return _validator.isValidDocType(sDocType);
        },

        /**
         * Validates a Purchase Order Document Type against domain rules.
         *
         * @param {string} sDocType
         * @returns {{ valid: boolean, state: string, text: string }}
         */
        validateDocType: function (sDocType) {
            return _validator.validateDocType(sDocType, this.getText.bind(this));
        },

        /**
         * Validates the PO form data at the client-side UI level for immediate UX feedback.
         *
         * @param {Object} oData
         * @returns {string[]} Array of error messages, empty if valid
         */
        validateUI: function (oData) {
            return _validator.validateUI(oData);
        },

        /**
         * Validates a single field contextually and updates that field's state.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {any} [sValue]
         * @param {number} [iItemIndex]
         * @returns {{ state: string, text: string }}
         */
        validateSingleField: function (oModel, sField, sValue, iItemIndex) {
            return _validator.validateSingleField(oModel, sField, sValue, iItemIndex, this.getText.bind(this), this.validateForm.bind(this));
        },

        /**
         * Validates the form data and updates field error states on the model for UI binding.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {{ isValid: boolean, errorCount: number, errorList: Array<{title: string, field: string, description: string, controlId: any}>, errorMessage: string }}
         */
        validateForm: function (oModel) {
            return _validator.validateForm(oModel, this.getText.bind(this));
        },

        /**
         * Applies backend error details from S/4HANA or CAP to the model fields and error list.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oError
         * @returns {{ errorCount: number, errorList: Array, errorMessage: string }}
         */
        applyBackendErrors: function (oModel, oError) {
            return _validator.applyBackendErrors(oModel, oError, this.getText.bind(this), this.HEADER_FIELD_CONFIG, this.ITEM_FIELD_CONFIG);
        },

        /**
         * Clears all validation error states on the model.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         */
        clearErrors: function (oModel) {
            return _validator.clearErrors(oModel);
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
            return _validator.setFieldValidation(oModel, sField, sState, sText);
        },

        /**
         * Cross-validates Company Code and Purchasing Organization compatibility.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {{ purchasingOrgs?: Array }} oConfigData
         * @returns {{ isValid: boolean, message: string }}
         */
        validateCompanyCodePurchasingOrg: function (oModel, oConfigData) {
            return _validator.validateCompanyCodePurchasingOrg(oModel, oConfigData, this.getText.bind(this), this.setFieldValidation.bind(this));
        },

        /* -------------------------------------------------------------------------
         * Delegated Facades to PurchaseOrderDefaults
         * ------------------------------------------------------------------------- */

        /**
         * Resolves the active default Document Type and description.
         *
         * @param {Object} [oConfigData]
         * @returns {{ code: string, text: string }}
         */
        getDefaultDocType: function (oConfigData) {
            return _defaults.getDefaultDocType(oConfigData, this.DEFAULT_DOC_TYPE);
        },

        /**
         * Sets and validates Document Type on the model, enforcing domain rules (Z-prefix and max length 4).
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sDocType
         * @param {Object} [oConfigData]
         * @param {string} [sDocTypeText]
         */
        setDocumentType: function (oModel, sDocType, oConfigData, sDocTypeText) {
            return _defaults.setDocumentType(
                oModel,
                sDocType,
                oConfigData,
                sDocTypeText,
                _validator,
                this.updateStatus.bind(this),
                this.markUserModified.bind(this),
                this.applyConfigurationDefaults.bind(this),
                this.DEFAULT_DOC_TYPE
            );
        },

        /**
         * Handles live change input for Document Type, validating domain prefix on keystroke.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sVal
         */
        updateDocTypeLive: function (oModel, sVal) {
            return _defaults.updateDocTypeLive(oModel, sVal, _validator, this.updateStatus.bind(this), this.markUserModified.bind(this));
        },

        /**
         * Applies Material master data configuration to a specific line item.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string|number} vItem Item index or binding path
         * @param {Object} oMaterialData Material master data object containing Material, MaterialBaseUnit, etc.
         * @param {boolean} [bForce]
         * @returns {Object} Report of applied fields
         */
        applyMaterialDefaults: function (oModel, vItem, oMaterialData, bForce) {
            return _defaults.applyMaterialDefaults(oModel, vItem, oMaterialData, bForce);
        },

        /**
         * Dynamically applies configuration-driven defaults and dependencies from loaded SAP master data.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {{ documentTypes?: Array, companyCodes?: Array, purchasingOrgs?: Array, purchasingGroups?: Array }} oConfigData
         * @returns {Object} Report of applied defaults, user preserved fields, and unconfirmed values
         */
        applyConfigurationDefaults: function (oModel, oConfigData) {
            return _defaults.applyConfigurationDefaults(oModel, oConfigData, this.DEFAULT_DOC_TYPE, _validator, this.updateStatus.bind(this));
        },

        /**
         * Derives configured commercial terms from supplier master data when available.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sSupplier
         * @param {Object} [oDefaults]
         * @returns {Object} Report of applied fields, preserved fields, and derivation warnings
         */
        deriveSupplierDefaults: function (oModel, sSupplier, oDefaults) {
            return _defaults.deriveSupplierDefaults(oModel, sSupplier, oDefaults, _validator, this.updateStatus.bind(this));
        }
    };

    return PurchaseOrderModel;
});
