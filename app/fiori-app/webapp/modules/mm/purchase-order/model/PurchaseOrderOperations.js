(function () {
    "use strict";

    var oOperations = {
        addItem: function (oModel, sUser, oValidator) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            var iNextItemNo = (aItems.length + 1) * 10;

            var sDocType = oModel.getProperty("/header/PurchaseOrderType") || "";
            var sCleanDocType = String(sDocType || "").trim().toUpperCase();
            var oPoRule = (oValidator && oValidator.rules && oValidator.rules.PO_TYPES && oValidator.rules.PO_TYPES[sCleanDocType]) || null;
            var sItemCat = (oPoRule && oPoRule.defaultItemCategory !== undefined) ? oPoRule.defaultItemCategory : "0";
            var sAcctAssgt = (oPoRule && oPoRule.defaultAcctAssignmentCategory !== undefined) ? oPoRule.defaultAcctAssignmentCategory : "";

            aItems.push({
                PurchaseOrderItem: iNextItemNo.toString(),
                PurchaseOrderItemCategory: sItemCat,
                AccountAssignmentCategory: sAcctAssgt,
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
                    PurchaseOrderItemText: { state: "None", text: "" },
                    OrderQuantity: { state: "None", text: "" },
                    UnitOfMeasure: { state: "None", text: "" },
                    NetPriceAmount: { state: "None", text: "" },
                    TaxCode: { state: "None", text: "" },
                    PurchaseOrderItemCategory: { state: "None", text: "" },
                    AccountAssignmentCategory: { state: "None", text: "" }
                }
            });
            oModel.setProperty("/items", aItems);
        },

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

        computeStatus: function (oData, fnGetText, fnValidateUI) {
            var getText = typeof fnGetText === "function" ? fnGetText : function (_k, _a, fallback) { return fallback; };

            if (!oData || !oData.header) {
                return {
                    text: getText("poStatusDraftIncomplete", null, "Draft (Incomplete)"),
                    state: "Warning",
                    icon: "sap-icon://alert",
                    complete: false
                };
            }

            var sDocType = (oData.header.PurchaseOrderType || "").trim();
            var aErrors = typeof fnValidateUI === "function" ? fnValidateUI(oData) : [];
            var bComplete = aErrors.length === 0;

            if (bComplete) {
                return {
                    text: getText("poStatusReadyToCreate", null, "Ready to Create"),
                    state: "Success",
                    icon: "sap-icon://accept",
                    complete: true
                };
            }

            if (sDocType) {
                return {
                    text: getText("poStatusDraft", null, "Draft"),
                    state: "Information",
                    icon: "sap-icon://edit",
                    complete: false
                };
            }

            return {
                text: getText("poStatusDraft", null, "Draft"),
                state: "Warning",
                icon: "sap-icon://alert",
                complete: false
            };
        },

        updateStatus: function (oModel, fnComputeStatus) {
            if (!oModel) return null;
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oStatus = typeof fnComputeStatus === "function" ? fnComputeStatus(oData) : this.computeStatus(oData);

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
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oOperations;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oOperations;
        });
    }
})();
