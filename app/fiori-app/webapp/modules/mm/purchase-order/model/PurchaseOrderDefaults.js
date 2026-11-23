(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        var PurchaseOrderRules = require("./PurchaseOrderRules");
        var PurchaseOrderDocTypeDefaults = require("./PurchaseOrderDocTypeDefaults");
        var PurchaseOrderConfigDefaults = require("./PurchaseOrderConfigDefaults");
        var PurchaseOrderSupplierDefaults = require("./PurchaseOrderSupplierDefaults");
        module.exports = factory(PurchaseOrderRules, PurchaseOrderDocTypeDefaults, PurchaseOrderConfigDefaults, PurchaseOrderSupplierDefaults);
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define([
            "./PurchaseOrderRules",
            "./PurchaseOrderDocTypeDefaults",
            "./PurchaseOrderConfigDefaults",
            "./PurchaseOrderSupplierDefaults"
        ], factory);
    }
})(this, function (InjectedRules, InjectedDocTypeDefaults, InjectedConfigDefaults, InjectedSupplierDefaults) {
    "use strict";

    var _rules = InjectedRules;
    var _docTypeDefaults = InjectedDocTypeDefaults;
    var _configDefaults = InjectedConfigDefaults;
    var _supplierDefaults = InjectedSupplierDefaults;

    if (typeof require === "function") {
        if (!_rules) { try { _rules = require("./PurchaseOrderRules"); } catch (e) {} }
        if (!_docTypeDefaults) { try { _docTypeDefaults = require("./PurchaseOrderDocTypeDefaults"); } catch (e) {} }
        if (!_configDefaults) { try { _configDefaults = require("./PurchaseOrderConfigDefaults"); } catch (e) {} }
        if (!_supplierDefaults) { try { _supplierDefaults = require("./PurchaseOrderSupplierDefaults"); } catch (e) {} }
    }

    var DEFAULT_DOC_TYPE_FALLBACK = (_docTypeDefaults && _docTypeDefaults.DEFAULT_DOC_TYPE_FALLBACK) || {
        code: "ZDOM",
        text: "Dom. Aether In.LTD."
    };

    var PurchaseOrderDefaults = {
        /** Reference to authoritative schema rules */
        rules: _rules,

        docTypeDefaults: _docTypeDefaults,
        configDefaults: _configDefaults,
        supplierDefaults: _supplierDefaults,

        /**
         * Resolves the active default Document Type and description.
         *
         * @param {Object} [oConfigData]
         * @param {{ code: string, text: string }} [oFallback]
         * @returns {{ code: string, text: string }}
         */
        getDefaultDocType: function (oConfigData, oFallback) {
            if (_docTypeDefaults && typeof _docTypeDefaults.getDefaultDocType === "function") {
                return _docTypeDefaults.getDefaultDocType(oConfigData, oFallback);
            }
            return oFallback || DEFAULT_DOC_TYPE_FALLBACK;
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
            if (_docTypeDefaults && typeof _docTypeDefaults.setDocumentType === "function") {
                return _docTypeDefaults.setDocumentType(
                    oModel,
                    sDocType,
                    oConfigData,
                    sDocTypeText,
                    oValidator,
                    fnUpdateStatus,
                    fnMarkUserModified,
                    fnApplyConfigDefaults,
                    oDefaultDocType,
                    _rules
                );
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
            if (_docTypeDefaults && typeof _docTypeDefaults.updateDocTypeLive === "function") {
                return _docTypeDefaults.updateDocTypeLive(oModel, sVal, oValidator, fnUpdateStatus, fnMarkUserModified);
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
            if (_configDefaults && typeof _configDefaults.applyConfigurationDefaults === "function") {
                return _configDefaults.applyConfigurationDefaults(oModel, oConfigData, oDefaultDocType, oValidator, fnUpdateStatus, _rules);
            }
            return null;
        },

        /**
         * Derives configured commercial terms (Currency, Payment Terms, Incoterms, Incoterms Location)
         * from supplier master data when available.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sSupplier
         * @param {Object} [oDefaults]
         * @param {Object} [oValidator]
         * @param {Function} [fnUpdateStatus]
         * @returns {Object} Report of applied fields, preserved fields, and derivation warnings
         */
        deriveSupplierDefaults: function (oModel, sSupplier, oDefaults, oValidator, fnUpdateStatus) {
            if (_supplierDefaults && typeof _supplierDefaults.deriveSupplierDefaults === "function") {
                return _supplierDefaults.deriveSupplierDefaults(oModel, sSupplier, oDefaults, oValidator, fnUpdateStatus);
            }
            return null;
        }
    };

    return PurchaseOrderDefaults;
});
