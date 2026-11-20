sap.ui.define([
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/Dialog",
    "sap/m/Table",
    "sap/m/Toolbar",
    "sap/m/ToolbarSpacer",
    "sap/m/SearchField",
    "sap/m/SegmentedButton",
    "sap/m/SegmentedButtonItem",
    "sap/m/Button",
    "sap/m/VBox",
    "sap/m/Label",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Text",
    "sap/m/ObjectIdentifier",
    "sap/m/ObjectStatus"
], function (Filter, FilterOperator, Dialog, Table, Toolbar, ToolbarSpacer, SearchField, SegmentedButton, SegmentedButtonItem, Button, VBox, Label, Column, ColumnListItem, Text, ObjectIdentifier, ObjectStatus) {
    "use strict";

    /**
     * Dedicated compact and scannable dialog for SAP S/4HANA Sales Inquiry Document Types.
     * Dynamically displays:
     * - Primary line: Code + Name (ObjectIdentifier)
     * - Secondary metadata as returned by SAP: Document Category, Screen Sequence Group, Internal Number Range,
     *   Active/Inactive Status (from the SAP IsLocked flag)
     * - Sub-header filters: search across code, description and number range, Status filter (All/Active/Inactive), Reset.
     *
     * @param {sap.ui.core.mvc.View} oView
     * @param {sap.m.Input} oInput
     * @param {sap.ui.model.Model} oModel
     * @param {string} sPath
     * @param {Array<sap.ui.model.Filter>} aActiveContextFilters
     * @param {Function} [fnCallback]
     */
    function open(oView, oInput, oModel, sPath, aActiveContextFilters, fnCallback) {
        var oSelectedData = null;
        var sSelectedKey = "";
        var sCurrentSearchText = "";
        var sCurrentStatusFilter = "ALL";

        var oSelectBtn = new Button({
            text: "Select",
            type: "Emphasized",
            enabled: false,
            press: function () {
                var oSelectedItem = oTable.getSelectedItem();
                if (oSelectedItem) {
                    confirmSelection(oSelectedItem);
                }
            }
        });

        var oCancelBtn = new Button({
            text: "Cancel",
            press: function () {
                oDialog.close();
                oDialog.destroy();
            }
        });

        var oTable = new Table({
            mode: "SingleSelectMaster",
            inset: false,
            growing: true,
            growingThreshold: 20,
            growingScrollToLoad: true,
            noDataText: "No SAP S/4HANA Inquiry Types match the selected filter criteria",
            columns: [
                new Column({ width: "14rem", header: new Text({ text: "Inquiry Type" }) }),
                new Column({ minScreenWidth: "Tablet", demandPopin: true, header: new Text({ text: "Category" }) }),
                new Column({ width: "6.5rem", minScreenWidth: "Tablet", demandPopin: true, hAlign: "Center", header: new Text({ text: "Number Range" }) }),
                new Column({ width: "7.5rem", hAlign: "End", header: new Text({ text: "Status" }) })
            ],
            selectionChange: function (oEvent) {
                var oSelectedItem = oEvent.getParameter("listItem");
                if (oSelectedItem) {
                    var oBindingContext = oSelectedItem.getBindingContext();
                    if (oBindingContext) {
                        sSelectedKey = oBindingContext.getProperty("SalesDocumentType") || "";
                        try {
                            oSelectedData = oBindingContext.getObject();
                        } catch (e) {
                            oSelectedData = null;
                        }
                    }
                    oSelectBtn.setEnabled(!!sSelectedKey);
                }
            },
            itemPress: function (oEvent) {
                var oSelectedItem = oEvent.getParameter("listItem");
                if (oSelectedItem) {
                    confirmSelection(oSelectedItem);
                }
            }
        });

        function updateFilters() {
            var aCombinedFilters = [];

            // 1. Search across the SAP code, SAP description, status and number range
            if (sCurrentSearchText && sCurrentSearchText.trim() !== "") {
                var sVal = sCurrentSearchText.trim();
                var aOrSearch = [
                    new Filter("SalesDocumentType", FilterOperator.Contains, sVal),
                    new Filter("SalesDocumentTypeName", FilterOperator.Contains, sVal),
                    new Filter("SalesDocumentType_Text", FilterOperator.Contains, sVal),
                    new Filter("StatusText", FilterOperator.Contains, sVal),
                    new Filter("NumberRangeForIntIDAssignment", FilterOperator.Contains, sVal)
                ];
                aCombinedFilters.push(new Filter({ filters: aOrSearch, and: false }));
            }

            // 2. Status Filter: ALL | ACTIVE | INACTIVE
            if (sCurrentStatusFilter === "ACTIVE") {
                aCombinedFilters.push(new Filter("IsActive", FilterOperator.EQ, true));
            } else if (sCurrentStatusFilter === "INACTIVE") {
                aCombinedFilters.push(new Filter("IsActive", FilterOperator.EQ, false));
            }

            if (Array.isArray(aActiveContextFilters) && aActiveContextFilters.length > 0) {
                aCombinedFilters = aCombinedFilters.concat(aActiveContextFilters);
            }

            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(aCombinedFilters);
            }
            oSelectBtn.setEnabled(false);
        }

        var oSearchField = new SearchField({
            width: "16rem",
            placeholder: "Search code or description...",
            liveChange: function (oEvent) {
                sCurrentSearchText = oEvent.getParameter("newValue") || "";
                updateFilters();
            },
            search: function (oEvent) {
                sCurrentSearchText = oEvent.getParameter("query") || "";
                updateFilters();
            }
        });

        var oStatusSegmentedButton = new SegmentedButton({
            selectedKey: "ALL",
            items: [
                new SegmentedButtonItem({ key: "ALL", text: "All" }),
                new SegmentedButtonItem({ key: "ACTIVE", text: "Active" }),
                new SegmentedButtonItem({ key: "INACTIVE", text: "Inactive" })
            ],
            selectionChange: function (oEvent) {
                sCurrentStatusFilter = oEvent.getParameter("item").getKey();
                updateFilters();
            }
        });

        var oResetBtn = new Button({
            icon: "sap-icon://clear-filter",
            tooltip: "Reset All Filters",
            press: function () {
                sCurrentSearchText = "";
                sCurrentStatusFilter = "ALL";
                oSearchField.setValue("");
                oStatusSegmentedButton.setSelectedKey("ALL");
                updateFilters();
            }
        });

        var oSubHeaderToolbar = new Toolbar({
            content: [
                oSearchField,
                new ToolbarSpacer(),
                new Label({ text: "Status:" }),
                oStatusSegmentedButton,
                oResetBtn
            ]
        });

        oTable.bindAggregation("items", {
            path: sPath,
            filters: aActiveContextFilters,
            template: new ColumnListItem({
                type: "Active",
                cells: [
                    new ObjectIdentifier({
                        title: "{SalesDocumentType}",
                        text: "{= ${SalesDocumentTypeName} || ${SalesDocumentType_Text} || '' }"
                    }),
                    new VBox({
                        items: [
                            new Text({
                                text: "{= 'Category ' + (${SDDocumentCategory} || 'A') + ' • ' + (${SDDocumentCategoryName} || 'Inquiry') }",
                                wrapping: false
                            }),
                            new Text({
                                text: "{= ${ScreenSequenceGroup} ? ('Screen Sequence: ' + ${ScreenSequenceGroup}) : '' }",
                                wrapping: false
                            }).addStyleClass("sapUiTinyMarginTop")
                        ]
                    }),
                    new Text({
                        text: "{= ${NumberRangeForIntIDAssignment} ? ('Int: ' + ${NumberRangeForIntIDAssignment}) : '-' }"
                    }),
                    new ObjectStatus({
                        text: "{StatusText}",
                        state: "{StatusState}",
                        icon: "{= ${IsActive} ? 'sap-icon://sys-enter-2' : 'sap-icon://locked' }"
                    })
                ]
            })
        });

        function confirmSelection(oSelectedItem) {
            var oBindingContext = oSelectedItem ? oSelectedItem.getBindingContext() : (oTable.getSelectedItem() && oTable.getSelectedItem().getBindingContext());
            var sKey = "";
            var oData = null;

            if (oBindingContext) {
                sKey = oBindingContext.getProperty("SalesDocumentType") || "";
                try {
                    oData = oBindingContext.getObject();
                } catch (e) {
                    oData = null;
                }
            }
            if (!sKey && oSelectedItem) {
                var aCells = oSelectedItem.getCells ? oSelectedItem.getCells() : [];
                sKey = aCells[0] && aCells[0].getTitle ? aCells[0].getTitle() : "";
            }

            if (sKey) {
                oInput.setValue(sKey);
                var oValBinding = oInput.getBinding("value");
                if (oValBinding) {
                    oValBinding.setValue(sKey);
                }

                if (typeof fnCallback === "function") {
                    fnCallback(sKey, oSelectedItem || oTable.getSelectedItem(), oData || oSelectedData);
                }
            }

            oDialog.close();
            oDialog.destroy();
        }

        var oDialog = new Dialog({
            title: "Select Inquiry Type (SAP S/4HANA)",
            contentWidth: "58rem",
            contentHeight: "34rem",
            resizable: true,
            draggable: true,
            subHeader: oSubHeaderToolbar,
            content: [oTable],
            beginButton: oSelectBtn,
            endButton: oCancelBtn
        });

        if (oModel) {
            oDialog.setModel(oModel);
            oDialog.setModel(oModel, "salesInquiry");
            oDialog.setModel(oModel, "salesOrder");
        }

        if (oView && oView.addDependent) {
            oView.addDependent(oDialog);
        }
        oDialog.addStyleClass("sapUiSizeCompact");
        oDialog.open();
    }

    return {
        open: open
    };
});
