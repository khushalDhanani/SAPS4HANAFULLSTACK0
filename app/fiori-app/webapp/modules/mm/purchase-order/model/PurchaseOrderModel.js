sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    return {
        /**
         * Resolves the current logged-in user name from Fiori Launchpad container or owner component user model.
         *
         * @param {sap.ui.core.UIComponent} [oComponent]
         * @returns {string}
         */
        getCurrentUserName: function (oComponent) {
            try {
                var oGlobal = typeof window !== "undefined" ? window : null;
                var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                var oUshell = oSap ? oSap["ushell"] : null;
                var oContainer = oUshell ? oUshell["Container"] : null;
                if (oContainer && typeof oContainer["getUser"] === "function") {
                    var oUser = oContainer["getUser"]();
                    if (oUser && typeof oUser["getId"] === "function" && oUser["getId"]()) {
                        return oUser["getId"]();
                    }
                }
            } catch (e) {
                // Ignore shell container error when running outside FLP
            }

            if (oComponent && oComponent.getModel) {
                var oUserModel = oComponent.getModel("user");
                if (oUserModel && oUserModel.getProperty && oUserModel.getProperty("/username")) {
                    return oUserModel.getProperty("/username");
                }
            }
            return "";
        },

        /**
         * Creates and returns a fresh JSONModel initialized for Purchase Order creation.
         *
         * @param {string} [sUser] - Default requisitioner name
         * @returns {sap.ui.model.json.JSONModel}
         */
        createInitialModel: function (sUser) {
            var oData = {
                header: {
                    PurchaseOrderType: "NB",
                    CompanyCode: "",
                    PurchasingOrganization: "",
                    PurchasingGroup: "",
                    Supplier: "",
                    DocumentDate: new Date().toISOString().split("T")[0],
                    Currency: "",
                    IncotermsClassification: "",
                    IncotermsLocation1: "",
                    PaymentTerms: "",
                    StatusText: "In Preparation (NB - Incomplete)",
                    StatusState: "Information",
                    StatusIcon: "sap-icon://edit",
                    PurchasingCompletenessStatus: false
                },
                items: [
                    {
                        PurchaseOrderItem: "10",
                        PurchaseOrderItemCategory: "0",
                        AccountAssignmentCategory: "",
                        Material: "",
                        MaterialGroup: "",
                        Plant: "",
                        StorageLocation: "",
                        OrderQuantity: "",
                        UnitOfMeasure: "PC",
                        NetPriceAmount: "",
                        TaxCode: "",
                        NetAmount: "0.00",
                        RequisitionerName: sUser || ""
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
                MaterialGroup: "",
                Plant: "",
                StorageLocation: "",
                OrderQuantity: "1",
                UnitOfMeasure: "PC",
                NetPriceAmount: "0.00",
                TaxCode: "",
                NetAmount: "0.00",
                RequisitionerName: sUser || ""
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
         * Calculates line item NetAmount from OrderQuantity and NetPriceAmount.
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
        },

        /**
         * Validates the PO form data at the client-side UI level for immediate UX feedback.
         *
         * @param {Object} oData
         * @returns {string[]} Array of error messages, empty if valid
         */
        validateUI: function (oData) {
            var aErrors = [];
            if (!oData || !oData.header) {
                return ["Invalid Purchase Order data."];
            }

            // 1. Header Validation
            if (!oData.header.PurchaseOrderType) aErrors.push("Document Type is required.");
            if (!oData.header.CompanyCode) aErrors.push("Company Code is required.");
            if (!oData.header.PurchasingOrganization) aErrors.push("Purchasing Organization is required.");
            if (!oData.header.PurchasingGroup) aErrors.push("Purchasing Group is required.");
            if (!oData.header.Supplier) aErrors.push("Supplier is required.");
            if (!oData.header.Currency) aErrors.push("Currency is required.");
            if (!oData.header.DocumentDate) aErrors.push("Document Date is required.");

            if (oData.header.IncotermsClassification && !oData.header.IncotermsLocation1) {
                aErrors.push("Incoterms Location is required when Incoterms is specified.");
            }

            // 2. Items Validation
            if (!oData.items || oData.items.length === 0) {
                aErrors.push("Please add at least one line item.");
            } else {
                oData.items.forEach(function (item, idx) {
                    var sItemNo = item.PurchaseOrderItem || "Item #" + (idx + 1);
                    if (!item.Material) aErrors.push(sItemNo + ": Material is required.");
                    if (!item.Plant) aErrors.push(sItemNo + ": Plant is required.");
                    if (!item.StorageLocation) aErrors.push(sItemNo + ": Storage Location is required.");
                    if (!item.UnitOfMeasure) aErrors.push(sItemNo + ": Unit of Measure is required.");

                    var fQty = parseFloat(item.OrderQuantity);
                    if (!item.OrderQuantity || isNaN(fQty) || fQty <= 0) {
                        aErrors.push(sItemNo + ": Order Quantity must be greater than 0.");
                    }
                });
            }

            return aErrors;
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
                    text: "Draft (Incomplete)",
                    state: "Warning",
                    icon: "sap-icon://alert",
                    complete: false
                };
            }

            var sDocType = (oData.header.PurchaseOrderType || "").trim();
            var aErrors = this.validateUI(oData);
            var bComplete = aErrors.length === 0;
            var sTypeLabel = sDocType || "Draft";

            if (bComplete) {
                return {
                    text: "Ready to Create (" + sTypeLabel + " - Complete)",
                    state: "Success",
                    icon: "sap-icon://accept",
                    complete: true
                };
            }

            if (sDocType) {
                return {
                    text: "In Preparation (" + sTypeLabel + " - Incomplete)",
                    state: "Information",
                    icon: "sap-icon://edit",
                    complete: false
                };
            }

            return {
                text: "Incomplete (Missing Document Type)",
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
        }
    };
});
