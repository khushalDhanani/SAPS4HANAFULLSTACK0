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
                var oAuthModel = oComponent.getModel("auth");
                if (oAuthModel && oAuthModel.getProperty) {
                    var sAuthUser = oAuthModel.getProperty("/user/username");
                    if (sAuthUser) {
                        return sAuthUser;
                    }
                }
            }
            return "";
        },

        HEADER_FIELD_CONFIG: {
            PurchaseOrderType: { controlId: "inDocType", label: "Document Type", section: "General Data", example: "NB" },
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
                    StatusText: "Draft",
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
                        PurchaseOrderItemText: "",
                        MaterialGroup: "",
                        Plant: "",
                        StorageLocation: "",
                        OrderQuantity: "",
                        UnitOfMeasure: "PC",
                        NetPriceAmount: "",
                        TaxCode: "",
                        NetAmount: "0.00",
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
                OrderQuantity: "1",
                UnitOfMeasure: "PC",
                NetPriceAmount: "0.00",
                TaxCode: "",
                NetAmount: "0.00",
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
         * Applies Material master data configuration to a specific line item:
         * Sets Material, Description (if not already entered), and directly sets UnitOfMeasure
         * from the Material's master data Base Unit of Measure configuration (MaterialBaseUnit).
         * Clears any validation errors on Material and UnitOfMeasure.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string|number} vItem Item index or binding path
         * @param {Object} oMaterialData Material master data object containing Material, MaterialBaseUnit, etc.
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
                    text: "Ready to Create",
                    state: "Success",
                    icon: "sap-icon://accept",
                    complete: true
                };
            }

            if (sDocType) {
                return {
                    text: "Draft",
                    state: "Information",
                    icon: "sap-icon://edit",
                    complete: false
                };
            }

            return {
                text: "Draft",
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
         * Validates a single field contextually and updates that field's state.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @param {any} [sValue]
         * @param {number} [iItemIndex]
         * @returns {{ state: string, text: string }}
         */
        validateSingleField: function (oModel, sField, sValue, iItemIndex) {
            if (!oModel) return { state: "None", text: "" };
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oState = { state: "None", text: "" };

            if (iItemIndex === undefined || iItemIndex === null) {
                // Header field validation
                var oHeader = oData.header || {};
                var val = sValue !== undefined ? sValue : (oHeader[sField] || "");
                var sValTrim = String(val || "").trim();

                switch (sField) {
                    case "PurchaseOrderType":
                        if (!sValTrim) oState = { state: "Error", text: "Document Type is required (e.g. NB)." };
                        break;
                    case "CompanyCode":
                        if (!sValTrim) oState = { state: "Error", text: "Company Code is required (4-character code, e.g. 1010)." };
                        break;
                    case "PurchasingOrganization":
                        if (!sValTrim) oState = { state: "Error", text: "Purchasing Organization is required (e.g. 1010)." };
                        break;
                    case "PurchasingGroup":
                        if (!sValTrim) oState = { state: "Error", text: "Purchasing Group is required (3-character code, e.g. 001)." };
                        break;
                    case "Supplier":
                        if (!sValTrim) oState = { state: "Error", text: "Supplier account is required (e.g. 10300001)." };
                        break;
                    case "Currency":
                        if (!sValTrim) {
                            oState = { state: "Error", text: "Currency is required (e.g. EUR, USD)." };
                        } else if (!/^[A-Za-z]{3}$/.test(sValTrim)) {
                            oState = { state: "Error", text: "Currency must be a 3-letter ISO code (e.g. EUR)." };
                        }
                        break;
                    case "DocumentDate":
                        if (!sValTrim) oState = { state: "Error", text: "Document Date is required." };
                        break;
                    case "IncotermsClassification":
                        if (sValTrim.length > 3) oState = { state: "Error", text: "Incoterms classification must not exceed 3 characters (e.g. EXW)." };
                        break;
                    case "IncotermsLocation1":
                        if (oHeader.IncotermsClassification && !sValTrim) {
                            oState = { state: "Error", text: "Incoterms Location 1 is required when Incoterms is specified." };
                        } else if (sValTrim.length > 70) {
                            oState = { state: "Error", text: "Incoterms Location 1 must not exceed 70 characters." };
                        }
                        break;
                    case "PaymentTerms":
                        if (sValTrim.length > 4) oState = { state: "Error", text: "Payment Terms must not exceed 4 characters (e.g. 0001)." };
                        break;
                    default:
                        break;
                }

                if (typeof oModel.setProperty === "function") {
                    oModel.setProperty("/errors/" + sField, oState);
                } else if (oData.errors) {
                    oData.errors[sField] = oState;
                }
            } else {
                // Item field validation
                var aItems = oData.items || [];
                var oItem = aItems[iItemIndex];
                if (oItem) {
                    var iVal = sValue !== undefined ? sValue : (oItem[sField] || "");
                    var sItemValTrim = String(iVal || "").trim();
                    var sItemNo = oItem.PurchaseOrderItem || "Item #" + (iItemIndex + 1);

                    switch (sField) {
                        case "Material":
                            if (!sItemValTrim) oState = { state: "Error", text: sItemNo + ": Material is required (e.g. TG11)." };
                            break;
                        case "Plant":
                            if (!sItemValTrim) oState = { state: "Error", text: sItemNo + ": Plant is required (e.g. 1010)." };
                            break;
                        case "StorageLocation":
                            if (!sItemValTrim) oState = { state: "Error", text: sItemNo + ": Storage Location is required (e.g. 101A)." };
                            break;
                        case "UnitOfMeasure":
                            if (!sItemValTrim) oState = { state: "Error", text: sItemNo + ": Unit of Measure is required (e.g. PC)." };
                            break;
                        case "OrderQuantity":
                            var fQty = parseFloat(sItemValTrim);
                            if (!sItemValTrim || isNaN(fQty) || fQty <= 0) {
                                oState = { state: "Error", text: sItemNo + ": Order Quantity must be greater than 0." };
                            }
                            break;
                        case "NetPriceAmount":
                            if (sItemValTrim) {
                                var fPrice = parseFloat(sItemValTrim);
                                if (isNaN(fPrice) || fPrice < 0) {
                                    oState = { state: "Error", text: sItemNo + ": Net Price must be a non-negative number." };
                                }
                            }
                            break;
                        case "TaxCode":
                            if (sItemValTrim.length > 2) {
                                oState = { state: "Error", text: sItemNo + ": Tax Code must not exceed 2 characters." };
                            }
                            break;
                        default:
                            break;
                    }

                    if (typeof oModel.setProperty === "function") {
                        oModel.setProperty("/items/" + iItemIndex + "/errors/" + sField, oState);
                    } else if (oItem.errors) {
                        oItem.errors[sField] = oState;
                    }
                }
            }

            // Sync aggregate error state if form has been validated
            if (oData.hasError) {
                this.validateForm(oModel);
            }

            return oState;
        },

        /**
         * Validates the form data and updates field error states on the model for UI binding.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {{ isValid: boolean, errorCount: number, errorList: Array<{title: string, field: string, description: string, controlId: any}>, errorMessage: string }}
         */
        validateForm: function (oModel) {
            if (!oModel) return { isValid: false, errorCount: 0, errorList: [], errorMessage: "" };
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oHeader = oData.header || {};
            var aItems = oData.items || [];
            var aErrorList = [];

            // Header errors
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

            if (!oHeader.PurchaseOrderType || !String(oHeader.PurchaseOrderType).trim()) {
                oHeaderErrors.PurchaseOrderType = { state: "Error", text: "Document Type is required (e.g. NB)." };
                aErrorList.push({
                    type: "Error",
                    title: "Document Type is required.",
                    field: "General Data / Document Type",
                    description: "Select or enter a purchasing document type (e.g. NB for standard orders).",
                    controlId: "inDocType"
                });
            }
            if (!oHeader.CompanyCode || !String(oHeader.CompanyCode).trim()) {
                oHeaderErrors.CompanyCode = { state: "Error", text: "Company Code is required (e.g. 1010)." };
                aErrorList.push({
                    type: "Error",
                    title: "Company Code is required.",
                    field: "General Data / Company Code",
                    description: "Specify an active 4-character Company Code (e.g. 1010) registered in your SAP organization.",
                    controlId: "inCompanyCode"
                });
            }
            if (!oHeader.PurchasingOrganization || !String(oHeader.PurchasingOrganization).trim()) {
                oHeaderErrors.PurchasingOrganization = { state: "Error", text: "Purchasing Organization is required (e.g. 1010)." };
                aErrorList.push({
                    type: "Error",
                    title: "Purchasing Organization is required.",
                    field: "General Data / Purchasing Org",
                    description: "Enter a valid Purchasing Organization responsible for this procurement document.",
                    controlId: "inPurchOrg"
                });
            }
            if (!oHeader.PurchasingGroup || !String(oHeader.PurchasingGroup).trim()) {
                oHeaderErrors.PurchasingGroup = { state: "Error", text: "Purchasing Group is required (e.g. 001)." };
                aErrorList.push({
                    type: "Error",
                    title: "Purchasing Group is required.",
                    field: "General Data / Purchasing Group",
                    description: "Specify a 3-character buyer purchasing group (e.g. 001).",
                    controlId: "inPurchGrp"
                });
            }
            if (!oHeader.Supplier || !String(oHeader.Supplier).trim()) {
                oHeaderErrors.Supplier = { state: "Error", text: "Supplier is required (e.g. 10300001)." };
                aErrorList.push({
                    type: "Error",
                    title: "Supplier is required.",
                    field: "Supplier & Commercial Terms / Supplier",
                    description: "Enter or select an active SAP Business Partner / Supplier ID.",
                    controlId: "inSupplier"
                });
            }
            if (!oHeader.Currency || !String(oHeader.Currency).trim()) {
                oHeaderErrors.Currency = { state: "Error", text: "Currency is required (e.g. EUR, USD)." };
                aErrorList.push({
                    type: "Error",
                    title: "Currency is required.",
                    field: "Supplier & Commercial Terms / Currency",
                    description: "Enter a valid 3-letter ISO currency code (e.g. EUR, USD).",
                    controlId: "inCurrency"
                });
            } else if (!/^[A-Za-z]{3}$/.test(String(oHeader.Currency).trim())) {
                oHeaderErrors.Currency = { state: "Error", text: "Currency must be a valid 3-letter ISO code." };
                aErrorList.push({
                    type: "Error",
                    title: "Currency must be a 3-letter ISO code (e.g. EUR).",
                    field: "Supplier & Commercial Terms / Currency",
                    description: "Use an authorized ISO currency code (e.g. EUR, USD, INR).",
                    controlId: "inCurrency"
                });
            }
            if (!oHeader.DocumentDate || !String(oHeader.DocumentDate).trim()) {
                oHeaderErrors.DocumentDate = { state: "Error", text: "Document Date is required." };
                aErrorList.push({
                    type: "Error",
                    title: "Document Date is required.",
                    field: "General Data / Document Date",
                    description: "Choose the creation or document date for this purchase order.",
                    controlId: "inDocDate"
                });
            }
            if (oHeader.IncotermsClassification && String(oHeader.IncotermsClassification).trim().length > 3) {
                oHeaderErrors.IncotermsClassification = { state: "Error", text: "Incoterms must not exceed 3 characters." };
                aErrorList.push({
                    type: "Error",
                    title: "Incoterms must not exceed 3 characters.",
                    field: "Supplier & Commercial Terms / Incoterms",
                    description: "Enter a 3-letter Incoterms classification (e.g. EXW, FOB, CIF).",
                    controlId: "inIncoterms"
                });
            }
            if (oHeader.IncotermsClassification && (!oHeader.IncotermsLocation1 || !String(oHeader.IncotermsLocation1).trim())) {
                oHeaderErrors.IncotermsLocation1 = { state: "Error", text: "Incoterms Location is required when Incoterms is specified." };
                aErrorList.push({
                    type: "Error",
                    title: "Incoterms Location is required when Incoterms is specified.",
                    field: "Supplier & Commercial Terms / Incoterms Location",
                    description: "Provide the primary delivery location for Incoterms.",
                    controlId: "inIncotermsLoc"
                });
            } else if (oHeader.IncotermsLocation1 && String(oHeader.IncotermsLocation1).trim().length > 70) {
                oHeaderErrors.IncotermsLocation1 = { state: "Error", text: "Incoterms Location 1 exceeds maximum length of 70 characters." };
                aErrorList.push({
                    type: "Error",
                    title: "Incoterms Location 1 exceeds 70 characters.",
                    field: "Supplier & Commercial Terms / Incoterms Location",
                    description: "Shorten Incoterms Location 1 to at most 70 characters.",
                    controlId: "inIncotermsLoc"
                });
            }
            if (oHeader.PaymentTerms && String(oHeader.PaymentTerms).trim().length > 4) {
                oHeaderErrors.PaymentTerms = { state: "Error", text: "Payment Terms exceeds maximum length of 4 characters." };
                aErrorList.push({
                    type: "Error",
                    title: "Payment Terms exceeds 4 characters.",
                    field: "Supplier & Commercial Terms / Payment Terms",
                    description: "Enter a standard 4-character payment terms code (e.g. 0001).",
                    controlId: "inPaymentTerms"
                });
            }

            // Items errors
            if (aItems.length === 0) {
                aErrorList.push({
                    type: "Error",
                    title: "Please add at least one line item.",
                    field: "Items Table",
                    description: "Click 'Add Item' to insert at least one purchasing line item.",
                    controlId: "poItemsTable"
                });
            } else {
                aItems.forEach(function (item, idx) {
                    var sItemNo = item.PurchaseOrderItem || "Item #" + (idx + 1);
                    item.errors = item.errors || {};
                    item.errors.Plant = { state: "None", text: "" };
                    item.errors.StorageLocation = { state: "None", text: "" };
                    item.errors.Material = { state: "None", text: "" };
                    item.errors.OrderQuantity = { state: "None", text: "" };
                    item.errors.UnitOfMeasure = { state: "None", text: "" };
                    item.errors.NetPriceAmount = { state: "None", text: "" };
                    item.errors.TaxCode = { state: "None", text: "" };

                    if (!item.Material || !String(item.Material).trim()) {
                        item.errors.Material = { state: "Error", text: "Material is required." };
                        aErrorList.push({
                            type: "Error",
                            title: sItemNo + ": Material is required.",
                            field: sItemNo + " / Material",
                            description: "Select a valid material master number (e.g. TG11).",
                            itemIndex: idx,
                            cellIndex: 3,
                            controlId: "poItemsTable"
                        });
                    }
                    if (!item.Plant || !String(item.Plant).trim()) {
                        item.errors.Plant = { state: "Error", text: "Plant is required." };
                        aErrorList.push({
                            type: "Error",
                            title: sItemNo + ": Plant is required.",
                            field: sItemNo + " / Plant",
                            description: "Specify an authorized plant (e.g. 1010).",
                            itemIndex: idx,
                            cellIndex: 1,
                            controlId: "poItemsTable"
                        });
                    }
                    if (!item.StorageLocation || !String(item.StorageLocation).trim()) {
                        item.errors.StorageLocation = { state: "Error", text: "Storage Location is required." };
                        aErrorList.push({
                            type: "Error",
                            title: sItemNo + ": Storage Location is required.",
                            field: sItemNo + " / Storage Location",
                            description: "Specify the receiving storage location within the plant (e.g. 101A).",
                            itemIndex: idx,
                            cellIndex: 2,
                            controlId: "poItemsTable"
                        });
                    }
                    if (!item.UnitOfMeasure || !String(item.UnitOfMeasure).trim()) {
                        item.errors.UnitOfMeasure = { state: "Error", text: "Unit of Measure is required." };
                        aErrorList.push({
                            type: "Error",
                            title: sItemNo + ": Unit of Measure is required.",
                            field: sItemNo + " / Unit of Measure",
                            description: "Specify the order unit of measure (e.g. PC, KG).",
                            itemIndex: idx,
                            cellIndex: 5,
                            controlId: "poItemsTable"
                        });
                    }
                    var fQty = parseFloat(item.OrderQuantity);
                    if (!item.OrderQuantity || isNaN(fQty) || fQty <= 0) {
                        item.errors.OrderQuantity = { state: "Error", text: "Order Quantity must be greater than 0." };
                        aErrorList.push({
                            type: "Error",
                            title: sItemNo + ": Order Quantity must be greater than 0.",
                            field: sItemNo + " / Quantity",
                            description: "Enter a positive numeric quantity.",
                            itemIndex: idx,
                            cellIndex: 4,
                            controlId: "poItemsTable"
                        });
                    }
                    if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && String(item.NetPriceAmount).trim() !== "") {
                        var fPrice = parseFloat(item.NetPriceAmount);
                        if (isNaN(fPrice) || fPrice < 0) {
                            item.errors.NetPriceAmount = { state: "Error", text: "Net Price must be non-negative." };
                            aErrorList.push({
                                type: "Error",
                                title: sItemNo + ": Net Price must be non-negative.",
                                field: sItemNo + " / Net Price",
                                description: "Enter 0.00 or a positive net price.",
                                itemIndex: idx,
                                cellIndex: 6,
                                controlId: "poItemsTable"
                            });
                        }
                    }
                    if (item.TaxCode && String(item.TaxCode).trim().length > 2) {
                        item.errors.TaxCode = { state: "Error", text: "Tax Code exceeds 2 characters." };
                        aErrorList.push({
                            type: "Error",
                            title: sItemNo + ": Tax Code exceeds 2 characters.",
                            field: sItemNo + " / Tax Code",
                            description: "Enter a 2-character SAP tax code (e.g. V1, I0).",
                            itemIndex: idx,
                            cellIndex: 7,
                            controlId: "poItemsTable"
                        });
                    }
                });
            }

            var bHasError = aErrorList.length > 0;
            var sSummary = "";
            if (bHasError) {
                sSummary = aErrorList.length === 1
                    ? aErrorList[0].title
                    : aErrorList.length + " validation errors found. Please correct the highlighted fields.";
            }

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", bHasError);
                oModel.setProperty("/errorMessage", sSummary);
                oModel.setProperty("/errorCount", aErrorList.length);
                oModel.setProperty("/errorList", aErrorList);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = bHasError;
                oData.errorMessage = sSummary;
                oData.errorCount = aErrorList.length;
                oData.errorList = aErrorList;
            }

            return {
                isValid: !bHasError,
                errorCount: aErrorList.length,
                errorList: aErrorList,
                errorMessage: sSummary
            };
        },

        /**
         * Applies backend error details from S/4HANA or CAP to the model fields and error list.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oError
         * @returns {{ errorCount: number, errorList: Array, errorMessage: string }}
         */
        applyBackendErrors: function (oModel, oError) {
            if (!oModel) return { errorCount: 0, errorList: [], errorMessage: "" };
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var aErrorList = [];
            var sMainMessage = (oError && oError.message) || "Backend operation failed.";
            var aDetails = (oError && oError.details) || [];
            var iStatus = (oError && oError.status) || 500;

            var mHeaderTargets = {
                "header.purchaseordertype": "PurchaseOrderType",
                "purchaseordertype": "PurchaseOrderType",
                "doctype": "PurchaseOrderType",
                "header.companycode": "CompanyCode",
                "companycode": "CompanyCode",
                "header.purchasingorganization": "PurchasingOrganization",
                "purchasingorganization": "PurchasingOrganization",
                "purchasingorg": "PurchasingOrganization",
                "header.purchasinggroup": "PurchasingGroup",
                "purchasinggroup": "PurchasingGroup",
                "purchgroup": "PurchasingGroup",
                "header.supplier": "Supplier",
                "supplier": "Supplier",
                "vendor": "Supplier",
                "header.currency": "Currency",
                "currency": "Currency",
                "header.documentdate": "DocumentDate",
                "documentdate": "DocumentDate",
                "header.paymentterms": "PaymentTerms",
                "paymentterms": "PaymentTerms",
                "header.incotermsclassification": "IncotermsClassification",
                "incotermsclassification": "IncotermsClassification",
                "incoterms": "IncotermsClassification",
                "header.incotermslocation1": "IncotermsLocation1",
                "incotermslocation1": "IncotermsLocation1"
            };

            var mItemTargets = {
                "material": "Material",
                "plant": "Plant",
                "storagelocation": "StorageLocation",
                "orderquantity": "OrderQuantity",
                "quantity": "OrderQuantity",
                "unitofmeasure": "UnitOfMeasure",
                "uom": "UnitOfMeasure",
                "netpriceamount": "NetPriceAmount",
                "netprice": "NetPriceAmount",
                "taxcode": "TaxCode"
            };

            var oHeaderErrors = oData.errors || {
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

            if (aDetails.length > 0) {
                var that = this;
                aDetails.forEach(function (detail) {
                    var sDetailMsg = detail.message || sMainMessage;
                    var sTarget = String(detail.target || "").toLowerCase();
                    var sCode = detail.code || "";
                    var sControlId = null;
                    var iItemIdx = -1;
                    var sItemField = null;

                    // Match header target
                    for (var k in mHeaderTargets) {
                        if (sTarget === k || sTarget.endsWith("." + k) || sTarget.endsWith("/" + k)) {
                            var sFieldKey = mHeaderTargets[k];
                            oHeaderErrors[sFieldKey] = { state: "Error", text: sDetailMsg };
                            sControlId = that.HEADER_FIELD_CONFIG[sFieldKey] ? that.HEADER_FIELD_CONFIG[sFieldKey].controlId : null;
                            break;
                        }
                    }

                    // Match item target (e.g. items[0].Plant or Plant)
                    if (!sControlId) {
                        var oItemMatch = sTarget.match(/items\[(\d+)\]\.?(\w+)?/);
                        if (oItemMatch) {
                            iItemIdx = parseInt(oItemMatch[1], 10);
                            var sTargetField = (oItemMatch[2] || "").toLowerCase();
                            sItemField = mItemTargets[sTargetField] || null;
                        } else {
                            for (var it in mItemTargets) {
                                if (sTarget === it || sTarget.endsWith("." + it)) {
                                    sItemField = mItemTargets[it];
                                    iItemIdx = 0;
                                    break;
                                }
                            }
                        }

                        if (sItemField && aItems[iItemIdx]) {
                            aItems[iItemIdx].errors = aItems[iItemIdx].errors || {};
                            aItems[iItemIdx].errors[sItemField] = { state: "Error", text: sDetailMsg };
                            sControlId = "poItemsTable";
                        }
                    }

                    aErrorList.push({
                        type: "Error",
                        title: sDetailMsg,
                        field: sCode ? ("SAP (" + sCode + ")") : (detail.target || "S/4HANA Error"),
                        description: (detail.description || sDetailMsg) + (sCode ? (" [Code: " + sCode + "]") : ""),
                        controlId: sControlId,
                        itemIndex: iItemIdx >= 0 ? iItemIdx : undefined,
                        cellIndex: sItemField && that.ITEM_FIELD_CONFIG[sItemField] ? that.ITEM_FIELD_CONFIG[sItemField].cellIndex : undefined
                    });
                });
            } else if (sMainMessage.indexOf(";") !== -1) {
                var that = this;
                var aParts = sMainMessage.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
                aParts.forEach(function (sPart) {
                    var sLower = sPart.toLowerCase();
                    var sControlId = null;

                    for (var k in mHeaderTargets) {
                        if (sLower.indexOf(k) !== -1) {
                            var sFieldKey = mHeaderTargets[k];
                            oHeaderErrors[sFieldKey] = { state: "Error", text: sPart };
                            sControlId = that.HEADER_FIELD_CONFIG[sFieldKey] ? that.HEADER_FIELD_CONFIG[sFieldKey].controlId : null;
                            break;
                        }
                    }

                    if (!sControlId) {
                        for (var it in mItemTargets) {
                            if (sLower.indexOf(it) !== -1) {
                                var sItemField = mItemTargets[it];
                                if (aItems[0]) {
                                    aItems[0].errors = aItems[0].errors || {};
                                    aItems[0].errors[sItemField] = { state: "Error", text: sPart };
                                    sControlId = "poItemsTable";
                                }
                                break;
                            }
                        }
                    }

                    aErrorList.push({
                        type: "Error",
                        title: sPart,
                        field: sControlId ? "Validation" : ("SAP Backend (HTTP " + iStatus + ")"),
                        description: sPart,
                        controlId: sControlId
                    });
                });
            } else {
                var sLower = sMainMessage.toLowerCase();
                var sControlId = null;
                for (var hk in mHeaderTargets) {
                    if (sLower.indexOf(hk) !== -1) {
                        var sFieldKey = mHeaderTargets[hk];
                        oHeaderErrors[sFieldKey] = { state: "Error", text: sMainMessage };
                        sControlId = this.HEADER_FIELD_CONFIG[sFieldKey] ? this.HEADER_FIELD_CONFIG[sFieldKey].controlId : null;
                        break;
                    }
                }
                aErrorList.push({
                    type: "Error",
                    title: sMainMessage,
                    field: "SAP Backend (HTTP " + iStatus + ")",
                    description: (oError && oError.code ? ("Error code: " + oError.code + ". ") : "") + sMainMessage,
                    controlId: sControlId
                });
            }

            var sSummary = aErrorList.length === 1
                ? aErrorList[0].title
                : aErrorList.length + " errors returned by backend. Please review and resolve.";

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", true);
                oModel.setProperty("/errorMessage", sSummary);
                oModel.setProperty("/errorCount", aErrorList.length);
                oModel.setProperty("/errorList", aErrorList);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = true;
                oData.errorMessage = sSummary;
                oData.errorCount = aErrorList.length;
                oData.errorList = aErrorList;
            }

            return {
                errorCount: aErrorList.length,
                errorList: aErrorList,
                errorMessage: sSummary
            };
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
            } else {
                var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
                if (oData) {
                    oData.userModified = oData.userModified || {};
                    oData.userModified[sField] = bVal;
                }
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
         * @returns {Object} Report of applied defaults, user preserved fields, and unconfirmed values
         */
        applyConfigurationDefaults: function (oModel, oConfigData) {
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

            // 1. Document Date = Today
            var sToday = new Date().toISOString().split("T")[0];
            if (!oHeader.DocumentDate) {
                oHeader.DocumentDate = sToday;
                oReport.applied.DocumentDate = sToday;
            }

            // 2. Document Type (e.g. ZDOM) driving applicable configuration
            var sCurrentDocType = (oHeader.PurchaseOrderType || "").trim();
            var bZdomAvailable = aDocTypes.some(function (dt) {
                return dt && (dt.PurchasingDocumentType === "ZDOM");
            });

            // If Document Type is not user modified, and ZDOM is available in config, select ZDOM
            if (!oUserModified.PurchaseOrderType && bZdomAvailable && (sCurrentDocType === "" || sCurrentDocType === "NB")) {
                oHeader.PurchaseOrderType = "ZDOM";
                sCurrentDocType = "ZDOM";
                oConfigDerived.PurchaseOrderType = true;
                oReport.applied.PurchaseOrderType = "ZDOM";
            }

            // 3. Confirm Company Code = 1000 ONLY when confirmed valid/configured in master data
            var bCoCode1000Confirmed = aCompanyCodes.some(function (cc) {
                return cc && (cc.CompanyCode === "1000");
            });

            if (bCoCode1000Confirmed) {
                if (!oUserModified.CompanyCode) {
                    oHeader.CompanyCode = "1000";
                    oConfigDerived.CompanyCode = true;
                    oReport.applied.CompanyCode = "1000";
                    this.validateSingleField(oModel, "CompanyCode", "1000");
                } else {
                    oReport.skippedDueToUser.CompanyCode = oHeader.CompanyCode;
                }
            } else {
                oReport.unconfirmed.push("CompanyCode 1000 is not configured or valid in SAP master data.");
                // Never invent defaults - do not set 1000 if not confirmed
            }

            // 4. Confirm Purchasing Organization = AE01 ONLY when confirmed valid/configured
            var bPurchOrgAE01Confirmed = aPurchOrgs.some(function (po) {
                var bIdMatch = po && (po.PurchasingOrganization === "AE01");
                var bCoMatch = !po.CompanyCode || po.CompanyCode === "1000";
                return bIdMatch && bCoMatch;
            });

            if (bPurchOrgAE01Confirmed) {
                if (!oUserModified.PurchasingOrganization) {
                    oHeader.PurchasingOrganization = "AE01";
                    oConfigDerived.PurchasingOrganization = true;
                    oReport.applied.PurchasingOrganization = "AE01";
                    this.validateSingleField(oModel, "PurchasingOrganization", "AE01");
                } else {
                    oReport.skippedDueToUser.PurchasingOrganization = oHeader.PurchasingOrganization;
                }
            } else {
                oReport.unconfirmed.push("Purchasing Organization AE01 is not configured or valid for Company Code 1000.");
                // Never invent defaults - do not set AE01 if not confirmed
            }

            // 5. Purchasing Group validation/defaulting
            if (!oHeader.PurchasingGroup && !oUserModified.PurchasingGroup) {
                var oDefGroup = aPurchGroups.find(function (pg) {
                    return pg && (pg.PurchasingGroup === "101" || pg.PurchasingGroup === "001");
                });
                if (oDefGroup) {
                    oHeader.PurchasingGroup = oDefGroup.PurchasingGroup;
                    oConfigDerived.PurchasingGroup = true;
                    oReport.applied.PurchasingGroup = oDefGroup.PurchasingGroup;
                    this.validateSingleField(oModel, "PurchasingGroup", oDefGroup.PurchasingGroup);
                }
            }

            // Save state back to model
            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/header", oHeader);
                oModel.setProperty("/userModified", oUserModified);
                oModel.setProperty("/configDerived", oConfigDerived);
            }

            this.updateStatus(oModel);
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
         * @returns {Object} Report of applied fields, preserved fields, and derivation warnings
         */
        deriveSupplierDefaults: function (oModel, sSupplier, oDefaults) {
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

            // 1. Currency Derivation
            if (oDefs.Currency && String(oDefs.Currency).trim() !== "") {
                if (!oUserModified.Currency || !oHeader.Currency) {
                    var sCurr = String(oDefs.Currency).trim().toUpperCase();
                    oHeader.Currency = sCurr;
                    oConfigDerived.Currency = true;
                    oReport.applied.Currency = sCurr;
                    this.validateSingleField(oModel, "Currency", sCurr);
                } else {
                    oReport.preserved.Currency = oHeader.Currency;
                }
            } else {
                // Default cannot be derived
                if (!oHeader.Currency) {
                    oReport.missing.push("Currency");
                    this.setFieldValidation(oModel, "Currency", "Information", "Currency could not be derived from supplier master; please enter manually.");
                }
            }

            // 2. Payment Terms Derivation
            if (oDefs.PaymentTerms && String(oDefs.PaymentTerms).trim() !== "") {
                if (!oUserModified.PaymentTerms || !oHeader.PaymentTerms) {
                    var sPayTerms = String(oDefs.PaymentTerms).trim().toUpperCase();
                    oHeader.PaymentTerms = sPayTerms;
                    oConfigDerived.PaymentTerms = true;
                    oReport.applied.PaymentTerms = sPayTerms;
                    this.validateSingleField(oModel, "PaymentTerms", sPayTerms);
                } else {
                    oReport.preserved.PaymentTerms = oHeader.PaymentTerms;
                }
            } else {
                if (!oHeader.PaymentTerms) {
                    oReport.missing.push("PaymentTerms");
                    this.setFieldValidation(oModel, "PaymentTerms", "Information", "No payment terms configured for this supplier; please select if required.");
                }
            }

            // 3. Incoterms Classification Derivation
            if (oDefs.IncotermsClassification && String(oDefs.IncotermsClassification).trim() !== "") {
                if (!oUserModified.IncotermsClassification || !oHeader.IncotermsClassification) {
                    var sInco = String(oDefs.IncotermsClassification).trim().toUpperCase();
                    oHeader.IncotermsClassification = sInco;
                    oConfigDerived.IncotermsClassification = true;
                    oReport.applied.IncotermsClassification = sInco;
                    this.validateSingleField(oModel, "IncotermsClassification", sInco);
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
                    this.validateSingleField(oModel, "IncotermsLocation1", sIncoLoc);
                } else {
                    oReport.preserved.IncotermsLocation1 = oHeader.IncotermsLocation1;
                }
            } else if (oHeader.IncotermsClassification && !oHeader.IncotermsLocation1) {
                // Incoterms present but location missing
                oReport.missing.push("IncotermsLocation1");
                this.setFieldValidation(oModel, "IncotermsLocation1", "Error", "Incoterms Location 1 is required when Incoterms is specified.");
            }

            // Update model
            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/header", oHeader);
                oModel.setProperty("/userModified", oUserModified);
                oModel.setProperty("/configDerived", oConfigDerived);
            }

            this.updateStatus(oModel);
            return oReport;
        },

        /**
         * Cross-validates Company Code and Purchasing Organization compatibility:
         * If Purchasing Org is assigned to a different Company Code in SAP master data,
         * flags error or clears it.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {{ purchasingOrgs?: Array }} oConfigData
         * @returns {{ isValid: boolean, message: string }}
         */
        validateCompanyCodePurchasingOrg: function (oModel, oConfigData) {
            if (!oModel) return { isValid: true, message: "" };
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oHeader = (oData && oData.header) || {};
            var sCoCode = (oHeader.CompanyCode || "").trim();
            var sPurchOrg = (oHeader.PurchasingOrganization || "").trim();

            if (!sCoCode || !sPurchOrg) {
                return { isValid: true, message: "" };
            }

            var aPurchOrgs = (oConfigData && oConfigData.purchasingOrgs) || [];
            if (aPurchOrgs.length === 0) {
                return { isValid: true, message: "" };
            }

            var oOrgRecord = aPurchOrgs.find(function (org) {
                return org && org.PurchasingOrganization === sPurchOrg;
            });

            if (oOrgRecord && oOrgRecord.CompanyCode && oOrgRecord.CompanyCode !== sCoCode) {
                var sMsg = "Purchasing Organization " + sPurchOrg + " belongs to Company Code " + oOrgRecord.CompanyCode + ", not " + sCoCode + ".";
                this.setFieldValidation(oModel, "PurchasingOrganization", "Error", sMsg);
                return { isValid: false, message: sMsg };
            }

            return { isValid: true, message: "" };
        }
    };
});
