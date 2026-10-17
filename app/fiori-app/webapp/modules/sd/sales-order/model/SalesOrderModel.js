sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    var CURRENCY_REGEX = /^[A-Z]{3}$/;
    var CONTACT_PERSON_REGEX = /^\d{1,10}$/;

    var INCOMPLETION_HEADER_FIELDS = [
        { field: "PaymentTerms", label: "Payment Terms" },
        { field: "ContactPerson", label: "Contact Person" }
    ];

    return {
        /**
         * Resolves current username from OwnerComponent auth or user models.
         *
         * @param {sap.ui.core.UIComponent} oComponent
         * @returns {string}
         */
        getCurrentUserName: function (oComponent) {
            try {
                var oGlobal = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : null);
                var oSap = oGlobal ? oGlobal["s" + "ap"] : null;
                if (oSap && oSap.ui && typeof oSap.ui.require === "function") {
                    var AuthService = oSap.ui.require("saps4hana/fiori/service/AuthService");
                    if (AuthService && typeof AuthService.getCurrentUserName === "function") {
                        var sUser = AuthService.getCurrentUserName(oComponent);
                        if (sUser) return sUser;
                    }
                }
            } catch (e) {
                // AuthService not loaded (e.g. unit tests): no user name available.
            }

            if (!oComponent) return "alice";
            var oAuthModel = oComponent.getModel("auth");
            var sAuthUser = oAuthModel ? oAuthModel.getProperty("/user/username") : "";
            if (sAuthUser && typeof sAuthUser === "string" && sAuthUser.trim() !== "") {
                return sAuthUser.trim();
            }
            var oUserModel = oComponent.getModel("user");
            var sModelUser = oUserModel ? oUserModel.getProperty("/username") : "";
            return (sModelUser && typeof sModelUser === "string" && sModelUser.trim() !== "") ? sModelUser.trim() : "alice";
        },

        /**
         * Creates initial model for VA01 Sales Order creation.
         *
         * @param {string} [sUser="alice"]
         * @returns {sap.ui.model.json.JSONModel}
         */
        createInitialModel: function (sUser) {
            var today = new Date().toISOString().split("T")[0];

            return new JSONModel({
                header: {
                    SalesOrderType: "",
                    SalesOrganization: "",
                    DistributionChannel: "",
                    OrganizationDivision: "",
                    SalesOffice: "",
                    SalesGroup: "",
                    SoldToParty: "",
                    CustomerName: "",
                    CustomerCity: "",
                    CustomerCountry: "",
                    ShipToParty: "",
                    ShipToPartyName: "",
                    PurchaseOrderNumber: "",
                    PurchaseOrderByCustomer: "",
                    CustomerPurchaseOrderDate: "",
                    SalesOrderDate: today,
                    RequestedDeliveryDate: "",
                    TransactionCurrency: "",
                    TotalNetAmount: "0.00",
                    CustomerGroup2: "",
                    PortOfLoading: "",
                    PortOfDischarge: "",
                    Incoterms: "",
                    IncotermsLocation1: "",
                    INCO1: "",
                    INCO2: "",
                    INCO2_L: "",
                    ContactPerson: "",
                    PaymentTerms: "",
                    PaymentTermCode: "",
                    CreatedByUser: sUser || "alice",
                    StatusText: "In Progress",
                    StatusState: "Warning",
                    StatusIcon: "sap-icon://in-progress"
                },
                items: [
                    {
                        SalesOrderItem: "10",
                        Material: "",
                        SalesOrderItemText: "",
                        OrderQuantity: "",
                        OrderQuantityUnit: "",
                        Plant: "",
                        RequestedDeliveryDate: "",
                        NetPriceAmount: "0.00",
                        NetAmount: "0.00",
                        errors: {}
                    }
                ],
                errors: {
                    ContactPerson: { state: "None", text: "" },
                    PaymentTerms: { state: "None", text: "" }
                },
                errorList: [],
                errorCount: 0,
                errorMessage: "",
                hasError: false,
                isModified: false,
                modifiedFields: {}
            });
        },

        /**
         * Creates a fresh blank line item.
         *
         * @param {number} iIndex
         * @param {string} [sPlant=""]
         * @param {string} [sReqDlvDate]
         * @returns {Object}
         */
        createEmptyItem: function (iIndex, sPlant, sReqDlvDate) {
            var sItemNum = String(((iIndex || 0) + 1) * 10);
            return {
                SalesOrderItem: sItemNum,
                Material: "",
                SalesOrderItemText: "",
                OrderQuantity: "",
                OrderQuantityUnit: "",
                Plant: sPlant || "",
                RequestedDeliveryDate: sReqDlvDate || "",
                NetPriceAmount: "0.00",
                NetAmount: "0.00",
                errors: {}
            };
        },

        /**
         * Calculates line item net amounts and the header total net value.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         */
        calculateTotals: function (oModel) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            var nTotal = 0;

            aItems.forEach(function (oItem) {
                var nQty = parseFloat(oItem.OrderQuantity) || 0;
                var nPrice = parseFloat(oItem.NetPriceAmount) || 0;
                var nItemNet = nQty * nPrice;
                oItem.NetAmount = nItemNet.toFixed(2);
                nTotal += nItemNet;
            });

            oModel.setProperty("/items", aItems);
            oModel.setProperty("/header/TotalNetAmount", nTotal.toFixed(2));
        },

        /**
         * Applies customer defaults derived from S/4HANA to the order model.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oCustomerData
         */
        applyCustomerDefaults: function (oModel, oCustomerData) {
            if (!oModel || !oCustomerData) return;
            var oHeader = oModel.getProperty("/header") || {};
            var oModified = oModel.getProperty("/modifiedFields") || {};

            if (oCustomerData.CustomerName) {
                oModel.setProperty("/header/CustomerName", oCustomerData.CustomerName);
            }
            if (oCustomerData.City) {
                oModel.setProperty("/header/CustomerCity", oCustomerData.City);
            }
            if (oCustomerData.Country) {
                oModel.setProperty("/header/CustomerCountry", oCustomerData.Country);
            }
            if (oCustomerData.Currency && !oModified.TransactionCurrency && (!oHeader.TransactionCurrency || String(oHeader.TransactionCurrency).trim() === "")) {
                oModel.setProperty("/header/TransactionCurrency", oCustomerData.Currency);
            }
            if (oCustomerData.ShipToParty && !oModified.ShipToParty && (!oHeader.ShipToParty || String(oHeader.ShipToParty).trim() === "")) {
                oModel.setProperty("/header/ShipToParty", oCustomerData.ShipToParty);
            }
            if (oCustomerData.ShipToPartyName) {
                oModel.setProperty("/header/ShipToPartyName", oCustomerData.ShipToPartyName);
            }
            if (oCustomerData.SalesOffice && !oModified.SalesOffice && (!oHeader.SalesOffice || String(oHeader.SalesOffice).trim() === "")) {
                oModel.setProperty("/header/SalesOffice", oCustomerData.SalesOffice);
            }
            if (oCustomerData.SalesGroup && !oModified.SalesGroup && (!oHeader.SalesGroup || String(oHeader.SalesGroup).trim() === "")) {
                oModel.setProperty("/header/SalesGroup", oCustomerData.SalesGroup);
            }
            if (oCustomerData.PaymentTerms && !oModified.PaymentTerms && (!oHeader.PaymentTerms || String(oHeader.PaymentTerms).trim() === "")) {
                oModel.setProperty("/header/PaymentTerms", oCustomerData.PaymentTerms);
            }
            var sIncoDefault = oCustomerData.Incoterms || oCustomerData.INCO1 || oCustomerData.IncotermsClassification;
            if (sIncoDefault && !oModified.Incoterms && !oModified.INCO1 && (!oHeader.Incoterms || String(oHeader.Incoterms).trim() === "")) {
                oModel.setProperty("/header/Incoterms", sIncoDefault);
                oModel.setProperty("/header/INCO1", sIncoDefault);
            }
            var sIncoLocDefault = oCustomerData.IncotermsLocation1 || oCustomerData.INCO2 || oCustomerData.INCO2_L;
            if (sIncoLocDefault && !oModified.IncotermsLocation1 && !oModified.INCO2 && (!oHeader.IncotermsLocation1 || String(oHeader.IncotermsLocation1).trim() === "")) {
                oModel.setProperty("/header/IncotermsLocation1", sIncoLocDefault);
                oModel.setProperty("/header/INCO2", sIncoLocDefault);
                oModel.setProperty("/header/INCO2_L", sIncoLocDefault);
            }
        },

        /**
         * Applies material master defaults to a given line item.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sPath Item path in JSONModel, e.g. "/items/0"
         * @param {Object} oMaterialData
         * @param {boolean} [bKeepQty=false]
         */
        applyMaterialDefaults: function (oModel, sPath, oMaterialData, bKeepQty) {
            if (!oModel || !sPath || !oMaterialData) return;

            var sMaterial = oMaterialData.Material || oMaterialData.Product || "";
            var sDesc = oMaterialData.MaterialName || oMaterialData.Material_Text || oMaterialData.ProductDescription || "";
            var sUnit = oMaterialData.MaterialBaseUnit || oMaterialData.BaseUnit || oMaterialData.OrderQuantityUnit || "";

            oModel.setProperty(sPath + "/Material", sMaterial);
            if (sDesc) {
                oModel.setProperty(sPath + "/SalesOrderItemText", sDesc);
            }
            if (sUnit) {
                oModel.setProperty(sPath + "/OrderQuantityUnit", sUnit);
            }
            if (!bKeepQty) {
                var currentQty = oModel.getProperty(sPath + "/OrderQuantity");
                if (!currentQty || parseFloat(currentQty) <= 0) {
                    oModel.setProperty(sPath + "/OrderQuantity", "1.000");
                }
            }

            oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            this.calculateTotals(oModel);
        },

        /**
         * Validates a single header property and stores error state in /errors.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sField
         * @returns {boolean} true if valid
         */
        validateSingleField: function (oModel, sField) {
            if (!oModel) return true;
            var oHeader = oModel.getProperty("/header") || {};
            var vVal = oHeader[sField];
            var sError = "";

            switch (sField) {
                case "SalesOrderType":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Order Type is required";
                    } else if (String(vVal).trim().length > 4) {
                        sError = "Order Type cannot exceed 4 characters";
                    }
                    break;
                case "SalesOrganization":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Sales Organization is required";
                    } else if (String(vVal).trim().length > 4) {
                        sError = "Sales Organization cannot exceed 4 characters";
                    }
                    break;
                case "DistributionChannel":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Distribution Channel is required";
                    } else if (String(vVal).trim().length > 2) {
                        sError = "Distribution Channel cannot exceed 2 characters";
                    }
                    break;
                case "OrganizationDivision":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Division is required";
                    } else if (String(vVal).trim().length > 2) {
                        sError = "Division cannot exceed 2 characters";
                    }
                    break;
                case "SoldToParty":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Sold-to Party (Customer) is required";
                    } else if (String(vVal).trim().length > 10) {
                        sError = "Sold-to Party cannot exceed 10 characters";
                    } else {
                        var oCurrentErr = oModel.getProperty("/errors/SoldToParty");
                        if (oCurrentErr && oCurrentErr.state === "Error" && oCurrentErr.text && oCurrentErr.text.indexOf("not maintained") !== -1) {
                            sError = oCurrentErr.text;
                        }
                    }
                    break;
                case "TransactionCurrency":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Currency is required";
                    } else if (!CURRENCY_REGEX.test(String(vVal).trim().toUpperCase())) {
                        sError = "Currency must be a valid 3-character ISO code (e.g. INR, USD)";
                    }
                    break;
                case "PurchaseOrderNumber":
                case "PurchaseOrderByCustomer":
                    if (vVal && String(vVal).trim().length > 35) {
                        sError = "PO Reference cannot exceed 35 characters";
                    }
                    break;
                case "RequestedDeliveryDate":
                    if (vVal) {
                        var dReq = new Date(vVal);
                        if (isNaN(dReq.getTime())) {
                            sError = "Requested Delivery Date must be a valid date";
                        }
                    }
                    break;
                case "PaymentTerms":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Payment Terms are required";
                    } else if (String(vVal).trim().length > 4) {
                        sError = "Payment Terms cannot exceed 4 characters";
                    }
                    break;
                case "ContactPerson":
                    if (!vVal || String(vVal).trim() === "") {
                        sError = "Contact Person is required";
                    } else if (!CONTACT_PERSON_REGEX.test(String(vVal).trim())) {
                        sError = "Contact Person must be a numeric SAP contact number (up to 10 digits)";
                    }
                    break;
                case "Incoterms":
                case "INCO1":
                    if (vVal && String(vVal).trim().length > 3) {
                        sError = "Incoterms cannot exceed 3 characters";
                    }
                    break;
                case "IncotermsLocation1":
                case "INCO2":
                case "INCO2_L":
                    if (vVal && String(vVal).trim().length > 70) {
                        sError = "Incoterms Location cannot exceed 70 characters";
                    }
                    break;
                default:
                    break;
            }

            var oFieldState = sError ? { state: "Error", text: sError } : { state: "None", text: "" };
            oModel.setProperty("/errors/" + sField, oFieldState);
            return !sError;
        },

        /**
         * Validates all form fields including header and line items.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {boolean}
         */
        validateForm: function (oModel) {
            if (!oModel) return false;
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];
            var aErrors = [];

            var aRequiredHeaderFields = [
                "SalesOrderType",
                "SalesOrganization",
                "DistributionChannel",
                "OrganizationDivision",
                "SoldToParty",
                "TransactionCurrency",
                "PaymentTerms",
                "ContactPerson"
            ];

            var that = this;
            aRequiredHeaderFields.forEach(function (sField) {
                var bValid = that.validateSingleField(oModel, sField);
                if (!bValid) {
                    var sText = oModel.getProperty("/errors/" + sField + "/text");
                    aErrors.push({ field: sField, message: sText });
                }
            });

            // PO Number & Requested Delivery Date validation
            if (oHeader.PurchaseOrderNumber && String(oHeader.PurchaseOrderNumber).trim().length > 35) {
                aErrors.push({ field: "PurchaseOrderNumber", message: "PO Reference cannot exceed 35 characters" });
            }
            if (oHeader.RequestedDeliveryDate) {
                var dReq = new Date(oHeader.RequestedDeliveryDate);
                if (isNaN(dReq.getTime())) {
                    aErrors.push({ field: "RequestedDeliveryDate", message: "Requested Delivery Date must be a valid date" });
                }
            }

            // Items validation
            if (!aItems || aItems.length === 0) {
                aErrors.push({ field: "items", message: "At least one order line item is required" });
            } else {
                aItems.forEach(function (oItem, idx) {
                    oItem.errors = oItem.errors || {};
                    var sItemLabel = "Item " + (idx + 1) + " (" + (oItem.SalesOrderItem || ((idx + 1) * 10)) + ")";

                    if (!oItem.Material || String(oItem.Material).trim() === "") {
                        oItem.errors.Material = { state: "Error", text: "Material is required" };
                        aErrors.push({ field: "Material", itemIndex: idx, message: sItemLabel + ": Material is required" });
                    } else {
                        oItem.errors.Material = { state: "None", text: "" };
                    }

                    var nQty = parseFloat(oItem.OrderQuantity);
                    if (oItem.OrderQuantity === undefined || oItem.OrderQuantity === null || isNaN(nQty) || nQty <= 0) {
                        oItem.errors.OrderQuantity = { state: "Error", text: "Quantity must be greater than 0" };
                        aErrors.push({ field: "OrderQuantity", itemIndex: idx, message: sItemLabel + ": Quantity must be greater than 0" });
                    } else {
                        oItem.errors.OrderQuantity = { state: "None", text: "" };
                    }

                    if (!oItem.OrderQuantityUnit || String(oItem.OrderQuantityUnit).trim() === "") {
                        oItem.errors.OrderQuantityUnit = { state: "Error", text: "Unit of measure is required" };
                        aErrors.push({ field: "OrderQuantityUnit", itemIndex: idx, message: sItemLabel + ": Unit of measure is required" });
                    } else {
                        oItem.errors.OrderQuantityUnit = { state: "None", text: "" };
                    }

                    if (!oItem.Plant || String(oItem.Plant).trim() === "") {
                        oItem.errors.Plant = { state: "Error", text: "Plant is required" };
                        aErrors.push({ field: "Plant", itemIndex: idx, message: sItemLabel + ": Plant is required" });
                    } else if (String(oItem.Plant).trim().length > 4) {
                        oItem.errors.Plant = { state: "Error", text: "Plant cannot exceed 4 characters" };
                        aErrors.push({ field: "Plant", itemIndex: idx, message: sItemLabel + ": Plant cannot exceed 4 characters" });
                    } else {
                        oItem.errors.Plant = { state: "None", text: "" };
                    }
                });
                oModel.setProperty("/items", aItems);
            }

            var bIsValid = aErrors.length === 0;
            oModel.setProperty("/errorList", aErrors);
            oModel.setProperty("/errorCount", aErrors.length);
            oModel.setProperty("/hasError", !bIsValid);
            oModel.setProperty("/errorMessage", bIsValid ? "" : aErrors[0].message);

            this.updateStatus(oModel);
            return bIsValid;
        },

        /**
         * Returns list of missing incompletion fields.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {Array<string>}
         */
        getIncompletionGaps: function (oModel) {
            if (!oModel) return [];
            var oHeader = oModel.getProperty("/header") || {};
            var aGaps = [];

            INCOMPLETION_HEADER_FIELDS.forEach(function (f) {
                if (!oHeader[f.field] || String(oHeader[f.field]).trim() === "") {
                    aGaps.push(f.label);
                }
            });

            return aGaps;
        },

        /**
         * Updates visual status indicator of the document.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         */
        updateStatus: function (oModel) {
            if (!oModel) return;
            var iErrors = oModel.getProperty("/errorCount") || 0;
            var oHeader = oModel.getProperty("/header") || {};

            if (iErrors > 0) {
                oModel.setProperty("/header/StatusText", "Incomplete (" + iErrors + " issues)");
                oModel.setProperty("/header/StatusState", "Error");
                oModel.setProperty("/header/StatusIcon", "sap-icon://error");
            } else if (!oHeader.SoldToParty) {
                oModel.setProperty("/header/StatusText", "Draft (No Customer)");
                oModel.setProperty("/header/StatusState", "Warning");
                oModel.setProperty("/header/StatusIcon", "sap-icon://in-progress");
            } else {
                oModel.setProperty("/header/StatusText", "Ready to Submit");
                oModel.setProperty("/header/StatusState", "Success");
                oModel.setProperty("/header/StatusIcon", "sap-icon://sys-enter-2");
            }
        },

        /**
         * Clears all validation errors.
         */
        clearErrors: function (oModel) {
            if (!oModel) return;
            oModel.setProperty("/errors", {});
            oModel.setProperty("/errorList", []);
            oModel.setProperty("/errorCount", 0);
            oModel.setProperty("/errorMessage", "");
            oModel.setProperty("/hasError", false);

            var aItems = oModel.getProperty("/items") || [];
            aItems.forEach(function (item) {
                item.errors = {};
            });
            oModel.setProperty("/items", aItems);
        },

        /**
         * Applies server-sourced defaults from getSalesOrderDefaults() to empty model fields.
         * Only sets a field if it is currently empty (not yet modified by the user).
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oDefaults - Response from getSalesOrderDefaults()
         */
        applyServerDefaults: function (oModel, oDefaults) {
            if (!oModel || !oDefaults) return;

            var oHeader = oModel.getProperty("/header") || {};

            var aHeaderFields = [
                "SalesOrderType",
                "SalesOrganization",
                "DistributionChannel",
                "OrganizationDivision",
                "TransactionCurrency",
                "RequestedDeliveryDate"
            ];

            aHeaderFields.forEach(function (sField) {
                if ((!oHeader[sField] || String(oHeader[sField]).trim() === "") && oDefaults[sField]) {
                    oModel.setProperty("/header/" + sField, oDefaults[sField]);
                }
            });

            // Apply plant and unit defaults to items that are still empty
            var aItems = oModel.getProperty("/items") || [];
            var sDefPlant = oDefaults.Plant || "";
            var sDefUnit = oDefaults.OrderQuantityUnit || "";
            var sDefReqDlvDate = oDefaults.RequestedDeliveryDate || "";
            aItems.forEach(function (itm) {
                if (!itm.Plant && sDefPlant) {
                    itm.Plant = sDefPlant;
                }
                if (!itm.OrderQuantityUnit && sDefUnit) {
                    itm.OrderQuantityUnit = sDefUnit;
                }
                if (!itm.RequestedDeliveryDate && sDefReqDlvDate) {
                    itm.RequestedDeliveryDate = sDefReqDlvDate;
                }
            });
            oModel.setProperty("/items", aItems);
        },

        /**
         * Builds a clean API-compliant payload conforming to the CAP OrderHeader and OrderItem contract.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {{ header: Object, items: Array<Object> }}
         */
        buildPayload: function (oModel) {
            if (!oModel) return { header: {}, items: [] };
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];

            var sPoNumber = oHeader.PurchaseOrderNumber || oHeader.PurchaseOrderByCustomer || "";

            var oCleanHeader = {
                SalesOrderType: oHeader.SalesOrderType ? String(oHeader.SalesOrderType).trim() : "",
                SalesOrganization: oHeader.SalesOrganization ? String(oHeader.SalesOrganization).trim() : "",
                DistributionChannel: oHeader.DistributionChannel ? String(oHeader.DistributionChannel).trim() : "",
                OrganizationDivision: oHeader.OrganizationDivision ? String(oHeader.OrganizationDivision).trim() : "",
                SoldToParty: oHeader.SoldToParty ? String(oHeader.SoldToParty).trim() : "",
                PurchaseOrderNumber: sPoNumber ? String(sPoNumber).trim() : "",
                PurchaseOrderByCustomer: sPoNumber ? String(sPoNumber).trim() : "",
                CustomerPurchaseOrderDate: oHeader.CustomerPurchaseOrderDate || null,
                SalesOrderDate: oHeader.SalesOrderDate || null,
                RequestedDeliveryDate: oHeader.RequestedDeliveryDate || null,
                TransactionCurrency: oHeader.TransactionCurrency ? String(oHeader.TransactionCurrency).trim().toUpperCase() : "",
                TotalNetAmount: oHeader.TotalNetAmount !== undefined && oHeader.TotalNetAmount !== null ? Number(oHeader.TotalNetAmount) : 0
            };

            // Payment Terms: populated from customer defaults via applyCustomerDefaults; optional
            if (oHeader.PaymentTerms && String(oHeader.PaymentTerms).trim() !== "") {
                oCleanHeader.PaymentTerms = String(oHeader.PaymentTerms).trim();
                oCleanHeader.PaymentTermCode = String(oHeader.PaymentTerms).trim();
            } else if (oHeader.PaymentTermCode && String(oHeader.PaymentTermCode).trim() !== "") {
                oCleanHeader.PaymentTerms = String(oHeader.PaymentTermCode).trim();
                oCleanHeader.PaymentTermCode = String(oHeader.PaymentTermCode).trim();
            }

            if (oHeader.CustomerName) {
                oCleanHeader.CustomerName = String(oHeader.CustomerName).trim();
            }
            if (oHeader.ShipToParty) {
                oCleanHeader.ShipToParty = String(oHeader.ShipToParty).trim();
            }
            if (oHeader.SalesOffice) {
                oCleanHeader.SalesOffice = String(oHeader.SalesOffice).trim();
            }
            if (oHeader.SalesGroup) {
                oCleanHeader.SalesGroup = String(oHeader.SalesGroup).trim();
            }
            var sIncoterms = oHeader.Incoterms || oHeader.INCO1 || oHeader.IncotermsClassification;
            if (sIncoterms && String(sIncoterms).trim() !== "") {
                oCleanHeader.Incoterms = String(sIncoterms).trim();
                oCleanHeader.INCO1 = String(sIncoterms).trim();
            }
            var sIncotermsLoc = oHeader.IncotermsLocation1 || oHeader.INCO2 || oHeader.INCO2_L;
            if (sIncotermsLoc && String(sIncotermsLoc).trim() !== "") {
                oCleanHeader.IncotermsLocation1 = String(sIncotermsLoc).trim();
                oCleanHeader.INCO2 = String(sIncotermsLoc).trim();
                oCleanHeader.INCO2_L = String(sIncotermsLoc).trim();
            }
            INCOMPLETION_HEADER_FIELDS.forEach(function (f) {
                if (oHeader[f.field] && String(oHeader[f.field]).trim() !== "") {
                    oCleanHeader[f.field] = String(oHeader[f.field]).trim();
                }
            });

            var aCleanItems = aItems.map(function (item, idx) {
                var sItemNum = item.SalesOrderItem && String(item.SalesOrderItem).trim() !== ""
                    ? String(item.SalesOrderItem).trim()
                    : String((idx + 1) * 10);

                var nQty = Number(item.OrderQuantity) || 0;
                var nPrice = Number(item.NetPriceAmount) || 0;
                var nNet = item.NetAmount !== undefined && item.NetAmount !== null
                    ? Number(item.NetAmount)
                    : Number((nQty * nPrice).toFixed(2));

                var cleanItem = {
                    SalesOrderItem: sItemNum,
                    Material: item.Material ? String(item.Material).trim() : "",
                    SalesOrderItemText: item.SalesOrderItemText ? String(item.SalesOrderItemText).trim() : "",
                    OrderQuantity: nQty,
                    OrderQuantityUnit: item.OrderQuantityUnit ? String(item.OrderQuantityUnit).trim().toUpperCase() : "",
                    Plant: item.Plant ? String(item.Plant).trim().toUpperCase() : "",
                    NetPriceAmount: nPrice,
                    NetAmount: nNet,
                    TransactionCurrency: oCleanHeader.TransactionCurrency
                };

                if (item.RequestedDeliveryDate || oCleanHeader.RequestedDeliveryDate) {
                    cleanItem.RequestedDeliveryDate = item.RequestedDeliveryDate || oCleanHeader.RequestedDeliveryDate;
                }

                return cleanItem;
            });

            return {
                header: oCleanHeader,
                items: aCleanItems
            };
        }
    };
});
