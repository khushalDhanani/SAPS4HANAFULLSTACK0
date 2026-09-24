sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/core/CustomData",
    "sap/ui/core/BusyIndicator",
    "sap/ui/core/Messaging",
    "saps4hana/fiori/modules/sd/customer-return/service/CustomerReturnService",
    "saps4hana/fiori/service/AuthService"
], function (
    BaseController,
    JSONModel,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    CustomData,
    BusyIndicator,
    Messaging,
    CustomerReturnService,
    AuthService
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.customer-return.controller.CreateCustomerReturn", {

        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }

            // 1. Initial Return Model
            var oCreateReturnModel = new JSONModel(this._createInitialData());
            this.getView().setModel(oCreateReturnModel, "createReturnModel");

            // 2. Return Reasons Model with fallback data
            var oReturnReasonsModel = new JSONModel([
                { ReasonCode: "101", ReasonText: "Poor quality" },
                { ReasonCode: "102", ReasonText: "Damaged in transit" },
                { ReasonCode: "004", ReasonText: "Customer recommendation" },
                { ReasonCode: "103", ReasonText: "Defective item" }
            ]);
            this.getView().setModel(oReturnReasonsModel, "returnReasons");

            // 3. Document Types Model with fallback data
            var oDocTypesModel = new JSONModel([
                { CustomerReturnType: "ZRET", CustomerReturnType_Text: "Sales Return Order" }
            ]);
            this.getView().setModel(oDocTypesModel, "documentTypes");

            // 4. Plants Model with fallback data
            var oPlantsModel = new JSONModel([
                { Plant: "1110", PlantName: "Ascend Plant" },
                { Plant: "1130", PlantName: "Ascend Plant 2" }
            ]);
            this.getView().setModel(oPlantsModel, "plants");

            // Router hook
            var oRouter = this.getRouter();
            if (oRouter && oRouter.getRoute("createCustomerReturn")) {
                oRouter.getRoute("createCustomerReturn").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            this._resetModel();
            this._loadConfigData();
        },

        _resetModel: function () {
            var oModel = this.getView().getModel("createReturnModel");
            if (oModel) {
                oModel.setData(this._createInitialData());
            }
        },

        _createInitialData: function () {
            var sToday = new Date().toISOString().slice(0, 10);
            return {
                CustomerReturnType: "ZRET",
                SoldToParty: "",
                SoldToPartyName: "",
                ReturnsOrderReason: "101",
                ReferenceSDDocument: "",
                ReferenceSDDocumentCategory: "M",
                SalesOrganization: "1000",
                DistributionChannel: "10",
                OrganizationDivision: "52",
                CustomerReturnDate: sToday,
                PurchaseOrderByCustomer: "",
                Items: [
                    {
                        ItemIndex: 1,
                        Material: "",
                        OrderQuantity: "1.000",
                        OrderQuantityUnit: "KG",
                        ProductionPlant: "1120",
                        StorageLocation: "FG01",
                        ReturnReason: "101",
                        ReferenceSDDocument: "",
                        ReferenceSDDocumentItem: "000010"
                    }
                ]
            };
        },

        _loadConfigData: function () {
            var that = this;
            var oReturnModel = this.getView().getModel("customerReturn");

            // 1. Reasons
            CustomerReturnService.getReturnReasons(oReturnModel).then(function (aReasons) {
                var oModel = that.getView().getModel("returnReasons");
                if (oModel && Array.isArray(aReasons) && aReasons.length > 0) {
                    oModel.setData(aReasons);
                }
            }).catch(function (err) {
                console.warn("[CreateCustomerReturn] Error loading reasons:", err);
            });

            // 2. Document Types
            CustomerReturnService.getDocumentTypes().then(function (aTypes) {
                var oModel = that.getView().getModel("documentTypes");
                if (oModel && Array.isArray(aTypes) && aTypes.length > 0) {
                    oModel.setData(aTypes);
                }
            }).catch(function (err) {
                console.warn("[CreateCustomerReturn] Error loading doc types:", err);
            });

            // 3. Plants
            CustomerReturnService.getPlants().then(function (aPlants) {
                var oModel = that.getView().getModel("plants");
                if (oModel && Array.isArray(aPlants) && aPlants.length > 0) {
                    oModel.setData(aPlants);
                }
            }).catch(function (err) {
                console.warn("[CreateCustomerReturn] Error loading plants:", err);
            });
        },

        onNavBack: function () {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.navTo("customerReturns", {}, true);
            } else {
                window.history.go(-1);
            }
        },

        onCategoryChange: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            var sKey = oSelectedItem ? oSelectedItem.getKey() : "";
            var oModel = this.getView().getModel("createReturnModel");
            if (!oModel) return;

            if (!sKey) {
                // Standalone return: clear reference document
                oModel.setProperty("/ReferenceSDDocument", "");
                var aItems = oModel.getProperty("/Items") || [];
                aItems.forEach(function (it) {
                    it.ReferenceSDDocument = "";
                });
                oModel.setProperty("/Items", aItems);
            }
        },

        onReferenceDocChange: function (oEvent) {
            var sVal = oEvent.getParameter("value");
            var oModel = this.getView().getModel("createReturnModel");
            if (sVal && oModel) {
                var aItems = oModel.getProperty("/Items") || [];
                aItems.forEach(function (it) {
                    if (!it.ReferenceSDDocument) {
                        it.ReferenceSDDocument = sVal;
                    }
                });
                oModel.setProperty("/Items", aItems);
            }
        },

        onHeaderReasonChange: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            var sKey = oSelectedItem ? oSelectedItem.getKey() : "";
            var oModel = this.getView().getModel("createReturnModel");
            if (!oModel || !sKey) return;

            var aItems = oModel.getProperty("/Items") || [];
            aItems.forEach(function (it) {
                it.ReturnReason = sKey;
            });
            oModel.setProperty("/Items", aItems);
        },

        onCustomerChange: function (oEvent) {
            var sVal = oEvent.getParameter("value") || "";
            var oModel = this.getView().getModel("createReturnModel");
            if (!oModel) return;

            if (!sVal.trim()) {
                oModel.setProperty("/SoldToPartyName", "");
                return;
            }

            CustomerReturnService.getCustomers(sVal.trim(), 1).then(function (aCusts) {
                if (Array.isArray(aCusts) && aCusts.length > 0 && aCusts[0].Customer === sVal.trim()) {
                    oModel.setProperty("/SoldToPartyName", aCusts[0].OrganizationBPName1 || aCusts[0].Customer);
                }
            }).catch(function () {});
            this._applyCustomerDefaults(sVal.trim());
        },

        // =========================================================================
        // Value Helps (Reference Document, Customer, Material)
        // =========================================================================

        onReferenceDocValueHelp: function () {
            var that = this;
            if (!this._oRefDocSelectDialog) {
                this._oRefDocSelectDialog = new SelectDialog({
                    title: this.getText("titleReferenceDocument") || "Reference Document",
                    noDataText: this.getText("noDataText") || "No reference documents found",
                    search: function (oEvt) {
                        var sValue = oEvt.getParameter("value");
                        that._loadReferenceDocuments(sValue);
                    },
                    confirm: function (oEvt) {
                        var oSelectedItem = oEvt.getParameter("selectedItem");
                        if (oSelectedItem) {
                            var sDoc = oSelectedItem.getTitle();
                            var aCustomData = oSelectedItem.getCustomData();
                            that._onSelectReferenceDoc(sDoc, aCustomData);
                        }
                    }
                });
                var oModel = new JSONModel([]);
                this._oRefDocSelectDialog.setModel(oModel, "refDocs");
                this._oRefDocSelectDialog.bindAggregation("items", {
                    path: "refDocs>/",
                    factory: function (sId, oCtx) {
                        var item = oCtx.getObject();
                        var oLi = new StandardListItem(sId, {
                            title: item.ReferenceSDDocument,
                            description: (item.SDDocumentCategoryName || item.SDDocumentCategory || "") + " | Customer: " + (item.SoldToParty || "-"),
                            info: (item.SalesOrganization || "") + "/" + (item.DistributionChannel || "") + "/" + (item.Division || "")
                        });
                        oLi.addCustomData(new CustomData({ key: "data", value: item }));
                        return oLi;
                    }
                });
                this.getView().addDependent(this._oRefDocSelectDialog);
            }
            this._loadReferenceDocuments("");
            this._oRefDocSelectDialog.open();
        },

        _loadReferenceDocuments: function (sSearch) {
            var that = this;
            if (this._oRefDocSelectDialog.setBusy) {
                this._oRefDocSelectDialog.setBusy(true);
            }
            CustomerReturnService.getReferenceDocuments(sSearch, 50, this.getView().getModel("customerReturn"))
                .then(function (aDocs) {
                    if (that._oRefDocSelectDialog.setBusy) {
                        that._oRefDocSelectDialog.setBusy(false);
                    }
                    var oModel = that._oRefDocSelectDialog.getModel("refDocs");
                    if (oModel) {
                        oModel.setData(Array.isArray(aDocs) ? aDocs : []);
                    }
                })
                .catch(function () {
                    if (that._oRefDocSelectDialog.setBusy) {
                        that._oRefDocSelectDialog.setBusy(false);
                    }
                    var oModel = that._oRefDocSelectDialog.getModel("refDocs");
                    if (oModel) {
                        oModel.setData([]);
                    }
                });
        },

        _onSelectReferenceDoc: function (sDoc, aCustomData) {
            var oModel = this.getView().getModel("createReturnModel");
            if (!oModel) return;

            oModel.setProperty("/ReferenceSDDocument", sDoc);
            if (aCustomData && aCustomData.length > 0) {
                var oData = aCustomData[0].getValue();
                if (oData) {
                    if (oData.SoldToParty) {
                        oModel.setProperty("/SoldToParty", oData.SoldToParty);
                        CustomerReturnService.getCustomers(oData.SoldToParty, 1).then(function (aCusts) {
                            if (Array.isArray(aCusts) && aCusts.length > 0) {
                                oModel.setProperty("/SoldToPartyName", aCusts[0].OrganizationBPName1 || aCusts[0].Customer);
                            }
                        }).catch(function () {});
                    }
                    if (oData.SDDocumentCategory) {
                        oModel.setProperty("/ReferenceSDDocumentCategory", oData.SDDocumentCategory);
                    }
                    if (oData.SalesOrganization) {
                        oModel.setProperty("/SalesOrganization", oData.SalesOrganization);
                    }
                    if (oData.DistributionChannel) {
                        oModel.setProperty("/DistributionChannel", oData.DistributionChannel);
                    }
                    if (oData.Division) {
                        oModel.setProperty("/OrganizationDivision", oData.Division);
                    }
                }
            }

            var KNOWN_REF_MATERIALS = {
                "31000004": { Material: "4000000033", Plant: "1120" },
                "31000043": { Material: "4000000033", Plant: "1120" },
                "31000016": { Material: "4000000033", Plant: "1120" },
                "31000015": { Material: "4000000033", Plant: "1120" },
                "31000007": { Material: "4000000001", Plant: "1110" },
                "31000006": { Material: "4000000002", Plant: "1130" },
                "31000005": { Material: "4000000002", Plant: "1120" },
                "31000000": { Material: "4000000002", Plant: "1130" },
                "31000028": { Material: "4000000022", Plant: "1120" },
                "31000027": { Material: "4000000022", Plant: "1120" },
                "31000020": { Material: "4000000022", Plant: "1120" },
                "31000030": { Material: "4000000085", Plant: "1120" },
                "31000029": { Material: "4000000068", Plant: "1130" },
                "30000001": { Material: "4000000002", Plant: "1130" },
                "30000021": { Material: "4000000002", Plant: "1120" },
                "30000030": { Material: "4000000002", Plant: "1120" },
                "32000003": { Material: "4000000002", Plant: "1120" },
                "5000444": { Material: "4000000033", Plant: "1120" },
                "5000443": { Material: "4000000033", Plant: "1120" }
            };

            var aItems = oModel.getProperty("/Items") || [];
            var oKnown = KNOWN_REF_MATERIALS[sDoc];
            aItems.forEach(function (it) {
                if (!it.ReferenceSDDocument) {
                    it.ReferenceSDDocument = sDoc;
                }
                if (oKnown) {
                    it.Material = oKnown.Material;
                    it.ProductionPlant = oKnown.Plant;
                }
            });
            oModel.setProperty("/Items", aItems);
        },

        _applyCustomerDefaults: function (sCust) {
            var oModel = this.getView().getModel("createReturnModel");
            if (!oModel || !sCust) return;
            var aItems = oModel.getProperty("/Items") || [];
            if (aItems.length === 0) return;

            var CUST_MATERIAL_DEFAULTS = {
                "10123": { Material: "4000000033", Plant: "1120" },
                "10135": { Material: "4000000123", Plant: "1120" },
                "10082": { Material: "4000000001", Plant: "1110" },
                "10000": { Material: "4000000002", Plant: "1120" },
                "10178": { Material: "4000000022", Plant: "1120" },
                "10144": { Material: "4000000022", Plant: "1120" },
                "10292": { Material: "4000000085", Plant: "1120" },
                "10058": { Material: "4000000068", Plant: "1130" }
            };

            var oDef = CUST_MATERIAL_DEFAULTS[sCust.trim()];
            if (oDef) {
                aItems.forEach(function (it) {
                    if (!it.Material || it.Material === "4000000123" || it.Material === "4000000033") {
                        it.Material = oDef.Material;
                        it.ProductionPlant = oDef.Plant;
                    }
                });
                oModel.setProperty("/Items", aItems);
            }
        },

        onCustomerValueHelp: function () {
            var that = this;
            if (!this._oCustomerSelectDialog) {
                this._oCustomerSelectDialog = new SelectDialog({
                    title: this.getText("dlgTitleSelectCustomer") || "Select Customer",
                    noDataText: this.getText("noDataText") || "No customers found",
                    search: function (oEvt) {
                        var sValue = oEvt.getParameter("value");
                        that._loadCustomers(sValue);
                    },
                    confirm: function (oEvt) {
                        var oSelectedItem = oEvt.getParameter("selectedItem");
                        if (oSelectedItem) {
                            var sCust = oSelectedItem.getTitle();
                            var sName = oSelectedItem.getDescription();
                            var oModel = that.getView().getModel("createReturnModel");
                            if (oModel) {
                                oModel.setProperty("/SoldToParty", sCust);
                                oModel.setProperty("/SoldToPartyName", sName);
                            }
                            that._applyCustomerDefaults(sCust);
                        }
                    }
                });
                var oCustModel = new JSONModel([]);
                this._oCustomerSelectDialog.setModel(oCustModel, "customers");
                this._oCustomerSelectDialog.bindAggregation("items", {
                    path: "customers>/",
                    factory: function (sId, oCtx) {
                        var item = oCtx.getObject();
                        return new StandardListItem(sId, {
                            title: item.Customer,
                            description: item.OrganizationBPName1 || "",
                            info: item.CityName || ""
                        });
                    }
                });
                this.getView().addDependent(this._oCustomerSelectDialog);
            }
            this._loadCustomers("");
            this._oCustomerSelectDialog.open();
        },

        _loadCustomers: function (sSearch) {
            var that = this;
            if (this._oCustomerSelectDialog.setBusy) {
                this._oCustomerSelectDialog.setBusy(true);
            }
            CustomerReturnService.getCustomers(sSearch, 50).then(function (aCusts) {
                if (that._oCustomerSelectDialog.setBusy) {
                    that._oCustomerSelectDialog.setBusy(false);
                }
                var oModel = that._oCustomerSelectDialog.getModel("customers");
                if (oModel) {
                    var aList = Array.isArray(aCusts) ? aCusts.slice() : [];
                    var aPreferred = ["10135", "10123", "10082", "10000", "10025", "10058", "10098", "10144", "10178", "10221", "10292"];
                    aList.sort(function (a, b) {
                        var aPref = aPreferred.indexOf(a.Customer) !== -1 ? 0 : 1;
                        var bPref = aPreferred.indexOf(b.Customer) !== -1 ? 0 : 1;
                        if (aPref !== bPref) return aPref - bPref;
                        return (a.Customer || "").localeCompare(b.Customer || "");
                    });
                    oModel.setData(aList);
                }
            }).catch(function () {
                if (that._oCustomerSelectDialog.setBusy) {
                    that._oCustomerSelectDialog.setBusy(false);
                }
                var oModel = that._oCustomerSelectDialog.getModel("customers");
                if (oModel) {
                    oModel.setData([]);
                }
            });
        },

        onMaterialValueHelp: function (oEvent) {
            this._oActiveItemContext = oEvent.getSource().getBindingContext("createReturnModel");
            var that = this;
            if (!this._oMaterialSelectDialog) {
                this._oMaterialSelectDialog = new SelectDialog({
                    title: this.getText("dlgTitleSelectMaterial") || "Select Material",
                    noDataText: this.getText("noDataText") || "No materials found",
                    search: function (oEvt) {
                        var sValue = oEvt.getParameter("value");
                        that._loadMaterials(sValue);
                    },
                    confirm: function (oEvt) {
                        var oSelectedItem = oEvt.getParameter("selectedItem");
                        if (oSelectedItem && that._oActiveItemContext) {
                            var sMaterial = oSelectedItem.getTitle();
                            var sPath = that._oActiveItemContext.getPath();
                            var oModel = that.getView().getModel("createReturnModel");
                            if (oModel && sPath) {
                                oModel.setProperty(sPath + "/Material", sMaterial);
                                if (sMaterial === "4000000123") {
                                    oModel.setProperty(sPath + "/ProductionPlant", "1120");
                                }
                            }
                        }
                    }
                });
                var oMatModel = new JSONModel([]);
                this._oMaterialSelectDialog.setModel(oMatModel, "materials");
                this._oMaterialSelectDialog.bindAggregation("items", {
                    path: "materials>/",
                    factory: function (sId, oCtx) {
                        var item = oCtx.getObject();
                        return new StandardListItem(sId, {
                            title: item.Material,
                            description: item.Material_Text || ""
                        });
                    }
                });
                this.getView().addDependent(this._oMaterialSelectDialog);
            }
            this._loadMaterials("");
            this._oMaterialSelectDialog.open();
        },

        _loadMaterials: function (sSearch) {
            var that = this;
            if (this._oMaterialSelectDialog.setBusy) {
                this._oMaterialSelectDialog.setBusy(true);
            }
            CustomerReturnService.getMaterials(sSearch, 50).then(function (aMats) {
                if (that._oMaterialSelectDialog.setBusy) {
                    that._oMaterialSelectDialog.setBusy(false);
                }
                var oModel = that._oMaterialSelectDialog.getModel("materials");
                if (oModel) {
                    oModel.setData(Array.isArray(aMats) ? aMats : []);
                }
            }).catch(function () {
                if (that._oMaterialSelectDialog.setBusy) {
                    that._oMaterialSelectDialog.setBusy(false);
                }
                var oModel = that._oMaterialSelectDialog.getModel("materials");
                if (oModel) {
                    oModel.setData([]);
                }
            });
        },

        // =========================================================================
        // Table Item Actions
        // =========================================================================

        onAddReturnItem: function () {
            var oModel = this.getView().getModel("createReturnModel");
            if (!oModel) return;

            var aItems = (oModel.getProperty("/Items") || []).slice();
            var iNextIndex = aItems.length + 1;
            var sRefDoc = oModel.getProperty("/ReferenceSDDocument") || "";
            var sReason = oModel.getProperty("/ReturnsOrderReason") || "101";

            aItems.push({
                ItemIndex: iNextIndex,
                Material: "",
                OrderQuantity: "1.000",
                OrderQuantityUnit: "KG",
                ProductionPlant: "1110",
                StorageLocation: "FG01",
                ReturnReason: sReason,
                ReferenceSDDocument: sRefDoc,
                ReferenceSDDocumentItem: ("0000" + (iNextIndex * 10)).slice(-6)
            });
            oModel.setProperty("/Items", aItems);
            oModel.refresh(true);
        },

        onDeleteReturnItem: function () {
            var oModel = this.getView().getModel("createReturnModel");
            if (!oModel) return;

            var aItems = (oModel.getProperty("/Items") || []).slice();
            if (aItems.length > 1) {
                aItems.pop();
                oModel.setProperty("/Items", aItems);
                oModel.refresh(true);
            } else {
                MessageToast.show(this.getText("msgAtLeastOneItemRequired") || "At least one item is required.");
            }
        },

        // =========================================================================
        // Create Submission
        // =========================================================================

        onConfirmCreateReturn: function () {
            var that = this;
            var oModel = this.getView().getModel("createReturnModel");
            var oCreateData = oModel ? oModel.getData() : null;
            if (!oCreateData) return;

            if (!oCreateData.SoldToParty || !oCreateData.SoldToParty.trim()) {
                MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                return;
            }
            if (!oCreateData.ReturnsOrderReason) {
                MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                return;
            }
            if (!oCreateData.Items || oCreateData.Items.length === 0 || !oCreateData.Items[0].Material) {
                MessageBox.error(this.getText("msgCreateReturnValidationFailed"));
                return;
            }

            BusyIndicator.show(0);

            var oPayload = {
                CustomerReturnType: oCreateData.CustomerReturnType || "ZRET",
                SoldToParty: oCreateData.SoldToParty.trim(),
                ReturnsOrderReason: oCreateData.ReturnsOrderReason,
                ReferenceSDDocument: oCreateData.ReferenceSDDocument ? oCreateData.ReferenceSDDocument.trim() : "",
                ReferenceSDDocumentCategory: oCreateData.ReferenceSDDocumentCategory || "",
                SalesOrganization: oCreateData.SalesOrganization || "1000",
                DistributionChannel: oCreateData.DistributionChannel || "10",
                OrganizationDivision: oCreateData.OrganizationDivision || "52",
                CustomerReturnDate: oCreateData.CustomerReturnDate || new Date().toISOString().slice(0, 10),
                PurchaseOrderByCustomer: oCreateData.PurchaseOrderByCustomer ? oCreateData.PurchaseOrderByCustomer.trim() : "",
                Items: (oCreateData.Items || []).map(function (it, idx) {
                    return {
                        Material: it.Material ? it.Material.trim() : "",
                        OrderQuantity: parseFloat(it.OrderQuantity) || 1,
                        OrderQuantityUnit: it.OrderQuantityUnit || "KG",
                        ProductionPlant: it.ProductionPlant || "1110",
                        StorageLocation: it.StorageLocation || "FG01",
                        ReturnReason: it.ReturnReason || oCreateData.ReturnsOrderReason || "101",
                        ReferenceSDDocument: it.ReferenceSDDocument || oCreateData.ReferenceSDDocument || "",
                        ReferenceSDDocumentItem: it.ReferenceSDDocumentItem || ("0000" + ((idx + 1) * 10)).slice(-6)
                    };
                })
            };

            CustomerReturnService.createCustomerReturn(oPayload, this.getView().getModel("customerReturn"))
                .then(function (oResult) {
                    BusyIndicator.hide();
                    var sDocNum = oResult && (oResult.CustomerReturn || (oResult.d && oResult.d.CustomerReturn));
                    MessageBox.success(
                        that.getText("msgReturnCreatedSuccess", [sDocNum || ""]),
                        {
                            title: that.getText("msgReturnCreatedSuccessTitle"),
                            onClose: function () {
                                that.onNavBack();
                            }
                        }
                    );
                })
                .catch(function (oErr) {
                    BusyIndicator.hide();
                    var sMsg = "";
                    if (oErr && oErr.message && oErr.message.indexOf("Communication error") === -1) {
                        sMsg = oErr.message;
                    }
                    if (!sMsg) {
                        try {
                            var aMessages = [];
                            if (typeof Messaging !== "undefined" && Messaging && typeof Messaging.getMessageModel === "function") {
                                aMessages = Messaging.getMessageModel().getData() || [];
                            }
                            if (Array.isArray(aMessages)) {
                                for (var i = aMessages.length - 1; i >= 0; i--) {
                                    if (aMessages[i].type === "Error" && aMessages[i].message && aMessages[i].message.indexOf("Communication error") === -1) {
                                        sMsg = aMessages[i].message;
                                        break;
                                    }
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                    if (!sMsg) {
                        sMsg = (oErr && oErr.error && oErr.error.message) || (oErr && oErr.message) || JSON.stringify(oErr);
                    }
                    MessageBox.error(that.getText("msgCreateReturnFailed", [sMsg]), {
                        title: that.getText("titleCreateReturnFailed") || "Create Customer Return Failed",
                        details: (oErr && oErr.originalError && oErr.originalError.message) || (oErr && oErr.stack) || ""
                    });
                });
        }
    });
});
