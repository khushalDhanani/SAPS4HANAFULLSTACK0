sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/le/outbound-delivery/service/OutboundDeliveryService"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    FilterType,
    Fragment,
    MessageBox,
    AuthService,
    OutboundDeliveryService
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.le.outbound-delivery.controller.OrdersDueForDelivery", {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }

            var bCanCreateDelivery = (AuthService && typeof AuthService.canCreateDelivery === "function") ? AuthService.canCreateDelivery() : true;
            var oViewModel = new JSONModel({
                totalCount: "-",
                readyCount: "-",
                inApprovalCount: "-",
                shippingPointCount: "-",
                displayCount: "-",
                selectedTab: "ready",
                canCreateDelivery: bCanCreateDelivery
            });
            this.getView().setModel(oViewModel, "ordersDueView");

            var oDialogModel = new JSONModel({
                salesOrder: "",
                shippingPoint: "",
                deliveryDate: this._getTodayDateString()
            });
            this.getView().setModel(oDialogModel, "deliveryDialog");

            // Follow-up on an existing delivery: PGI and billing. Types come from SAP per delivery.
            this.getView().setModel(new JSONModel({
                delivery: "",
                billingTypes: [],
                billingType: "",
                billingDate: "",
                busy: false,
                lastResult: "",
                status: null,
                statusText: "",
                canPgi: false,
                canBill: false
            }), "deliveryFollowUp");

            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("ordersDueForDelivery")) {
                oRouter.getRoute("ordersDueForDelivery").attachPatternMatched(this._onRouteMatched, this);
            }

            this._applyCombinedFilters();
            this._loadServerMetrics();
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            if (AuthService && typeof AuthService.canCreateDelivery === "function") {
                var oVm = this.getView().getModel("ordersDueView");
                if (oVm) {
                    oVm.setProperty("/canCreateDelivery", AuthService.canCreateDelivery());
                }
            }
            this._applyCombinedFilters();
            var oTable = this.byId("ordersDueTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Ignore refresh error if request is in flight
                }
            }
            this._loadServerMetrics();
        },

        _getTodayDateString: function () {
            var d = new Date();
            var sMonth = String(d.getMonth() + 1).padStart(2, "0");
            var sDay = String(d.getDate()).padStart(2, "0");
            return d.getFullYear() + "-" + sMonth + "-" + sDay;
        },

        _loadServerMetrics: function () {
            var oViewModel = this.getView().getModel("ordersDueView");
            if (!oViewModel) {
                return Promise.resolve();
            }
            return OutboundDeliveryService.getOrdersDueMetrics()
                .then(function (oMetrics) {
                    var bOk = oMetrics && typeof oMetrics.scheduleLineCount === "number" && typeof oMetrics.shippingPointCount === "number";
                    var nTotal = bOk ? oMetrics.scheduleLineCount : "-";
                    var nReady = bOk && typeof oMetrics.readyToDeliverCount === "number" ? oMetrics.readyToDeliverCount : "-";
                    var nApproval = bOk && typeof oMetrics.inApprovalCount === "number" ? oMetrics.inApprovalCount : "-";
                    var nSP = bOk ? oMetrics.shippingPointCount : "-";

                    oViewModel.setProperty("/totalCount", nTotal);
                    oViewModel.setProperty("/readyCount", nReady);
                    oViewModel.setProperty("/inApprovalCount", nApproval);
                    oViewModel.setProperty("/shippingPointCount", nSP);

                    var sTab = oViewModel.getProperty("/selectedTab") || "ready";
                    var sDisplay = sTab === "ready" ? nReady : (sTab === "inApproval" ? nApproval : nTotal);
                    oViewModel.setProperty("/displayCount", sDisplay);
                })
                .catch(function () {
                    oViewModel.setProperty("/totalCount", "-");
                    oViewModel.setProperty("/readyCount", "-");
                    oViewModel.setProperty("/inApprovalCount", "-");
                    oViewModel.setProperty("/shippingPointCount", "-");
                    oViewModel.setProperty("/displayCount", "-");
                });
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent && typeof oEvent.getParameter === "function"
                ? (oEvent.getParameter("key") || (oEvent.getParameter("item") && oEvent.getParameter("item").getKey()))
                : null;
            if (!sKey) {
                var oSeg = (typeof this.byId === "function")
                    ? this.byId("segApprovalStatus")
                    : (this.getView && typeof this.getView().byId === "function" ? this.getView().byId("segApprovalStatus") : null);
                sKey = oSeg && typeof oSeg.getSelectedKey === "function" ? oSeg.getSelectedKey() : "ready";
            }
            var oViewModel = this.getView && typeof this.getView().getModel === "function" ? this.getView().getModel("ordersDueView") : null;
            if (oViewModel) {
                oViewModel.setProperty("/selectedTab", sKey);
                var sDisplay = sKey === "ready"
                    ? oViewModel.getProperty("/readyCount")
                    : (sKey === "inApproval" ? oViewModel.getProperty("/inApprovalCount") : oViewModel.getProperty("/totalCount"));
                oViewModel.setProperty("/displayCount", sDisplay);
            }
            this._applyCombinedFilters();
        },

        onSearch: function () {
            this._applyCombinedFilters();
        },

        _applyCombinedFilters: function () {
            var oTable = (typeof this.byId === "function")
                ? this.byId("ordersDueTable")
                : (this.getView && typeof this.getView().byId === "function" ? this.getView().byId("ordersDueTable") : null);
            var oBinding = oTable && typeof oTable.getBinding === "function" ? oTable.getBinding("items") : null;
            if (!oBinding) return;

            var aFilters = [];
            var oViewModel = this.getView && typeof this.getView().getModel === "function" ? this.getView().getModel("ordersDueView") : null;
            var sTab = (oViewModel && typeof oViewModel.getProperty === "function" && oViewModel.getProperty("/selectedTab")) || "ready";

            if (sTab === "ready") {
                aFilters.push(new Filter("IsDeliverable", FilterOperator.EQ, true));
            } else if (sTab === "inApproval") {
                aFilters.push(new Filter("SalesDocApprovalStatus", FilterOperator.EQ, "A"));
            }

            var oSearchField = (typeof this.byId === "function")
                ? this.byId("searchOrdersDue")
                : (this.getView && typeof this.getView().byId === "function" ? this.getView().byId("searchOrdersDue") : null);
            var sQuery = oSearchField && typeof oSearchField.getValue === "function" ? oSearchField.getValue() : "";
            if (sQuery && sQuery.trim()) {
                var q = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("SalesOrder", FilterOperator.Contains, q),
                        new Filter("SoldToParty", FilterOperator.Contains, q),
                        new Filter("SoldToPartyName", FilterOperator.Contains, q),
                        new Filter("ShippingPoint", FilterOperator.Contains, q),
                        new Filter("Material", FilterOperator.Contains, q)
                    ],
                    and: false
                }));
            }

            oBinding.filter(aFilters, FilterType.Application);
        },

        onRefresh: function () {
            var oTable = this.byId("ordersDueTable");
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
            this._loadServerMetrics();
        },

        onCreateDeliveryPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext("outboundDelivery");
            if (!oCtx) return;

            var sSalesOrder = oCtx.getProperty("SalesOrder");
            var sDelivBlock = oCtx.getProperty("DelivBlockReasonForSchedLine");
            var sApprovalStatus = oCtx.getProperty("SalesDocApprovalStatus");

            if (sApprovalStatus === "unknown") {
                MessageBox.warning(this._text("msgOrderApprovalUnknown", "Approval status for Sales Order {0} could not be verified from S/4HANA. Delivery creation is blocked until status is confirmed.", [sSalesOrder]));
                return;
            }
            if (sApprovalStatus === "A") {
                MessageBox.warning(this._text("msgOrderInApproval", "Sales Order {0} is currently in approval (SAP Flexible Workflow). It must be approved in SAP (My Inbox or Manage Sales Orders) before an outbound delivery can be created.", [sSalesOrder]));
                return;
            }
            if (sApprovalStatus === "C") {
                MessageBox.warning(this._text("msgOrderRejected", "Sales Order {0} has been rejected and cannot be delivered.", [sSalesOrder]));
                return;
            }
            if (sApprovalStatus === "D") {
                MessageBox.warning(this._text("msgOrderRework", "Sales Order {0} is being reworked and cannot be delivered.", [sSalesOrder]));
                return;
            }
            if (sDelivBlock) {
                MessageBox.warning(this._text("msgOrderDeliveryBlocked", "Sales Order {0} has a delivery block ({1}) and cannot be delivered.", [sSalesOrder, sDelivBlock]));
                return;
            }

            var oDialogModel = this.getView().getModel("deliveryDialog");
            var sShippingPoint = oCtx.getProperty("ShippingPoint") || "";
            var sGoodsIssueDate = oCtx.getProperty("GoodsIssueDate") || this._getTodayDateString();

            if (oDialogModel) {
                oDialogModel.setProperty("/salesOrder", sSalesOrder);
                oDialogModel.setProperty("/shippingPoint", sShippingPoint);
                oDialogModel.setProperty("/deliveryDate", sGoodsIssueDate);
            }

            this._openCreateDeliveryDialog();
        },

        _openCreateDeliveryDialog: function () {
            var oView = this.getView();
            var that = this;

            if (!this._pCreateDeliveryDialog) {
                this._pCreateDeliveryDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.le.outbound-delivery.view.CreateDeliveryDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    if (oDialog.addStyleClass && that.getContentDensityClass) {
                        oDialog.addStyleClass(that.getContentDensityClass());
                    }
                    return oDialog;
                });
            }

            this._pCreateDeliveryDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onCancelCreateDelivery: function () {
            if (this._pCreateDeliveryDialog) {
                this._pCreateDeliveryDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onConfirmCreateDelivery: function () {
            var that = this;
            var oDialogModel = this.getView().getModel("deliveryDialog");
            var sSalesOrder = oDialogModel.getProperty("/salesOrder");
            var sShippingPoint = oDialogModel.getProperty("/shippingPoint");
            var sDeliveryDate = oDialogModel.getProperty("/deliveryDate");

            if (!sSalesOrder) {
                MessageBox.error(this._text("msgSalesOrderRequired", "Sales Order is required."));
                return;
            }
            if (!sShippingPoint) {
                MessageBox.error(this._text("msgShippingPointRequired", "Shipping Point is required."));
                return;
            }

            this._setDialogBusy(true);

            OutboundDeliveryService.createOutboundDelivery({
                salesOrder: sSalesOrder,
                shippingPoint: sShippingPoint,
                deliveryDate: sDeliveryDate
            })
                .then(function (sDeliveryNo) {
                    that.onCancelCreateDelivery();
                    if (sDeliveryNo && String(sDeliveryNo).trim() !== "" && sDeliveryNo !== "Delivery created") {
                        var sSuccessTemplate = that._text("msgDeliveryCreatedSuccess", "Delivery {0} created");
                        var sSuccessMessage = sSuccessTemplate.replace("{0}", sDeliveryNo);
                        var oFollowUp = that.getView().getModel("deliveryFollowUp");
                        if (oFollowUp) { oFollowUp.setProperty("/delivery", String(sDeliveryNo)); oFollowUp.setProperty("/billingTypes", []); oFollowUp.setProperty("/billingType", ""); that.onLoadDeliveryStatus(); }
                        MessageBox.success(sSuccessMessage, {
                            onClose: function () {
                                that.onRefresh();
                            }
                        });
                    } else {
                        var sWarningTemplate = that._text(
                            "msgDeliveryCreatedNoNumberWarning",
                            "Delivery created in SAP S/4HANA for Sales Order {0}, but no delivery number was returned. Please check transaction VL03N."
                        );
                        var sWarningMessage = sWarningTemplate.replace("{0}", sSalesOrder);
                        MessageBox.warning(sWarningMessage, {
                            onClose: function () {
                                that.onRefresh();
                            }
                        });
                    }
                })
                .catch(function (err) {
                    // Show SAP's own message on failure
                    var sErrorMessage = (err && (err.message || err.statusText)) || "Failed to create outbound delivery.";
                    MessageBox.error(sErrorMessage);
                })
                .finally(function () {
                    that._setDialogBusy(false);
                });
        },

        // SAP status domain (STATV): A = not yet processed, B = partially processed, C = completely processed, blank = not relevant
        _statusLabel: function (sCode) {
            var m = { A: "not started", B: "partial", C: "complete", "": "not relevant" };
            return (sCode || "") + " (" + (m[sCode || ""] || sCode) + ")";
        },

        onLoadDeliveryStatus: function () {
            var that = this;
            var oFU = this.getView().getModel("deliveryFollowUp");
            // Read the live control value: on Enter the submit event can arrive before the two-way binding has written the model.
            var oInput = this.byId && this.byId("inpFollowUpDelivery");
            if (oInput && typeof oInput.getValue === "function") {
                oFU.setProperty("/delivery", String(oInput.getValue() || "").trim());
            }
            var sDelivery = (oFU.getProperty("/delivery") || "").trim();
            oFU.setProperty("/status", null); oFU.setProperty("/statusText", ""); oFU.setProperty("/canPgi", false); oFU.setProperty("/canBill", false);
            oFU.setProperty("/billingTypes", []); oFU.setProperty("/billingType", "");
            if (!sDelivery) { return Promise.resolve(); }
            oFU.setProperty("/busy", true);
            return OutboundDeliveryService.getDeliveryStatus(sDelivery)
                .then(function (o) {
                    oFU.setProperty("/status", o);
                    oFU.setProperty("/statusText", that._text("dlvFollowUpStatus", "Type {0} · Ship-to {1} · Picking {2} · Goods movement {3} · Billing {4}")
                        .replace("{0}", o.DeliveryDocumentType).replace("{1}", o.SoldToParty).replace("{2}", that._statusLabel(o.OverallPickingStatus))
                        .replace("{3}", that._statusLabel(o.OverallGoodsMovementStatus)).replace("{4}", that._statusLabel(o.OverallDelivReltdBillgStatus)));
                    // Gate on SAP's own statuses: PGI needs picking complete and no goods movement yet; billing needs goods movement complete and billing not complete.
                    oFU.setProperty("/canPgi", o.OverallPickingStatus === "C" && o.OverallGoodsMovementStatus !== "C");
                    oFU.setProperty("/canBill", o.OverallGoodsMovementStatus === "C" && o.OverallDelivReltdBillgStatus !== "C");
                })
                .catch(function (err) {
                    oFU.setProperty("/statusText", (err && (err.message || err.statusText)) || "Delivery status could not be read from SAP.");
                })
                .finally(function () { oFU.setProperty("/busy", false); });
        },

        onPostGoodsIssue: function () {
            var that = this;
            var oFU = this.getView().getModel("deliveryFollowUp");
            var sDelivery = (oFU.getProperty("/delivery") || "").trim();
            if (!sDelivery) { MessageBox.error(this._text("msgDeliveryNumberRequired", "Enter a delivery number.")); return; }
            MessageBox.confirm(this._text("msgConfirmPgi", "Post goods issue in S/4HANA for delivery {0}? This cannot be undone here.").replace("{0}", sDelivery), {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    oFU.setProperty("/busy", true);
                    OutboundDeliveryService.postGoodsIssue(sDelivery)
                        .then(function (oRes) {
                            var sMsg = that._text("msgPgiPosted", "Goods issue posted in S/4HANA for delivery {0}.").replace("{0}", sDelivery);
                            oFU.setProperty("/lastResult", sMsg);
                            MessageBox.success(sMsg, { onClose: function () { that.onRefresh(); that.onLoadDeliveryStatus(); } });
                            return oRes;
                        })
                        .catch(function (err) {
                            // SAP's own message, verbatim
                            MessageBox.error((err && (err.message || err.statusText)) || "Goods issue could not be posted.");
                        })
                        .finally(function () { oFU.setProperty("/busy", false); });
                }
            });
        },

        onLoadBillingTypes: function () {
            var oFU = this.getView().getModel("deliveryFollowUp");
            var sDelivery = (oFU.getProperty("/delivery") || "").trim();
            if (!sDelivery) { MessageBox.error(this._text("msgDeliveryNumberRequired", "Enter a delivery number.")); return; }
            oFU.setProperty("/busy", true);
            return OutboundDeliveryService.getBillingDocumentTypes(sDelivery)
                .then(function (aTypes) {
                    oFU.setProperty("/billingTypes", aTypes);
                    oFU.setProperty("/billingType", aTypes.length === 1 ? aTypes[0].BillingDocumentType : "");
                    if (aTypes.length === 0) { MessageBox.warning("S/4HANA returned no billing document type for delivery " + sDelivery + "."); }
                })
                .catch(function (err) {
                    oFU.setProperty("/billingTypes", []);
                    MessageBox.error((err && (err.message || err.statusText)) || "Billing document types could not be read.");
                })
                .finally(function () { oFU.setProperty("/busy", false); });
        },

        onCreateBillingDocument: function () {
            var that = this;
            var oFU = this.getView().getModel("deliveryFollowUp");
            var sDelivery = (oFU.getProperty("/delivery") || "").trim();
            var sType = oFU.getProperty("/billingType") || "";
            if (!sDelivery) { MessageBox.error(this._text("msgDeliveryNumberRequired", "Enter a delivery number.")); return; }
            MessageBox.confirm(this._text("msgConfirmBilling", "Create billing document (type {1}) in S/4HANA for delivery {0}?").replace("{0}", sDelivery).replace("{1}", sType || this._text("dlvFollowUpTypeBySap", "determined by SAP copy control")), {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    oFU.setProperty("/busy", true);
                    OutboundDeliveryService.createBillingDocument({ delivery: sDelivery, billingType: sType, billingDate: oFU.getProperty("/billingDate") })
                        .then(function (oRes) {
                            var sNo = oRes && oRes.BillingDocument;
                            var aMsgs = (oRes && oRes.Messages) || [];
                            var sDetail = aMsgs.map(function (m) { return m.Message; }).filter(Boolean).join("\n");
                            var sMsg = that._text("msgBillingCreated", "Billing document {0} created in S/4HANA for delivery {1}.").replace("{0}", sNo).replace("{1}", sDelivery);
                            oFU.setProperty("/lastResult", sMsg);
                            MessageBox.success(sMsg + (sDetail ? "\n\n" + sDetail : ""), { onClose: function () { that.onLoadDeliveryStatus(); } });
                        })
                        .catch(function (err) {
                            MessageBox.error((err && (err.message || err.statusText)) || "Billing document could not be created.");
                        })
                        .finally(function () { oFU.setProperty("/busy", false); });
                }
            });
        },

        _setDialogBusy: function (bBusy) {
            if (this._pCreateDeliveryDialog) {
                this._pCreateDeliveryDialog.then(function (oDialog) {
                    oDialog.setBusy(bBusy);
                });
            }
        },

        _text: function (sKey, sDefault) {
            try {
                var oComp = this.getOwnerComponent();
                var oI18n = oComp && oComp.getModel ? oComp.getModel("i18n") : null;
                var oBundle = oI18n && oI18n.getResourceBundle ? oI18n.getResourceBundle() : null;
                if (oBundle && oBundle.hasText && oBundle.hasText(sKey)) {
                    return oBundle.getText(sKey);
                }
            } catch (e) {
                // i18n bundle not available (e.g. unit tests): fall through to the English default.
            }
            return sDefault;
        }
    });
});
