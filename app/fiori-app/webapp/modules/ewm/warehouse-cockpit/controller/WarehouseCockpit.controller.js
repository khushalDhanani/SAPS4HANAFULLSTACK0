sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/ewm/warehouse-cockpit/service/EwmService",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Input",
    "sap/m/Dialog",
    "sap/m/VBox",
    "sap/m/Label",
    "sap/m/Button"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    EwmService,
    MessageToast,
    MessageBox,
    Input,
    Dialog,
    VBox,
    Label,
    Button
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.ewm.warehouse-cockpit.controller.WarehouseCockpit", {
        onInit: function () {
            var oViewModel = new JSONModel({
                selectedWarehouse: "",
                selectedTab: "tasks",
                warehouses: [],
                storageTypes: [],
                storageBins: [],
                tasks: [],
                inboundDeliveries: [],
                outboundDeliveries: [],
                kpis: {
                    OpenTasksCount: 0,
                    PendingInbound: 0,
                    PendingOutbound: 0,
                    TotalStorageBins: 0
                },
                storageTypeCount: 0,
                busy: false
            });
            this.getView().setModel(oViewModel, "ewmView");

            var oRouter = this.getRouter();
            if (oRouter) {
                var oRoute = oRouter.getRoute("ewmWarehouseCockpit");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onPatternMatched, this);
                }
            }
        },

        _onPatternMatched: function (oEvent) {
            var oAuthModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("auth") : null;
            if (oAuthModel && oAuthModel.getProperty("/isAuthenticated") === false) {
                return;
            }
            var oArgs = oEvent ? oEvent.getParameter("arguments") : null;
            var oQuery = (oArgs && oArgs["?query"]) || {};
            if (oQuery.warehouse) {
                this.getView().getModel("ewmView").setProperty("/selectedWarehouse", oQuery.warehouse);
            }
            this._loadAllData();
        },

        onWarehouseChange: function (oEvent) {
            var sWhse = oEvent.getSource().getSelectedKey();
            this.getView().getModel("ewmView").setProperty("/selectedWarehouse", sWhse);
            this.setBusy(true);
            var that = this;
            this._loadWarehouseEntities(sWhse).finally(function () {
                that.setBusy(false);
            });
        },

        onRefreshData: function () {
            this._loadAllData();
            MessageToast.show(this.getText("ewmRefreshedMsg") || "Warehouse data refreshed from S/4HANA");
        },

        onNavigateToRfTerminal: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                var sWhse = this.getView().getModel("ewmView").getProperty("/selectedWarehouse") || "";
                oRouter.navTo("ewmRfTerminal", {
                    "?query": {
                        warehouse: sWhse
                    }
                });
            }
        },

        onSelectTasksTab: function () {
            this.getView().getModel("ewmView").setProperty("/selectedTab", "tasks");
        },

        onSelectInboundTab: function () {
            this.getView().getModel("ewmView").setProperty("/selectedTab", "inbound");
        },

        onSelectOutboundTab: function () {
            this.getView().getModel("ewmView").setProperty("/selectedTab", "outbound");
        },

        onSelectStorageTab: function () {
            this.getView().getModel("ewmView").setProperty("/selectedTab", "storage");
        },

        _loadAllData: function () {
            var oModel = this.getView().getModel("ewmView");
            var that = this;

            this.setBusy(true);

            // 1. Fetch Warehouses first from SAP
            EwmService.getWarehouses()
                .then(function (oData) {
                    var aRaw = (oData && Array.isArray(oData.value)) ? oData.value : [];
                    // Exclude all SAP standard, default, and demo warehouse types (e.g. 0001, 001, 002, 100, EWM, MLO,
                    // Central Warehouse, Full WM, Lean WM, SCM-EWM, Loading Object) and retain strictly project-specific warehouses.
                    var aWarehouses = EwmService.filterProjectWarehouses(aRaw);
                    oModel.setProperty("/warehouses", aWarehouses);

                    if (aWarehouses.length === 0) {
                        oModel.setProperty("/selectedWarehouse", "");
                        oModel.setProperty("/tasks", []);
                        oModel.setProperty("/inboundDeliveries", []);
                        oModel.setProperty("/outboundDeliveries", []);
                        oModel.setProperty("/storageTypes", []);
                        oModel.setProperty("/storageBins", []);
                        oModel.setProperty("/kpis", {
                            OpenTasksCount: 0,
                            PendingInbound: 0,
                            PendingOutbound: 0,
                            TotalStorageBins: 0
                        });
                        return;
                    }

                    var sCurrent = oModel.getProperty("/selectedWarehouse");
                    var bFound = aWarehouses.some(function (w) { return w.Warehouse === sCurrent; });
                    var sResolvedWhse = bFound ? sCurrent : aWarehouses[0].Warehouse;
                    oModel.setProperty("/selectedWarehouse", sResolvedWhse);

                    return that._loadWarehouseEntities(sResolvedWhse);
                })
                .catch(function (err) {
                    var sMsg = (err && err.message) || String(err || "");
                    if (err && (err.status === 401 || sMsg.toLowerCase().includes("unauthorized"))) {
                        MessageBox.error("Session expired or authentication required. Please sign in to SAP S/4HANA.", {
                            onClose: function () {
                                var oRouter = that.getRouter();
                                if (oRouter) {
                                    oRouter.navTo("login", {}, true);
                                }
                            }
                        });
                        return;
                    }
                    MessageBox.error("Failed to load warehouses from SAP: " + sMsg);
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        _loadWarehouseEntities: function (sWhse) {
            var oModel = this.getView().getModel("ewmView");
            if (!sWhse) {
                return Promise.resolve();
            }

            var pKpis = EwmService.getWarehouseKPIs(sWhse)
                .then(function (oData) {
                    if (oData && oData.value && oData.value[0]) {
                        oModel.setProperty("/kpis", oData.value[0]);
                    }
                })
                .catch(function () {});

            var pTasks = EwmService.getWarehouseTasks(sWhse)
                .then(function (oData) {
                    var aTasks = (oData && oData.value) ? oData.value : [];
                    oModel.setProperty("/tasks", aTasks);
                })
                .catch(function () {
                    oModel.setProperty("/tasks", []);
                });

            var pInb = EwmService.getInboundDeliveries(sWhse)
                .then(function (oData) {
                    var aInb = (oData && oData.value) ? oData.value : [];
                    oModel.setProperty("/inboundDeliveries", aInb);
                })
                .catch(function () {
                    oModel.setProperty("/inboundDeliveries", []);
                });

            var pOutb = EwmService.getOutboundDeliveries(sWhse)
                .then(function (oData) {
                    var aOutb = (oData && oData.value) ? oData.value : [];
                    oModel.setProperty("/outboundDeliveries", aOutb);
                })
                .catch(function () {
                    oModel.setProperty("/outboundDeliveries", []);
                });

            var pStorage = Promise.allSettled([
                EwmService.getStorageTypes(sWhse),
                EwmService.getStorageBins(sWhse)
            ]).then(function (results) {
                var aTypes = (results[0].status === "fulfilled" && results[0].value?.value) ? results[0].value.value : [];
                var aBins = (results[1].status === "fulfilled" && results[1].value?.value) ? results[1].value.value : [];
                oModel.setProperty("/storageTypes", aTypes);
                oModel.setProperty("/storageTypeCount", aTypes.length);
                oModel.setProperty("/storageBins", aBins);
            });

            return Promise.allSettled([pKpis, pTasks, pInb, pOutb, pStorage]);
        },

        // -------------------------------------------------------------
        // Search Filter Handlers
        // -------------------------------------------------------------

        onSearchTasks: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
            var aFilters = [];
            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("WarehouseTask", FilterOperator.Contains, sQuery),
                        new Filter("WarehouseOrder", FilterOperator.Contains, sQuery),
                        new Filter("Product", FilterOperator.Contains, sQuery),
                        new Filter("SourceStorageBin", FilterOperator.Contains, sQuery),
                        new Filter("TargetStorageBin", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }
            var oTable = this.byId("tasksTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        onSearchInbound: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
            var aFilters = [];
            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("DeliveryDocument", FilterOperator.Contains, sQuery),
                        new Filter("SupplierName", FilterOperator.Contains, sQuery),
                        new Filter("Supplier", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }
            var oTable = this.byId("inboundTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        onSearchOutbound: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
            var aFilters = [];
            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("OutboundDeliveryOrder", FilterOperator.Contains, sQuery),
                        new Filter("ShipToPartyName", FilterOperator.Contains, sQuery),
                        new Filter("ShipToParty", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }
            var oTable = this.byId("outboundTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        // -------------------------------------------------------------
        // Action Handlers
        // -------------------------------------------------------------

        onConfirmTaskPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("ewmView");
            var oTask = oContext ? oContext.getObject() : null;
            if (!oTask) return;

            var that = this;
            var sConfirmMsg = "Confirm execution of Warehouse Task " + oTask.WarehouseTask + " for product " + oTask.Product + " (Target Qty: " + oTask.TargetQuantity + " " + oTask.BaseUnit + ")?";

            MessageBox.confirm(sConfirmMsg, {
                title: "Confirm Warehouse Task",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        that.setBusy(true);
                        EwmService.confirmWarehouseTask(oTask.Warehouse, oTask.WarehouseTask, oTask.TargetQuantity)
                            .then(function () {
                                MessageToast.show("Task " + oTask.WarehouseTask + " successfully confirmed in SAP S/4HANA!");
                                that._loadAllData();
                            })
                            .catch(function (err) {
                                MessageBox.error("Confirmation failed: " + (err.message || err));
                            })
                            .finally(function () {
                                that.setBusy(false);
                            });
                    }
                }
            });
        },

        onCancelTaskPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("ewmView");
            var oTask = oContext ? oContext.getObject() : null;
            if (!oTask) return;

            var that = this;
            MessageBox.confirm("Cancel Warehouse Task " + oTask.WarehouseTask + "?", {
                title: "Cancel Task",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        that.setBusy(true);
                        EwmService.cancelWarehouseTask(oTask.Warehouse, oTask.WarehouseTask)
                            .then(function () {
                                MessageToast.show("Task " + oTask.WarehouseTask + " cancelled");
                                that._loadAllData();
                            })
                            .catch(function (err) {
                                MessageBox.error("Cancel failed: " + (err.message || err));
                            })
                            .finally(function () {
                                that.setBusy(false);
                            });
                    }
                }
            });
        },

        onPostGoodsReceiptPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("ewmView");
            var oDelivery = oContext ? oContext.getObject() : null;
            if (!oDelivery) return;

            var that = this;
            var sWhse = (oDelivery.Warehouse && oDelivery.Warehouse.length <= 4) ? oDelivery.Warehouse : (this._sCurrentWarehouse || "W22");
            MessageBox.confirm("Post Goods Receipt (PGR) for Inbound Delivery " + oDelivery.DeliveryDocument + "?", {
                title: "Post Goods Receipt",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        that.setBusy(true);
                        EwmService.postGoodsReceipt(sWhse, oDelivery.DeliveryDocument)
                            .then(function () {
                                MessageToast.show("Goods Receipt posted for delivery " + oDelivery.DeliveryDocument);
                                that._loadAllData();
                            })
                            .catch(function (err) {
                                MessageBox.error("Goods Receipt failed: " + (err.message || err));
                            })
                            .finally(function () {
                                that.setBusy(false);
                            });
                    }
                }
            });
        },

        onPostGoodsIssuePress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("ewmView");
            var oODO = oContext ? oContext.getObject() : null;
            if (!oODO) return;

            var that = this;
            var sWhse = (oODO.Warehouse && oODO.Warehouse.length <= 4) ? oODO.Warehouse : (this._sCurrentWarehouse || "W22");
            MessageBox.confirm("Post Goods Issue (PGI) for Outbound Delivery Order " + oODO.OutboundDeliveryOrder + "?", {
                title: "Post Goods Issue",
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        that.setBusy(true);
                        EwmService.postGoodsIssue(sWhse, oODO.OutboundDeliveryOrder)
                            .then(function () {
                                MessageToast.show("Goods Issue posted for ODO " + oODO.OutboundDeliveryOrder);
                                that._loadAllData();
                            })
                            .catch(function (err) {
                                MessageBox.error("Goods Issue failed: " + (err.message || err));
                            })
                            .finally(function () {
                                that.setBusy(false);
                            });
                    }
                }
            });
        },

        onOpenCreateTaskDialog: function () {
            var oModel = this.getView().getModel("ewmView");
            var sWhse = oModel.getProperty("/selectedWarehouse");
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("createWarehouseTask", {
                    "?query": {
                        warehouse: sWhse || ""
                    }
                });
            }
        }
    });
});

