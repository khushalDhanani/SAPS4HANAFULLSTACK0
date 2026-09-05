sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog"
], function (Controller, JSONModel, MessageBox, MessageToast, Fragment, Filter, FilterOperator, SelectDialog) {
    "use strict";

    return Controller.extend("saps4hana.fiori.controller.CreatePurchaseOrder", {
        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createPurchaseOrder").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            this._resetModel();
        },

        _resetModel: function () {
            var oData = {
                header: {
                    PurchaseOrderType: "NB",
                    CompanyCode: "",
                    PurchasingOrganization: "",
                    PurchasingGroup: "",
                    Supplier: "",
                    DocumentDate: new Date().toISOString().split('T')[0],
                    Currency: "",
                    IncotermsClassification: "",
                    IncotermsLocation1: "",
                    PaymentTerms: ""
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
                        NetAmount: "0.00"
                    }
                ]
            };
            var oModel = new JSONModel(oData);
            this.getView().setModel(oModel, "newPO");
        },

        _getValueHelpConfig: function (sPath) {
            var oConfig = {
                "/DocumentTypeVH": { title: "Select Document Type", key: "PurchasingDocumentType", desc: "PurchasingDocumentType_Text" },
                "/CompanyCodeVH": { title: "Select Company Code", key: "CompanyCode", desc: "CompanyCodeName" },
                "/PurchasingOrgVH": { title: "Select Purchasing Org", key: "PurchasingOrganization", desc: "PurchasingOrganizationName" },
                "/PurchasingGroupVH": { title: "Select Purchasing Group", key: "PurchasingGroup", desc: "PurchasingGroupName" },
                "/SupplierVH": { title: "Select Supplier", key: "Supplier", desc: "SupplierName" },
                "/CurrencyVH": { title: "Select Currency", key: "Currency", desc: "Currency_Text" },
                "/IncotermsClassificationVH": { title: "Select Incoterms", key: "IncotermsClassification", desc: "IncotermsClassificationName" },
                "/PaymentTermsVH": { title: "Select Payment Terms", key: "PaymentTerms", desc: "PaymentTermsName" },
                "/MaterialVH": { title: "Select Material", key: "Material", desc: "MaterialName" },
                "/MaterialGroupVH": { title: "Select Material Group", key: "MaterialGroup", desc: "MaterialGroupName" },
                "/PlantVH": { title: "Select Plant", key: "Plant", desc: "PlantName" },
                "/StorageLocationVH": { title: "Select Storage Location", key: "StorageLocation", desc: "StorageLocationName" },
                "/UnitOfMeasureVH": { title: "Select Unit of Measure", key: "UnitOfMeasure", desc: "UnitOfMeasure_Text" },
                "/TaxCodeVH": { title: "Select Tax Code", key: "TaxCode", desc: "TaxCode_Text" }
            };
            return oConfig[sPath];
        },

        onValueHelpRequest: function (oEvent) {
            var oInput = oEvent.getSource();
            var sPath = oInput.getBinding("suggestionItems").getPath();

            var oConf = this._getValueHelpConfig(sPath);
            if (!oConf) return;

            var oSelectDialog = new SelectDialog({
                title: oConf.title,
                search: function (oSearchEvent) {
                    var sValue = oSearchEvent.getParameter("value");
                    var oFilter = new Filter({
                        filters: [
                            new Filter(oConf.key, FilterOperator.Contains, sValue),
                            new Filter(oConf.desc, FilterOperator.Contains, sValue)
                        ],
                        and: false
                    });
                    oSearchEvent.getSource().getBinding("items").filter([oFilter]);
                },
                confirm: function (oConfirmEvent) {
                    var oSelectedItem = oConfirmEvent.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sKey = oSelectedItem.getTitle();
                        oInput.setValue(sKey);
                        var oBinding = oInput.getBinding("value");
                        if (oBinding) {
                            oBinding.setValue(sKey);
                        }
                    }
                }
            });

            oSelectDialog.bindAggregation("items", {
                path: sPath,
                template: new sap.m.StandardListItem({
                    title: "{" + oConf.key + "}",
                    description: "{" + oConf.desc + "}"
                })
            });

            this.getView().addDependent(oSelectDialog);
            oSelectDialog.open();
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            var oInput = oEvent.getSource();
            var sPath = oInput.getBinding("suggestionItems").getPath();

            var oConf = this._getValueHelpConfig(sPath);
            if (!oConf) return;

            var aFilters = [];
            if (sValue) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter(oConf.key, FilterOperator.Contains, sValue),
                        new Filter(oConf.desc, FilterOperator.Contains, sValue)
                    ],
                    and: false
                }));
            }

            oInput.getBinding("suggestionItems").filter(aFilters);
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("purchaseOrders");
        },

        onCancelPress: function () {
            this.onNavBack();
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newPO");
            var aItems = oModel.getProperty("/items");
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
                NetAmount: "0.00"
            });
            oModel.setProperty("/items", aItems);
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var sPath = oItem.getBindingContext("newPO").getPath();
            var iIndex = parseInt(sPath.split("/")[2], 10);

            var oModel = this.getView().getModel("newPO");
            var aItems = oModel.getProperty("/items");
            aItems.splice(iIndex, 1);

            // Re-number items
            aItems.forEach(function (item, idx) {
                item.PurchaseOrderItem = ((idx + 1) * 10).toString();
            });

            oModel.setProperty("/items", aItems);
        },

        onCalculateNetAmount: function (oEvent) {
            var oInput = oEvent.getSource();
            var oContext = oInput.getBindingContext("newPO");
            if (!oContext) return;
            
            var sPath = oContext.getPath();
            var oModel = this.getView().getModel("newPO");
            
            // Defer the model update to allow UI5's current event and measurement cycle to finish
            setTimeout(function () {
                var oItem = oModel.getProperty(sPath);
                if (!oItem) return;
                
                var fQuantity = parseFloat(oItem.OrderQuantity) || 0;
                var fNetPrice = parseFloat(oItem.NetPriceAmount) || 0;
                
                var fNetAmount = fQuantity * fNetPrice;
                oModel.setProperty(sPath + "/NetAmount", fNetAmount.toFixed(2));
            }, 0);
        },

        onCreatePress: function () {
            var oModel = this.getView().getModel("newPO");
            var oData = oModel.getData();
            var that = this;

            // Basic Validation
            if (!oData.header.PurchaseOrderType || !oData.header.CompanyCode || !oData.header.Supplier) {
                MessageBox.error("Please fill all required header fields.");
                return;
            }
            if (oData.items.length === 0) {
                MessageBox.error("Please add at least one item.");
                return;
            }

            var bItemValid = oData.items.every(function (item) {
                return item.Material && item.Plant && item.OrderQuantity && item.StorageLocation && item.UnitOfMeasure;
            });

            if (!bItemValid) {
                MessageBox.error("Please fill all required fields for all items.");
                return;
            }

            // Call CAP action via fetch
            var payload = {
                header: oData.header,
                items: oData.items
            };
            sap.ui.core.BusyIndicator.show(0);
            fetch("/odata/v4/purchase-order/createPurchaseOrder", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            })
                .then(function (response) {
                    sap.ui.core.BusyIndicator.hide();
                    if (!response.ok) {
                        return response.text().then(function (txt) { throw new Error(txt); });
                    }
                    return response.json();
                })
                .then(function (result) {
                    var sNewPO = result.value || result;
                    MessageToast.show("Purchase Order Created: " + sNewPO);
                    that.onNavBack();
                })
                .catch(function (oError) {
                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.error(oError.message || "Error creating Purchase Order.");
                });
        }
    });
});
