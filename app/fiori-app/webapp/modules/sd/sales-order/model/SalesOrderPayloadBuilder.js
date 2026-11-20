(function () {
    "use strict";

    var oPayloadBuilder = {
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

            var aIncompletionFields = [
                { field: "PaymentTerms" },
                { field: "ContactPerson" }
            ];
            aIncompletionFields.forEach(function (f) {
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
