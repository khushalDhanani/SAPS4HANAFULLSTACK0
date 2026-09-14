sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    var CURRENCY_REGEX = /^[A-Z]{3}$/;

    return {
        /**
         * Resolves current username from OwnerComponent auth or user models.
         *
         * @param {sap.ui.core.UIComponent} oComponent
         * @returns {string}
         */
        getCurrentUserName: function (oComponent) {
            if (!oComponent) return "alice";
            var oAuthModel = oComponent.getModel("auth");
            var sAuthUser = oAuthModel ? oAuthModel.getProperty("/user/username") : "";
            if (sAuthUser && typeof sAuthUser === "string" && sAuthUser.trim() !== "") {
                return sAuthUser.trim();
            }
            var oUserModel = oComponent.getModel("user");
            var sUser = oUserModel ? oUserModel.getProperty("/username") : "";
            return (sUser && typeof sUser === "string" && sUser.trim() !== "") ? sUser.trim() : "alice";
        },

        /**
         * Creates initial model for VA11 Sales Inquiry creation.
         *
         * @param {string} [sUser="alice"]
         * @returns {sap.ui.model.json.JSONModel}
         */
        createInitialModel: function (sUser) {
            var today = new Date().toISOString().split("T")[0];
            var validityEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

            return new JSONModel({
                header: {
                    SalesInquiryType: "ZIN",
                    SalesOrganization: "1000",
                    DistributionChannel: "10",
                    OrganizationDivision: "52",
                    SoldToParty: "",
                    CustomerName: "",
                    CustomerCity: "",
                    CustomerCountry: "",
                    ShipToParty: "",
                    ShipToPartyName: "",
                    PurchaseOrderByCustomer: "",
                    CustomerPurchaseOrderDate: today,
                    SalesInquiryDate: today,
                    BindingPeriodValidityStartDate: today,
                    BindingPeriodValidityEndDate: validityEnd,
                    TransactionCurrency: "INR",
                    TotalNetAmount: "0.00",
                    StatusText: "Draft",
                    StatusState: "Information",
                    StatusIcon: "sap-icon://edit",
                    CreatedByUser: sUser || "alice"
                },
                items: [
                    {
                        SalesInquiryItem: "000010",
                        Material: "",
                        SalesInquiryItemText: "",
                        OrderQuantity: 1,
                        OrderQuantityUnit: "PC",
                        NetPriceAmount: "",
                        NetAmount: "0.00",
                        errors: {}
                    }
                ],
                errors: {},
                errorCount: 0,
                errorMessage: "",
                hasError: false,
                userModified: {},
                configDerived: {}
            });
        },

        /**
         * Marks a field as explicitly modified by the user.
         */
        markUserModified: function (oModel, sField, bModified) {
            if (!oModel) return;
            oModel.setProperty("/userModified/" + sField, bModified !== false);
        },

        /**
         * Sets validation error/warning state for a specific field.
         */
        setFieldValidation: function (oModel, sField, sState, sText) {
            if (!oModel) return;
            oModel.setProperty("/errors/" + sField, {
                state: sState || "None",
                text: sText || ""
            });
        },

        /**
         * Applies confirmed master data configuration defaults without overwriting user entries.
         */
        applyConfigurationDefaults: function (oModel, oConfigData) {
            if (!oModel || !oConfigData) return;

            var oHeader = oModel.getProperty("/header") || {};
            var oUserMod = oModel.getProperty("/userModified") || {};

            // 1. Inquiry Type: Default to ZIN if valid in Inquiry Types, otherwise first valid
            if (!oUserMod.SalesInquiryType) {
                var aTypes = oConfigData.inquiryTypes || [];
                var bHasZIN = aTypes.some(function (t) { return (t.SalesDocumentType || t.SalesInquiryType) === "ZIN"; });
                var bHasIN = aTypes.some(function (t) { return (t.SalesDocumentType || t.SalesInquiryType) === "IN"; });
                if (bHasZIN) {
                    oModel.setProperty("/header/SalesInquiryType", "ZIN");
                } else if (bHasIN) {
                    oModel.setProperty("/header/SalesInquiryType", "IN");
                } else if (aTypes.length > 0) {
                    oModel.setProperty("/header/SalesInquiryType", aTypes[0].SalesDocumentType || aTypes[0].SalesInquiryType);
                }
            }

            // 2. Sales Organization: Default to 1000 only if valid in Sales Organizations
            if (!oUserMod.SalesOrganization) {
                var aOrgs = oConfigData.salesOrgs || [];
                var bHas1000 = aOrgs.some(function (o) { return o.SalesOrganization === "1000"; });
                if (bHas1000) {
                    oModel.setProperty("/header/SalesOrganization", "1000");
                } else if (aOrgs.length > 0) {
                    oModel.setProperty("/header/SalesOrganization", aOrgs[0].SalesOrganization);
                }
            }

            // 3. Distribution Channel: Default to 10 if valid for selected Sales Org
            var sCurrentOrg = oModel.getProperty("/header/SalesOrganization");
            if (!oUserMod.DistributionChannel && sCurrentOrg) {
                var aChannels = oConfigData.distChannels || [];
                var aValidChannels = aChannels.filter(function (c) { return c.SalesOrganization === sCurrentOrg; });
                var bHas10 = aValidChannels.some(function (c) { return c.DistributionChannel === "10"; });
                if (bHas10) {
                    oModel.setProperty("/header/DistributionChannel", "10");
                } else if (aValidChannels.length > 0) {
                    oModel.setProperty("/header/DistributionChannel", aValidChannels[0].DistributionChannel);
                }
            }

            // 4. Division: Default to 52 if valid for selected Org and Channel
            var sCurrentChannel = oModel.getProperty("/header/DistributionChannel");
            if (!oUserMod.OrganizationDivision && sCurrentOrg && sCurrentChannel) {
                var aDivisions = oConfigData.divisions || [];
                var aValidDivs = aDivisions.filter(function (d) {
                    return d.SalesOrganization === sCurrentOrg && d.DistributionChannel === sCurrentChannel;
                });
                var bHas52 = aValidDivs.some(function (d) { return d.Division === "52"; });
                if (bHas52) {
                    oModel.setProperty("/header/OrganizationDivision", "52");
                } else if (aValidDivs.length > 0) {
                    oModel.setProperty("/header/OrganizationDivision", aValidDivs[0].Division);
                }
            }
        },

        /**
         * Derives commercial defaults from customer master data without unexpected overrides.
         */
        deriveCustomerDefaults: function (oModel, sCustomer, oDefaults) {
            if (!oModel) return;
            var oUserMod = oModel.getProperty("/userModified") || {};

            if (oDefaults && oDefaults.derived) {
                oModel.setProperty("/header/CustomerName", oDefaults.CustomerName || "");
                oModel.setProperty("/header/CustomerCity", oDefaults.City || "");
                oModel.setProperty("/header/CustomerCountry", oDefaults.Country || "");

                if (!oUserMod.ShipToParty) {
                    oModel.setProperty("/header/ShipToParty", oDefaults.ShipToParty || sCustomer);
                    oModel.setProperty("/header/ShipToPartyName", oDefaults.ShipToPartyName || oDefaults.CustomerName || "");
                }

                if (!oUserMod.TransactionCurrency && oDefaults.Currency) {
                    oModel.setProperty("/header/TransactionCurrency", oDefaults.Currency);
                }

                this.setFieldValidation(oModel, "SoldToParty", "None", "");
            } else {
                oModel.setProperty("/header/CustomerName", "");
                oModel.setProperty("/header/CustomerCity", "");
                oModel.setProperty("/header/CustomerCountry", "");
                if (!oUserMod.ShipToParty) {
                    oModel.setProperty("/header/ShipToParty", sCustomer);
                }
            }
        },

        /**
         * Adds an item with standard SAP 10-increment numbering.
         */
        addItem: function (oModel) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            var nextNum = (aItems.length + 1) * 10;
            var sItemNum = String(nextNum).padStart(6, "0");

            aItems.push({
                SalesInquiryItem: sItemNum,
                Material: "",
                SalesInquiryItemText: "",
                OrderQuantity: 1,
                OrderQuantityUnit: "PC",
                NetPriceAmount: "",
                NetAmount: "0.00",
                errors: {}
            });

            oModel.setProperty("/items", aItems);
            this.calculateTotals(oModel);
            this.updateStatus(oModel);
        },

        /**
         * Deletes an item and re-sequences 10-increment numbers.
         */
        deleteItem: function (oModel, sItemPath) {
            if (!oModel || !sItemPath) return;
            var aItems = oModel.getProperty("/items") || [];
            var idx = parseInt(sItemPath.split("/").pop(), 10);
            if (isNaN(idx) || idx < 0 || idx >= aItems.length) return;

            aItems.splice(idx, 1);

            // Re-number
            aItems.forEach(function (item, i) {
                item.SalesInquiryItem = String((i + 1) * 10).padStart(6, "0");
            });

            oModel.setProperty("/items", aItems);
            this.calculateTotals(oModel);
            this.updateStatus(oModel);
        },

        /**
         * Applies Material master data configuration to a specific line item:
         * Sets Material, Description (if not already entered), and directly sets OrderQuantityUnit
         * from the Material's master data Base Unit of Measure configuration (MaterialBaseUnit).
         * Clears any validation errors on Material and OrderQuantityUnit.
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sItemPath Item binding path (e.g. "/items/0")
         * @param {Object} oMaterialData Material master data object containing Material, MaterialBaseUnit, etc.
         * @returns {Object} Report of applied fields
         */
        applyMaterialDefaults: function (oModel, sItemPath, oMaterialData) {
            if (!oModel || !sItemPath || !oMaterialData) return {};
            var oReport = {};

            if (oMaterialData.Material) {
                oModel.setProperty(sItemPath + "/Material", oMaterialData.Material);
                oModel.setProperty(sItemPath + "/errors/Material", { state: "None", text: "" });
                oReport.Material = oMaterialData.Material;
            }

            var sDesc = oMaterialData.Material_Text || oMaterialData.MaterialName;
            if (sDesc && !oModel.getProperty(sItemPath + "/SalesInquiryItemText")) {
                oModel.setProperty(sItemPath + "/SalesInquiryItemText", sDesc);
                oReport.SalesInquiryItemText = sDesc;
            }

            var sUnit = oMaterialData.MaterialBaseUnit || oMaterialData.BaseUnit || oMaterialData.OrderQuantityUnit;
            if (sUnit) {
                oModel.setProperty(sItemPath + "/OrderQuantityUnit", sUnit);
                oModel.setProperty(sItemPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
                oReport.OrderQuantityUnit = sUnit;
            }

            return oReport;
        },

        /**
         * Calculates line net amount and header total net amount.
         */
        calculateTotals: function (oModel) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            var total = 0;

            aItems.forEach(function (item) {
                var qty = parseFloat(item.OrderQuantity) || 0;
                var price = parseFloat(item.NetPriceAmount) || 0;
                var net = qty * price;
                item.NetAmount = net > 0 ? net.toFixed(2) : "0.00";
                total += net;
            });

            oModel.setProperty("/items", aItems);
            oModel.setProperty("/header/TotalNetAmount", total.toFixed(2));
        },

        /**
         * Updates status indicator based on completeness.
         */
        updateStatus: function (oModel) {
            if (!oModel) return;
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];

            var bHasHeader = Boolean(
                oHeader.SalesInquiryType &&
                oHeader.SalesOrganization &&
                oHeader.DistributionChannel &&
                oHeader.OrganizationDivision &&
                oHeader.SoldToParty
            );

            var bHasItems = aItems.length > 0 && aItems.every(function (item) {
                return Boolean(item.Material && parseFloat(item.OrderQuantity) > 0 && item.OrderQuantityUnit);
            });

            if (bHasHeader && bHasItems) {
                oModel.setProperty("/header/StatusText", "Ready to Create");
                oModel.setProperty("/header/StatusState", "Success");
                oModel.setProperty("/header/StatusIcon", "sap-icon://accept");
            } else {
                oModel.setProperty("/header/StatusText", "Draft");
                oModel.setProperty("/header/StatusState", "Information");
                oModel.setProperty("/header/StatusIcon", "sap-icon://edit");
            }
        },

        /**
         * Validates all fields imitating SAP SD Incompletion Log (V.02).
         *
         * @returns {boolean} True if all fields are valid
         */
        validateForm: function (oModel) {
            if (!oModel) return false;
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];
            var oErrors = {};
            var iErrorCount = 0;
            var sFirstError = "";

            function addError(sField, sMsg) {
                oErrors[sField] = { state: "Error", text: sMsg };
                iErrorCount++;
                if (!sFirstError) sFirstError = sMsg;
            }

            // Header validations
            if (!oHeader.SalesInquiryType || String(oHeader.SalesInquiryType).trim() === "") {
                addError("SalesInquiryType", "Inquiry Type is mandatory");
            }
            if (!oHeader.SalesOrganization || String(oHeader.SalesOrganization).trim() === "") {
                addError("SalesOrganization", "Sales Organization is mandatory");
            }
            if (!oHeader.DistributionChannel || String(oHeader.DistributionChannel).trim() === "") {
                addError("DistributionChannel", "Distribution Channel is mandatory");
            }
            if (!oHeader.OrganizationDivision || String(oHeader.OrganizationDivision).trim() === "") {
                addError("OrganizationDivision", "Division is mandatory");
            }
            if (!oHeader.SoldToParty || String(oHeader.SoldToParty).trim() === "") {
                addError("SoldToParty", "Sold-to Party is mandatory");
            }
            if (!oHeader.TransactionCurrency || !CURRENCY_REGEX.test(String(oHeader.TransactionCurrency).trim())) {
                addError("TransactionCurrency", "Currency must be a valid 3-letter ISO code (e.g. INR, USD)");
            }

            // Date validation
            if (oHeader.BindingPeriodValidityStartDate && oHeader.BindingPeriodValidityEndDate) {
                var dStart = new Date(oHeader.BindingPeriodValidityStartDate);
                var dEnd = new Date(oHeader.BindingPeriodValidityEndDate);
                if (dEnd < dStart) {
                    addError("BindingPeriodValidityEndDate", "Validity End Date cannot be earlier than Validity Start Date");
                }
            }

            // Items validation
            if (aItems.length === 0) {
                addError("items", "At least one item must be added to the inquiry");
            } else {
                aItems.forEach(function (item, idx) {
                    item.errors = {};
                    if (!item.Material || String(item.Material).trim() === "") {
                        item.errors.Material = { state: "Error", text: "Material is required" };
                        iErrorCount++;
                        if (!sFirstError) sFirstError = "Item " + (idx + 1) + ": Material is required";
                    }
                    var q = parseFloat(item.OrderQuantity);
                    if (isNaN(q) || q <= 0) {
                        item.errors.OrderQuantity = { state: "Error", text: "Quantity must be > 0" };
                        iErrorCount++;
                        if (!sFirstError) sFirstError = "Item " + (idx + 1) + ": Quantity must be > 0";
                    }
                    if (!item.OrderQuantityUnit || String(item.OrderQuantityUnit).trim() === "") {
                        item.errors.OrderQuantityUnit = { state: "Error", text: "Unit is required" };
                        iErrorCount++;
                        if (!sFirstError) sFirstError = "Item " + (idx + 1) + ": Unit is required";
                    }
                });
                oModel.setProperty("/items", aItems);
            }

            oModel.setProperty("/errors", oErrors);
            oModel.setProperty("/errorCount", iErrorCount);
            oModel.setProperty("/errorMessage", sFirstError);
            oModel.setProperty("/hasError", iErrorCount > 0);

            return iErrorCount === 0;
        },

        /**
         * Validates a single header field for real-time UX feedback.
         */
        validateSingleField: function (oModel, sField) {
            if (!oModel || !sField) return;
            var val = oModel.getProperty("/header/" + sField);
            var oErr = oModel.getProperty("/errors/" + sField);

            if (!val || String(val).trim() === "") {
                this.setFieldValidation(oModel, sField, "Error", sField + " is mandatory");
            } else if (sField === "TransactionCurrency" && !CURRENCY_REGEX.test(String(val).trim())) {
                this.setFieldValidation(oModel, sField, "Error", "Currency must be 3-letter ISO code");
            } else {
                this.setFieldValidation(oModel, sField, "None", "");
            }
        },

        /**
         * Clears all validation errors.
         */
        clearErrors: function (oModel) {
            if (!oModel) return;
            oModel.setProperty("/errors", {});
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
         * Builds a clean API-compliant payload conforming strictly to the CAP InquiryHeader and InquiryItem contract.
         * Strips UI-only and unmapped client-state properties (such as CustomerCity, CustomerCountry, ShipToPartyName, StatusText, StatusState, StatusIcon, CreatedByUser, and item errors).
         *
         * @param {sap.ui.model.json.JSONModel} oModel
         * @returns {{ header: Object, items: Array<Object> }}
         */
        buildPayload: function (oModel) {
            if (!oModel) return { header: {}, items: [] };
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];

            var oCleanHeader = {
                SalesInquiryType: oHeader.SalesInquiryType ? String(oHeader.SalesInquiryType).trim() : "ZIN",
                SalesOrganization: oHeader.SalesOrganization ? String(oHeader.SalesOrganization).trim() : "1000",
                DistributionChannel: oHeader.DistributionChannel ? String(oHeader.DistributionChannel).trim() : "10",
                OrganizationDivision: oHeader.OrganizationDivision ? String(oHeader.OrganizationDivision).trim() : "52",
                SoldToParty: oHeader.SoldToParty ? String(oHeader.SoldToParty).trim() : "",
                PurchaseOrderByCustomer: oHeader.PurchaseOrderByCustomer ? String(oHeader.PurchaseOrderByCustomer).trim() : "",
                CustomerPurchaseOrderDate: oHeader.CustomerPurchaseOrderDate || null,
                SalesInquiryDate: oHeader.SalesInquiryDate || null,
                BindingPeriodValidityStartDate: oHeader.BindingPeriodValidityStartDate || null,
                BindingPeriodValidityEndDate: oHeader.BindingPeriodValidityEndDate || null,
                TransactionCurrency: oHeader.TransactionCurrency ? String(oHeader.TransactionCurrency).trim().toUpperCase() : "INR",
                TotalNetAmount: oHeader.TotalNetAmount !== undefined && oHeader.TotalNetAmount !== null ? Number(oHeader.TotalNetAmount) : 0
            };

            if (oHeader.CustomerName) {
                oCleanHeader.CustomerName = String(oHeader.CustomerName).trim();
            }
            if (oHeader.ShipToParty) {
                oCleanHeader.ShipToParty = String(oHeader.ShipToParty).trim();
            }

            var aCleanItems = aItems.map(function (item, idx) {
                var sItemNum = item.SalesInquiryItem && String(item.SalesInquiryItem).trim() !== ""
                    ? String(item.SalesInquiryItem).padStart(6, "0")
                    : String((idx + 1) * 10).padStart(6, "0");

                var cleanItem = {
                    SalesInquiryItem: sItemNum,
                    Material: item.Material ? String(item.Material).trim() : "",
                    SalesInquiryItemText: item.SalesInquiryItemText ? String(item.SalesInquiryItemText).trim() : "",
                    OrderQuantity: parseFloat(item.OrderQuantity) || 0,
                    OrderQuantityUnit: item.OrderQuantityUnit ? String(item.OrderQuantityUnit).trim().toUpperCase() : "PC",
                    NetAmount: parseFloat(item.NetAmount) || 0,
                    TransactionCurrency: oCleanHeader.TransactionCurrency
                };

                if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && item.NetPriceAmount !== "") {
                    cleanItem.NetPriceAmount = parseFloat(item.NetPriceAmount);
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
