sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/sd/sales-order/model/SalesOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/sd/sales-order/service/SalesOrderService",
    "saps4hana/fiori/service/AuthService"
], function (BaseController, JSONModel, MessageBox, MessageToast, MessagePopover, MessageItem, BusyIndicator, Filter, FilterOperator, SalesOrderModel, ValueHelpService, SalesOrderService, AuthService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-order.controller.CreateSalesOrder", {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            this._resetModel(false);
            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("createSalesOrder")) {
                oRouter.getRoute("createSalesOrder").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _resetModel: function (bLoadConfig) {
            var sUser = SalesOrderModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = SalesOrderModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newOrder");
            SalesOrderModel.updateStatus(oModel);

            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }

            if (bLoadConfig) {
                this._loadConfigurationAndDefaults();
            }
        },

        _loadConfigurationAndDefaults: function () {
            var that = this;
            var oModel = this.getView().getModel("newOrder");

            if (this._oConfigData) {
                this._updateOrganizationalFilters();
                return Promise.resolve(this._oConfigData);
            }

            var oSalesOrderModel = (this.getModel && this.getModel("salesOrder")) || null;
            var oConfigPromise = oSalesOrderModel ?
                SalesOrderService.loadConfiguration(oSalesOrderModel) :
                SalesOrderService.loadConfiguration();

            return oConfigPromise.then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newOrder");
                if (oCurrentModel) {
                    that._updateOrganizationalFilters();
                    if (oConfigData && oConfigData.defaults && oConfigData.defaults.Plant) {
                        var sDefPlant = oConfigData.defaults.Plant;
                        var aItems = oCurrentModel.getProperty("/items") || [];
                        aItems.forEach(function (itm) {
                            if (!itm.Plant || itm.Plant === "1000") {
                                itm.Plant = sDefPlant;
                            }
                        });
                        oCurrentModel.setProperty("/items", aItems);
                    }
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreateSalesOrder] Error loading config data:", err);
            });
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            this._resetModel(true);
        },

        onOrderTypeChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "SalesOrderType");
            SalesOrderModel.updateStatus(oModel);
        },

        onOrderTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/SalesOrderType", sKey);
            this.onOrderTypeChange();
        },

        onSalesOrgChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "SalesOrganization");
            this._updateOrganizationalFilters();
            SalesOrderModel.updateStatus(oModel);
        },

        onSalesOrgSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/SalesOrganization", sKey);
            this.onSalesOrgChange();
        },

        onDistChannelChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "DistributionChannel");
            this._updateOrganizationalFilters();
            SalesOrderModel.updateStatus(oModel);
        },

        onDistChannelSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/DistributionChannel", sKey);
            this.onDistChannelChange();
        },

        onDivisionChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "OrganizationDivision");
            SalesOrderModel.updateStatus(oModel);
        },

        onDivisionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/OrganizationDivision", sKey);
            this.onDivisionChange();
        },

        onSoldToPartyChange: function () {
            var that = this;
            var oModel = this.getView().getModel("newOrder");
            var sCustomer = oModel.getProperty("/header/SoldToParty");

            SalesOrderModel.validateSingleField(oModel, "SoldToParty");

            if (!sCustomer || sCustomer.trim() === "") {
                oModel.setProperty("/header/CustomerName", "");
                oModel.setProperty("/header/CustomerCity", "");
                oModel.setProperty("/header/CustomerCountry", "");
                oModel.setProperty("/header/ShipToParty", "");
                oModel.setProperty("/header/ShipToPartyName", "");
                SalesOrderModel.updateStatus(oModel);
                return;
            }

            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sDist = oModel.getProperty("/header/DistributionChannel");
            var sDiv = oModel.getProperty("/header/OrganizationDivision");

            SalesOrderService.getCustomerDefaults(sCustomer, sOrg, sDist, sDiv).then(function (oDefaults) {
                if (oDefaults) {
                    SalesOrderModel.applyCustomerDefaults(oModel, oDefaults);
                }
                SalesOrderModel.updateStatus(oModel);
            }).catch(function () {
                SalesOrderModel.updateStatus(oModel);
            });
        },

        onSoldToPartyLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/SoldToParty", sVal);
            if (sVal && sVal.trim() !== "") {
                oModel.setProperty("/errors/SoldToParty", { state: "None", text: "" });
            }
        },

        onSoldToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/SoldToParty", sKey);

            var sName = oItem.getAdditionalText && oItem.getAdditionalText();
            if (sName) {
                oModel.setProperty("/header/CustomerName", sName);
            }

            this.onSoldToPartyChange();
        },

        onShipToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/ShipToParty", sKey);
            var sName = oItem.getAdditionalText && oItem.getAdditionalText();
            if (sName) {
                oModel.setProperty("/header/ShipToPartyName", sName);
            }
            this.onHeaderFieldChange();
        },

        onCurrencyChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.validateSingleField(oModel, "TransactionCurrency");
            SalesOrderModel.updateStatus(oModel);
        },

        onCurrencySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;
            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            oModel.setProperty("/header/TransactionCurrency", sKey);
            this.onCurrencyChange();
        },

        onHeaderFieldChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.updateStatus(oModel);
        },

        _updateOrganizationalFilters: function () {
            var oModel = this.getView().getModel("newOrder");
            if (!oModel) return;

            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sChannel = oModel.getProperty("/header/DistributionChannel");

            var inDist = this.byId("inDistChannel");
            if (inDist) {
                var oBindingDist = inDist.getBinding("suggestionItems");
                if (oBindingDist) {
                    var aFiltersDist = [];
                    if (sOrg) {
                        aFiltersDist.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                    }
                    oBindingDist.filter(aFiltersDist);
                }
            }

            var inDiv = this.byId("inDivision");
            if (inDiv) {
                var oBindingDiv = inDiv.getBinding("suggestionItems");
                if (oBindingDiv) {
                    var aFiltersDiv = [];
                    if (sOrg) {
                        aFiltersDiv.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                    }
                    if (sChannel) {
                        aFiltersDiv.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                    }
                    oBindingDiv.filter(aFiltersDiv);
                }
            }
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newOrder");
            var aItems = oModel.getProperty("/items") || [];
            var sPlant = (aItems[0] && aItems[0].Plant) || "1000";
            var sReqDate = oModel.getProperty("/header/RequestedDeliveryDate");
            var oNewItem = SalesOrderModel.createEmptyItem(aItems.length, sPlant, sReqDate);
            aItems.push(oNewItem);
            oModel.setProperty("/items", aItems);
            SalesOrderModel.calculateTotals(oModel);
            SalesOrderModel.updateStatus(oModel);
        },

        onDeleteItem: function (oEvent) {
            var oModel = this.getView().getModel("newOrder");
            var aItems = oModel.getProperty("/items") || [];
            if (aItems.length <= 1) {
                MessageToast.show("An order requires at least one line item.");
                return;
            }

            var oListItem = oEvent.getParameter("listItem");
            var sPath = oListItem.getBindingContext("newOrder").getPath();
            var iIndex = parseInt(sPath.split("/").pop(), 10);

            aItems.splice(iIndex, 1);
            aItems.forEach(function (itm, idx) {
                itm.SalesOrderItem = String((idx + 1) * 10);
            });

            oModel.setProperty("/items", aItems);
            SalesOrderModel.calculateTotals(oModel);
            SalesOrderModel.validateForm(oModel);
        },

        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oSource.getValue() ? oSource.getValue().trim() : "";
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sVal);

            if (!sVal) {
                oModel.setProperty(sPath + "/errors/Material", { state: "Error", text: "Material is required" });
                SalesOrderModel.updateStatus(oModel);
                return;
            }

            oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });

            var oSalesOrderModel = (this.getModel && this.getModel("salesOrder")) || null;
            var oPromise = oSalesOrderModel ?
                SalesOrderService.getMaterialDetails(oSalesOrderModel, sVal) :
                SalesOrderService.getMaterialDetails(sVal);

            oPromise.then(function (oMat) {
                if (oMat) {
                    SalesOrderModel.applyMaterialDefaults(oModel, sPath, oMat, true);
                }
                SalesOrderModel.updateStatus(oModel);
            });
        },

        onItemMaterialLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sVal);
            if (sVal && sVal.trim() !== "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }
        },

        onItemMaterialSelect: function (oEvent) {
            var oRow = oEvent.getParameter("selectedRow") || oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext || !oRow) return;

            var oBindingCtx = oRow.getBindingContext("salesOrder") || oRow.getBindingContext();
            var sKey = "";
            if (oBindingCtx && typeof oBindingCtx.getProperty === "function") {
                sKey = oBindingCtx.getProperty("Material") || "";
            }
            if (!sKey) {
                var aCells = oRow.getCells ? oRow.getCells() : [];
                sKey = aCells[0] && aCells[0].getTitle ? aCells[0].getTitle() : (aCells[0] && aCells[0].getText ? aCells[0].getText() : (oRow.getKey ? oRow.getKey() : ""));
            }

            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            var oMaterialData = null;
            if (oBindingCtx) {
                try {
                    oMaterialData = typeof oBindingCtx.getObject === "function" ? oBindingCtx.getObject() : null;
                } catch (e) {
                    oMaterialData = null;
                }
                if (!oMaterialData || typeof oMaterialData !== "object") {
                    var fnGetProp = typeof oBindingCtx.getProperty === "function" ? oBindingCtx.getProperty.bind(oBindingCtx) : function () { return ""; };
                    oMaterialData = {
                        Material: fnGetProp("Material") || sKey,
                        MaterialName: fnGetProp("MaterialName") || fnGetProp("Material_Text") || "",
                        Material_Text: fnGetProp("Material_Text") || fnGetProp("MaterialName") || "",
                        MaterialBaseUnit: fnGetProp("MaterialBaseUnit") || "",
                        MaterialType: fnGetProp("MaterialType") || "",
                        MaterialGroup: fnGetProp("MaterialGroup") || ""
                    };
                }
            }

            if (oMaterialData && oMaterialData.Material) {
                SalesOrderModel.applyMaterialDefaults(oModel, sPath, oMaterialData, true);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                var sDesc = (oRow.getAdditionalText && oRow.getAdditionalText()) || "";
                if (!sDesc && oRow.getCells) {
                    var aCellsDesc = oRow.getCells();
                    sDesc = (aCellsDesc[1] && aCellsDesc[1].getText && aCellsDesc[1].getText()) || "";
                }
                if (sDesc) {
                    oModel.setProperty(sPath + "/SalesOrderItemText", sDesc);
                }
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            var sMatUnit = oMaterialData && (oMaterialData.MaterialBaseUnit || oMaterialData.BaseUnit);
            var sMatDesc = oMaterialData && (oMaterialData.MaterialName || oMaterialData.Material_Text);
            if (!sMatUnit || !sMatDesc) {
                var oSalesOrderModel = (this.getModel && this.getModel("salesOrder")) || null;
                var oDetailsPromise = oSalesOrderModel ?
                    SalesOrderService.getMaterialDetails(oSalesOrderModel, sKey) :
                    SalesOrderService.getMaterialDetails(sKey);
                if (oDetailsPromise && typeof oDetailsPromise.then === "function") {
                    oDetailsPromise.then(function (oMat) {
                        if (oMat) {
                            SalesOrderModel.applyMaterialDefaults(oModel, sPath, oMat, true);
                            SalesOrderModel.updateStatus(oModel);
                        }
                    });
                }
            }

            SalesOrderModel.updateStatus(oModel);
        },

        onItemCalculationChange: function (oEvent) {
            var oSource = oEvent && typeof oEvent.getSource === "function" ? oEvent.getSource() : null;
            if (oSource) {
                var oContext = oSource.getBindingContext("newOrder");
                if (oContext) {
                    var sPath = oContext.getPath();
                    var sVal = oSource.getValue();
                    var sProp = oSource.getBindingPath("value");
                    if (sProp) {
                        var oModel = this.getView().getModel("newOrder");
                        oModel.setProperty(sPath + "/" + sProp, sVal);
                    }
                }
            }
            var oModelTotals = this.getView().getModel("newOrder");
            SalesOrderModel.calculateTotals(oModelTotals);
            SalesOrderModel.updateStatus(oModelTotals);
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newOrder");
            SalesOrderModel.updateStatus(oModel);
        },

        onItemUnitSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/OrderQuantityUnit", sKey);
            oModel.setProperty(sPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
            this.onItemFieldChange();
        },

        onItemPlantChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oSource.getValue() ? oSource.getValue().trim().toUpperCase() : "";
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sVal);

            if (!sVal) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant is required for each line item" });
            } else if (sVal.length > 4) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant cannot exceed 4 characters" });
            } else {
                oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            }
            SalesOrderModel.updateStatus(oModel);
        },

        onItemPlantLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sVal ? sVal.toUpperCase() : "");
            if (sVal && sVal.trim() !== "") {
                if (sVal.trim().length <= 4) {
                    oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
                }
            }
        },

        onItemPlantSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newOrder");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newOrder");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sKey);
            oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            SalesOrderModel.updateStatus(oModel);
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            var oInput = oEvent.getSource();
            var oModel = this.getView().getModel("newOrder");
            var aContextFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inDistChannel") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                if (sOrg) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrgDiv = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrgDiv) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrgDiv));
                }
                if (sChannel) {
                    aContextFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                }
            }

            ValueHelpService.applySuggestionFilter(oInput, sValue, aContextFilters);
        },

        onValueHelpRequest: function (oEvent) {
            var oInput = oEvent.getSource();
            var oView = this.getView();
            var that = this;
            var oModel = oView.getModel("newOrder");

            var aInitialFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inDistChannel") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                if (sOrg) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrgDiv = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrgDiv) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrgDiv));
                }
                if (sChannel) {
                    aInitialFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                }
            }

            ValueHelpService.openValueHelp(oView, oInput, function (sKey, oSelectedItem, oData) {
                var oRowContext = oInput.getBindingContext("newOrder");
                if (oRowContext) {
                    var sRowPath = oRowContext.getPath();
                    var sValPath = oInput.getBindingPath("value");

                    if (sValPath === "Material" || sId.indexOf("Material") !== -1) {
                        var oMatData = oData || {
                            Material: sKey,
                            MaterialName: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || "",
                            Material_Text: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || ""
                        };
                        if (!oMatData.Material_Text && oSelectedItem && oSelectedItem.getCells) {
                            var aCellsVh = oSelectedItem.getCells();
                            oMatData.Material_Text = (aCellsVh[1] && aCellsVh[1].getText && aCellsVh[1].getText()) || "";
                            oMatData.MaterialName = oMatData.Material_Text;
                        }
                        SalesOrderModel.applyMaterialDefaults(oModel, sRowPath, oMatData, true);
                        if (!oData || !oData.MaterialBaseUnit || !(oData.MaterialName || oData.Material_Text)) {
                            var oSalesOrderModel = (that.getModel && that.getModel("salesOrder")) || null;
                            var oVhPromise = oSalesOrderModel ?
                                SalesOrderService.getMaterialDetails(oSalesOrderModel, sKey) :
                                SalesOrderService.getMaterialDetails(sKey);
                            if (oVhPromise && typeof oVhPromise.then === "function") {
                                oVhPromise.then(function (oMat) {
                                    if (oMat) {
                                        SalesOrderModel.applyMaterialDefaults(oModel, sRowPath, oMat, true);
                                        SalesOrderModel.updateStatus(oModel);
                                    }
                                });
                            }
                        }
                        SalesOrderModel.updateStatus(oModel);
                    } else if (sValPath === "OrderQuantityUnit") {
                        oModel.setProperty(sRowPath + "/OrderQuantityUnit", sKey);
                        oModel.setProperty(sRowPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
                        SalesOrderModel.updateStatus(oModel);
                    } else if (sValPath === "Plant" || sId.indexOf("Plant") !== -1) {
                        oModel.setProperty(sRowPath + "/Plant", sKey);
                        oModel.setProperty(sRowPath + "/errors/Plant", { state: "None", text: "" });
                        SalesOrderModel.updateStatus(oModel);
                    }
                    return;
                }

                // Header fields
                if (sId.indexOf("inOrderType") !== -1) {
                    that.onOrderTypeChange();
                } else if (sId.indexOf("inSalesOrg") !== -1) {
                    that.onSalesOrgChange();
                } else if (sId.indexOf("inDistChannel") !== -1) {
                    that.onDistChannelChange();
                } else if (sId.indexOf("inDivision") !== -1) {
                    that.onDivisionChange();
                } else if (sId.indexOf("inSoldToParty") !== -1) {
                    if (oData && (oData.CustomerName || oData.CityName)) {
                        oModel.setProperty("/header/CustomerName", oData.CustomerName || oData.OrganizationBPName1 || "");
                        oModel.setProperty("/header/CustomerCity", oData.CityName || "");
                        oModel.setProperty("/header/CustomerCountry", oData.Country || "");
                    }
                    that.onSoldToPartyChange();
                } else if (sId.indexOf("inShipToParty") !== -1) {
                    if (oData && oData.CustomerName) {
                        oModel.setProperty("/header/ShipToPartyName", oData.CustomerName);
                    }
                    that.onHeaderFieldChange();
                } else if (sId.indexOf("inCurrency") !== -1) {
                    that.onCurrencyChange();
                }
            }, aInitialFilters);
        },

        onCheckIncompletion: function () {
            var oModel = this.getView().getModel("newOrder");
            var bValid = SalesOrderModel.validateForm(oModel);
            var aGaps = SalesOrderModel.getIncompletionGaps(oModel);
            if (bValid && aGaps.length === 0) {
                MessageToast.show("Document is complete. No incompletions detected.");
            } else {
                this.onMessageButtonPress();
            }
        },

        onCheckAvailability: function () {
            var oModel = this.getView().getModel("newOrder");
            var aItems = oModel.getProperty("/items") || [];

            if (aItems.length === 0 || !aItems[0].Material) {
                MessageBox.warning("Please enter at least one line item with a Material to check ATP availability.");
                return;
            }

            var firstItem = aItems[0];
            var sDocId = oModel.getProperty("/header/PurchaseOrderNumber") || "";

            // Check if user provided an existing document number for CheckATP
            if (sDocId && /^\d+$/.test(sDocId.trim())) {
                BusyIndicator.show(0);
                SalesOrderService.checkATP(sDocId.trim(), firstItem.SalesOrderItem || "10").then(function (res) {
                    BusyIndicator.hide();
                    MessageBox.information(
                        "ATP Availability for Document " + sDocId.trim() + " Item " + (firstItem.SalesOrderItem || "10") + ":\n\n" +
                        "• Requested Quantity: " + res.RequestedQty + " " + (res.SalesUnit || firstItem.OrderQuantityUnit) + "\n" +
                        "• Confirmed Quantity: " + res.ConfirmedQty + " " + (res.SalesUnit || firstItem.OrderQuantityUnit) + "\n" +
                        "• Requested Delivery Date: " + (res.ReqDlvDate || "Default") + "\n" +
                        "• Confirmed Delivery Date: " + (res.CnfDlvDate || "Pending Scheduling"),
                        { title: "S/4HANA ATP Check Result" }
                    );
                }).catch(function (err) {
                    BusyIndicator.hide();
                    MessageBox.error("ATP Check error: " + (err.message || err));
                });
            } else {
                // Draft check notice explaining SAP S/4HANA LORD_ODATA_ORDER_SRV ATP scheduling
                MessageBox.information(
                    "ATP Availability Check (SAP S/4HANA):\n\n" +
                    "• Material: " + firstItem.Material + (firstItem.SalesOrderItemText ? " (" + firstItem.SalesOrderItemText + ")" : "") + "\n" +
                    "• Requested Quantity: " + firstItem.OrderQuantity + " " + firstItem.OrderQuantityUnit + "\n" +
                    "• Delivering Plant: " + firstItem.Plant + "\n" +
                    "• Requested Delivery Date: " + (firstItem.RequestedDeliveryDate || oModel.getProperty("/header/RequestedDeliveryDate")) + "\n\n" +
                    "Notice: In SAP S/4HANA, ATP schedule lines are dynamically generated and confirmed when the sales order is submitted.\n" +
                    "(To check live ATP against an existing document, enter the document number in PO Reference).",
                    { title: "Check Availability" }
                );
            }
        },

        onSave: function () {
            var that = this;
            var oModel = this.getView().getModel("newOrder");
            var bValid = SalesOrderModel.validateForm(oModel);

            // Validate Plant per item on submit
            var aItems = oModel.getProperty("/items") || [];
            var bItemsPlantValid = true;
            aItems.forEach(function (itm) {
                if (!itm.Plant || String(itm.Plant).trim() === "") {
                    itm.errors = itm.errors || {};
                    itm.errors.Plant = { state: "Error", text: "Plant is required for each line item" };
                    bItemsPlantValid = false;
                }
            });
            if (!bItemsPlantValid) {
                oModel.setProperty("/items", aItems);
                bValid = false;
            }

            if (!bValid) {
                this.onMessageButtonPress();
                return;
            }

            BusyIndicator.show(0);
            var oPayload = SalesOrderModel.buildPayload(oModel);

            SalesOrderService.createSalesOrder(oPayload).then(function (sOrderId) {
                BusyIndicator.hide();
                MessageBox.success("Sales Order " + sOrderId + " has been successfully created in SAP S/4HANA.", {
                    title: "Sales Order Created",
                    actions: ["Create Another", "Worklist", "Close"],
                    emphasizedAction: "Worklist",
                    onClose: function (sAction) {
                        if (sAction === "Create Another") {
                            that._resetModel(true);
                        } else {
                            that.getOwnerComponent().getRouter().navTo("salesOrders");
                        }
                    }
                });
            }).catch(function (error) {
                BusyIndicator.hide();
                var sErrMsg = (error && error.message) ? error.message : "An unexpected error occurred.";
                oModel.setProperty("/errorMessage", sErrMsg);
                oModel.setProperty("/hasError", true);
                MessageBox.error("Failed to create Sales Order: " + sErrMsg);
            });
        },

        onCancel: function () {
            var that = this;
            MessageBox.confirm("Are you sure you want to discard your changes?", {
                title: "Discard Sales Order",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        that.onNavBack("salesOrders");
                    }
                }
            });
        },

        onDismissError: function () {
            var oModel = this.getView().getModel("newOrder");
            if (oModel) {
                oModel.setProperty("/hasError", false);
                oModel.setProperty("/errorMessage", "");
            }
        },

        onMessageButtonPress: function (oEvent) {
            var oSource = (oEvent && oEvent.getSource) ? oEvent.getSource() : this.byId("btnOrderMessages");
            if (!oSource) return;

            var oModel = this.getView().getModel("newOrder");
            var aErrors = oModel.getProperty("/errorList") || [];

            if (!this._oMessagePopover) {
                var oMessageTemplate = new MessageItem({
                    type: "Error",
                    title: "{title}",
                    description: "{description}"
                });

                this._oMessagePopover = new MessagePopover({
                    items: {
                        path: "/",
                        template: oMessageTemplate
                    }
                });
                this.getView().addDependent(this._oMessagePopover);
            }

            var aItemsData = aErrors.map(function (err) {
                return {
                    title: err.message,
                    description: "Field: " + err.field
                };
            });

            var oMsgModel = new JSONModel(aItemsData);
            this._oMessagePopover.setModel(oMsgModel);
            this._oMessagePopover.toggle(oSource);
        }
    });
});
