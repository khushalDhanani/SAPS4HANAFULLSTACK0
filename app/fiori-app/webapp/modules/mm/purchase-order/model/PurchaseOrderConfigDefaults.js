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

    var PurchaseOrderConfigDefaults = {
        DEFAULT_DOC_TYPE_FALLBACK: DEFAULT_DOC_TYPE_FALLBACK,

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
         * @param {Object} [oRules]
         * @returns {Object} Report of applied defaults, user preserved fields, and unconfirmed values
         */
        applyConfigurationDefaults: function (oModel, oConfigData, oDefaultDocType, oValidator, fnUpdateStatus, oRules) {
            if (!oModel) return null;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            if (!oData || !oData.header) return null;

            var oEffectiveRules = oRules || _rules;
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
            var oPoRule = (oEffectiveRules && oEffectiveRules.PO_TYPES && oEffectiveRules.PO_TYPES[sCurrentDocType]) || null;
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

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/header", oHeader);
                oModel.setProperty("/userModified", oUserModified);
                oModel.setProperty("/configDerived", oConfigDerived);
            }

            if (typeof fnUpdateStatus === "function") {
                fnUpdateStatus(oModel);
            }
            return oReport;
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = PurchaseOrderConfigDefaults;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return PurchaseOrderConfigDefaults;
        });
    }
})();
