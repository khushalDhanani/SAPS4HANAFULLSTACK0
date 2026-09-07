sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
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
], function (BaseController, MessageBox, MessageToast, MessagePopover, MessageItem, BusyIndicator, Filter, FilterOperator, SalesInquiryModel, ValueHelpService, SalesInquiryService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-inquiry.controller.CreateSalesInquiry", {
        onInit: function () {
            this._resetModel();
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createSalesInquiry").attachPatternMatched(this._onRouteMatched, this);
        },

        _resetModel: function () {
            var sUser = SalesInquiryModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = SalesInquiryModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newInquiry");
            SalesInquiryModel.updateStatus(oModel);

            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }

            this._loadConfigurationAndDefaults();
        },

        _loadConfigurationAndDefaults: function () {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");

            if (this._oConfigData) {
                SalesInquiryModel.applyConfigurationDefaults(oModel, this._oConfigData);
                return Promise.resolve(this._oConfigData);
            }

            return SalesInquiryService.loadConfiguration().then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newInquiry");
                if (oCurrentModel) {
                    SalesInquiryModel.applyConfigurationDefaults(oCurrentModel, oConfigData);
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreateSalesInquiry] Error loading config data:", err);
            });
        },

        _onRouteMatched: function () {
            this._resetModel();
        },

        onInquiryTypeChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "SalesInquiryType", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "SalesInquiryType");
            SalesInquiryModel.updateStatus(oModel);
        },

        onInquiryTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesInquiryType", sKey);
                this.onInquiryTypeChange();
            }
        },

        onSalesOrgChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "SalesOrganization", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "SalesOrganization");
            SalesInquiryModel.updateStatus(oModel);
        },

        onSalesOrgSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SalesOrganization", sKey);
                this.onSalesOrgChange();
            }
        },

        onDistChannelChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "DistributionChannel", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "DistributionChannel");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDistChannelSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/DistributionChannel", sKey);
                this.onDistChannelChange();
            }
        },

        onDivisionChange: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "OrganizationDivision", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "OrganizationDivision");
            SalesInquiryModel.updateStatus(oModel);
        },

        onDivisionSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/OrganizationDivision", sKey);
                this.onDivisionChange();
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
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/SoldToParty", sKey);
                SalesInquiryModel.markUserModified(oModel, "SoldToParty", true);
                this._deriveCustomerData(sKey);
                SalesInquiryModel.validateSingleField(oModel, "SoldToParty");
                SalesInquiryModel.updateStatus(oModel);
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
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                SalesInquiryModel.markUserModified(oModel, "TransactionCurrency", true);
            }
            SalesInquiryModel.validateSingleField(oModel, "TransactionCurrency");
            SalesInquiryModel.updateStatus(oModel);
        },

        onCurrencySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newInquiry");
                oModel.setProperty("/header/TransactionCurrency", sKey);
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

            if (!sVal || sVal.trim() === "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "Error", text: "Material is required" });
            } else {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemMaterialSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newInquiry");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var sDesc = oItem.getAdditionalText() || "";
            var oModel = this.getView().getModel("newInquiry");
            var sPath = oContext.getPath();

            oModel.setProperty(sPath + "/Material", sKey);
            if (sDesc && !oModel.getProperty(sPath + "/SalesInquiryItemText")) {
                oModel.setProperty(sPath + "/SalesInquiryItemText", sDesc);
            }
            oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemCalculationChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.calculateTotals(oModel);
            SalesInquiryModel.updateStatus(oModel);
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newInquiry");
            SalesInquiryModel.updateStatus(oModel);
        },

        onCheckIncompletion: function () {
            var oModel = this.getView().getModel("newInquiry");
            var bValid = SalesInquiryModel.validateForm(oModel);
            if (bValid) {
                MessageToast.show("Document is complete. No incompletions detected.");
            } else {
                this.onMessageButtonPress();
            }
        },

        onSave: function () {
            var that = this;
            var oModel = this.getView().getModel("newInquiry");
            var bValid = SalesInquiryModel.validateForm(oModel);

            if (!bValid) {
                this.onMessageButtonPress();
                return;
            }

            BusyIndicator.show(0);
            var oHeader = oModel.getProperty("/header");
            var aItems = oModel.getProperty("/items");

            var oPayload = {
                header: oHeader,
                items: aItems
            };

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
                            that._resetModel();
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
                MessageBox.error("Failed to create Sales Inquiry: " + sErrMsg);
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

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            var oSource = oEvent.getSource();
            var oBinding = oSource.getBinding("suggestionItems");
            if (oBinding) {
                oBinding.filter(new Filter({
                    path: oSource.getBindingInfo("suggestionItems").template.getBindingInfo("text").parts[0].path,
                    operator: FilterOperator.Contains,
                    value1: sValue
                }));
            }
        },

        onValueHelpRequest: function (oEvent) {
            var oInput = oEvent.getSource();
            var oView = this.getView();
            var that = this;

            ValueHelpService.openValueHelp(oView, oInput, function (oSelectedItem) {
                if (oSelectedItem) {
                    var sKey = oSelectedItem.getTitle();
                    oInput.setValue(sKey);

                    // Fire relevant change handler based on input ID
                    var sId = oInput.getId();
                    if (sId.indexOf("inInquiryType") !== -1) {
                        that.onInquiryTypeChange();
                    } else if (sId.indexOf("inSalesOrg") !== -1) {
                        that.onSalesOrgChange();
                    } else if (sId.indexOf("inDistChannel") !== -1) {
                        that.onDistChannelChange();
                    } else if (sId.indexOf("inDivision") !== -1) {
                        that.onDivisionChange();
                    } else if (sId.indexOf("inSoldToParty") !== -1) {
                        that.onSoldToPartyChange();
                    } else if (sId.indexOf("inCurrency") !== -1) {
                        that.onCurrencyChange();
                    }
                }
            });
        },

        onMessageButtonPress: function () {
            var oModel = this.getView().getModel("newInquiry");
            var oErrors = oModel.getProperty("/errors") || {};
            var aItems = oModel.getProperty("/items") || [];
            var aMessages = [];

            Object.keys(oErrors).forEach(function (field) {
                if (oErrors[field].state === "Error") {
                    aMessages.push({
                        type: "Error",
                        title: oErrors[field].text,
                        subtitle: "Header: " + field
                    });
                }
            });

            aItems.forEach(function (item, idx) {
                if (item.errors) {
                    Object.keys(item.errors).forEach(function (field) {
                        if (item.errors[field].state === "Error") {
                            aMessages.push({
                                type: "Error",
                                title: item.errors[field].text,
                                subtitle: "Item " + (idx + 1) + ": " + field
                            });
                        }
                    });
                }
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
            }

            var oMsgModel = new JSONModel(aMessages);
            this._oMessagePopover.setModel(oMsgModel, "msg");
            var oBtn = this.byId("btnInquiryMessages") || this.byId("btnSaveInquiry");
            this._oMessagePopover.openBy(oBtn);
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
