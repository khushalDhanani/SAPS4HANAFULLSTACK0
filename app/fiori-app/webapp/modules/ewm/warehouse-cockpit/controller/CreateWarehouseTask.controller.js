sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/ewm/warehouse-cockpit/service/EwmService"
], function (BaseController, MessageBox, MessageToast, MessagePopover, MessageItem, JSONModel, Filter, FilterOperator, ValueHelpService, EwmService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.ewm.warehouse-cockpit.controller.CreateWarehouseTask", {

        onInit: function () {
            this._resetModel();
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("createWarehouseTask").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _resetModel: function () {
            var oInitialData = {
                task: {
                    Warehouse: "",
                    WarehouseProcessType: "",
                    Product: "",
                    ProductDescription: "",
                    Quantity: "",
                    UnitOfMeasure: "",
                    Batch: "",
                    SourceStorageType: "",
                    SourceStorageBin: "",
                    SourceHandlingUnit: "",
                    DestinationStorageType: "",
                    DestinationStorageBin: "",
                    DestinationHandlingUnit: ""
                },
                errors: {
                    Warehouse: { state: "None", text: "" },
                    WarehouseProcessType: { state: "None", text: "" },
                    Product: { state: "None", text: "" },
                    Quantity: { state: "None", text: "" },
                    UnitOfMeasure: { state: "None", text: "" }
                },
                hasError: false,
                errorMessage: "",
                errorCount: 0,
                errorList: [],
                isNonEwmWarehouse: false,
                nonEwmWarningText: "",
                warehouses: [],
                storageTypes: [],
                storageBins: [],
                processTypes: []
            };

            var oModel = new JSONModel(oInitialData);
            this.getView().setModel(oModel, "taskModel");
            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }
        },

        _onRouteMatched: function (oEvent) {
            this._resetModel();
            var oArgs = oEvent.getParameter("arguments");
            var sQueryWhse = oArgs && oArgs["?query"] && oArgs["?query"].warehouse;

            this._loadWarehousesAndMasterData(sQueryWhse);
        },

        _loadWarehousesAndMasterData: function (sPreferredWarehouse) {
            var that = this;
            var oModel = this.getView().getModel("taskModel");

            this.setBusy(true);

            EwmService.getWarehouses()
                .then(function (oData) {
                    var aRaw = (oData && Array.isArray(oData.value)) ? oData.value : [];
                    // Filter strictly to project-specific warehouse types
                    // Exclude all SAP standard, default, and demo warehouse types (e.g. 0001, 001, 002, 100, EWM, MLO, Central Warehouse, etc.)
                    var aDisplayWarehouses = EwmService.filterProjectWarehouses(aRaw);
                    oModel.setProperty("/warehouses", aDisplayWarehouses);

                    if (aDisplayWarehouses.length === 0) {
                        oModel.setProperty("/task/Warehouse", "");
                        oModel.setProperty("/storageTypes", []);
                        oModel.setProperty("/storageBins", []);
                        oModel.setProperty("/processTypes", []);
                        return;
                    }

                    var bMatch = aDisplayWarehouses.some(function (w) { return w.Warehouse === sPreferredWarehouse; });
                    var sSelectedWhse = bMatch ? sPreferredWarehouse : aDisplayWarehouses[0].Warehouse;
                    oModel.setProperty("/task/Warehouse", sSelectedWhse);

                    return that._loadWarehouseLocations(sSelectedWhse);
                })
                .catch(function (err) {
                    var sMsg = (err && err.message) || String(err || "");
                    if (err && (err.status === 401 || sMsg.toLowerCase().includes("unauthorized"))) {
                        MessageBox.error("Session expired. Please sign in to SAP S/4HANA.", {
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

        _loadWarehouseLocations: function (sWhse) {
            var oModel = this.getView().getModel("taskModel");
            if (!sWhse) {
                oModel.setProperty("/storageTypes", []);
                oModel.setProperty("/storageBins", []);
                oModel.setProperty("/processTypes", []);
                return Promise.resolve();
            }

            return Promise.all([
                EwmService.getStorageTypes(sWhse).catch(function () { return { value: [] }; }),
                EwmService.getStorageBins(sWhse, 100).catch(function () { return { value: [] }; }),
                EwmService.getWarehouseProcessTypes(sWhse).catch(function () { return { value: [] }; })
            ]).then(function (aResults) {
                var aTypes = (aResults[0] && aResults[0].value) ? aResults[0].value : [];
                var aBins = (aResults[1] && aResults[1].value) ? aResults[1].value : [];
                var aProcessTypes = (aResults[2] && aResults[2].value) ? aResults[2].value : [];
                if (sWhse && aProcessTypes.length === 0) {
                    var aDefaultProcessTypes = [
                        { Warehouse: sWhse, WarehouseProcessType: "1010", WarehouseProcessTypeName: "Putaway (Local Staging)" },
                        { Warehouse: sWhse, WarehouseProcessType: "2010", WarehouseProcessTypeName: "Picking (Local Staging)" },
                        { Warehouse: sWhse, WarehouseProcessType: "3010", WarehouseProcessTypeName: "Internal Movement (Local Staging)" }
                    ];
                    oModel.setProperty("/processTypes", aDefaultProcessTypes);
                    if (!oModel.getProperty("/task/WarehouseProcessType")) {
                        oModel.setProperty("/task/WarehouseProcessType", "1010");
                    }
                    oModel.setProperty("/isNonEwmWarehouse", true);
                    oModel.setProperty("/nonEwmWarningText", "Warehouse " + sWhse + " has no active EWM process types (/SCWM/T333) configured in this system. Local Staging persistence will be automatically used.");
                } else {
                    oModel.setProperty("/processTypes", aProcessTypes);
                    oModel.setProperty("/isNonEwmWarehouse", false);
                    oModel.setProperty("/nonEwmWarningText", "");
                }

                if (sWhse && aTypes.length === 0) {
                    var aDefaultTypes = [
                        { StorageType: "0010", StorageTypeName: "General Storage (Local Staging)" },
                        { StorageType: "0020", StorageTypeName: "High Rack Storage (Local Staging)" },
                        { StorageType: "0030", StorageTypeName: "Picking Area (Local Staging)" }
                    ];
                    oModel.setProperty("/storageTypes", aDefaultTypes);
                } else {
                    oModel.setProperty("/storageTypes", aTypes);
                }

                if (sWhse && aBins.length === 0) {
                    var aDefaultBins = [
                        { StorageBin: sWhse + "-01-01", StorageType: "0010" },
                        { StorageBin: sWhse + "-01-02", StorageType: "0010" },
                        { StorageBin: sWhse + "-02-01", StorageType: "0020" },
                        { StorageBin: sWhse + "-03-01", StorageType: "0030" }
                    ];
                    oModel.setProperty("/storageBins", aDefaultBins);
                } else {
                    oModel.setProperty("/storageBins", aBins);
                }
            });
        },

        onWarehouseChange: function (oEvent) {
            var sNewWhse = oEvent.getParameter("selectedItem").getKey();
            var oModel = this.getView().getModel("taskModel");
            oModel.setProperty("/task/Warehouse", sNewWhse);
            oModel.setProperty("/task/WarehouseProcessType", "");
            oModel.setProperty("/task/SourceStorageType", "");
            oModel.setProperty("/task/SourceStorageBin", "");
            oModel.setProperty("/task/DestinationStorageType", "");
            oModel.setProperty("/task/DestinationStorageBin", "");
            oModel.setProperty("/processTypes", []);

            this.setBusy(true);
            var that = this;
            this._loadWarehouseLocations(sNewWhse).finally(function () {
                that.setBusy(false);
            });
            this.onFieldChange();
        },

        onSourceBinChange: function (oEvent) {
            var oSelectedItem = oEvent.getSource().getSelectedItem();
            if (oSelectedItem) {
                var oBinData = oSelectedItem.getBindingContext("taskModel").getObject();
                if (oBinData && oBinData.StorageType) {
                    this.getView().getModel("taskModel").setProperty("/task/SourceStorageType", oBinData.StorageType);
                }
            }
        },

        onDestBinChange: function (oEvent) {
            var oSelectedItem = oEvent.getSource().getSelectedItem();
            if (oSelectedItem) {
                var oBinData = oSelectedItem.getBindingContext("taskModel").getObject();
                if (oBinData && oBinData.StorageType) {
                    this.getView().getModel("taskModel").setProperty("/task/DestinationStorageType", oBinData.StorageType);
                }
            }
        },

        onValueHelpRequest: function (oEvent) {
            var oInput = oEvent.getSource();
            var that = this;

            ValueHelpService.openValueHelp(this.getView(), oInput, function (sKey, oItem, oData) {
                if (oInput.getId().indexOf("inProduct") !== -1) {
                    var sDesc = (oData && (oData.MaterialName || oData.Material_Text)) || "";
                    var sUom = (oData && oData.MaterialBaseUnit) || "";
                    that.getView().getModel("taskModel").setProperty("/task/ProductDescription", sDesc);
                    if (sUom) {
                        that.getView().getModel("taskModel").setProperty("/task/UnitOfMeasure", sUom);
                    }
                }
                that.onFieldChange();
            });
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            ValueHelpService.applySuggestionFilter(oEvent.getSource(), sValue);
        },

        onProductSelect: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (oSelectedItem) {
                var oContext = oSelectedItem.getBindingContext();
                if (oContext) {
                    var oData = oContext.getObject();
                    if (oData) {
                        var sDesc = oData.MaterialName || oData.Material_Text || "";
                        var sUom = oData.MaterialBaseUnit || "";
                        this.getView().getModel("taskModel").setProperty("/task/ProductDescription", sDesc);
                        if (sUom) {
                            this.getView().getModel("taskModel").setProperty("/task/UnitOfMeasure", sUom);
                        }
                    }
                }
            }
            this.onFieldChange();
        },

        onFieldChange: function () {
            var oModel = this.getView().getModel("taskModel");
            if (oModel) {
                var sWpt = oModel.getProperty("/task/WarehouseProcessType");
                if (typeof sWpt === "string" && sWpt !== sWpt.toUpperCase()) {
                    oModel.setProperty("/task/WarehouseProcessType", sWpt.toUpperCase());
                }
            }
            this._validateForm(false);
        },

        _validateForm: function (bShowMessages) {
            var oModel = this.getView().getModel("taskModel");
            var oTask = oModel.getProperty("/task");
            var aErrors = [];

            // 1. Warehouse
            if (!oTask.Warehouse || !oTask.Warehouse.trim()) {
                oModel.setProperty("/errors/Warehouse", { state: "Error", text: "Warehouse is required" });
                aErrors.push("Warehouse is required");
            } else {
                oModel.setProperty("/errors/Warehouse", { state: "None", text: "" });
            }

            // 2. Warehouse Process Type
            if (!oTask.WarehouseProcessType || !oTask.WarehouseProcessType.trim()) {
                // If warehouse process types are not configured in backend (such as W22), automatically default to standard '1010' (Putaway)
                oTask.WarehouseProcessType = "1010";
                oModel.setProperty("/task/WarehouseProcessType", "1010");
                oModel.setProperty("/errors/WarehouseProcessType", { state: "None", text: "" });
            } else if (oTask.WarehouseProcessType.trim().length > 4) {
                oModel.setProperty("/errors/WarehouseProcessType", { state: "Error", text: "Process Type cannot exceed 4 characters" });
                aErrors.push("Process Type cannot exceed 4 characters");
            } else {
                oModel.setProperty("/errors/WarehouseProcessType", { state: "None", text: "" });
            }

            // 3. Product
            if (!oTask.Product || !oTask.Product.trim()) {
                oModel.setProperty("/errors/Product", { state: "Error", text: "Product / Material ID is required" });
                aErrors.push("Product / Material ID is required");
            } else {
                oModel.setProperty("/errors/Product", { state: "None", text: "" });
            }

            // 4. Quantity
            var nQty = Number(oTask.Quantity);
            if (oTask.Quantity === "" || oTask.Quantity === null || isNaN(nQty) || nQty <= 0) {
                oModel.setProperty("/errors/Quantity", { state: "Error", text: "Valid positive Quantity (> 0) is required" });
                aErrors.push("Quantity must be a positive number greater than 0");
            } else {
                oModel.setProperty("/errors/Quantity", { state: "None", text: "" });
            }

            // 5. Unit of Measure
            if (!oTask.UnitOfMeasure || !oTask.UnitOfMeasure.trim()) {
                oModel.setProperty("/errors/UnitOfMeasure", { state: "Error", text: "Unit of Measure is required" });
                aErrors.push("Unit of Measure is required");
            } else {
                oModel.setProperty("/errors/UnitOfMeasure", { state: "None", text: "" });
            }

            var bHasError = aErrors.length > 0;
            oModel.setProperty("/hasError", bHasError);
            oModel.setProperty("/errorCount", aErrors.length);
            oModel.setProperty("/errorList", aErrors.map(function (msg) {
                return { type: "Error", title: msg };
            }));

            if (bHasError) {
                oModel.setProperty("/errorMessage", aErrors[0] + (aErrors.length > 1 ? " (+" + (aErrors.length - 1) + " more)" : ""));
            } else {
                oModel.setProperty("/errorMessage", "");
            }

            return !bHasError;
        },

        onDismissError: function () {
            this.getView().getModel("taskModel").setProperty("/hasError", false);
        },

        onMessageButtonPress: function (oEvent) {
            var oSource = oEvent.getSource();
            if (!this._oMessagePopover) {
                this._oMessagePopover = new MessagePopover({
                    items: {
                        path: "taskModel>/errorList",
                        template: new MessageItem({
                            type: "{taskModel>type}",
                            title: "{taskModel>title}"
                        })
                    }
                });
                this.getView().addDependent(this._oMessagePopover);
            }
            this._oMessagePopover.toggle(oSource);
        },

        onCreatePress: function () {
            var bValid = this._validateForm(true);
            if (!bValid) {
                var oBtn = this.byId("btnMessages");
                if (oBtn) {
                    this.onMessageButtonPress({ getSource: function () { return oBtn; } });
                }
                MessageBox.error("Please correct the highlighted fields before submitting.");
                return;
            }

            var that = this;
            var oModel = this.getView().getModel("taskModel");
            var oTask = oModel.getProperty("/task");

            function sanitizeCode(val, maxLen) {
                if (!val) return "";
                var s = String(val).trim();
                if (s.indexOf(" - ") !== -1) {
                    s = s.split(" - ")[0].trim();
                }
                if (maxLen && s.length > maxLen) {
                    s = s.substring(0, maxLen);
                }
                return s.toUpperCase();
            }

            var oPayload = {
                Warehouse: sanitizeCode(oTask.Warehouse, 4),
                WarehouseProcessType: sanitizeCode(oTask.WarehouseProcessType || "1010", 4),
                Product: (oTask.Product || "").trim(),
                Quantity: Number(oTask.Quantity),
                UnitOfMeasure: (oTask.UnitOfMeasure || "").trim()
            };

            if (oTask.SourceStorageType && String(oTask.SourceStorageType).trim()) {
                oPayload.SourceStorageType = sanitizeCode(oTask.SourceStorageType, 4);
            }
            if (oTask.SourceStorageBin && String(oTask.SourceStorageBin).trim()) {
                oPayload.SourceStorageBin = String(oTask.SourceStorageBin).trim();
            }
            if (oTask.SourceHandlingUnit && String(oTask.SourceHandlingUnit).trim()) {
                oPayload.SourceHandlingUnit = String(oTask.SourceHandlingUnit).trim();
            }
            if (oTask.DestinationStorageType && String(oTask.DestinationStorageType).trim()) {
                var sDestType = sanitizeCode(oTask.DestinationStorageType, 4);
                oPayload.DestinationStorageType = sDestType;
                oPayload.TargetStorageType = sDestType;
            }
            if (oTask.DestinationStorageBin && String(oTask.DestinationStorageBin).trim()) {
                var sDestBin = String(oTask.DestinationStorageBin).trim();
                oPayload.DestinationStorageBin = sDestBin;
                oPayload.TargetStorageBin = sDestBin;
            }
            if (oTask.DestinationHandlingUnit && String(oTask.DestinationHandlingUnit).trim()) {
                oPayload.DestinationHandlingUnit = String(oTask.DestinationHandlingUnit).trim();
            }
            if (oTask.Batch && String(oTask.Batch).trim()) {
                oPayload.Batch = String(oTask.Batch).trim();
            }

            this.setBusy(true);

            EwmService.createWarehouseTask(oPayload)
                .then(function (oCreated) {
                    var sTaskId = (oCreated && (oCreated.WarehouseTask || oCreated.WarehouseTaskNumber)) || "Success";
                    var bIsStaged = Boolean(oCreated && oCreated._isLocalStaging);
                    var sSuccessMsg = bIsStaged
                        ? "Warehouse Task " + sTaskId + " created successfully (Local Staging — SAP backend task creation is unavailable on this software stack)."
                        : "Warehouse Task " + sTaskId + " created successfully in SAP S/4HANA.";
                    MessageBox.success(sSuccessMsg, {
                        onClose: function () {
                            var oRouter = that.getRouter();
                            if (oRouter) {
                                oRouter.navTo("ewmWarehouseCockpit", {}, true);
                            }
                        }
                    });
                })
                .catch(function (err) {
                    var sMsg = (err && err.message) || String(err || "");
                    oModel.setProperty("/hasError", true);
                    oModel.setProperty("/errorMessage", "SAP Backend Error: " + sMsg);
                    MessageBox.error("Failed to create Warehouse Task in SAP S/4HANA:\n\n" + sMsg, {
                        title: "SAP S/4HANA Rejection"
                    });
                })
                .finally(function () {
                    that.setBusy(false);
                });
        },

        _isDirty: function () {
            var oTask = this.getView().getModel("taskModel").getProperty("/task");
            return Boolean(
                (oTask.WarehouseProcessType && oTask.WarehouseProcessType.trim()) ||
                (oTask.Product && oTask.Product.trim()) ||
                (oTask.Quantity && String(oTask.Quantity).trim()) ||
                (oTask.SourceStorageBin && oTask.SourceStorageBin.trim()) ||
                (oTask.DestinationStorageBin && oTask.DestinationStorageBin.trim())
            );
        },

        onCancelPress: function () {
            var that = this;
            if (this._isDirty()) {
                MessageBox.confirm("Are you sure you want to discard your changes and return to the Warehouse Cockpit?", {
                    title: "Discard Changes?",
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            that._navigateBackToCockpit();
                        }
                    }
                });
            } else {
                this._navigateBackToCockpit();
            }
        },

        onNavBack: function () {
            this.onCancelPress();
        },

        _navigateBackToCockpit: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("ewmWarehouseCockpit", {}, true);
            }
        }
    });
});
