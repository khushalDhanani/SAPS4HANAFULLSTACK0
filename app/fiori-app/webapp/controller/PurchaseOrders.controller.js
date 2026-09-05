sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/ResponsivePopover",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Text",
    "sap/m/Label",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/model/formatter"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageBox,
    MessageToast,
    ResponsivePopover,
    Dialog,
    Button,
    VBox,
    HBox,
    Text,
    Label,
    AuthService,
    formatter
) {
    "use strict";

    return Controller.extend("saps4hana.fiori.controller.PurchaseOrders", {
        formatter: formatter,

        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: 0,
                supplierCount: 0,
                completeRate: 100
            });
            this.getView().setModel(oViewModel, "viewModel");

            var oTable = this.byId("purchaseOrdersTable");
            oTable.attachEventOnce("updateFinished", this._updateKpiMetrics, this);
            oTable.attachUpdateFinished(this._updateKpiMetrics, this);
        },

        _updateKpiMetrics: function (oEvent) {
            var oTable = oEvent.getSource();
            var aItems = oTable.getItems();
            var iTotal = oEvent.getParameter("total") || aItems.length;

            var oSuppliers = {};
            var iCompleted = 0;

            aItems.forEach(function (oItem) {
                var oContext = oItem.getBindingContext();
                if (oContext) {
                    var sSupplier = oContext.getProperty("Supplier");
                    if (sSupplier) {
                        oSuppliers[sSupplier] = true;
                    }
                    if (oContext.getProperty("PurchasingCompletenessStatus")) {
                        iCompleted++;
                    }
                }
            });

            var iSupplierCount = Object.keys(oSuppliers).length;
            var iRate = aItems.length > 0 ? Math.round((iCompleted / aItems.length) * 100) : 100;

            var oViewModel = this.getView().getModel("viewModel");
            oViewModel.setProperty("/totalCount", iTotal);
            oViewModel.setProperty("/supplierCount", iSupplierCount > 0 ? iSupplierCount : iTotal);
            oViewModel.setProperty("/completeRate", iRate);
        },

        onSearch: function (oEvent) {
            this._applyFilters();
        },


        onFilterBarSearch: function () {
            this._applyFilters();
        },

        onFilterBarClear: function () {
            this.byId("fbPO").setValue("");
            this.byId("fbSupplier").setValue("");
            this.byId("fbCompanyCode").setValue("");
            this._applyFilters();
        },

        _applyFilters: function () {
            var aFilters = [];
            
            // 1. Search Query Filter (Global Search)
            var oSearchField = this.byId("searchField");
            var sQuery = oSearchField ? oSearchField.getValue() : "";
            if (sQuery && sQuery.trim().length > 0) {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("PurchaseOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("Supplier", FilterOperator.Contains, sTrimmed),
                        new Filter("SupplierName", FilterOperator.Contains, sTrimmed),
                        new Filter("CompanyCode", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            // 2. Advanced Filter Bar
            var oFbPO = this.byId("fbPO");
            var oFbSupplier = this.byId("fbSupplier");
            var oFbCompanyCode = this.byId("fbCompanyCode");
            
            if (oFbPO && oFbPO.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrder", FilterOperator.Contains, oFbPO.getValue().trim()));
            }
            if (oFbSupplier && oFbSupplier.getValue().trim() !== "") {
                aFilters.push(new Filter("SupplierName", FilterOperator.Contains, oFbSupplier.getValue().trim()));
            }
            if (oFbCompanyCode && oFbCompanyCode.getValue().trim() !== "") {
                aFilters.push(new Filter("CompanyCode", FilterOperator.Contains, oFbCompanyCode.getValue().trim()));
            }


            // Combine filters with AND
            var oFinalFilter = aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : [];

            // Apply to Table Binding
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(oFinalFilter);
            }
        },

        onRefresh: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.refresh();
            }
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("dashboard");
        },

        onCreatePO: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("createPurchaseOrder");
        },

        onOpenUserProfile: function (oEvent) {
            var oButton = oEvent.getSource();
            var oUser = AuthService.getCurrentUser();
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            var that = this;

            if (!this._oUserProfilePopover) {
                this._oUserProfilePopover = new ResponsivePopover({
                    title: oBundle.getText("userProfileTitle"),
                    placement: "Bottom",
                    contentWidth: "320px",
                    content: [
                        new VBox({
                            class: "sapUiSmallMargin",
                            items: [
                                new HBox({
                                    alignItems: "Center",
                                    class: "sapUiSmallMarginBottom",
                                    items: [
                                        new VBox({
                                            items: [
                                                new Label({ text: oBundle.getText("loginUsername") + ":", design: "Bold" }),
                                                new Text({ id: "popoverUserNamePO", text: "{auth>/user/username}" }),
                                                new Label({ text: oBundle.getText("userProfileSystem") + ":", design: "Bold", class: "sapUiTinyMarginTop" }),
                                                new Text({ id: "popoverUserSystemPO", text: "{auth>/user/system}" })
                                            ]
                                        })
                                    ]
                                }),
                                new Button({
                                    text: oBundle.getText("btnLogout"),
                                    type: "Reject",
                                    icon: "sap-icon://log-out",
                                    width: "100%",
                                    press: function () {
                                        that._oUserProfilePopover.close();
                                        that.onLogout();
                                    }
                                })
                            ]
                        })
                    ]
                });
                this.getView().addDependent(this._oUserProfilePopover);
            }

            this._oUserProfilePopover.openBy(oButton);
        },

        onLogout: function () {
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();

            MessageBox.confirm(oBundle.getText("logoutConfirmMsg"), {
                title: oBundle.getText("logoutConfirmTitle"),
                icon: MessageBox.Icon.WARNING,
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.NO,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        AuthService.logout();
                        MessageToast.show(oBundle.getText("logoutSuccessMsg"));
                        // Use direct hash change for guaranteed navigation —
                        // sap.m.routing.Router may skip navTo if hash is already "login"
                        window.location.hash = "login";
                    }
                }
            });
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem.getBindingContext();
            if (!oContext) {
                return;
            }

            var oData = oContext.getObject();
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();

            var oDialog = new Dialog({
                title: oBundle.getText("dialogTitle") + " — " + oData.PurchaseOrder,
                type: "Message",
                contentWidth: "400px",
                content: new VBox({
                    class: "sapUiSmallMargin",
                    items: [
                        new HBox({
                            items: [
                                new Label({ text: oBundle.getText("colPurchaseOrder") + ":", width: "160px", design: "Bold" }),
                                new Text({ text: oData.PurchaseOrder })
                            ]
                        }),
                        new HBox({
                            items: [
                                new Label({ text: oBundle.getText("colDocType") + ":", width: "160px", design: "Bold" }),
                                new Text({ text: oData.PurchaseOrderType || "-" })
                            ]
                        }),
                        new HBox({
                            items: [
                                new Label({ text: oBundle.getText("colSupplier") + ":", width: "160px", design: "Bold" }),
                                new Text({ text: (oData.SupplierName || "") + " (" + (oData.Supplier || "-") + ")" })
                            ]
                        }),
                        new HBox({
                            items: [
                                new Label({ text: oBundle.getText("colCompany") + ":", width: "160px", design: "Bold" }),
                                new Text({ text: (oData.CompanyCode || "-") + " - " + (oData.CompanyCodeName || "") })
                            ]
                        }),
                        new HBox({
                            items: [
                                new Label({ text: oBundle.getText("colPurchasingOrg") + ":", width: "160px", design: "Bold" }),
                                new Text({ text: (oData.PurchasingOrganization || "-") + " / " + (oData.PurchasingGroup || "-") })
                            ]
                        }),
                        new HBox({
                            items: [
                                new Label({ text: oBundle.getText("colCreationDate") + ":", width: "160px", design: "Bold" }),
                                new Text({ text: formatter.formatDate(oData.CreationDate) })
                            ]
                        }),
                        new HBox({
                            items: [
                                new Label({ text: oBundle.getText("colStatus") + ":", width: "160px", design: "Bold" }),
                                new Text({ text: oData.PurchasingCompletenessStatus ? oBundle.getText("statusComplete") : oBundle.getText("statusIncomplete") })
                            ]
                        })
                    ]
                }),
                beginButton: new Button({
                    text: oBundle.getText("dialogClose"),
                    press: function () {
                        oDialog.close();
                        oDialog.destroy();
                    }
                })
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        }
    });
});
