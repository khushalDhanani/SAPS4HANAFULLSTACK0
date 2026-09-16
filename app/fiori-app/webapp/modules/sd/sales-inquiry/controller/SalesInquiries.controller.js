sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/BusyIndicator",
    "sap/ui/core/Fragment",
    "saps4hana/fiori/modules/sd/sales-inquiry/service/SalesInquiryService"
], function (BaseController, JSONModel, Filter, FilterOperator, FilterType, MessageBox, MessageToast, BusyIndicator, Fragment, SalesInquiryService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-inquiry.controller.SalesInquiries", {
        formatter: {
            statusText: function (sStatus) {
                if (!sStatus || sStatus === "A" || sStatus === "Open") {
                    return "Open";
                }
                if (sStatus === "B") {
                    return "In Process";
                }
                if (sStatus === "C" || sStatus === "Completed") {
                    return "Completed";
                }
                return sStatus;
            },

            statusState: function (sStatus) {
                if (!sStatus || sStatus === "A" || sStatus === "Open") {
                    return "Information";
                }
                if (sStatus === "B") {
                    return "Warning";
                }
                if (sStatus === "C" || sStatus === "Completed") {
                    return "Success";
                }
                return "None";
            }
        },

        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: 0,
                openCount: 0,
                customerCount: 0
            });
            this.getView().setModel(oViewModel, "salesInquiriesView");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("salesInquiries").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oTable = this.byId("salesInquiriesTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Safe guard against refreshing in-flight initial request
                }
            }
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var iTotal = oEvent.getParameter("total") || 0;
            var aItems = oTable.getItems() || [];
            var oViewModel = this.getView().getModel("salesInquiriesView");

            var mCustomers = {};
            var iOpen = 0;

            aItems.forEach(function (oItem) {
                var oCtx = oItem.getBindingContext("salesInquiry");
                if (oCtx) {
                    var sCust = oCtx.getProperty("SoldToParty");
                    if (sCust) {
                        mCustomers[sCust] = true;
                    }
                    var sStatus = oCtx.getProperty("OverallSDProcessStatus");
                    if (!sStatus || sStatus === "A" || sStatus === "Open") {
                        iOpen++;
                    }
                }
            });

            var iDistinctCustomers = Object.keys(mCustomers).length;
            oViewModel.setProperty("/totalCount", iTotal || aItems.length);
            oViewModel.setProperty("/openCount", iOpen);
            oViewModel.setProperty("/customerCount", iDistinctCustomers);
        },

        onNavigateToCreateInquiry: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesInquiry");
        },

        onInquiryPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            if (oItem) {
                var oCtx = oItem.getBindingContext("salesInquiry");
                if (oCtx) {
                    var sInquiryId = oCtx.getProperty("SalesInquiry");
                    this.getOwnerComponent().getRouter().navTo("salesInquiryDetail", {
                        SalesInquiry: sInquiryId
                    });
                }
            }
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
            var oTable = this.byId("salesInquiriesTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (!oBinding) return;

            var aFilters = [];
            if (sQuery && sQuery.trim() !== "") {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("SalesInquiry", FilterOperator.Contains, sTrimmed),
                        new Filter("SoldToParty", FilterOperator.Contains, sTrimmed),
                        new Filter("OrganizationBPName1", FilterOperator.Contains, sTrimmed),
                        new Filter("PurchaseOrderByCustomer", FilterOperator.Contains, sTrimmed),
                        new Filter("SalesInquiryType", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            oBinding.filter(aFilters, FilterType.Application);
        },

        onRefresh: function () {
            var oTable = this.byId("salesInquiriesTable");
            if (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    try {
                        oBinding.refresh();
                    } catch (e) {
                        // Ignore refresh if already pending
                    }
                }
            }
        },

        _formatDateYMD: function (oDate) {
            if (!oDate) return "";
            var d = new Date(oDate);
            if (isNaN(d.getTime())) return "";
            var month = "" + (d.getMonth() + 1);
            var day = "" + d.getDate();
            var year = d.getFullYear();
            if (month.length < 2) month = "0" + month;
            if (day.length < 2) day = "0" + day;
            return [year, month, day].join("-");
        },

        onCreateSalesQuote: function (oEvent) {
            var that = this;
            var oSource = oEvent ? oEvent.getSource() : null;
            var oCtx = oSource ? oSource.getBindingContext("salesInquiry") : null;

            // Fallback to table selection if invoked without direct row button context
            if (!oCtx) {
                var oTable = this.byId("salesInquiriesTable");
                var oSelectedItem = oTable ? oTable.getSelectedItem() : null;
                if (oSelectedItem) {
                    oCtx = oSelectedItem.getBindingContext("salesInquiry");
                }
            }

            if (!oCtx) {
                MessageToast.show("Please select or click 'Create Sales Quote' on an inquiry row.");
                return;
            }

            var oInquiry = oCtx.getObject() || {};
            var sInquiryId = oInquiry.SalesInquiry || oCtx.getProperty("SalesInquiry");
            var sCustomerName = oInquiry.OrganizationBPName1 || oInquiry.CustomerName || oInquiry.SoldToParty || "Customer";
            var sCustomer = oInquiry.SoldToParty || "";
            var sNetAmount = oInquiry.TotalNetAmount || "0.00";
            var sCurrency = oInquiry.TransactionCurrency || "INR";

            if (!sInquiryId) {
                MessageToast.show("Unable to identify Sales Inquiry number.");
                return;
            }

            var dToday = new Date();
            var dValidTo = new Date();
            dValidTo.setDate(dToday.getDate() + 30);
            var sTodayStr = this._formatDateYMD(dToday);
            var sValidToStr = this._formatDateYMD(dValidTo);

            var aItems = Array.isArray(oInquiry.to_Items) ? oInquiry.to_Items : [];

            var oDialogData = {
                SalesInquiry: sInquiryId,
                SalesInquiryType: oInquiry.SalesInquiryType || "ZIN",
                SoldToParty: sCustomer,
                OrganizationBPName1: sCustomerName,
                ShipToParty: oInquiry.ShipToParty || sCustomer,
                ShipToPartyName: oInquiry.ShipToPartyName || sCustomerName,
                SalesOrganization: oInquiry.SalesOrganization || "",
                DistributionChannel: oInquiry.DistributionChannel || "",
                OrganizationDivision: oInquiry.OrganizationDivision || "",
                TotalNetAmount: sNetAmount,
                TransactionCurrency: sCurrency,
                SalesQuotationType: "ZQT",
                SalesQuotationDate: sTodayStr,
                BindingPeriodValidityEndDate: sValidToStr,
                PurchaseOrderByCustomer: oInquiry.PurchaseOrderByCustomer || ("Ref Inquiry " + sInquiryId),
                CustomerPurchaseOrderDate: oInquiry.CustomerPurchaseOrderDate || sTodayStr,
                items: aItems
            };

            var oView = this.getView();
            var oDialogModel = new JSONModel(oDialogData);
            oView.setModel(oDialogModel, "quoteDialog");

            // If line items not loaded in worklist row, fetch full inquiry detail
            if (aItems.length === 0) {
                var oSalesInquiryModel = (this.getModel && this.getModel("salesInquiry")) || null;
                var oFetchPromise = oSalesInquiryModel ?
                    SalesInquiryService.getSalesInquiry(oSalesInquiryModel, sInquiryId) :
                    SalesInquiryService.getSalesInquiry(sInquiryId);
                oFetchPromise.then(function (fullInq) {
                    if (fullInq) {
                        var h = fullInq.header || fullInq;
                        var itms = fullInq.items || fullInq.to_Items || [];
                        if (itms.length > 0) {
                            oDialogModel.setProperty("/items", itms);
                        }
                        if (h.ShipToParty) oDialogModel.setProperty("/ShipToParty", h.ShipToParty);
                        if (h.ShipToPartyName) oDialogModel.setProperty("/ShipToPartyName", h.ShipToPartyName);
                    }
                }).catch(function () {
                    // Fallback gracefully to header info
                });
            }

            if (!this._oCreateQuoteDialog) {
                Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.sd.sales-inquiry.view.CreateQuoteFromInquiryDialog",
                    controller: this
                }).then(function (oDialog) {
                    that._oCreateQuoteDialog = oDialog;
                    oView.addDependent(oDialog);
                    oDialog.open();
                });
            } else {
                this._oCreateQuoteDialog.open();
            }
        },

        onConfirmCreateSalesQuote: function () {
            var that = this;
            var oModel = this.getView().getModel("quoteDialog");
            if (!oModel) return;
            var oData = oModel.getData();

            if (!oData.SalesQuotationType) {
                MessageBox.error("Please select a Quotation Type.");
                return;
            }
            if (!oData.SalesQuotationDate) {
                MessageBox.error("Please specify a Quotation Date.");
                return;
            }
            if (!oData.BindingPeriodValidityEndDate) {
                MessageBox.error("Please specify a Valid-To Date.");
                return;
            }
            if (oData.BindingPeriodValidityEndDate < oData.SalesQuotationDate) {
                MessageBox.error("Valid-To Date cannot be earlier than Quotation Date.");
                return;
            }

            // SAP persists the quotation; there is no preview. Nothing is sent until the user confirms.
            MessageBox.confirm(
                "This action creates a real Sales Quotation in SAP and cannot be treated as a preview.\n\n" +
                "Inquiry: " + oData.SalesInquiry + "\nQuotation Type: " + oData.SalesQuotationType,
                {
                    title: "Create Sales Quotation in SAP?",
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    emphasizedAction: MessageBox.Action.CANCEL,
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            that._createSalesQuoteInSap(oData);
                        }
                    }
                }
            );
        },

        _createSalesQuoteInSap: function (oData) {
            var that = this;
            if (this._oCreateQuoteDialog) {
                this._oCreateQuoteDialog.close();
            }

            BusyIndicator.show(0);
            return SalesInquiryService.createSalesQuote({
                SalesInquiry: oData.SalesInquiry,
                SalesQuotationType: oData.SalesQuotationType,
                SalesQuotationDate: oData.SalesQuotationDate,
                BindingPeriodValidityEndDate: oData.BindingPeriodValidityEndDate,
                PurchaseOrderByCustomer: oData.PurchaseOrderByCustomer,
                CustomerPurchaseOrderDate: oData.CustomerPurchaseOrderDate
            })
                .then(function (sQuoteId) {
                    BusyIndicator.hide();
                    var sSuccessMsg = "Sales Quotation " + (sQuoteId || "") +
                        " created successfully with reference to Sales Inquiry " + oData.SalesInquiry + "." +
                        " It was read back from SAP to confirm it exists.";
                    MessageBox.success(sSuccessMsg, {
                        title: "Sales Quotation Created",
                        onClose: function () {
                            that.onRefresh();
                        }
                    });
                    return sQuoteId;
                })
                .catch(function (err) {
                    BusyIndicator.hide();
                    var sErrorMsg = (err && (err.message || err.error || err)) || "Unknown error occurred";
                    MessageBox.error("Failed to create Sales Quotation against Inquiry " + oData.SalesInquiry + ":\n\n" + sErrorMsg, {
                        title: "SAP S/4HANA Error"
                    });
                });
        },

        onCancelCreateSalesQuote: function () {
            if (this._oCreateQuoteDialog) {
                this._oCreateQuoteDialog.close();
            }
        }
    });
});
