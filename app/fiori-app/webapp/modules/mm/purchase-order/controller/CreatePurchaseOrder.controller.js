sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/core/BusyIndicator",
    "saps4hana/fiori/modules/mm/purchase-order/model/PurchaseOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/mm/purchase-order/service/PurchaseOrderService"
], function (BaseController, MessageBox, MessageToast, MessagePopover, MessageItem, BusyIndicator, PurchaseOrderModel, ValueHelpService, PurchaseOrderService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.mm.purchase-order.controller.CreatePurchaseOrder", {
        onInit: function () {
            this._resetModel();
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createPurchaseOrder").attachPatternMatched(this._onRouteMatched, this);
        },

        _resetModel: function () {
            var sUser = PurchaseOrderModel.getCurrentUserName(this.getOwnerComponent());
            var oModel = PurchaseOrderModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }
            this._loadConfigurationAndDefaults();
        },

        _loadConfigurationAndDefaults: function () {
            var that = this;
            var oModel = this.getView().getModel("newPO");
            if (this._oConfigData) {
                PurchaseOrderModel.applyConfigurationDefaults(oModel, this._oConfigData);
                return Promise.resolve(this._oConfigData);
            }

            return PurchaseOrderService.loadConfiguration().then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newPO");
                if (oCurrentModel) {
                    PurchaseOrderModel.applyConfigurationDefaults(oCurrentModel, oConfigData);
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreatePurchaseOrder] Error loading config data:", err);
            });
        },

        _onRouteMatched: function () {
            this._resetModel();
        },

        onHeaderChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onDocTypeChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                PurchaseOrderModel.markUserModified(oModel, "PurchaseOrderType", true);
            }
            if (this._oConfigData) {
                PurchaseOrderModel.applyConfigurationDefaults(oModel, this._oConfigData);
            }
            PurchaseOrderModel.validateSingleField(oModel, "PurchaseOrderType");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onDocTypeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/PurchaseOrderType", sKey);
                this.onDocTypeChange();
            }
        },

        onDocDateChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "DocumentDate", true);
            PurchaseOrderModel.validateSingleField(oModel, "DocumentDate");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onCompanyCodeChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                PurchaseOrderModel.markUserModified(oModel, "CompanyCode", true);
            }
            if (this._oConfigData) {
                PurchaseOrderModel.validateCompanyCodePurchasingOrg(oModel, this._oConfigData);
            }
            PurchaseOrderModel.validateSingleField(oModel, "CompanyCode");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onCompanyCodeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/CompanyCode", sKey);
                this.onCompanyCodeChange();
            }
        },

        onPurchOrgChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                PurchaseOrderModel.markUserModified(oModel, "PurchasingOrganization", true);
            }
            if (this._oConfigData) {
                PurchaseOrderModel.validateCompanyCodePurchasingOrg(oModel, this._oConfigData);
            }
            PurchaseOrderModel.validateSingleField(oModel, "PurchasingOrganization");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onPurchOrgSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/PurchasingOrganization", sKey);
                this.onPurchOrgChange();
            }
        },

        onPurchGrpChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                PurchaseOrderModel.markUserModified(oModel, "PurchasingGroup", true);
            }
            PurchaseOrderModel.validateSingleField(oModel, "PurchasingGroup");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onPurchGrpSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/PurchasingGroup", sKey);
                this.onPurchGrpChange();
            }
        },

        onSupplierLiveChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "Supplier", true);
            PurchaseOrderModel.validateSingleField(oModel, "Supplier");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onSupplierChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sSupplier = "";
            if (typeof oEvent === "string") {
                sSupplier = oEvent;
            } else if (oEvent && typeof oEvent.getParameter === "function") {
                sSupplier = oEvent.getParameter("value");
            } else {
                sSupplier = oModel.getProperty("/header/Supplier");
            }

            PurchaseOrderModel.markUserModified(oModel, "Supplier", true);
            PurchaseOrderModel.validateSingleField(oModel, "Supplier", sSupplier);
            PurchaseOrderModel.updateStatus(oModel);

            this._deriveSupplierData(sSupplier);
        },

        onSupplierSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/Supplier", sKey);
                this.onSupplierChange(sKey);
            }
        },

        _deriveSupplierData: function (sSupplier) {
            if (!sSupplier || String(sSupplier).trim() === "") return;

            var that = this;
            var oModel = this.getView().getModel("newPO");
            var sCoCode = oModel.getProperty("/header/CompanyCode") || "";
            var sPurchOrg = oModel.getProperty("/header/PurchasingOrganization") || "";

            PurchaseOrderService.getSupplierDefaults(sSupplier, sCoCode, sPurchOrg)
                .then(function (oDefaults) {
                    if (!oDefaults) return;
                    var oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, sSupplier, oDefaults);
                    if (oReport && oReport.applied && Object.keys(oReport.applied).length > 0) {
                        var aAppliedFields = Object.keys(oReport.applied).map(function (k) {
                            return k + ": " + oReport.applied[k];
                        });
                        MessageToast.show("Supplier defaults applied: " + aAppliedFields.join(", "));
                    }
                })
                .catch(function (err) {
                    console.warn("[CreatePurchaseOrder] Could not derive supplier defaults:", err);
                });
        },

        onCurrencyChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "Currency", true);
            PurchaseOrderModel.validateSingleField(oModel, "Currency");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onCurrencySelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/Currency", sKey);
                this.onCurrencyChange();
            }
        },

        onPaymentTermsChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "PaymentTerms", true);
            PurchaseOrderModel.validateSingleField(oModel, "PaymentTerms");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onPaymentTermsSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/PaymentTerms", sKey);
                this.onPaymentTermsChange();
            }
        },

        onIncotermsChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "IncotermsClassification", true);
            PurchaseOrderModel.validateSingleField(oModel, "IncotermsClassification");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onIncotermsSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (oItem) {
                var sKey = oItem.getKey() || oItem.getText();
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/IncotermsClassification", sKey);
                this.onIncotermsChange();
            }
        },

        onIncotermsLocChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "IncotermsLocation1", true);
            PurchaseOrderModel.validateSingleField(oModel, "IncotermsLocation1");
            PurchaseOrderModel.updateStatus(oModel);
        },

        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newPO");
            if (!oContext) return;

            var sVal = oSource.getValue();
            var oModel = this.getView().getModel("newPO");
            var sPath = oContext.getPath();

            if (!sVal || sVal.trim() === "") {
                oModel.setProperty(sPath + "/errors/Material", { state: "Error", text: "Material is required" });
            } else {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
                // Directly retrieve and set Unit from S/4HANA material configuration on manual input
                var that = this;
                PurchaseOrderService.getMaterialDetails(sVal).then(function (oMaterial) {
                    if (oMaterial) {
                        PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMaterial);
                        that.onItemFieldChange();
                    }
                });
            }
            this.onItemFieldChange();
        },

        onItemMaterialSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newPO");
            if (!oContext || !oItem) return;

            var sKey = oItem.getKey() || oItem.getText();
            var oModel = this.getView().getModel("newPO");
            var sPath = oContext.getPath();

            var oBindingCtx = oItem.getBindingContext();
            var oMaterialData = oBindingCtx ? oBindingCtx.getObject() : null;

            if (oMaterialData) {
                PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMaterialData);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                var sDesc = oItem.getAdditionalText() || "";
                if (sDesc && !oModel.getProperty(sPath + "/PurchaseOrderItemText")) {
                    oModel.setProperty(sPath + "/PurchaseOrderItemText", sDesc);
                }
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            // Ensure Unit is derived from S/4HANA if not already present in suggestion context
            var sCurrentUnit = oModel.getProperty(sPath + "/UnitOfMeasure");
            var that = this;
            if (!sCurrentUnit || sCurrentUnit === "PC") {
                PurchaseOrderService.getMaterialUnit(sKey).then(function (sUnit) {
                    if (sUnit) {
                        oModel.setProperty(sPath + "/UnitOfMeasure", sUnit);
                        oModel.setProperty(sPath + "/errors/UnitOfMeasure", { state: "None", text: "" });
                        that.onItemFieldChange();
                    }
                });
            }

            this.onItemFieldChange();
        },

        onItemFieldChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onDismissError: function () {
            var oModel = this.getView().getModel("newPO");
            if (oModel) {
                oModel.setProperty("/hasError", false);
                oModel.setProperty("/errorMessage", "");
            }
        },

        _initMessagePopover: function () {
            var that = this;
            var oMessageTemplate = new MessageItem({
                type: "{newPO>type}",
                title: "{newPO>title}",
                subtitle: "{newPO>field}",
                description: "{newPO>description}",
                activeTitle: true
            });

            this._oMessagePopover = new MessagePopover({
                items: {
                    path: "newPO>/errorList",
                    template: oMessageTemplate
                },
                itemSelect: function (oEvent) {
                    var oItem = oEvent.getParameter("item");
                    if (oItem) {
                        var oContext = oItem.getBindingContext("newPO");
                        if (oContext) {
                            that._navigateToErrorTarget(oContext.getObject());
                        }
                    }
                }
            });
            this.getView().addDependent(this._oMessagePopover);
        },

        _openMessagePopover: function () {
            var oBtn = this.byId("btnMessages");
            if (!oBtn) return;
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            var that = this;
            setTimeout(function () {
                if (!that._oMessagePopover.isOpen() && oBtn.getDomRef()) {
                    that._oMessagePopover.openBy(oBtn);
                }
            }, 100);
        },

        _navigateToErrorTarget: function (oError) {
            if (!oError) return;

            var that = this;
            setTimeout(function () {
                // 1. Header input targeting by control ID
                if (typeof oError.controlId === "string" && oError.controlId !== "poItemsTable") {
                    var oControl = that.byId(oError.controlId);
                    if (oControl) {
                        if (typeof oControl.focus === "function") {
                            oControl.focus();
                        }
                        var oDomRef = oControl.getDomRef();
                        if (oDomRef && typeof oDomRef.scrollIntoView === "function") {
                            oDomRef.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                        return;
                    }
                }

                // 2. Line Item Table cell targeting
                var oTable = that.byId("poItemsTable");
                if (oTable) {
                    var iItemIndex = oError.itemIndex !== undefined ? oError.itemIndex : 0;
                    var aTableItems = oTable.getItems();
                    if (aTableItems && aTableItems[iItemIndex]) {
                        var oRow = aTableItems[iItemIndex];
                        var aCells = oRow.getCells();
                        var iCellIndex = oError.cellIndex !== undefined ? oError.cellIndex : 1;
                        var oTargetCell = aCells[iCellIndex] || oRow;
                        if (typeof oTargetCell.focus === "function") {
                            oTargetCell.focus();
                        }
                        var oCellDom = oTargetCell.getDomRef();
                        if (oCellDom && typeof oCellDom.scrollIntoView === "function") {
                            oCellDom.scrollIntoView({ behavior: "smooth", block: "center" });
                        }
                    }
                }
            }, 100);
        },

        onMessageButtonPress: function (oEvent) {
            var oSource = oEvent ? oEvent.getSource() : this.byId("btnMessages");
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            this._oMessagePopover.toggle(oSource);
        },

        onValueHelpRequest: function (oEvent) {
            var oSource = oEvent.getSource();
            var that = this;
            ValueHelpService.openValueHelp(this.getView(), oSource, function (sKey, oSelectedItem, oData) {
                that._handleValueHelpSelected(oSource, sKey, oSelectedItem, oData);
            });
        },

        _handleValueHelpSelected: function (oSource, sKey, oSelectedItem, oData) {
            if (!oSource || !sKey) return;
            var sId = oSource.getId() || "";
            var oRowContext = oSource.getBindingContext("newPO");
            var oModel = this.getView().getModel("newPO");

            // Line items table fields
            if (oRowContext) {
                var sRowPath = oRowContext.getPath();
                var sValPath = oSource.getBindingPath("value");

                if (sValPath === "Material" || sId.indexOf("Material") !== -1) {
                    var oMatData = oData || {
                        Material: sKey,
                        MaterialName: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || ""
                    };
                    PurchaseOrderModel.applyMaterialDefaults(oModel, sRowPath, oMatData);
                    var that = this;
                    if (!oData || !oData.MaterialBaseUnit) {
                        PurchaseOrderService.getMaterialUnit(sKey).then(function (sUnit) {
                            if (sUnit) {
                                oModel.setProperty(sRowPath + "/UnitOfMeasure", sUnit);
                                oModel.setProperty(sRowPath + "/errors/UnitOfMeasure", { state: "None", text: "" });
                                that.onItemFieldChange();
                            }
                        });
                    }
                    this.onItemFieldChange();
                } else if (sValPath === "UnitOfMeasure" || sId.indexOf("UnitOfMeasure") !== -1) {
                    oModel.setProperty(sRowPath + "/UnitOfMeasure", sKey);
                    oModel.setProperty(sRowPath + "/errors/UnitOfMeasure", { state: "None", text: "" });
                    this.onItemFieldChange();
                } else if (sValPath === "Plant" || sId.indexOf("Plant") !== -1) {
                    oModel.setProperty(sRowPath + "/Plant", sKey);
                    oModel.setProperty(sRowPath + "/errors/Plant", { state: "None", text: "" });
                    this.onItemFieldChange();
                } else if (sValPath === "StorageLocation" || sId.indexOf("StorageLocation") !== -1) {
                    oModel.setProperty(sRowPath + "/StorageLocation", sKey);
                    oModel.setProperty(sRowPath + "/errors/StorageLocation", { state: "None", text: "" });
                    this.onItemFieldChange();
                } else if (sValPath === "TaxCode" || sId.indexOf("TaxCode") !== -1) {
                    oModel.setProperty(sRowPath + "/TaxCode", sKey);
                    oModel.setProperty(sRowPath + "/errors/TaxCode", { state: "None", text: "" });
                    this.onItemFieldChange();
                }
                return;
            }

            // Header fields
            if (sId.indexOf("inDocType") !== -1) {
                this.onDocTypeChange();
            } else if (sId.indexOf("inCompanyCode") !== -1) {
                this.onCompanyCodeChange();
            } else if (sId.indexOf("inPurchOrg") !== -1) {
                this.onPurchOrgChange();
            } else if (sId.indexOf("inPurchGrp") !== -1) {
                this.onPurchGrpChange();
            } else if (sId.indexOf("inSupplier") !== -1) {
                this.onSupplierChange(sKey);
            } else if (sId.indexOf("inCurrency") !== -1) {
                this.onCurrencyChange();
            } else if (sId.indexOf("inPaymentTerms") !== -1) {
                this.onPaymentTermsChange();
            } else if (sId.indexOf("inIncoterms") !== -1) {
                this.onIncotermsChange();
            }
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            ValueHelpService.applySuggestionFilter(oEvent.getSource(), sValue);
        },

        onNavBack: function () {
            BaseController.prototype.onNavBack.call(this, "purchaseOrders");
        },

        onCancelPress: function () {
            this.onNavBack();
        },

        onAddItem: function () {
            var oModel = this.getView().getModel("newPO");
            var sUser = PurchaseOrderModel.getCurrentUserName(this.getOwnerComponent());
            PurchaseOrderModel.addItem(oModel, sUser);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onDeleteItem: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var sPath = oItem.getBindingContext("newPO").getPath();
            var iIndex = parseInt(sPath.split("/")[2], 10);
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.deleteItem(oModel, iIndex);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onCalculateNetAmount: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("newPO");
            if (!oContext) return;

            var sPath = oContext.getPath();
            var oModel = this.getView().getModel("newPO");

            PurchaseOrderModel.calculateItemNetAmount(oModel, sPath);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        _getErrorMessageConfig: function (oError) {
            var iStatus = (oError && oError.status) || 500;
            var sMessage = (oError && oError.message) || "An unexpected error occurred.";

            if (oError && oError.responseText) {
                try {
                    var oParsed = JSON.parse(oError.responseText);
                    if (oParsed.error && oParsed.error.message) {
                        sMessage = typeof oParsed.error.message === "object" ? (oParsed.error.message.value || sMessage) : oParsed.error.message;
                    }
                } catch (e) {
                    // responseText is not JSON
                }
            } else if (oError && oError.error && oError.error.message) {
                sMessage = typeof oError.error.message === "object" ? (oError.error.message.value || sMessage) : oError.error.message;
            }

            switch (iStatus) {
                case 400:
                    return {
                        title: "Invalid Input",
                        message: sMessage
                    };
                case 401:
                    return {
                        title: "Authentication Failed",
                        message: "Your session is unauthenticated or has expired. Please log in again."
                    };
                case 403:
                    return {
                        title: "Authorization Denied",
                        message: sMessage || "You do not have permission to create Purchase Orders in this Purchasing Organization or Group."
                    };
                case 404:
                    return {
                        title: "Resource Not Found",
                        message: sMessage || "One or more referenced master data records (Supplier, Material, Plant) were not found in SAP."
                    };
                case 409:
                    return {
                        title: "Document Locked / Conflict",
                        message: sMessage || "The purchasing record or supplier is currently locked in SAP S/4HANA by another process. Please retry shortly."
                    };
                case 422:
                    return {
                        title: "Business Validation Error",
                        message: sMessage
                    };
                case 502:
                case 503:
                    return {
                        title: "S/4HANA Backend Unavailable",
                        message: "The SAP S/4HANA backend system is currently unreachable. Please check connectivity or destination configuration."
                    };
                case 500:
                default:
                    return {
                        title: "Application Error",
                        message: sMessage
                    };
            }
        },

        onCreatePress: function () {
            var oModel = this.getView().getModel("newPO");
            var oData = oModel.getData();
            var that = this;

            // 1. Immediate Fiori Client-Side Validation UX
            var oValidationResult = PurchaseOrderModel.validateForm(oModel);
            if (!oValidationResult.isValid) {
                // Open MessagePopover attached to footer alert button
                that._openMessagePopover();

                // Focus first invalid field
                if (oValidationResult.errorList && oValidationResult.errorList.length > 0) {
                    that._navigateToErrorTarget(oValidationResult.errorList[0]);
                }
                return;
            }

            // 2. Submit to Backend
            BusyIndicator.show(0);

            // Clean UI-only fields from payload before submitting to backend
            var oCleanHeader = Object.assign({}, oData.header);
            delete oCleanHeader.StatusText;
            delete oCleanHeader.StatusState;
            delete oCleanHeader.StatusIcon;
            delete oCleanHeader.PurchasingCompletenessStatus;

            var aCleanItems = (oData.items || []).map(function(item) {
                var oCleanItem = Object.assign({}, item);
                delete oCleanItem.errors;
                return oCleanItem;
            });

            PurchaseOrderService.createPurchaseOrder({
                header: oCleanHeader,
                items: aCleanItems
            })
                .then(function (sNewPO) {
                    BusyIndicator.hide();
                    MessageToast.show("Purchase Order Created: " + sNewPO);
                    that.onNavBack();
                })
                .catch(function (oError) {
                    BusyIndicator.hide();
                    var oErrResult = PurchaseOrderModel.applyBackendErrors(oModel, oError);

                    // Open MessagePopover with all backend error details
                    that._openMessagePopover();

                    // Auto-focus first affected field
                    if (oErrResult.errorList && oErrResult.errorList.length > 0) {
                        that._navigateToErrorTarget(oErrResult.errorList[0]);
                    }

                    // For critical infrastructure / network error (502, 503, 401), also show diagnostic dialog
                    var iStatus = (oError && oError.status) || 500;
                    if (iStatus === 502 || iStatus === 503 || iStatus === 401) {
                        var oErrConfig = that._getErrorMessageConfig(oError);
                        MessageBox.error(oErrConfig.message, {
                            title: oErrConfig.title,
                            details: (oError && (oError.rawResponse || oError.message)) || ""
                        });
                    }
                });
        },

        onExit: function () {
            if (this._oMessagePopover) {
                this._oMessagePopover.destroy();
                this._oMessagePopover = null;
            }
        }
    });
});
