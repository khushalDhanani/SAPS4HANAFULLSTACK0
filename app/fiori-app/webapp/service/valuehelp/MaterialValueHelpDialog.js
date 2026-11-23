sap.ui.define([
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/TableSelectDialog",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Text",
    "sap/m/ObjectIdentifier",
    "sap/m/ObjectStatus"
], function (Filter, FilterOperator, TableSelectDialog, Column, ColumnListItem, Text, ObjectIdentifier, ObjectStatus) {
    "use strict";

    /**
     * Dedicated Responsive TableSelectDialog for Finished Goods Material / Product Master Data.
     *
     * @param {sap.ui.core.mvc.View} oView
     * @param {sap.m.Input} oInput
     * @param {sap.ui.model.Model} oModel
     * @param {string} sPath
     * @param {object} oConf
     * @param {Array<sap.ui.model.Filter>} aActiveContextFilters
     * @param {Function} [fnCallback]
     */
    function open(oView, oInput, oModel, sPath, oConf, aActiveContextFilters, fnCallback) {
        var oTableSelectDialog = new TableSelectDialog({
            title: "Select Finished Goods Material / Product",
            noDataText: "No Finished Goods materials found in SAP S/4HANA",
            contentWidth: "52rem",
            growing: true,
            growingThreshold: 25,
            columns: [
                new Column({ width: "10rem", header: new Text({ text: "Material Number" }) }),
                new Column({ minScreenWidth: "Tablet", demandPopin: true, header: new Text({ text: "Product Description" }) }),
                new Column({ width: "6rem", minScreenWidth: "Tablet", demandPopin: true, header: new Text({ text: "Type" }) }),
                new Column({ width: "6rem", minScreenWidth: "Tablet", demandPopin: true, header: new Text({ text: "Group" }) }),
                new Column({ width: "5rem", hAlign: "Center", header: new Text({ text: "Unit" }) })
            ],
            search: function (oSearchEvent) {
                var sValue = oSearchEvent.getParameter("value");
                var aSearchFilters = [];

                if (sValue && String(sValue).trim() !== "") {
                    var aOrFilters = [
                        new Filter("Material", FilterOperator.Contains, sValue),
                        new Filter("MaterialName", FilterOperator.Contains, sValue),
                        new Filter("Material_Text", FilterOperator.Contains, sValue)
                    ];
                    aSearchFilters.push(new Filter({ filters: aOrFilters, and: false }));
                }

                var aAllFilters = aSearchFilters.concat(aActiveContextFilters);
                oSearchEvent.getSource().getBinding("items").filter(aAllFilters);
            },
            confirm: function (oConfirmEvent) {
                var oSelectedItem = oConfirmEvent.getParameter("selectedItem");
                if (oSelectedItem) {
                    var oBindingContext = oSelectedItem.getBindingContext();
                    var sKey = (oBindingContext && oBindingContext.getProperty("Material")) || "";
                    if (!sKey) {
                        var aCells = oSelectedItem.getCells ? oSelectedItem.getCells() : [];
                        sKey = aCells[0] && aCells[0].getTitle ? aCells[0].getTitle() : (aCells[0] && aCells[0].getText ? aCells[0].getText() : "");
                    }

                    oInput.setValue(sKey);
                    var oValBinding = oInput.getBinding("value");
                    if (oValBinding) {
                        oValBinding.setValue(sKey);
                    }

                    var oSelectedData = null;
                    if (oBindingContext) {
                        try {
                            oSelectedData = oBindingContext.getObject();
                        } catch (e) {
                            oSelectedData = null;
                        }
                        if (!oSelectedData || typeof oSelectedData !== "object") {
                            oSelectedData = {};
                        }

                        oSelectedData.Material = oSelectedData.Material || oBindingContext.getProperty("Material") || sKey;
                        oSelectedData.MaterialName = oSelectedData.MaterialName || oBindingContext.getProperty("MaterialName") || oBindingContext.getProperty("Material_Text") || "";
                        oSelectedData.Material_Text = oSelectedData.Material_Text || oBindingContext.getProperty("Material_Text") || oSelectedData.MaterialName;
                        oSelectedData.MaterialBaseUnit = oSelectedData.MaterialBaseUnit || oBindingContext.getProperty("MaterialBaseUnit") || "";
                        oSelectedData.MaterialGroup = oSelectedData.MaterialGroup || oBindingContext.getProperty("MaterialGroup") || "";
                        oSelectedData.MaterialType = oSelectedData.MaterialType || oBindingContext.getProperty("MaterialType") || "";
                    }

                    if (typeof fnCallback === "function") {
                        fnCallback(sKey, oSelectedItem, oSelectedData);
                    }
                }
                oTableSelectDialog.destroy();
            },
            cancel: function () {
                oTableSelectDialog.destroy();
            }
        });

        if (oModel) {
            oTableSelectDialog.setModel(oModel);
            oTableSelectDialog.setModel(oModel, "salesInquiry");
            oTableSelectDialog.setModel(oModel, "salesOrder");
        }

        oTableSelectDialog.bindAggregation("items", {
            path: sPath,
            filters: aActiveContextFilters,
            template: new ColumnListItem({
                type: "Active",
                cells: [
                    new ObjectIdentifier({ title: "{" + oConf.key + "}" }),
                    new Text({ text: "{= ${MaterialName} || ${Material_Text} || '' }" }),
                    new ObjectStatus({ text: "{MaterialType}", state: "Success" }),
                    new Text({ text: "{= ${MaterialGroup} || '-' }" }),
                    new Text({ text: "{MaterialBaseUnit}" })
                ]
            })
        });

        if (oView && oView.addDependent) {
            oView.addDependent(oTableSelectDialog);
        }
        oTableSelectDialog.addStyleClass("sapUiSizeCompact");
        oTableSelectDialog.open();
    }

    return {
        open: open
    };
});
