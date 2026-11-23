(function () {
    "use strict";

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

    function createCreateCustomerReturnReferenceDoc(deps) {
        deps = deps || {};
        var SelectDialog = deps.SelectDialog;
        var StandardListItem = deps.StandardListItem;
        var CustomData = deps.CustomData;
        var JSONModel = deps.JSONModel;
        var CustomerReturnService = deps.CustomerReturnService;

        return {
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
            }
        };
    }

    var oExports = {
        KNOWN_REF_MATERIALS: KNOWN_REF_MATERIALS,
        createCreateCustomerReturnReferenceDoc: createCreateCustomerReturnReferenceDoc
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
