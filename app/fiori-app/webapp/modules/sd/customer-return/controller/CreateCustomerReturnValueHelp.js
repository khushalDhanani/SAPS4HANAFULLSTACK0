(function () {
    "use strict";

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

    function createCreateCustomerReturnValueHelp(deps) {
        deps = deps || {};
        var SelectDialog = deps.SelectDialog;
        var StandardListItem = deps.StandardListItem;
        var JSONModel = deps.JSONModel;
        var CustomerReturnService = deps.CustomerReturnService;

        return {
            _applyCustomerDefaults: function (sCust) {
                var oModel = this.getView().getModel("createReturnModel");
                if (!oModel || !sCust) return;
                var aItems = oModel.getProperty("/Items") || [];
                if (aItems.length === 0) return;

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
            }
        };
    }

    var oExports = {
        CUST_MATERIAL_DEFAULTS: CUST_MATERIAL_DEFAULTS,
        createCreateCustomerReturnValueHelp: createCreateCustomerReturnValueHelp
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oExports;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oExports;
        });
    }
})();
