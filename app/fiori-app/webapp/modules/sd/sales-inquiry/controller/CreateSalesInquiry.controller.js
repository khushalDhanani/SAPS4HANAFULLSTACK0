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
    "saps4hana/fiori/modules/sd/sales-inquiry/model/SalesInquiryModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/sd/sales-inquiry/service/SalesInquiryService"
], function (BaseController, JSONModel, MessageBox, MessageToast, MessagePopover, MessageItem, BusyIndicator, Filter, FilterOperator, SalesInquiryModel, ValueHelpService, SalesInquiryService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-inquiry.controller.CreateSalesInquiry", {
        onInit: function () {
            this._resetModel(false);
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createSalesInquiry").attachPatternMatched(this._onRouteMatched, this);
        },

        _resetModel: function (bLoadConfig) {
            var sUser = SalesInquiryModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = SalesInquiryModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newInquiry");
            SalesInquiryModel.updateStatus(oModel);
            if (this._oCapabilities) {
                SalesInquiryModel.applyCapabilities(oModel, this._oCapabilities);
            }

            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }

            if (bLoadConfig) {
                this._loadConfigurationAndDefaults();
                this._loadCapabilities();
            }
        },

        /**
         * Asks the backend which quotation-required fields the SAP inquiry service accepts, so the
         * form can require those and warn about the rest (to be maintained in VA22).
         */
        _loadCapabilities: function () {
            var that = this;
            if (this._oCapabilities) {
                return Promise.resolve(this._oCapabilities);
            }
            return SalesInquiryService.getInquiryCreationCapabilities().then(function (oCaps) {
                that._oCapabilities = oCaps || {};
                var oModel = that.getView().getModel("newInquiry");
                if (oModel) {
                    SalesInquiryModel.applyCapabilities(oModel, that._oCapabilities);
                }
                return that._oCapabilities;
            });
        },

        _loadConfigurationAndDefaults: function () {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");

            if (this._oConfigData) {
                SalesInquiryModel.applyConfigurationDefaults(oModel, this._oConfigData);
                this._updateOrganizationalFilters();
                return Promise.resolve(this._oConfigData);
            }

            var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
            var oConfigPromise = oSalesInquiryModel ?
                SalesInquiryService.loadConfiguration(oSalesInquiryModel) :
                SalesInquiryService.loadConfiguration();
            return oConfigPromise.then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newInquiry");
                if (oCurrentModel) {
                    SalesInquiryModel.applyConfigurationDefaults(oCurrentModel, oConfigData);
                    that._updateOrganizationalFilters();
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error loading config data:", err);
            });
        },

        _onRouteMatched: function () {
            this._resetModel(true);
        },

        onInquiryTypeChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "SalesInquiryType", true);
            SalesInquiryModel.validateSingleField(oModel, "SalesInquiryType");
            SalesInquiryModel.updateStatus(oModel);
        },

        onInquiryTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesInquiryType", sKey);
                SalesInquiryModel.markUserModified(oModel, "SalesInquiryType", true);
                this.onInquiryTypeChange();
            }
        },

        onSalesOrgChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "SalesOrganization", true);
            this._updateOrganizationalFilters();
            SalesInquiryModel.validateSingleField(oModel, "SalesOrganization");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSalesOrgSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesOrganization", sKey);
                SalesInquiryModel.markUserModified(oModel, "SalesOrganization", true);
                this.onSalesOrgChange();
            }
        },

        onDistChannelChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "DistributionChannel", true);
            this._updateOrganizationalFilters();
            SalesInquiryModel.validateSingleField(oModel, "DistributionChannel");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDistChannelSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/DistributionChannel", sKey);
                SalesInquiryModel.markUserModified(oModel, "DistributionChannel", true);
                this.onDistChannelChange();
            }
        },

        onDivisionChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "OrganizationDivision", true);
            SalesInquiryModel.validateSingleField(oModel, "OrganizationDivision");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDivisionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/OrganizationDivision", sKey);
                SalesInquiryModel.markUserModified(oModel, "OrganizationDivision", true);
                this.onDivisionChange();
            }
        },

        _updateOrganizationalFilters: function () {
            var oModel = this.getView().getModel("newInquiry");
            if (!oModel) return;
            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sChannel = oModel.getProperty("/header/DistributionChannel");

            var oDistInput = this.byId("inDistChannel");
            if (oDistInput) {
                var oDistBinding = oDistInput.getBinding("suggestionItems");
                if (oDistBinding) {
                    var aDistFilters = sOrg ? [new Filter("SalesOrganization", FilterOperator.EQ, sOrg)] : [];
                    oDistBinding.filter(aDistFilters);
                }
            }

            var oDivInput = this.byId("inDivision");
            if (oDivInput) {
                var oDivBinding = oDivInput.getBinding("suggestionItems");
                if (oDivBinding) {
                    var aDivFilters = [];
                    if (sOrg) aDivFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                    if (sChannel) aDivFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                    oDivBinding.filter(aDivFilters);
                }
            }
        },

        onSoldToPartyChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : oModel.getProperty("/header/SoldToParty");
            SalesInquiryModel.markUserModified(oModel, "SoldToParty", true);
            this._deriveCustomerData(sVal);
            SalesInquiryModel.validateSingleField(oModel, "SoldToParty");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSoldToPartyLiveChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newInquiry");
            oModel.setProperty("/header/SoldToParty", sVal);
            SalesInquiryModel.markUserModified(oModel, "SoldToParty", true);
            if (sVal && sVal.length >= 4) {
                this._deriveCustomerData(sVal);
            }
            SalesInquiryModel.validateSingleField(oModel, "SoldToParty");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSoldToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var sDesc = oItem.getAdditionalText() || "";
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SoldToParty", sKey);
                if (sDesc) {
                    oModel.setProperty("/header/CustomerName", sDesc);
                }
                SalesInquiryModel.markUserModified(oModel, "SoldToParty", true);
                this._deriveCustomerData(sKey);
                SalesInquiryModel.validateSingleField(oModel, "SoldToParty");
                SalesInquiryModel.updateStatus(oModel);
            }
        },

        onShipToPartySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var sDesc = oItem.getAdditionalText() || "";
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/ShipToParty", sKey);
                if (sDesc) {
                    oModel.setProperty("/header/ShipToPartyName", sDesc);
                }
                this.onHeaderFieldChange();
            }
        },

        _deriveCustomerData: function (sCustomer) {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");
            if (!sCustomer || String(sCustomer).trim() === "") {
                SalesInquiryModel.deriveCustomerDefaults(oModel, "", null);
                return;
            }

            var sOrg = oModel.getProperty("/header/SalesOrganization");
            var sChannel = oModel.getProperty("/header/DistributionChannel");
            var sDivision = oModel.getProperty("/header/OrganizationDivision");

            SalesInquiryService.getCustomerDefaults(sCustomer, sOrg, sChannel, sDivision).then(function (oDefaults) {
                var oCurrentModel = that.getView().getModel("newInquiry");
                if (oCurrentModel && oCurrentModel.getProperty("/header/SoldToParty") === sCustomer) {
                    SalesInquiryModel.deriveCustomerDefaults(oCurrentModel, sCustomer, oDefaults);
                }
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error fetching customer defaults:", err);
            });
        },

        onValidityDateChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            var dStart = oModel.getProperty("/header/BindingPeriodValidityStartDate");
            var dEnd = oModel.getProperty("/header/BindingPeriodValidityEndDate");

            if (dStart && dEnd && new Date(dEnd) < new Date(dStart)) {
                SalesInquiryModel.setFieldValidation(oModel, "BindingPeriodValidityEndDate", "Error", "End Date must be >= Start Date");
            } else {
                SalesInquiryModel.setFieldValidation(oModel, "BindingPeriodValidityEndDate", "None", "");
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onCurrencyChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.markUserModified(oModel, "TransactionCurrency", true);
            SalesInquiryModel.validateSingleField(oModel, "TransactionCurrency");
            SalesInquiryModel.updateStatus(oModel);
        },

        onCurrencySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/TransactionCurrency", sKey);
                SalesInquiryModel.markUserModified(oModel, "TransactionCurrency", true);
                this.onCurrencyChange();
            }
        },

        onHeaderFieldChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.updateStatus(oModel);
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.addItem(oModel);
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            if (oItem) {
                var sPath = oItem.getBindingContext("newInquiry").getPath();
                var oModel = this.getView().getModel("newInquiry");
                SalesInquiryModel.deleteItem(oModel, sPath);
            }
        },

        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oSource.getValue();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sVal);

            if (!sVal || sVal.trim() === "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "Error", text: "Material is required" });
            } else {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
                // Directly retrieve and set Unit from S/4HANA material configuration on manual input
                var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
                var oChangePromise = oSalesInquiryModel ?
                    SalesInquiryService.getMaterialDetails(oSalesInquiryModel, sVal) :
                    SalesInquiryService.getMaterialDetails(sVal);
                if (oChangePromise && typeof oChangePromise.then === "function") {
                    oChangePromise.then(function (oMaterial) {
                        if (oMaterial) {
                            SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMaterial, true);
                            SalesInquiryModel.updateStatus(oModel);
                        }
                    });
                }
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemMaterialLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sVal);
            if (sVal && sVal.trim() !== "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }
        },

        onItemMaterialSelect: function (oEvent) {
            var oRow = oEvent.getParameter("selectedRow") || oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oRow) return;

            var oBindingCtx = oRow.getBindingContext("salesInquiry") || oRow.getBindingContext();
            var sKey = "";
            if (oBindingCtx && typeof oBindingCtx.getProperty === "function") {
                sKey = oBindingCtx.getProperty("Material") || "";
            }
            if (!sKey) {
                var aCells = oRow.getCells ? oRow.getCells() : [];
                sKey = aCells[0] && aCells[0].getTitle ? aCells[0].getTitle() : (aCells[0] && aCells[0].getText ? aCells[0].getText() : (oRow.getKey ? oRow.getKey() : (oRow.getText ? oRow.getText() : "")));
            }

            var oModel = this.getView().getModel("newInquiry");
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
                SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMaterialData, true);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                var sDesc = (oRow.getAdditionalText && oRow.getAdditionalText()) || "";
                if (!sDesc && oRow.getCells) {
                    var aCellsDesc = oRow.getCells();
                    sDesc = (aCellsDesc[1] && aCellsDesc[1].getText && aCellsDesc[1].getText()) || "";
                }
                if (sDesc) {
                    oModel.setProperty(sPath + "/SalesInquiryItemText", sDesc);
                }
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            // Ensure Unit and material details are derived from S/4HANA if not already present
            var sMatUnit = oMaterialData && (oMaterialData.MaterialBaseUnit || oMaterialData.BaseUnit);
            var sMatDesc = oMaterialData && (oMaterialData.MaterialName || oMaterialData.Material_Text);
            if (!sMatUnit || !sMatDesc) {
                var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
                var oDetailsPromise = oSalesInquiryModel ?
                    SalesInquiryService.getMaterialDetails(oSalesInquiryModel, sKey) :
                    SalesInquiryService.getMaterialDetails(sKey);
                if (oDetailsPromise && typeof oDetailsPromise.then === "function") {
                    oDetailsPromise.then(function (oMat) {
                        if (oMat) {
                            SalesInquiryModel.applyMaterialDefaults(oModel, sPath, oMat, true);
                            SalesInquiryModel.updateStatus(oModel);
                        }
                    });
                }
            }

            SalesInquiryModel.updateStatus(oModel);
        },

        onItemCalculationChange: function (oEvent) {
            var oSource = oEvent && typeof oEvent.getSource === "function" ? oEvent.getSource() : null;
            if (oSource) {
                var oContext = oSource.getBindingContext("newInquiry");
                if (oContext) {
                    var sPath = oContext.getPath();
                    var sVal = oSource.getValue();
                    var sProp = oSource.getBindingPath("value");
                    if (sProp) {
                        var oModel = this.getView().getModel("newInquiry");
                        oModel.setProperty(sPath + "/" + sProp, sVal);
                    }
                }
            }
            var oCurrentModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.calculateTotals(oCurrentModel);
            SalesInquiryModel.updateStatus(oCurrentModel);
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.updateStatus(oModel);
        },

        onCheckIncompletion: function () {
            var oModel = this.getView().getModel("newInquiry");
            var bValid = SalesInquiryModel.validateForm(oModel);
            // Mirror SAP's own incompletion log: values SAP needs before a quotation can be created
            var aGaps = SalesInquiryModel.getQuotationReadinessGaps(oModel);
            if (bValid && aGaps.length === 0) {
                MessageToast.show("Document is complete. No incompletions detected.");
            } else {
                this.onMessageButtonPress();
            }
        },

        onSave: function () {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");
            var bValid = SalesInquiryModel.validateForm(oModel);

            // Validate Plant per item on submit before calling backend
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
            var oPayload = SalesInquiryModel.buildPayload(oModel);

            SalesInquiryService.createSalesInquiry(oPayload).then(function (sInquiryId) {
                BusyIndicator.hide();
                MessageBox.success("Sales Inquiry " + sInquiryId + " has been successfully created.", {
                    title: "Sales Inquiry Created",
                    actions: ["Display Inquiry", "Create Another", "Close"],
                    emphasizedAction: "Display Inquiry",
                    onClose: function (sAction) {
                        if (sAction === "Display Inquiry") {
                            that.getOwnerComponent().getRouter().navTo("salesInquiryDetail", {
                                SalesInquiry: sInquiryId
                            });
                        } else if (sAction === "Create Another") {
                            that._resetModel(true);
                        } else {
                            that.getOwnerComponent().getRouter().navTo("salesInquiries");
                        }
                    }
                });
            }).catch(function (error) {
                BusyIndicator.hide();
                var sErrMsg = (error && error.message) ? error.message : "An unexpected error occurred.";
                oModel.setProperty("/errorMessage", sErrMsg);
                oModel.setProperty("/hasError", true);

                var sInquiryMatch = sErrMsg.match(/Sales Inquiry (\d+)/i);
                var sPartialInquiryId = (error && (error.SalesInquiry || error.documentNumber)) || (sInquiryMatch ? sInquiryMatch[1] : null);

                if (sPartialInquiryId) {
                    MessageBox.warning(sErrMsg, {
                        title: "Partial Creation in SAP",
                        actions: ["Display Inquiry " + sPartialInquiryId, "Close"],
                        emphasizedAction: "Display Inquiry " + sPartialInquiryId,
                        onClose: function (sAction) {
                            if (sAction && sAction.indexOf("Display Inquiry") === 0) {
                                that.getOwnerComponent().getRouter().navTo("salesInquiryDetail", {
                                    SalesInquiry: sPartialInquiryId
                                });
                            }
                        }
                    });
                } else {
                    MessageBox.error("Failed to create Sales Inquiry: " + sErrMsg);
                }
            });
        },

        onCancel: function () {
            var that = this;
            MessageBox.confirm("Are you sure you want to discard your changes?", {
                title: "Discard Inquiry",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        that._resetModel();
                        that.onNavBack("salesInquiries");
                    }
                }
            });
        },

        onItemUnitSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/OrderQuantityUnit", sKey);
            oModel.setProperty(sPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
            this.onItemFieldChange();
        },

        onItemPlantChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oSource.getValue() ? oSource.getValue().trim().toUpperCase() : "";
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sVal);

            if (!sVal) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant is required for each line item" });
            } else if (sVal.length > 4) {
                oModel.setProperty(sPath + "/errors/Plant", { state: "Error", text: "Plant cannot exceed 4 characters" });
            } else {
                oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemPlantLiveChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext) return;

            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("newInquiry");
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
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Plant", sKey);
            oModel.setProperty(sPath + "/errors/Plant", { state: "None", text: "" });
            SalesInquiryModel.updateStatus(oModel);
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            var oInput = oEvent.getSource();
            var oModel = this.getView().getModel("newInquiry");
            var aContextFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inDistChannel") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                if (sOrg) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrg) {
                    aContextFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
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
            var oModel = oView.getModel("newInquiry");

            var aInitialFilters = [];
            var sId = oInput.getId();

            if (sId.indexOf("inDistChannel") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                if (sOrg) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
            } else if (sId.indexOf("inDivision") !== -1) {
                var sOrg = oModel.getProperty("/header/SalesOrganization");
                var sChannel = oModel.getProperty("/header/DistributionChannel");
                if (sOrg) {
                    aInitialFilters.push(new Filter("SalesOrganization", FilterOperator.EQ, sOrg));
                }
                if (sChannel) {
                    aInitialFilters.push(new Filter("DistributionChannel", FilterOperator.EQ, sChannel));
                }
            }

            ValueHelpService.openValueHelp(oView, oInput, function (sKey, oSelectedItem, oData) {
                // Check if this input is in the line items table
                var oRowContext = oInput.getBindingContext("newInquiry");
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
                        SalesInquiryModel.applyMaterialDefaults(oModel, sRowPath, oMatData, true);
                        if (!oData || !oData.MaterialBaseUnit || !(oData.MaterialName || oData.Material_Text)) {
                            var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
                            var oVhPromise = oSalesInquiryModel ?
                                SalesInquiryService.getMaterialDetails(oSalesInquiryModel, sKey) :
                                SalesInquiryService.getMaterialDetails(sKey);
                            if (oVhPromise && typeof oVhPromise.then === "function") {
                                oVhPromise.then(function (oMat) {
                                    if (oMat) {
                                        SalesInquiryModel.applyMaterialDefaults(oModel, sRowPath, oMat, true);
                                        SalesInquiryModel.updateStatus(oModel);
                                    }
                                });
                            }
                        }
                        SalesInquiryModel.updateStatus(oModel);
                    } else if (sValPath === "OrderQuantityUnit") {
                        oModel.setProperty(sRowPath + "/OrderQuantityUnit", sKey);
                        oModel.setProperty(sRowPath + "/errors/OrderQuantityUnit", { state: "None", text: "" });
                        SalesInquiryModel.updateStatus(oModel);
                    } else if (sValPath === "Plant" || sId.indexOf("Plant") !== -1) {
                        oModel.setProperty(sRowPath + "/Plant", sKey);
                        oModel.setProperty(sRowPath + "/errors/Plant", { state: "None", text: "" });
                        SalesInquiryModel.updateStatus(oModel);
                    }
                    return;
                }

                // Header fields
                if (sId.indexOf("inInquiryType") !== -1) {
                    that.onInquiryTypeChange();
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

        onMessageButtonPress: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var oErrors = oModel.getProperty("/errors") || {};
            var aItems = oModel.getProperty("/items") || [];
            var aMessages = [];

            Object.keys(oErrors).forEach(function (field) {
                if (oErrors[field] && oErrors[field].state === "Error") {
                    aMessages.push({
                        type: "Error",
                        title: oErrors[field].text,
                        subtitle: "Header: " + field
                    });
                }
            });

            aItems.forEach(function (item, idx) {
                if (item && item.errors) {
                    Object.keys(item.errors).forEach(function (field) {
                        if (item.errors[field] && item.errors[field].state === "Error") {
                            aMessages.push({
                                type: "Error",
                                title: item.errors[field].text,
                                subtitle: "Item " + (idx + 1) + ": " + field
                            });
                        }
                    });
                }
            });

            (oModel.getProperty("/readinessGaps") || []).forEach(function (gap) {
                aMessages.push({ type: "Warning", title: gap.title, subtitle: gap.subtitle });
            });

            if (aMessages.length === 0) {
                MessageToast.show("No issues detected.");
                return;
            }

            if (!this._oMessagePopover) {
                this._oMessagePopover = new MessagePopover({
                    items: {
                        path: "msg>/",
                        template: new MessageItem({
                            type: "{msg>type}",
                            title: "{msg>title}",
                            subtitle: "{msg>subtitle}"
                        })
                    }
                });
                this.getView().addDependent(this._oMessagePopover);
            }

            var oMsgModel = new JSONModel(aMessages);
            this._oMessagePopover.setModel(oMsgModel, "msg");

            var that = this;
            var oSource = (oEvent && typeof oEvent.getSource === "function") ? oEvent.getSource() : null;
            var oBtn = oSource || this.byId("btnInquiryMessages");
            if (!oBtn || !oBtn.getDomRef()) {
                oBtn = this.byId("btnSaveInquiry") || this.byId("btnCheckIncompletion");
            }

            setTimeout(function () {
                if (that._oMessagePopover && !that._oMessagePopover.isOpen()) {
                    var oTarget = (oBtn && oBtn.getDomRef()) ? oBtn : (that.byId("btnSaveInquiry") || that.byId("btnCheckIncompletion"));
                    if (oTarget && oTarget.getDomRef()) {
                        that._oMessagePopover.openBy(oTarget);
                    }
                }
            }, 50);
        },

        onDismissError: function () {
            var oModel = this.getView().getModel("newInquiry");
            oModel.setProperty("/hasError", false);
            oModel.setProperty("/errorMessage", "");
        },

        onExit: function () {
            if (this._oMessagePopover) {
                this._oMessagePopover.destroy();
                this._oMessagePopover = null;
            }
        }
    });
});
