sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/ewm/warehouse-cockpit/service/EwmService",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    BaseController,
    JSONModel,
    EwmService,
    MessageToast,
    MessageBox
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.ewm.rf-terminal.controller.RfTerminal", {
        onInit: function () {
            var oViewModel = new JSONModel({
                warehouse: "",
                availableWarehouses: [],
                operator: "",
                resource: "",
                queue: "",
                availableResources: [],
                availableQueues: [],
                isLoggedIn: false,
                currentStep: 1, // 1: Logon, 2: Scan Bin, 3: Scan Product, 4: Scan HU, 5: Success
                audioEnabled: true,
                tasks: [],
                activeTask: null,
                scannedBin: "",
                verifiedBin: "",
                scannedProduct: "",
                verifiedProduct: "",
                suggestedHU: "",
                scannedHU: "",
                confirmedQty: 0,
                manualTaskId: "",
                successMessage: ""
            });
            this.getView().setModel(oViewModel, "rfView");

            var oRouter = this.getRouter();
            if (oRouter) {
                var oRoute = oRouter.getRoute("ewmRfTerminal");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onPatternMatched, this);
                }
            }
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("ewmWarehouseCockpit", {}, true);
            }
        },

        _onPatternMatched: function (oEvent) {
            var oAuthModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("auth") : null;
            if (oAuthModel && oAuthModel.getProperty("/isAuthenticated") === false) {
                return;
            }

            var oModel = this.getView().getModel("rfView");
            var sUsername = (oAuthModel && oAuthModel.getProperty("/user/username")) || "";
            oModel.setProperty("/operator", sUsername);

            var oArgs = (oEvent && oEvent.getParameter && oEvent.getParameter("arguments")) || {};
            var oQuery = (oArgs && oArgs["?query"]) || {};
            var sRequestedWhse = oQuery.warehouse || "";

            this._loadWarehouses(sRequestedWhse);
        },

        _loadWarehouses: function (sPreferredWhse) {
            var oModel = this.getView().getModel("rfView");
            var that = this;

            this.setBusy(true);
            EwmService.getWarehouses()
                .then(function (oData) {
                    var aRaw = (oData && Array.isArray(oData.value)) ? oData.value : [];
                    // Filter strictly to project-specific warehouse types
                    // Exclude all SAP standard, default, and demo warehouse types (e.g. 0001, 001, 002, 100, EWM, MLO, Central Warehouse, etc.)
                    var aWarehouses = EwmService.filterProjectWarehouses(aRaw);
                    oModel.setProperty("/availableWarehouses", aWarehouses);
                    if (aWarehouses.length > 0) {
                        var sCurrent = sPreferredWhse || oModel.getProperty("/warehouse");
                        var oMatched = aWarehouses.find(function (w) { return w.Warehouse === sCurrent; });
                        var sWhse = oMatched ? oMatched.Warehouse : aWarehouses[0].Warehouse;
                        oModel.setProperty("/warehouse", sWhse);
                        return that._loadWarehouseData(sWhse);
                    } else {
                        oModel.setProperty("/warehouse", "");
                        oModel.setProperty("/availableResources", []);
                        oModel.setProperty("/availableQueues", []);
                    }
                })
                .catch(function (err) {
                    oModel.setProperty("/availableWarehouses", []);
                    oModel.setProperty("/warehouse", "");
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

        _loadWarehouseData: function (sWhse) {
            var that = this;
            return Promise.all([
                this._loadResources(sWhse),
                this._loadQueues(sWhse)
            ]).catch(function (err) {
                MessageBox.error("Failed to load warehouse data from SAP: " + (err.message || err));
            });
        },

        _loadResources: function (sWhse) {
            var oModel = this.getView().getModel("rfView");
            if (!sWhse) {
                oModel.setProperty("/availableResources", []);
                oModel.setProperty("/resource", "");
                return Promise.resolve();
            }

            return EwmService.getResources(sWhse)
                .then(function (oData) {
                    var aResources = (oData && oData.value) ? oData.value : [];
                    if (aResources.length === 0) {
                        // Standard EWM RF resources for interactive cart picking
                        aResources = [
                            { Resource: "CART-01", ResourceType: "CART", AssignedQueue: "OUTBOUND" },
                            { Resource: "CART-02", ResourceType: "CART", AssignedQueue: "OUTBOUND" },
                            { Resource: "FORKLIFT-01", ResourceType: "FORK", AssignedQueue: "INTERNAL" },
                            { Resource: "MANUAL-01", ResourceType: "HAND", AssignedQueue: "PUTAWAY" }
                        ];
                    }
                    oModel.setProperty("/availableResources", aResources);
                    var sCurrRsrc = oModel.getProperty("/resource");
                    var bExists = aResources.some(function (r) { return r.Resource === sCurrRsrc; });
                    if (!sCurrRsrc || !bExists) {
                        oModel.setProperty("/resource", aResources[0].Resource);
                        if (aResources[0].AssignedQueue && !oModel.getProperty("/queue")) {
                            oModel.setProperty("/queue", aResources[0].AssignedQueue);
                        }
                    }
                })
                .catch(function () {
                    var aFallback = [
                        { Resource: "CART-01", ResourceType: "CART", AssignedQueue: "OUTBOUND" },
                        { Resource: "CART-02", ResourceType: "CART", AssignedQueue: "OUTBOUND" }
                    ];
                    oModel.setProperty("/availableResources", aFallback);
                    if (!oModel.getProperty("/resource")) {
                        oModel.setProperty("/resource", aFallback[0].Resource);
                    }
                });
        },

        _loadQueues: function (sWhse) {
            var oModel = this.getView().getModel("rfView");
            if (!sWhse) {
                oModel.setProperty("/availableQueues", []);
                oModel.setProperty("/queue", "");
                return Promise.resolve();
            }

            return EwmService.getQueues(sWhse)
                .then(function (aQueues) {
                    var aSafeQueues = Array.isArray(aQueues) ? aQueues : [];
                    if (aSafeQueues.length === 0) {
                        aSafeQueues = [
                            { Queue: "OUTBOUND" },
                            { Queue: "PUTAWAY" },
                            { Queue: "INTERNAL" }
                        ];
                    }
                    oModel.setProperty("/availableQueues", aSafeQueues);
                    var sCurrQueue = oModel.getProperty("/queue");
                    var bExists = aSafeQueues.some(function (q) { return q.Queue === sCurrQueue; });
                    if (!sCurrQueue || !bExists) {
                        oModel.setProperty("/queue", aSafeQueues[0].Queue);
                    }
                })
                .catch(function () {
                    var aFallback = [
                        { Queue: "OUTBOUND" },
                        { Queue: "PUTAWAY" }
                    ];
                    oModel.setProperty("/availableQueues", aFallback);
                    if (!oModel.getProperty("/queue")) {
                        oModel.setProperty("/queue", aFallback[0].Queue);
                    }
                });
        },

        onWarehouseChange: function (oEvent) {
            var sWhse = oEvent.getSource().getSelectedKey();
            var oModel = this.getView().getModel("rfView");
            oModel.setProperty("/warehouse", sWhse);
            this.setBusy(true);
            var that = this;
            this._loadWarehouseData(sWhse)
                .finally(function () {
                    that.setBusy(false);
                });
        },

        onResourceChange: function (oEvent) {
            var sRsrcKey = (oEvent.getSource().getSelectedKey() || oEvent.getSource().getValue() || "").trim().toUpperCase();
            var oModel = this.getView().getModel("rfView");
            oModel.setProperty("/resource", sRsrcKey);
            var aResources = oModel.getProperty("/availableResources") || [];
            var oRsrc = aResources.find(function (r) { return r.Resource === sRsrcKey; });
            if (oRsrc && oRsrc.AssignedQueue) {
                oModel.setProperty("/queue", oRsrc.AssignedQueue);
            }
        },

        onResourceInputChange: function (oEvent) {
            var sVal = (oEvent.getParameter("value") || oEvent.getSource().getValue() || "").trim().toUpperCase();
            var oModel = this.getView().getModel("rfView");
            oModel.setProperty("/resource", sVal);
            var aResources = oModel.getProperty("/availableResources") || [];
            var oRsrc = aResources.find(function (r) { return r.Resource === sVal; });
            if (oRsrc && oRsrc.AssignedQueue) {
                oModel.setProperty("/queue", oRsrc.AssignedQueue);
            }
        },

        onQueueInputChange: function (oEvent) {
            var sVal = (oEvent.getParameter("value") || oEvent.getSource().getValue() || "").trim().toUpperCase();
            this.getView().getModel("rfView").setProperty("/queue", sVal);
        },

        onToggleAudio: function () {
            var oModel = this.getView().getModel("rfView");
            var bCurrent = oModel.getProperty("/audioEnabled");
            oModel.setProperty("/audioEnabled", !bCurrent);
            MessageToast.show(bCurrent ? "Audio cues muted" : "Audio cues enabled");
        },

        onResetWorkflow: function () {
            var oModel = this.getView().getModel("rfView");
            oModel.setProperty("/currentStep", 1);
            oModel.setProperty("/isLoggedIn", false);
            oModel.setProperty("/scannedBin", "");
            oModel.setProperty("/verifiedBin", "");
            oModel.setProperty("/scannedProduct", "");
            oModel.setProperty("/verifiedProduct", "");
            oModel.setProperty("/scannedHU", "");
            oModel.setProperty("/activeTask", null);
            oModel.setProperty("/suggestedHU", "");
            oModel.setProperty("/confirmedQty", 0);
            MessageToast.show("Terminal reset to logon");
        },

        _playBeep: function (bSuccess) {
            var oModel = this.getView().getModel("rfView");
            if (!oModel.getProperty("/audioEnabled")) return;

            try {
                var AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                var ctx = new AudioContext();
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);

                if (bSuccess) {
                    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
                    gain.gain.setValueAtTime(0.1, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.15);
                } else {
                    osc.frequency.setValueAtTime(220, ctx.currentTime); // A3 note
                    gain.gain.setValueAtTime(0.2, ctx.currentTime);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.35);
                }
            } catch (_) {
                // AudioContext not allowed before user interaction
            }
        },

        onLogon: function () {
            var oModel = this.getView().getModel("rfView");
            var sWhse = (oModel.getProperty("/warehouse") || "").trim();
            var sRsrc = (oModel.getProperty("/resource") || "").trim().toUpperCase();
            var sQueue = (oModel.getProperty("/queue") || "").trim().toUpperCase();
            var that = this;

            if (!sWhse) {
                MessageBox.error(this.getText("rfSelectWarehousePrompt") || "Please select a warehouse loaded from SAP.");
                return;
            }
            if (!sRsrc) {
                MessageBox.error(this.getText("rfEnterResourcePrompt") || "Please select or enter an RF resource.");
                return;
            }
            if (!sQueue) {
                MessageBox.error("Please select or enter an RF queue.");
                return;
            }

            oModel.setProperty("/resource", sRsrc);
            oModel.setProperty("/queue", sQueue);

            this.setBusy(true);
            return EwmService.logonResource(sWhse, sRsrc, sQueue)
                .then(function () {
                    oModel.setProperty("/isLoggedIn", true);
                    that._playBeep(true);
                    return that._fetchNextTask();
                })
                .then(function (bFound) {
                    if (bFound) {
                        oModel.setProperty("/currentStep", 2);
                        MessageToast.show("Operator logged on to " + sRsrc);
                    } else {
                        MessageToast.show("Logged on to " + sRsrc + ". No open warehouse tasks in queue.");
                    }
                })
                .catch(function (err) {
                    that._playBeep(false);
                    MessageBox.error("Logon failed: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        onCheckForTasks: function () {
            var that = this;
            var oModel = this.getView().getModel("rfView");
            var sWhse = oModel.getProperty("/warehouse");

            this.setBusy(true);
            return this._fetchNextTask()
                .then(function (bFound) {
                    if (bFound) {
                        oModel.setProperty("/currentStep", 2);
                        MessageToast.show("Found and loaded SAP Warehouse Task");
                    } else {
                        MessageToast.show("No open warehouse tasks in SAP for warehouse " + sWhse);
                    }
                })
                .catch(function (err) {
                    MessageBox.error("Failed to check SAP tasks: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        onFetchTaskById: function () {
            var oModel = this.getView().getModel("rfView");
            var sWhse = oModel.getProperty("/warehouse");
            var sTaskId = (oModel.getProperty("/manualTaskId") || "").trim();
            var that = this;

            if (!sTaskId) {
                MessageToast.show("Please enter a Warehouse Task number");
                return;
            }

            this.setBusy(true);
            return EwmService.getWarehouseTasks(sWhse)
                .then(function (oData) {
                    var aTasks = (oData && oData.value) ? oData.value : [];
                    var oFound = aTasks.find(function (t) { return String(t.WarehouseTask) === sTaskId; });
                    if (oFound) {
                        if (oFound.WarehouseTaskStatus === "C") {
                            MessageBox.warning("Warehouse Task " + sTaskId + " is already confirmed. Only open tasks (status 'O') can be picked.");
                            return;
                        }
                        if (oFound.WarehouseTaskStatus === "X") {
                            MessageBox.warning("Warehouse Task " + sTaskId + " is cancelled.");
                            return;
                        }
                        oModel.setProperty("/activeTask", oFound);
                        oModel.setProperty("/confirmedQty", Number(oFound.TargetQuantity) || 0);
                        oModel.setProperty("/suggestedHU", oFound.DestinationHandlingUnit || oFound.HandlingUnit || "");
                        oModel.setProperty("/scannedBin", "");
                        oModel.setProperty("/verifiedBin", "");
                        oModel.setProperty("/scannedProduct", "");
                        oModel.setProperty("/verifiedProduct", "");
                        oModel.setProperty("/scannedHU", "");
                        oModel.setProperty("/currentStep", 2);
                        MessageToast.show("Loaded SAP Task " + sTaskId);
                    } else {
                        MessageBox.error("Warehouse Task " + sTaskId + " not found in SAP for warehouse " + sWhse);
                    }
                })
                .catch(function (err) {
                    MessageBox.error("Failed to query SAP task: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        onLogoff: function () {
            var oModel = this.getView().getModel("rfView");
            oModel.setProperty("/isLoggedIn", false);
            oModel.setProperty("/currentStep", 1);
            oModel.setProperty("/activeTask", null);
            MessageToast.show("Logged off from RF resource");
        },

        onCancelTask: function () {
            var oModel = this.getView().getModel("rfView");
            oModel.setProperty("/currentStep", 1);
            oModel.setProperty("/activeTask", null);
            oModel.setProperty("/scannedBin", "");
            oModel.setProperty("/verifiedBin", "");
            oModel.setProperty("/scannedProduct", "");
            oModel.setProperty("/verifiedProduct", "");
            oModel.setProperty("/scannedHU", "");
            MessageToast.show("Returned to RF task standby");
        },

        _fetchNextTask: function () {
            var oModel = this.getView().getModel("rfView");
            var sWhse = oModel.getProperty("/warehouse");

            return EwmService.getWarehouseTasks(sWhse)
                .then(function (oData) {
                    var aTasks = (oData && oData.value) ? oData.value : [];
                    var aOpenTasks = aTasks.filter(function (t) { return t.WarehouseTaskStatus === "O"; });
                    if (aOpenTasks.length > 0) {
                        var oOpenTask = aOpenTasks[0];
                        oModel.setProperty("/activeTask", oOpenTask);
                        oModel.setProperty("/confirmedQty", Number(oOpenTask.TargetQuantity) || 0);
                        oModel.setProperty("/suggestedHU", oOpenTask.DestinationHandlingUnit || oOpenTask.HandlingUnit || "");
                        oModel.setProperty("/scannedBin", "");
                        oModel.setProperty("/verifiedBin", "");
                        oModel.setProperty("/scannedProduct", "");
                        oModel.setProperty("/verifiedProduct", "");
                        oModel.setProperty("/scannedHU", "");
                        return true;
                    } else {
                        oModel.setProperty("/activeTask", null);
                        oModel.setProperty("/confirmedQty", 0);
                        oModel.setProperty("/suggestedHU", "");
                        return false;
                    }
                });
        },

        // -------------------------------------------------------------
        // Step 2: Scan Source Bin
        // -------------------------------------------------------------

        onScanSourceBin: function () {
            var oModel = this.getView().getModel("rfView");
            var sScanned = oModel.getProperty("/scannedBin");
            var sExpected = oModel.getProperty("/activeTask/SourceStorageBin");
            var sWhse = oModel.getProperty("/warehouse");
            var that = this;

            if (!sScanned) {
                MessageToast.show(this.getText("rfScanBinPrompt") || "Please scan Source Storage Bin");
                return;
            }

            this.setBusy(true);
            return EwmService.verifyRfScan(sWhse, "BIN", sScanned, sExpected)
                .then(function (bValid) {
                    if (bValid) {
                        that._playBeep(true);
                        oModel.setProperty("/verifiedBin", sScanned);
                        oModel.setProperty("/currentStep", 3);
                        MessageToast.show("Bin verified: " + sScanned);
                    } else {
                        that._playBeep(false);
                        MessageBox.error("Wrong Storage Bin scanned: " + sScanned + " (Expected: " + sExpected + ")");
                    }
                })
                .catch(function (err) {
                    that._playBeep(false);
                    MessageBox.error("Verification error: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        // -------------------------------------------------------------
        // Step 3: Scan Product
        // -------------------------------------------------------------

        onScanProduct: function () {
            var oModel = this.getView().getModel("rfView");
            var sScanned = oModel.getProperty("/scannedProduct");
            var sExpected = oModel.getProperty("/activeTask/Product");
            var sWhse = oModel.getProperty("/warehouse");
            var that = this;

            if (!sScanned) {
                MessageToast.show(this.getText("rfScanProductPrompt") || "Please scan Product barcode");
                return;
            }

            this.setBusy(true);
            return EwmService.verifyRfScan(sWhse, "PRODUCT", sScanned, sExpected)
                .then(function (bValid) {
                    if (bValid) {
                        that._playBeep(true);
                        oModel.setProperty("/verifiedProduct", sScanned);
                        oModel.setProperty("/currentStep", 4);
                        MessageToast.show("Product verified: " + sScanned);
                    } else {
                        that._playBeep(false);
                        MessageBox.error("Wrong Product scanned: " + sScanned + " (Expected: " + sExpected + ")");
                    }
                })
                .catch(function (err) {
                    that._playBeep(false);
                    MessageBox.error("Verification error: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        // -------------------------------------------------------------
        // Step 4: Scan Destination HU & Confirm Pick
        // -------------------------------------------------------------

        onConfirmPick: function () {
            var oModel = this.getView().getModel("rfView");
            var sWhse = oModel.getProperty("/warehouse");
            var oTask = oModel.getProperty("/activeTask");
            var sHu = (oModel.getProperty("/scannedHU") || oModel.getProperty("/suggestedHU") || "").trim();
            var fQty = parseFloat(oModel.getProperty("/confirmedQty"));
            var sBin = (oModel.getProperty("/verifiedBin") || "").trim();
            var that = this;

            if (!sWhse) {
                MessageBox.error("No active warehouse selected");
                return;
            }

            if (!oTask || !oTask.WarehouseTask) {
                MessageBox.error("No active warehouse task to confirm");
                return;
            }

            if (isNaN(fQty) || fQty <= 0) {
                MessageBox.error("Valid positive confirmed quantity is required");
                return;
            }

            if (!sHu) {
                MessageToast.show(this.getText("rfScanHUPrompt") || "Please scan or enter Destination HU");
                return;
            }

            if (!sBin) {
                MessageToast.show("Please verify Source Storage Bin before confirmation");
                return;
            }

            this.setBusy(true);
            return EwmService.confirmRfPick(sWhse, oTask.WarehouseTask, fQty, sHu, sBin)
                .then(function () {
                    that._playBeep(true);
                    oModel.setProperty("/successMessage", "Pick confirmed for Task " + oTask.WarehouseTask + " into HU " + sHu + " (" + fQty + " " + (oTask.BaseUnit || "EA") + ")");
                    oModel.setProperty("/currentStep", 5);
                })
                .catch(function (err) {
                    that._playBeep(false);
                    MessageBox.error("Pick confirmation failed: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        // -------------------------------------------------------------
        // Step 5: Next Task
        // -------------------------------------------------------------

        onNextTask: function () {
            var oModel = this.getView().getModel("rfView");
            oModel.setProperty("/scannedBin", "");
            oModel.setProperty("/verifiedBin", "");
            oModel.setProperty("/scannedProduct", "");
            oModel.setProperty("/verifiedProduct", "");
            oModel.setProperty("/scannedHU", "");

            var that = this;
            this.setBusy(true);
            return this._fetchNextTask()
                .then(function (bFound) {
                    if (bFound) {
                        oModel.setProperty("/currentStep", 2);
                    } else {
                        oModel.setProperty("/currentStep", 1);
                        oModel.setProperty("/isLoggedIn", false);
                        MessageBox.information(that.getText("rfAllTasksCompleted") || "All open warehouse tasks in SAP have been completed.");
                    }
                })
                .catch(function (err) {
                    MessageBox.error("Failed to query next SAP task: " + (err.message || err));
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        // -------------------------------------------------------------
        // Barcode Simulation / Quick-Fill Helpers
        // -------------------------------------------------------------

        onSimulateScanBin: function () {
            var oModel = this.getView().getModel("rfView");
            var sBin = oModel.getProperty("/activeTask/SourceStorageBin") || "";
            if (!sBin) {
                MessageToast.show("No required source bin in active task");
                return;
            }
            oModel.setProperty("/scannedBin", sBin);
            this.onScanSourceBin();
        },

        onSimulateScanProduct: function () {
            var oModel = this.getView().getModel("rfView");
            var sProd = oModel.getProperty("/activeTask/Product") || "";
            if (!sProd) {
                MessageToast.show("No expected product in active task");
                return;
            }
            oModel.setProperty("/scannedProduct", sProd);
            this.onScanProduct();
        },

        onSimulateScanHU: function () {
            var oModel = this.getView().getModel("rfView");
            var sHu = oModel.getProperty("/suggestedHU") || "HU-CART01-POS1";
            oModel.setProperty("/scannedHU", sHu);
            MessageToast.show("Destination HU slot scanned: " + sHu);
        },

        onNavigateToCreateTask: function () {
            var sWhse = this.getView().getModel("rfView").getProperty("/warehouse") || "";
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("createWarehouseTask", {
                    "?query": {
                        warehouse: sWhse
                    }
                });
            }
        }
    });
});
