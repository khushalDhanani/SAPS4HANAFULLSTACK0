sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/MessagePopover",
    "sap/m/MessageItem",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/mm/purchase-order/model/PurchaseOrderModel",
    "saps4hana/fiori/service/ValueHelpService",
    "saps4hana/fiori/modules/mm/purchase-order/service/PurchaseOrderService"
], function (BaseController, MessageBox, MessageToast, MessagePopover, MessageItem, BusyIndicator, Filter, FilterOperator, PurchaseOrderModel, ValueHelpService, PurchaseOrderService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.mm.purchase-order.controller.CreatePurchaseOrder", {
        onInit: function () {
            PurchaseOrderModel.setTextResolver(this.getText.bind(this));
            this._resetModel(false);
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("createPurchaseOrder").attachPatternMatched(this._onRouteMatched, this);
        },

        /**
         * Resolves default document type and text from configuration or model constant.
         * @returns {{ code: string, text: string }}
         */
        _getDefaultDocType: function () {
            return PurchaseOrderModel.getDefaultDocType(this._oConfigData);
        },

        _resetModel: function (bLoadConfig) {
            var oOwnerComponent = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var sUser = PurchaseOrderModel.getCurrentUserName(oOwnerComponent);
            var oModel = PurchaseOrderModel.createInitialModel(sUser);
            this.getView().setModel(oModel, "newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (this._oMessagePopover) {
                this._oMessagePopover.close();
            }
            if (bLoadConfig) {
                this._loadConfigurationAndDefaults();
            }
        },

        /**
         * Loads configuration data (document types, company codes, purchasing orgs, groups)
         * from SAP S/4HANA / CAP backend.
         * Applies any cached configuration immediately for instant responsiveness, then refetches
         * fresh configuration asynchronously on every route entry so server-side configuration changes
         * are reflected without requiring a full application reload.
         *
         * @param {boolean} [bForce=false] - If true, ignores cache and forces a fresh network load
         * @returns {Promise<Object>}
         */
        _loadConfigurationAndDefaults: function (bForce) {
            var that = this;
            var oModel = this.getView().getModel("newPO");

            // Optimistically apply existing configuration while refetching in background
            if (this._oConfigData && !bForce) {
                PurchaseOrderModel.applyConfigurationDefaults(oModel, this._oConfigData);
                PurchaseOrderModel.updateStatus(oModel);
            }

            var oPoModel = this.getModel();
            return PurchaseOrderService.loadConfiguration(oPoModel).then(function (oConfigData) {
                that._oConfigData = oConfigData;
                var oCurrentModel = that.getView().getModel("newPO");
                if (oCurrentModel) {
                    PurchaseOrderModel.applyConfigurationDefaults(oCurrentModel, oConfigData);
                    PurchaseOrderModel.updateStatus(oCurrentModel);
                    that._refreshSupplierBinding();
                    that._refreshCompanyCodeBinding();
                }
                return oConfigData;
            }).catch(function (err) {
                console.warn("[CreatePurchaseOrder] Error loading config data:", err);
                return that._oConfigData || null;
            });
        },

        _onRouteMatched: function () {
            this._resetModel(true);
        },

        onHeaderChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        /**
         * Lightweight liveChange handler for the Document Type input.
         * Delegates domain validation to PurchaseOrderModel.
         */
        onDocTypeLiveChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            PurchaseOrderModel.updateDocTypeLive(oModel, sVal);
        },

        /**
         * Full change handler for the Document Type input (fires on blur / Enter).
         * Delegates domain validation, default recovery, and error state tracking to PurchaseOrderModel.
         */
        onDocTypeChange: function (oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            var sCurrentVal = sVal !== null && sVal !== undefined ? sVal : (oModel.getProperty("/header/PurchaseOrderType") || "");
            PurchaseOrderModel.setDocumentType(oModel, sCurrentVal, this._oConfigData);
            this._onDocTypeSelectedCheck(sCurrentVal);
        },

        /**
         * Handles suggestion selection for Document Type.
         * Delegates domain setting and validation to PurchaseOrderModel.
         */
        onDocTypeSelect: function (oEvent) {
            var oItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("selectedItem") : null;
            if (oItem) {
                var sKey = (typeof oItem.getKey === "function" && oItem.getKey()) || (typeof oItem.getText === "function" && oItem.getText()) || "";
                var sText = (typeof oItem.getAdditionalText === "function" && oItem.getAdditionalText()) || (typeof oItem.getText === "function" && oItem.getText()) || "";
                var oModel = this.getView().getModel("newPO");
                PurchaseOrderModel.setDocumentType(oModel, sKey, this._oConfigData, sText);
                this._onDocTypeSelectedCheck(sKey);
            }
        },

        onDocDateChange: function () {
            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.markUserModified(oModel, "DocumentDate", true);
            PurchaseOrderModel.validateSingleField(oModel, "DocumentDate");
            PurchaseOrderModel.updateStatus(oModel);
        },

        /**
         * Generic field change helper for header fields.
         * Marks field as user-modified, validates cross-field dependencies (CompanyCode/PurchOrg),
         * validates the field, and updates overall form status.
         *
         * @param {string} sField - Header field key (e.g. 'CompanyCode', 'Currency')
         * @param {sap.ui.base.Event} [oEvent] - UI5 change event
         */
        _onFieldChange: function (sField, oEvent) {
            var oModel = this.getView().getModel("newPO");
            var sVal = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("value") : null;
            if (sVal !== null && sVal !== undefined) {
                PurchaseOrderModel.markUserModified(oModel, sField, true);
            } else {
                PurchaseOrderModel.markUserModified(oModel, sField, true);
            }
            if ((sField === "CompanyCode" || sField === "PurchasingOrganization") && this._oConfigData) {
                PurchaseOrderModel.validateCompanyCodePurchasingOrg(oModel, this._oConfigData);
            }
            if (sField === "CompanyCode") {
                this._refreshSupplierBinding();
            }
            PurchaseOrderModel.validateSingleField(oModel, sField);
            PurchaseOrderModel.updateStatus(oModel);
        },

        /**
         * Generic field suggestion selection helper for header fields.
         * Sets the selected key on the model header, marks field as modified, and runs field change validation.
         *
         * @param {string} sField - Header field key (e.g. 'CompanyCode', 'Currency')
         * @param {sap.ui.base.Event} oEvent - UI5 suggestionItemSelected event
         */
        _onFieldSelect: function (sField, oEvent) {
            var oItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("selectedItem") : null;
            if (oItem) {
                var sKey = (typeof oItem.getKey === "function" && oItem.getKey()) || (typeof oItem.getText === "function" && oItem.getText()) || "";
                var oModel = this.getView().getModel("newPO");
                oModel.setProperty("/header/" + sField, sKey);
                PurchaseOrderModel.markUserModified(oModel, sField, true);
                this._onFieldChange(sField);
            }
        },

        onCompanyCodeChange: function (oEvent) { this._onFieldChange("CompanyCode", oEvent); },
        onCompanyCodeSelect: function (oEvent) { this._onFieldSelect("CompanyCode", oEvent); },

        onPurchOrgChange: function (oEvent) { this._onFieldChange("PurchasingOrganization", oEvent); },
        onPurchOrgSelect: function (oEvent) { this._onFieldSelect("PurchasingOrganization", oEvent); },

        onPurchGrpChange: function (oEvent) { this._onFieldChange("PurchasingGroup", oEvent); },
        onPurchGrpSelect: function (oEvent) { this._onFieldSelect("PurchasingGroup", oEvent); },

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
                    if (oDefaults.source === "lookup failed") {
                        MessageToast.show(that.getText("poMsgSupplierHistoryFailed", null, "Supplier history could not be read from SAP. Enter currency, payment terms and Incoterms manually."));
                        return;
                    }
                    var oReport = PurchaseOrderModel.deriveSupplierDefaults(oModel, sSupplier, oDefaults);
                    if (oReport && oReport.applied && Object.keys(oReport.applied).length > 0) {
                        var aAppliedFields = Object.keys(oReport.applied).map(function (k) {
                            return k + ": " + oReport.applied[k];
                        });
                        var sSourceInfo = oReport.source ? (" (" + oReport.source + ")") : that.getText("poMsgSupplierDefaultsFromLastPO", null, " (from last PO)");
                        MessageToast.show(that.getText("poMsgSupplierDefaultsApplied", [sSourceInfo, aAppliedFields.join(", ")], "Supplier defaults applied" + sSourceInfo + ": " + aAppliedFields.join(", ")));
                    }
                })
                .catch(function (err) {
                    console.warn("[CreatePurchaseOrder] Could not derive supplier defaults:", err);
                });
        },

        onCurrencyChange: function (oEvent) { this._onFieldChange("Currency", oEvent); },
        onCurrencySelect: function (oEvent) { this._onFieldSelect("Currency", oEvent); },

        onPaymentTermsChange: function (oEvent) { this._onFieldChange("PaymentTerms", oEvent); },
        onPaymentTermsSelect: function (oEvent) { this._onFieldSelect("PaymentTerms", oEvent); },

        onIncotermsChange: function (oEvent) { this._onFieldChange("IncotermsClassification", oEvent); },
        onIncotermsSelect: function (oEvent) { this._onFieldSelect("IncotermsClassification", oEvent); },

        onIncotermsLocChange: function (oEvent) { this._onFieldChange("IncotermsLocation1", oEvent); },

        onItemMaterialChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oContext = oSource.getBindingContext("newPO");
            if (!oContext) return;

            var sVal = oSource.getValue();
            var oModel = this.getView().getModel("newPO");
            var sPath = oContext.getPath();
            var sPlant = oModel.getProperty(sPath + "/Plant") || "";

            if (!sVal || sVal.trim() === "") {
                oModel.setProperty(sPath + "/errors/Material", {
                    state: "Error",
                    text: this.getText("poValMaterialRequired", null, "Material is required")
                });
            } else {
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
                // Directly retrieve and set Unit and master data from S/4HANA material configuration on manual input
                var that = this;
                var oPoModel = this.getModel();
                PurchaseOrderService.getMaterialDetails(oPoModel, sVal, sPlant).then(function (oMaterial) {
                    if (oMaterial) {
                        PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMaterial, true);
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
            var sPlant = oModel.getProperty(sPath + "/Plant") || "";

            var oBindingCtx = oItem.getBindingContext();
            var oMaterialData = null;
            if (oBindingCtx) {
                try {
                    oMaterialData = oBindingCtx.getObject();
                } catch (e) {
                    oMaterialData = null;
                }
                if (!oMaterialData || typeof oMaterialData !== "object") {
                    oMaterialData = {
                        Material: oBindingCtx.getProperty("Material") || sKey,
                        MaterialName: oBindingCtx.getProperty("MaterialName") || oBindingCtx.getProperty("Material_Text") || "",
                        MaterialBaseUnit: oBindingCtx.getProperty("MaterialBaseUnit"),
                        Plant: oBindingCtx.getProperty("Plant"),
                        MaterialGroup: oBindingCtx.getProperty("MaterialGroup")
                    };
                }
            }

            if (oMaterialData && oMaterialData.Material) {
                PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMaterialData, true);
            } else {
                oModel.setProperty(sPath + "/Material", sKey);
                oModel.setProperty(sPath + "/errors/Material", { state: "None", text: "" });
            }

            // Ensure Unit and master data is derived from S/4HANA if not already present
            var that = this;
            if (!oMaterialData || !oMaterialData.MaterialBaseUnit || !oMaterialData.MaterialGroup) {
                var oPoModel = this.getModel();
                PurchaseOrderService.getMaterialDetails(oPoModel, sKey, sPlant).then(function (oMat) {
                    if (oMat) {
                        PurchaseOrderModel.applyMaterialDefaults(oModel, sPath, oMat, true);
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

        /**
         * Resolves a promise when the given control has a valid DOM reference.
         * If the control is already rendered, resolves immediately without waiting.
         * Otherwise attaches a one-time onAfterRendering event delegate.
         * @param {sap.ui.core.Control} oControl The control to wait for
         * @returns {Promise<sap.ui.core.Control>}
         */
        _whenRendered: function (oControl) {
            return new Promise(function (resolve) {
                if (!oControl) {
                    resolve(null);
                    return;
                }
                var oDomRef = typeof oControl.getDomRef === "function" ? oControl.getDomRef() : null;
                if (oDomRef) {
                    resolve(oControl);
                    return;
                }
                if (typeof oControl.addEventDelegate === "function") {
                    var iFallbackTimer;
                    var oDelegate = {
                        onAfterRendering: function () {
                            if (iFallbackTimer) {
                                clearTimeout(iFallbackTimer);
                            }
                            if (typeof oControl.removeEventDelegate === "function") {
                                oControl.removeEventDelegate(oDelegate);
                            }
                            resolve(oControl);
                        }
                    };
                    oControl.addEventDelegate(oDelegate);
                    // Fail-safe timeout in case the control is never rendered (e.g. destroyed or kept hidden)
                    iFallbackTimer = setTimeout(function () {
                        if (typeof oControl.removeEventDelegate === "function") {
                            oControl.removeEventDelegate(oDelegate);
                        }
                        resolve(oControl);
                    }, 500);
                } else {
                    // Fallback for mock/test objects without addEventDelegate
                    resolve(oControl);
                }
            });
        },

        /**
         * Focuses and smoothly scrolls the given control into view once its DOM is ready.
         * @param {sap.ui.core.Control} oControl
         */
        _focusAndScrollIntoView: function (oControl) {
            if (!oControl) return;
            this._whenRendered(oControl).then(function (oRenderedControl) {
                if (!oRenderedControl) return;
                if (typeof oRenderedControl.focus === "function") {
                    oRenderedControl.focus();
                }
                var oDomRef = typeof oRenderedControl.getDomRef === "function" ? oRenderedControl.getDomRef() : null;
                if (oDomRef && typeof oDomRef.scrollIntoView === "function") {
                    oDomRef.scrollIntoView({ behavior: "smooth", block: "center" });
                }
            });
        },

        _openMessagePopover: function () {
            var oBtn = this.byId("btnMessages");
            if (!oBtn) return;
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            var that = this;
            this._whenRendered(oBtn).then(function (oButtonControl) {
                if (oButtonControl && that._oMessagePopover && !that._oMessagePopover.isOpen()) {
                    var oDom = typeof oButtonControl.getDomRef === "function" ? oButtonControl.getDomRef() : null;
                    if (oDom || typeof that._oMessagePopover.openBy === "function") {
                        that._oMessagePopover.openBy(oButtonControl);
                    }
                }
            });
        },

        _navigateToErrorTarget: function (oError) {
            if (!oError) return;

            var that = this;
            // 1. Header input targeting by control ID
            if (typeof oError.controlId === "string" && oError.controlId !== "poItemsTable") {
                var oControl = this.byId(oError.controlId);
                if (oControl) {
                    this._focusAndScrollIntoView(oControl);
                    return;
                }
            }

            // 2. Line Item Table cell targeting
            var oTable = this.byId("poItemsTable");
            if (oTable) {
                this._whenRendered(oTable).then(function (oRenderedTable) {
                    if (!oRenderedTable) return;
                    var iItemIndex = oError.itemIndex !== undefined ? oError.itemIndex : 0;
                    var aTableItems = typeof oRenderedTable.getItems === "function" ? oRenderedTable.getItems() : [];
                    if (aTableItems && aTableItems[iItemIndex]) {
                        var oRow = aTableItems[iItemIndex];
                        var aCells = typeof oRow.getCells === "function" ? oRow.getCells() : [];
                        var iCellIndex = oError.cellIndex !== undefined ? oError.cellIndex : 1;
                        var oTargetCell = aCells[iCellIndex] || oRow;
                        that._focusAndScrollIntoView(oTargetCell);
                    }
                });
            }
        },

        onMessageButtonPress: function (oEvent) {
            var oSource = oEvent ? oEvent.getSource() : this.byId("btnMessages");
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            this._oMessagePopover.toggle(oSource);
        },

        /**
         * Robustly resolves the logical field name from an event source control.
         * Priority:
         * 1. Declarative customData: data("field") or data-field
         * 2. Bound property path on 'value'
         * 3. Precise Control ID lookup table
         *
         * @param {sap.ui.core.Control} oSource
         * @returns {string} Logical field name (e.g. 'Material', 'CompanyCode', 'PurchaseOrderType')
         */
        _resolveSourceField: function (oSource) {
            if (!oSource) return "";

            // 1. Declarative customData: data("field")
            if (typeof oSource.data === "function") {
                var sCustomDataField = oSource.data("field");
                if (sCustomDataField && typeof sCustomDataField === "string") {
                    return sCustomDataField.trim();
                }
            }

            // 2. Bound property path on 'value'
            if (typeof oSource.getBindingPath === "function") {
                var sPath = oSource.getBindingPath("value");
                if (sPath) {
                    var sClean = sPath.split("/").pop();
                    if (sClean) {
                        return sClean;
                    }
                }
            }

            // 3. Precise Control ID lookup table
            var sId = (typeof oSource.getId === "function" ? oSource.getId() : "") || "";
            var sControlName = sId.indexOf("--") !== -1 ? sId.split("--").pop() : sId;

            var FIELD_ID_MAP = {
                "inDocType": "PurchaseOrderType",
                "inCompanyCode": "CompanyCode",
                "inPurchOrg": "PurchasingOrganization",
                "inPurchGrp": "PurchasingGroup",
                "inSupplier": "Supplier",
                "inCurrency": "Currency",
                "inPaymentTerms": "PaymentTerms",
                "inIncoterms": "IncotermsClassification",
                "inIncotermsLoc": "IncotermsLocation1",
                "inDocDate": "DocumentDate"
            };

            return FIELD_ID_MAP[sControlName] || sControlName;
        },

        _buildContextFilters: function (oSource) {
            var aFilters = [];
            var oModel = this.getView().getModel("newPO");
            if (!oModel || !oSource) return aFilters;

            var sField = this._resolveSourceField(oSource);
            var oRowContext = typeof oSource.getBindingContext === "function" ? oSource.getBindingContext("newPO") : null;

            if (oRowContext) {
                // Line item row context
                if (sField === "Material" || sField === "StorageLocation") {
                    var sPlant = oRowContext.getProperty("Plant");
                    if (sPlant && String(sPlant).trim() !== "") {
                        aFilters.push(new Filter("Plant", FilterOperator.EQ, String(sPlant).trim()));
                    }
                } else if (sField === "Plant") {
                    var sPurchOrg = oModel.getProperty("/header/PurchasingOrganization");
                    if (sPurchOrg && String(sPurchOrg).trim() !== "") {
                        aFilters.push(new Filter("PurchasingOrganization", FilterOperator.EQ, String(sPurchOrg).trim()));
                    }
                }
            } else {
                // Header fields
                if (sField === "PurchaseOrderType" || sField === "PurchaseOrderTypeText") {
                    aFilters.push(new Filter("PurchasingDocumentType", FilterOperator.StartsWith, "Z"));
                } else if (sField === "CompanyCode") {
                    var sDocTypeComp = oModel.getProperty("/header/PurchaseOrderType");
                    if (sDocTypeComp && String(sDocTypeComp).trim().toUpperCase() === "ZDOM") {
                        aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, "1000"));
                    }
                } else if (sField === "Supplier") {
                    var sCompanyCode = oModel.getProperty("/header/CompanyCode");
                    if (sCompanyCode && String(sCompanyCode).trim() !== "") {
                        aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, String(sCompanyCode).trim()));
                    }
                    var sDocType = oModel.getProperty("/header/PurchaseOrderType");
                    if (sDocType && String(sDocType).trim().toUpperCase() === "ZDOM") {
                        aFilters.push(new Filter("SupplierAccountGroup", FilterOperator.EQ, "ZDOM"));
                    }
                } else if (sField === "PurchasingOrganization") {
                    var sCompanyCode = oModel.getProperty("/header/CompanyCode");
                    if (sCompanyCode && String(sCompanyCode).trim() !== "") {
                        aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, String(sCompanyCode).trim()));
                    }
                }
            }

            return aFilters;
        },

        /**
         * Re-applies active contextual filters (e.g. CompanyCode, SupplierAccountGroup for ZDOM)
         * to the inSupplier suggestion items binding so autocomplete suggestions strictly reflect
         * the current document type context.
         * @private
         */
        _refreshSupplierBinding: function () {
            var oSupplierInput = typeof this.byId === "function" ? this.byId("inSupplier") : null;
            if (oSupplierInput && typeof oSupplierInput.getBinding === "function") {
                var oBinding = oSupplierInput.getBinding("suggestionItems");
                if (oBinding && typeof oBinding.filter === "function") {
                    var aFilters = this._buildContextFilters(oSupplierInput);
                    oBinding.filter(aFilters);
                }
            }
        },

        /**
         * Re-applies active contextual filters (e.g. CompanyCode eq 1000 for ZDOM)
         * to the inCompanyCode suggestion items binding so autocomplete suggestions strictly reflect
         * the current document type context.
         * @private
         */
        _refreshCompanyCodeBinding: function () {
            var oCompanyInput = typeof this.byId === "function" ? this.byId("inCompanyCode") : null;
            if (oCompanyInput && typeof oCompanyInput.getBinding === "function") {
                var oBinding = oCompanyInput.getBinding("suggestionItems");
                if (oBinding && typeof oBinding.filter === "function") {
                    var aFilters = this._buildContextFilters(oCompanyInput);
                    oBinding.filter(aFilters);
                }
            }
        },

        /**
         * Checks supplier and company validity against the newly selected document type.
         * If ZDOM is selected and the supplier is known to be non-domestic, displays a warning.
         * If ZDOM is selected and the company code is not 1000, displays a warning.
         * @param {string} sDocType
         * @private
         */
        _onDocTypeSelectedCheck: function (sDocType) {
            this._refreshSupplierBinding();
            this._refreshCompanyCodeBinding();
            var oModel = this.getView().getModel("newPO");
            if (!oModel) return;
            var sCleanDocType = String(sDocType || "").trim().toUpperCase();
            if (sCleanDocType === "ZDOM") {
                var sExistingSupplier = oModel.getProperty("/header/Supplier");
                var sExistingAccountGroup = oModel.getProperty("/header/SupplierAccountGroup");
                if (sExistingSupplier && sExistingAccountGroup && sExistingAccountGroup !== "ZDOM") {
                    PurchaseOrderModel.setFieldValidation(
                        oModel,
                        "Supplier",
                        "Warning",
                        this.getText("poValSupplierNotDomestic", null, "Selected supplier is not a domestic supplier. Please choose a domestic supplier for document type ZDOM.")
                    );
                }
                var sExistingCoCode = oModel.getProperty("/header/CompanyCode");
                if (sExistingCoCode && sExistingCoCode !== "1000") {
                    PurchaseOrderModel.setFieldValidation(
                        oModel,
                        "CompanyCode",
                        "Warning",
                        this.getText("poValCompanyCodeNotDomestic", null, "Selected Company Code is not a domestic company for document type ZDOM (expected 1000 - Aether Industries Limited).")
                    );
                }
            }
        },

        onValueHelpRequest: function (oEvent) {
            var oSource = oEvent.getSource();
            var that = this;
            var aInitialFilters = this._buildContextFilters(oSource);

            ValueHelpService.openValueHelp(this.getView(), oSource, function (sKey, oSelectedItem, oData) {
                that._handleValueHelpSelected(oSource, sKey, oSelectedItem, oData);
            }, aInitialFilters);
        },

        _handleValueHelpSelected: function (oSource, sKey, oSelectedItem, oData) {
            if (!oSource || !sKey) return;
            var sField = this._resolveSourceField(oSource);
            var oRowContext = typeof oSource.getBindingContext === "function" ? oSource.getBindingContext("newPO") : null;
            var oModel = this.getView().getModel("newPO");

            // Line items table fields
            if (oRowContext) {
                var sRowPath = oRowContext.getPath();

                switch (sField) {
                    case "Material":
                        var sPlant = oModel.getProperty(sRowPath + "/Plant") || "";
                        var oMatData = oData || {
                            Material: sKey,
                            MaterialName: (oSelectedItem && oSelectedItem.getDescription && oSelectedItem.getDescription()) || ""
                        };
                        PurchaseOrderModel.applyMaterialDefaults(oModel, sRowPath, oMatData, true);
                        var that = this;
                        if (!oData || !oData.MaterialBaseUnit || !oData.MaterialGroup) {
                            var oPoModel = this.getModel();
                            PurchaseOrderService.getMaterialDetails(oPoModel, sKey, sPlant).then(function (oMat) {
                                if (oMat) {
                                    PurchaseOrderModel.applyMaterialDefaults(oModel, sRowPath, oMat, true);
                                    that.onItemFieldChange();
                                }
                            });
                        }
                        this.onItemFieldChange();
                        break;

                    case "UnitOfMeasure":
                    case "Plant":
                    case "StorageLocation":
                    case "TaxCode":
                        oModel.setProperty(sRowPath + "/" + sField, sKey);
                        oModel.setProperty(sRowPath + "/errors/" + sField, { state: "None", text: "" });
                        this.onItemFieldChange();
                        break;
                }
                return;
            }

            // Header fields
            switch (sField) {
                case "PurchaseOrderType":
                    var oDefaultDoc = this._getDefaultDocType();
                    var sDocText = (oSelectedItem && typeof oSelectedItem.getDescription === "function" && oSelectedItem.getDescription()) ||
                                   (oSelectedItem && typeof oSelectedItem.getTitle === "function" && oSelectedItem.getTitle()) ||
                                   (oData && (oData.PurchasingDocumentType_Text || oData.PurchasingDocumentType)) ||
                                   (sKey === oDefaultDoc.code ? oDefaultDoc.text : sKey);
                    PurchaseOrderModel.setDocumentType(oModel, sKey, this._oConfigData, sDocText);
                    this._onDocTypeSelectedCheck(sKey);
                    break;

                case "Supplier":
                    oModel.setProperty("/header/Supplier", sKey);
                    PurchaseOrderModel.markUserModified(oModel, "Supplier", true);
                    if (oData && oData.CompanyCode && !oModel.getProperty("/header/CompanyCode")) {
                        oModel.setProperty("/header/CompanyCode", oData.CompanyCode);
                    }
                    if (oData && oData.SupplierAccountGroup) {
                        oModel.setProperty("/header/SupplierAccountGroup", oData.SupplierAccountGroup);
                    }
                    this.onSupplierChange(sKey);
                    break;

                case "CompanyCode":
                    oModel.setProperty("/header/" + sField, sKey);
                    PurchaseOrderModel.markUserModified(oModel, sField, true);
                    this._onFieldChange(sField);
                    this._refreshSupplierBinding();
                    break;
                case "PurchasingOrganization":
                case "PurchasingGroup":
                case "Currency":
                case "PaymentTerms":
                case "IncotermsClassification":
                case "IncotermsLocation1":
                    oModel.setProperty("/header/" + sField, sKey);
                    PurchaseOrderModel.markUserModified(oModel, sField, true);
                    this._onFieldChange(sField);
                    break;
            }
        },

        onSuggest: function (oEvent) {
            var oSource = oEvent.getSource();
            var sValue = oEvent.getParameter("suggestValue");
            var aContextFilters = this._buildContextFilters(oSource);
            var sField = this._resolveSourceField(oSource);
            var oDefaultDoc = this._getDefaultDocType();

            if (sField === "PurchaseOrderType" && sValue === oDefaultDoc.code) {
                sValue = "";
            }

            ValueHelpService.applySuggestionFilter(oSource, sValue, aContextFilters);
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
            var oItem = oEvent && typeof oEvent.getParameter === "function" ? oEvent.getParameter("listItem") : null;
            if (!oItem) {
                return;
            }
            var oContext = typeof oItem.getBindingContext === "function" ? oItem.getBindingContext("newPO") : null;
            if (!oContext || typeof oContext.getPath !== "function") {
                return;
            }

            var sPath = oContext.getPath();
            var aParts = sPath ? sPath.split("/") : [];
            var iIndex = aParts.length > 2 ? parseInt(aParts[2], 10) : NaN;
            if (isNaN(iIndex) || iIndex < 0) {
                return;
            }

            var oModel = this.getView().getModel("newPO");
            PurchaseOrderModel.deleteItem(oModel, iIndex);
            PurchaseOrderModel.updateStatus(oModel);
            if (oModel.getProperty("/hasError")) {
                PurchaseOrderModel.validateForm(oModel);
            }
        },

        onCalculateNetAmount: function (oEvent) {
            var oSource = oEvent && typeof oEvent.getSource === "function" ? oEvent.getSource() : null;
            var oContext = oSource && typeof oSource.getBindingContext === "function" ? oSource.getBindingContext("newPO") : null;
            if (!oContext || typeof oContext.getPath !== "function") {
                return;
            }

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
            var sMessage = (oError && oError.message) || "";

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
                        title: this.getText("poErrTitleInvalidInput", null, "Invalid Input"),
                        message: sMessage || this.getText("poErrTitleInvalidInput", null, "Invalid Input")
                    };
                case 401:
                    return {
                        title: this.getText("poErrTitleAuthFailed", null, "Authentication Failed"),
                        message: this.getText("poErrMsgAuthFailed", null, "Your session is unauthenticated or has expired. Please log in again.")
                    };
                case 403:
                    return {
                        title: this.getText("poErrTitleAuthDenied", null, "Authorization Denied"),
                        message: sMessage || this.getText("poErrMsgAuthDenied", null, "You do not have permission to create Purchase Orders in this Purchasing Organization or Group.")
                    };
                case 404:
                    return {
                        title: this.getText("poErrTitleNotFound", null, "Resource Not Found"),
                        message: sMessage || this.getText("poErrMsgNotFound", null, "One or more referenced master data records (Supplier, Material, Plant) were not found in SAP.")
                    };
                case 409:
                    return {
                        title: this.getText("poErrTitleLocked", null, "Document Locked / Conflict"),
                        message: sMessage || this.getText("poErrMsgLocked", null, "The purchasing record or supplier is currently locked in SAP S/4HANA by another process. Please retry shortly.")
                    };
                case 422:
                    return {
                        title: this.getText("poErrTitleValidation", null, "Business Validation Error"),
                        message: sMessage
                    };
                case 502:
                case 503:
                    return {
                        title: this.getText("poErrTitleUnavailable", null, "S/4HANA Backend Unavailable"),
                        message: this.getText("poErrMsgUnavailable", null, "The SAP S/4HANA backend system is currently unreachable. Please check connectivity or destination configuration.")
                    };
                case 500:
                default:
                    return {
                        title: this.getText("poErrTitleAppError", null, "Application Error"),
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
            delete oCleanHeader.PurchaseOrderTypeText;
            delete oCleanHeader.StatusText;
            delete oCleanHeader.StatusState;
            delete oCleanHeader.StatusIcon;
            delete oCleanHeader.PurchasingCompletenessStatus;

            var aCleanItems = (oData.items || []).map(function(item) {
                var oCleanItem = Object.assign({}, item);
                delete oCleanItem.errors;
                delete oCleanItem.NetAmountIsEstimate;
                return oCleanItem;
            });

            PurchaseOrderService.createPurchaseOrder({
                header: oCleanHeader,
                items: aCleanItems
            })
                .then(function (sNewPO) {
                    BusyIndicator.hide();
                    MessageToast.show(that.getText("poMsgCreatedSuccess", [sNewPO], "Purchase Order Created: " + sNewPO));
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
            PurchaseOrderModel.setTextResolver(null);
            this._oConfigData = null;
            if (this._oMessagePopover) {
                this._oMessagePopover.destroy();
                this._oMessagePopover = null;
            }
        }
    });
});
