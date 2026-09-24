sap.ui.define([
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/TableSelectDialog",
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
    "sap/m/StandardListItem",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Text",
    "sap/m/ObjectIdentifier",
    "sap/m/ObjectStatus"
], function (Filter, FilterOperator, SelectDialog, TableSelectDialog, Dialog, Table, Toolbar, ToolbarSpacer, SearchField, SegmentedButton, SegmentedButtonItem, Button, VBox, Label, StandardListItem, Column, ColumnListItem, Text, ObjectIdentifier, ObjectStatus) {
    "use strict";

    var oValueHelpConfig = {
        "/DocumentTypeVH": { title: "Select Document Type", key: "PurchasingDocumentType", desc: "PurchasingDocumentType_Text" },
        "/CompanyCodeVH": { title: "Select Company Code", key: "CompanyCode", desc: "CompanyCodeName", info: "CompanyCode" },
        "/PurchasingOrgVH": { title: "Select Purchasing Org", key: "PurchasingOrganization", desc: "PurchasingOrganizationName" },
        "/PurchasingGroupVH": { title: "Select Purchasing Group", key: "PurchasingGroup", desc: "PurchasingGroupName" },
        "/SupplierVH": { title: "Select Supplier", key: "Supplier", desc: "SupplierName", info: "CompanyCode" },
        "/CurrencyVH": { title: "Select Currency", key: "Currency", desc: "Currency_Text" },
        "/IncotermsClassificationVH": { title: "Select Incoterms", key: "IncotermsClassification", desc: "IncotermsClassificationName" },
        "/PaymentTermsVH": { title: "Select Payment Terms", key: "PaymentTerms", desc: "PaymentTermsName" },
        "/MaterialVH": { title: "Select Material", key: "Material", desc: "MaterialName", descAlt: "Material_Text", info: "MaterialBaseUnit" },
        "/MaterialGroupVH": { title: "Select Material Group", key: "MaterialGroup", desc: "MaterialGroupName" },
        "/PlantVH": { title: "Select Plant", key: "Plant", desc: "PlantName", info: "PurchasingOrganization" },
        "/StorageLocationVH": { title: "Select Storage Location", key: "StorageLocation", desc: "StorageLocationName", info: "Plant" },
        "/UnitOfMeasureVH": { title: "Select Unit of Measure", key: "UnitOfMeasure", desc: "UnitOfMeasure_Text" },
        "/TaxCodeVH": { title: "Select Tax Code", key: "TaxCode", desc: "TaxCode_Text" },
        "/SalesInquiryTypeVH": { title: "Select Inquiry Type", key: "SalesDocumentType", desc: "SalesDocumentTypeName", descAlt: "SalesDocumentType_Text", info: "Classification" },
        "/SalesOrderTypeVH": { title: "Select Order Type", key: "SalesOrderType", desc: "SalesOrderTypeName", descAlt: "SalesOrderTypeName", info: "Language key" },
        "/SalesOrganizationVH": { title: "Select Sales Organization", key: "SalesOrganization", desc: "SalesOrganization_Text" },
        "/DistributionChannelVH": { title: "Select Distribution Channel", key: "DistributionChannel", desc: "DistributionChannelName" },
        "/DivisionVH": { title: "Select Division", key: "Division", desc: "DivisionName" },
        "/SoldToPartyVH": { title: "Select Sold-to Party", key: "Customer", desc: "CustomerName" },
        "/CustomerVH": { title: "Select Customer", key: "Customer", desc: "CustomerName" }
    };

    return {
        /**
         * Returns configuration metadata for a given value-help OData path.
         *
         * @param {string} sPath
         * @returns {{ title: string, key: string, desc: string, descAlt?: string }|undefined}
         */
        getConfig: function (sPath) {
            return oValueHelpConfig[sPath];
        },

        /**
         * Instantiates and opens a SelectDialog for the given input control.
         *
         * @param {sap.ui.core.mvc.View} oView
         * @param {sap.m.Input} oInput
         * @param {Function} [fnCallback] - Called with (sKey, oSelectedItem, oSelectedData)
         * @param {Array<sap.ui.model.Filter>} [aInitialFilters] - Optional contextual filters (e.g. SalesOrg, DistChannel, Plant)
         */
        openValueHelp: function (oView, oInput, fnCallback, aInitialFilters) {
            var oBinding = oInput.getBinding("suggestionRows") || oInput.getBinding("suggestionItems");
            if (!oBinding) return;

            var sPath = oBinding.getPath();
            var oConf = this.getConfig(sPath);
            if (!oConf) return;

            var oModel = oBinding.getModel() || (oView && (oView.getModel("salesOrder") || oView.getModel("salesInquiry"))) || oInput.getModel();
            var aActiveContextFilters = Array.isArray(aInitialFilters) ? aInitialFilters.slice() : [];

            // Dedicated Scannable Dialog for SAP S/4HANA Sales Inquiry Document Types
            if (sPath === "/SalesInquiryTypeVH") {
                this._openInquiryTypeValueHelp(oView, oInput, oModel, sPath, aActiveContextFilters, fnCallback);
                return;
            }

            // Dedicated Responsive TableSelectDialog for Material / Product Master Data
            if (sPath === "/MaterialVH") {
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
                return;
            }

            var sDialogTitle = oConf.title;
            if (sPath === "/SupplierVH") {
                var bHasZDomFilter = aActiveContextFilters.some(function (f) {
                    return f && f.sPath === "SupplierAccountGroup" && (f.oValue1 === "ZDOM" || f.sValue === "ZDOM");
                });
                if (bHasZDomFilter) {
                    sDialogTitle = "Select Domestic Supplier";
                }
            } else if (sPath === "/CompanyCodeVH") {
                var bHasDomCoFilter = aActiveContextFilters.some(function (f) {
                    return f && f.sPath === "CompanyCode" && (f.oValue1 === "1000" || f.sValue === "1000");
                });
                if (bHasDomCoFilter) {
                    sDialogTitle = "Select Domestic Company Code";
                }
            }

            var oSelectDialog = new SelectDialog({
                title: sDialogTitle,
                contentWidth: "42rem",
                growing: true,
                growingThreshold: 50,
                search: function (oSearchEvent) {
                    var sValue = oSearchEvent.getParameter("value");
                    var aSearchFilters = [];

                    if (sValue && String(sValue).trim() !== "") {
                        var aOrFilters = [
                            new Filter(oConf.key, FilterOperator.Contains, sValue),
                            new Filter(oConf.desc, FilterOperator.Contains, sValue)
                        ];
                        if (oConf.descAlt) {
                            aOrFilters.push(new Filter(oConf.descAlt, FilterOperator.Contains, sValue));
                        }
                        aSearchFilters.push(new Filter({ filters: aOrFilters, and: false }));
                    }

                    var aAllFilters = aSearchFilters.concat(aActiveContextFilters);
                    oSearchEvent.getSource().getBinding("items").filter(aAllFilters);
                },
                confirm: function (oConfirmEvent) {
                    var oSelectedItem = oConfirmEvent.getParameter("selectedItem");
                    if (oSelectedItem) {
                        var sKey = oSelectedItem.getTitle();
                        oInput.setValue(sKey);
                        var oValBinding = oInput.getBinding("value");
                        if (oValBinding) {
                            oValBinding.setValue(sKey);
                        }

                        var oBindingContext = oSelectedItem.getBindingContext();
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

                            // Extract common attributes safely across OData V2/V4
                            oSelectedData.Customer = oSelectedData.Customer || oBindingContext.getProperty("Customer") || sKey;
                            oSelectedData.CustomerName = oSelectedData.CustomerName || oBindingContext.getProperty("CustomerName") || oSelectedItem.getDescription() || "";
                            oSelectedData.OrganizationBPName1 = oSelectedData.OrganizationBPName1 || oBindingContext.getProperty("OrganizationBPName1") || "";
                            oSelectedData.CityName = oSelectedData.CityName || oBindingContext.getProperty("CityName") || "";
                            oSelectedData.Country = oSelectedData.Country || oBindingContext.getProperty("Country") || "";
                            oSelectedData.SupplierAccountGroup = oSelectedData.SupplierAccountGroup || oBindingContext.getProperty("SupplierAccountGroup") || "";

                            oSelectedData.Material = oSelectedData.Material || oBindingContext.getProperty("Material") || sKey;
                            oSelectedData.MaterialName = oSelectedData.MaterialName || oBindingContext.getProperty("MaterialName") || oBindingContext.getProperty("Material_Text") || oSelectedItem.getDescription() || "";
                            oSelectedData.Material_Text = oSelectedData.Material_Text || oBindingContext.getProperty("Material_Text") || oBindingContext.getProperty("MaterialName") || oSelectedItem.getDescription() || "";
                            oSelectedData.MaterialBaseUnit = oSelectedData.MaterialBaseUnit || oBindingContext.getProperty("MaterialBaseUnit") || "";
                            oSelectedData.Plant = oSelectedData.Plant || oBindingContext.getProperty("Plant") || "";
                            oSelectedData.MaterialGroup = oSelectedData.MaterialGroup || oBindingContext.getProperty("MaterialGroup") || "";
                            oSelectedData.MaterialType = oSelectedData.MaterialType || oBindingContext.getProperty("MaterialType") || "";

                            oSelectedData.UnitOfMeasure = oSelectedData.UnitOfMeasure || oBindingContext.getProperty("UnitOfMeasure") || sKey;
                            oSelectedData.UnitOfMeasure_Text = oSelectedData.UnitOfMeasure_Text || oBindingContext.getProperty("UnitOfMeasure_Text") || oSelectedItem.getDescription() || "";
                        }

                        if (typeof fnCallback === "function") {
                            fnCallback(sKey, oSelectedItem, oSelectedData);
                        }
                    }
                    oSelectDialog.destroy();
                },
                cancel: function () {
                    oSelectDialog.destroy();
                }
            });

            if (oModel) {
                oSelectDialog.setModel(oModel);
                oSelectDialog.setModel(oModel, "salesInquiry");
                oSelectDialog.setModel(oModel, "salesOrder");
            }

            var oTemplateConfig = {
                title: "{" + oConf.key + "}",
                description: oConf.descAlt ? "{= ${" + oConf.desc + "} || ${" + oConf.descAlt + "} || '' }" : "{" + oConf.desc + "}"
            };
            if (oConf.info) {
                if (sPath === "/MaterialVH") {
                    oTemplateConfig.info = "{= ${MaterialType} ? (${MaterialType} + (${MaterialBaseUnit} ? ' • ' + ${MaterialBaseUnit} : '')) : (${MaterialBaseUnit} || '') }";
                } else if (sPath === "/SupplierVH") {
                    oTemplateConfig.info = "{= (${SupplierAccountGroup} === 'ZDOM' ? 'Domestic • ' : '') + (${CompanyCode} ? 'CoCode ' + ${CompanyCode} : '') }";
                } else if (sPath === "/CompanyCodeVH") {
                    oTemplateConfig.info = "{= ${CompanyCode} === '1000' ? 'Domestic' : '' }";
                } else if (sPath === "/PlantVH") {
                    oTemplateConfig.info = "{= ${PurchasingOrganization} ? 'PurchOrg ' + ${PurchasingOrganization} : '' }";
                } else if (sPath === "/StorageLocationVH") {
                    oTemplateConfig.info = "{= ${Plant} ? 'Plant ' + ${Plant} : '' }";
                } else {
                    oTemplateConfig.info = "{" + oConf.info + "}";
                }
            }

            oSelectDialog.bindAggregation("items", {
                path: sPath,
                filters: aActiveContextFilters,
                template: new StandardListItem(oTemplateConfig)
            });

            if (oView && oView.addDependent) {
                oView.addDependent(oSelectDialog);
            }
            oSelectDialog.addStyleClass("sapUiSizeCompact");
            oSelectDialog.open();
        },

        /**
         * Dedicated compact and scannable dialog for SAP S/4HANA Sales Inquiry Document Types.
         * Dynamically displays:
         * - Primary line: Code + Name (ObjectIdentifier)
         * - Secondary metadata as returned by SAP: Document Category, Screen Sequence Group, Internal Number Range,
         *   Active/Inactive Status (from the SAP IsLocked flag)
         * - Sub-header filters: search across code, description and number range, Status filter (All/Active/Inactive), Reset.
         *
         * @private
         */
        _openInquiryTypeValueHelp: function (oView, oInput, oModel, sPath, aActiveContextFilters, fnCallback) {
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
                    new Column({
                        width: "14rem",
                        header: new Text({ text: "Inquiry Type" })
                    }),
                    new Column({
                        minScreenWidth: "Tablet",
                        demandPopin: true,
                        header: new Text({ text: "Category" })
                    }),
                    new Column({
                        width: "6.5rem",
                        minScreenWidth: "Tablet",
                        demandPopin: true,
                        hAlign: "Center",
                        header: new Text({ text: "Number Range" })
                    }),
                    new Column({
                        width: "7.5rem",
                        hAlign: "End",
                        header: new Text({ text: "Status" })
                    })
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
        },

        /**
         * Applies filter to autocomplete suggestion items as the user types.
         * Filters both technical key and description, and merges contextual filters.
         *
         * @param {sap.m.Input} oInput
         * @param {string} sValue
         * @param {Array<sap.ui.model.Filter>} [aContextFilters] - Optional contextual filters (e.g. SalesOrg, DistChannel)
         */
        applySuggestionFilter: function (oInput, sValue, aContextFilters) {
            var oBinding = oInput.getBinding("suggestionRows") || oInput.getBinding("suggestionItems");
            if (!oBinding) return;

            var sPath = oBinding.getPath();
            var oConf = this.getConfig(sPath);
            if (!oConf) return;

            var aFilters = [];
            if (sValue && String(sValue).trim() !== "") {
                var aOrFilters = [
                    new Filter(oConf.key, FilterOperator.Contains, sValue),
                    new Filter(oConf.desc, FilterOperator.Contains, sValue)
                ];
                if (oConf.descAlt) {
                    aOrFilters.push(new Filter(oConf.descAlt, FilterOperator.Contains, sValue));
                }
                if (oConf.info) {
                    aOrFilters.push(new Filter(oConf.info, FilterOperator.Contains, sValue));
                }
                aFilters.push(new Filter({
                    filters: aOrFilters,
                    and: false
                }));
            }

            if (Array.isArray(aContextFilters) && aContextFilters.length > 0) {
                aFilters = aFilters.concat(aContextFilters);
            }

            oBinding.filter(aFilters);
        }
    };
});
