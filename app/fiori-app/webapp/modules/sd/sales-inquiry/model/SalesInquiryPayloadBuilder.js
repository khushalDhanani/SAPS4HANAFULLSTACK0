(function () {
    "use strict";

    var INCOMPLETION_HEADER_FIELDS = [
        { field: "CustomerGroup2", label: "Customer Group 2" },
        { field: "PortOfLoading", label: "Port of Loading" },
        { field: "PortOfDischarge", label: "Port of Discharge" },
        { field: "ContactPerson", label: "Contact Person" }
    ];

    var oPayloadBuilder = {
        applyConfigurationDefaults: function (oModel, oConfigData) {
            if (!oModel || !oConfigData) return;

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

        deriveCustomerDefaults: function (oModel, sCustomer, oDefaults) {
            if (!oModel) return;
            var oUserMod = oModel.getProperty("/userModified") || {};

            if (!sCustomer || String(sCustomer).trim() === "") {
                oModel.setProperty("/header/CustomerName", "");
                oModel.setProperty("/header/CustomerCity", "");
                oModel.setProperty("/header/CustomerCountry", "");
                if (!oUserMod.ShipToParty) {
                    oModel.setProperty("/header/ShipToParty", "");
                    oModel.setProperty("/header/ShipToPartyName", "");
                }
                return;
            }

            if (oDefaults && oDefaults.derived) {
                if (oDefaults.CustomerName) {
                    oModel.setProperty("/header/CustomerName", oDefaults.CustomerName);
                }
                if (oDefaults.City) {
                    oModel.setProperty("/header/CustomerCity", oDefaults.City);
                }
                if (oDefaults.Country) {
                    oModel.setProperty("/header/CustomerCountry", oDefaults.Country);
                }

                if (!oUserMod.ShipToParty) {
                    oModel.setProperty("/header/ShipToParty", oDefaults.ShipToParty || sCustomer);
                    oModel.setProperty("/header/ShipToPartyName", oDefaults.ShipToPartyName || oDefaults.CustomerName || oModel.getProperty("/header/CustomerName") || "");
                }

                if (!oUserMod.TransactionCurrency && oDefaults.Currency) {
                    oModel.setProperty("/header/TransactionCurrency", oDefaults.Currency);
                }

                if (!oUserMod.SalesOffice && oDefaults.SalesOffice) {
                    oModel.setProperty("/header/SalesOffice", oDefaults.SalesOffice);
                    oModel.setProperty("/header/SalesOfficeName", oDefaults.SalesOfficeName || "");
                }
                if (!oUserMod.SalesGroup && oDefaults.SalesGroup) {
                    oModel.setProperty("/header/SalesGroup", oDefaults.SalesGroup);
                    oModel.setProperty("/header/SalesGroupName", oDefaults.SalesGroupName || "");
                }

                if (typeof this.setFieldValidation === "function") {
                    this.setFieldValidation(oModel, "SoldToParty", "None", "");
                }
            } else {
                if (!oUserMod.ShipToParty && !oModel.getProperty("/header/ShipToParty")) {
                    oModel.setProperty("/header/ShipToParty", sCustomer);
                }
            }
        },

        addItem: function (oModel) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            var nextNum = (aItems.length + 1) * 10;
            var sItemNum = String(nextNum).padStart(6, "0");

            aItems.push({
                SalesInquiryItem: sItemNum,
                Material: "",
                SalesInquiryItemText: "",
                OrderQuantity: "",
                OrderQuantityUnit: "",
                Plant: "",
                NetPriceAmount: "",
                NetAmount: "0.00",
                errors: {}
            });

            oModel.setProperty("/items", aItems);
            if (typeof this.calculateTotals === "function") {
                this.calculateTotals(oModel);
            }
            if (typeof this.updateStatus === "function") {
                this.updateStatus(oModel);
            }
        },

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
            if (typeof this.calculateTotals === "function") {
                this.calculateTotals(oModel);
            }
            if (typeof this.updateStatus === "function") {
                this.updateStatus(oModel);
            }
        },

        applyMaterialDefaults: function (oModel, sItemPath, oMaterialData, bForce) {
            if (!oModel || !sItemPath || !oMaterialData) return {};
            var oReport = {};

            if (oMaterialData.Material) {
                oModel.setProperty(sItemPath + "/Material", oMaterialData.Material);
                oModel.setProperty(sItemPath + "/errors/Material", { state: "None", text: "" });
                oReport.Material = oMaterialData.Material;
            }

            var sDesc = oMaterialData.MaterialName || oMaterialData.Material_Text || oMaterialData.Description || "";
            var sCurrentDesc = oModel.getProperty(sItemPath + "/SalesInquiryItemText");
            if (sDesc && (bForce !== false || !sCurrentDesc)) {
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

        calculateTotals: function (oModel) {
            if (!oModel) return;
            var aItems = oModel.getProperty("/items") || [];
            var total = 0;

            aItems.forEach(function (item, idx) {
                var qty = parseFloat(item.OrderQuantity) || 0;
                var price = parseFloat(item.NetPriceAmount) || 0;
                var net = qty * price;
                var sNet = net > 0 ? net.toFixed(2) : "0.00";
                if (item.NetAmount !== sNet) {
                    item.NetAmount = sNet;
                    oModel.setProperty("/items/" + idx + "/NetAmount", sNet);
                }
                total += net;
            });

            var sTotal = total.toFixed(2);
            if (oModel.getProperty("/header/TotalNetAmount") !== sTotal) {
                oModel.setProperty("/header/TotalNetAmount", sTotal);
            }
        },

        buildPayload: function (oModel) {
            if (!oModel) return { header: {}, items: [] };
            var oHeader = oModel.getProperty("/header") || {};
            var aItems = oModel.getProperty("/items") || [];

            var oCleanHeader = {
                SalesInquiryType: oHeader.SalesInquiryType ? String(oHeader.SalesInquiryType).trim() : "",
                SalesOrganization: oHeader.SalesOrganization ? String(oHeader.SalesOrganization).trim() : "",
                DistributionChannel: oHeader.DistributionChannel ? String(oHeader.DistributionChannel).trim() : "",
                OrganizationDivision: oHeader.OrganizationDivision ? String(oHeader.OrganizationDivision).trim() : "",
                SoldToParty: oHeader.SoldToParty ? String(oHeader.SoldToParty).trim() : "",
                PurchaseOrderByCustomer: oHeader.PurchaseOrderByCustomer ? String(oHeader.PurchaseOrderByCustomer).trim() : "",
                CustomerPurchaseOrderDate: oHeader.CustomerPurchaseOrderDate || null,
                SalesInquiryDate: oHeader.SalesInquiryDate || null,
                BindingPeriodValidityStartDate: oHeader.BindingPeriodValidityStartDate || null,
                BindingPeriodValidityEndDate: oHeader.BindingPeriodValidityEndDate || null,
                TransactionCurrency: oHeader.TransactionCurrency ? String(oHeader.TransactionCurrency).trim().toUpperCase() : "",
                TotalNetAmount: oHeader.TotalNetAmount !== undefined && oHeader.TotalNetAmount !== null ? Number(oHeader.TotalNetAmount) : 0
            };

            if (oHeader.CustomerName) {
                oCleanHeader.CustomerName = String(oHeader.CustomerName).trim();
            }
            if (oHeader.ShipToParty) {
                oCleanHeader.ShipToParty = String(oHeader.ShipToParty).trim();
            }
            INCOMPLETION_HEADER_FIELDS.forEach(function (f) {
                if (oHeader[f.field] && String(oHeader[f.field]).trim() !== "") {
                    oCleanHeader[f.field] = String(oHeader[f.field]).trim();
                }
            });

            var aCleanItems = aItems.map(function (item, idx) {
                var sItemNum = item.SalesInquiryItem && String(item.SalesInquiryItem).trim() !== ""
                    ? String(item.SalesInquiryItem).padStart(6, "0")
                    : String((idx + 1) * 10).padStart(6, "0");

                var cleanItem = {
                    SalesInquiryItem: sItemNum,
                    Material: item.Material ? String(item.Material).trim() : "",
                    SalesInquiryItemText: item.SalesInquiryItemText ? String(item.SalesInquiryItemText).trim() : "",
                    OrderQuantity: parseFloat(item.OrderQuantity) || 0,
                    OrderQuantityUnit: item.OrderQuantityUnit ? String(item.OrderQuantityUnit).trim().toUpperCase() : "",
                    NetAmount: parseFloat(item.NetAmount) || 0,
                    TransactionCurrency: oCleanHeader.TransactionCurrency
                };

                if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && item.NetPriceAmount !== "") {
                    cleanItem.NetPriceAmount = parseFloat(item.NetPriceAmount);
                }
                if (item.Plant && String(item.Plant).trim() !== "") {
                    cleanItem.Plant = String(item.Plant).trim().toUpperCase();
                }

                return cleanItem;
            });

            return {
                header: oCleanHeader,
                items: aCleanItems
            };
        }
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oPayloadBuilder;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oPayloadBuilder;
        });
    }
})();
