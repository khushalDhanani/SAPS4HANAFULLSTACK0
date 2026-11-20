sap.ui.define([
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "saps4hana/fiori/service/valuehelp/InquiryTypeValueHelpDialog",
    "saps4hana/fiori/service/valuehelp/MaterialValueHelpDialog"
], function (Filter, FilterOperator, SelectDialog, StandardListItem, InquiryTypeValueHelpDialog, MaterialValueHelpDialog) {
    "use strict";

    var oValueHelpConfig = {
        "/DocumentTypeVH": { title: "Select Document Type", key: "PurchasingDocumentType", desc: "PurchasingDocumentType_Text" },
        "/CompanyCodeVH": { title: "Select Company Code", key: "CompanyCode", desc: "CompanyCodeName", info: "CompanyCode" },
        "/PurchasingOrgVH": { title: "Select Purchasing Org", key: "PurchasingOrganization", desc: "PurchasingOrganizationName" },
        "/PurchasingGroupVH": { title: "Select Purchasing Group", key: "PurchasingGroup", desc: "PurchasingGroupName", info: "FaxNumber" },
        "/SupplierVH": { title: "Select Supplier", key: "Supplier", desc: "SupplierName", info: "CompanyCode" },
        "/CurrencyVH": { title: "Select Currency", key: "Currency", desc: "Currency_Text" },
        "/IncotermsClassificationVH": { title: "Select Incoterms", key: "IncotermsClassification", desc: "IncotermsClassificationName" },
        "/PaymentTermsVH": { title: "Select Payment Terms", key: "PaymentTerms", desc: "PaymentTermsName" },
        // searchInfo false: the unit of measure is shown but never searched (SAP rejects contains() on a 3-char unit field)
        "/MaterialVH": { title: "Select Material", key: "Material", desc: "MaterialName", descAlt: "Material_Text", info: "MaterialBaseUnit", searchInfo: false },
        "/MaterialGroupVH": { title: "Select Material Group", key: "MaterialGroup", desc: "MaterialGroupName" },
        "/PlantVH": { title: "Select Plant", key: "Plant", desc: "PlantName", info: "PurchasingOrganization" },
        "/StorageLocationVH": { title: "Select Storage Location", key: "StorageLocation", desc: "StorageLocationName", info: "Plant" },
        "/UnitOfMeasureVH": { title: "Select Unit of Measure", key: "UnitOfMeasure", desc: "UnitOfMeasure_Text" },
        "/TaxCodeVH": { title: "Select Tax Code", key: "TaxCode", desc: "TaxCode_Text" },
        "/ItemCategoryVH": { title: "Select Item Category", key: "PurchasingDocumentItemCategory", desc: "PurgDocItemCategoryName" },
        "/AcctAssignmentCategoryVH": { title: "Select Account Assignment Category", key: "AccountAssignmentCategory", desc: "AcctAssignmentCategoryName" },
        "/SalesInquiryTypeVH": { title: "Select Inquiry Type", key: "SalesDocumentType", desc: "SalesDocumentTypeName", descAlt: "SalesDocumentType_Text" },
        "/SalesOrderTypeVH": { title: "Select Order Type", key: "SalesOrderType", desc: "SalesOrderTypeName" },
        "/SalesOrganizationVH": { title: "Select Sales Organization", key: "SalesOrganization", desc: "SalesOrganization_Text" },
        "/DistributionChannelVH": { title: "Select Distribution Channel", key: "DistributionChannel", desc: "DistributionChannelName" },
        "/DivisionVH": { title: "Select Division", key: "Division", desc: "DivisionName" },
        "/SoldToPartyVH": { title: "Select Sold-to Party", key: "Customer", desc: "CustomerName" },
        "/CustomerVH": { title: "Select Customer", key: "Customer", desc: "CustomerName" },
        "/ContactPersonVH": { title: "Select Contact Person", key: "ContactPerson", desc: "FullName", descAlt: "LastName", info: "Customer" },
        "/OrderTypeVH": { title: "Select Order Type", key: "OrderType", desc: "OrderTypeName", info: "OrderCategory" }
    };

    function resolveTitleAndContext(sPath, oConf, aActiveContextFilters) {
        var sDialogTitle = oConf.title;
        var aFilters = aActiveContextFilters;

        if (sPath === "/SupplierVH") {
            var bHasZDom = aFilters.some(function (f) {
                return f && f.sPath === "SupplierAccountGroup" && (f.oValue1 === "ZDOM" || f.sValue === "ZDOM");
            });
            var bHasZInt = aFilters.some(function (f) {
                return f && f.sPath === "SupplierAccountGroup" && (f.oValue1 === "ZINT" || f.sValue === "ZINT");
            });
            if (bHasZDom) {
                sDialogTitle = "Select Domestic Supplier";
            } else if (bHasZInt) {
                sDialogTitle = "Select Supplying Plant / Internal Site";
            }
        } else if (sPath === "/CompanyCodeVH") {
            sDialogTitle = "Select Company Code (1000 / 2000)";
        } else if (sPath === "/PurchasingGroupVH") {
            var bHas100 = aFilters.some(function (f) {
                return f && f.sPath === "PurchasingGroup" && (f.oValue1 === "1" || f.sValue === "1");
            });
            if (bHas100) {
                sDialogTitle = "Select Purchasing Group (100 Series)";
            }
        } else if (sPath === "/SoldToPartyVH" || sPath === "/CustomerVH") {
            var aAreaTokens = [];
            var aFiltered = [];
            aFilters.forEach(function (f) {
                if (f && (f.sPath === "SalesOrganization" || f.sPath === "SalesOrg")) {
                    aAreaTokens.push(f.oValue1 || f.sValue);
                } else if (f && (f.sPath === "DistributionChannel" || f.sPath === "DistChannel")) {
                    aAreaTokens.push(f.oValue1 || f.sValue);
                } else if (f && (f.sPath === "Division" || f.sPath === "OrganizationDivision")) {
                    aAreaTokens.push(f.oValue1 || f.sValue);
                } else {
                    aFiltered.push(f);
                }
            });
            if (aAreaTokens.length > 0) {
                sDialogTitle = (sPath === "/CustomerVH" ? "Select Ship-to Party" : "Select Sold-to Party") +
                    " (Sales Area: " + aAreaTokens.join(" / ") + ")";
            }
            aFilters = aFiltered;
        }

        return { title: sDialogTitle, filters: aFilters };
    }

    var oTemplateInfoMap = {
        "/MaterialVH": "{= ${MaterialType} ? (${MaterialType} + (${MaterialBaseUnit} ? ' • ' + ${MaterialBaseUnit} : '')) : (${MaterialBaseUnit} || '') }",
        "/SupplierVH": "{= (${SupplierAccountGroup} === 'ZDOM' ? 'Domestic • ' : (${SupplierAccountGroup} === 'ZINT' ? 'Internal Plant • ' : '')) + (${CompanyCode} ? 'CoCode ' + ${CompanyCode} : '') }",
        "/CompanyCodeVH": "{= ${CompanyCode} === '1000' ? 'Domestic (AIL)' : (${CompanyCode} === '2000' ? 'Domestic (ASCL)' : '') }",
        "/PlantVH": "{= ${PurchasingOrganization} ? 'PurchOrg ' + ${PurchasingOrganization} : '' }",
        "/StorageLocationVH": "{= ${Plant} ? 'Plant ' + ${Plant} : '' }",
        "/PurchasingGroupVH": "{= ${FaxNumber} ? ${FaxNumber} : '' }",
        "/OrderTypeVH": "{= ${OrderCategory} ? 'Cat ' + ${OrderCategory} : '' }"
    };

    function buildTemplateInfo(sCleanPath, oConf) {
        if (!oConf.info) return undefined;
        return oTemplateInfoMap[sCleanPath] || ("{" + oConf.info + "}");
    }

    return {
        getConfig: function (sPath) {
            if (!sPath) return undefined;
            var sCleanPath = sPath.indexOf(">") !== -1 ? sPath.substring(sPath.indexOf(">") + 1) : sPath;
            return oValueHelpConfig[sCleanPath] || oValueHelpConfig[sPath];
        },

        openValueHelp: function (oView, oInput, fnCallback, aInitialFilters) {
            var oBinding = oInput.getBinding("suggestionRows") || oInput.getBinding("suggestionItems");
            if (!oBinding) return;

            var sPath = oBinding.getPath();
            var oConf = this.getConfig(sPath);
            if (!oConf) return;

            var oModel = oBinding.getModel() || (oView && (oView.getModel("salesOrder") || oView.getModel("salesInquiry"))) || oInput.getModel();
            var aActiveContextFilters = Array.isArray(aInitialFilters) ? aInitialFilters.slice() : [];

            if (sPath === "/SalesInquiryTypeVH") {
                this._openInquiryTypeValueHelp(oView, oInput, oModel, sPath, aActiveContextFilters, fnCallback);
                return;
            }

            if (sPath === "/MaterialVH" && MaterialValueHelpDialog && typeof MaterialValueHelpDialog.open === "function") {
                MaterialValueHelpDialog.open(oView, oInput, oModel, sPath, oConf, aActiveContextFilters, fnCallback);
                return;
            }

            var resolved = resolveTitleAndContext(sPath, oConf, aActiveContextFilters);
            var sDialogTitle = resolved.title;
            aActiveContextFilters = resolved.filters;

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
                            } catch {
                                oSelectedData = null;
                            }
                            if (!oSelectedData || typeof oSelectedData !== "object") {
                                oSelectedData = {};
                            }

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

            var sCleanPath = sPath.indexOf(">") !== -1 ? sPath.substring(sPath.indexOf(">") + 1) : sPath;
            var oTemplateConfig = {
                title: "{" + oConf.key + "}",
                description: oConf.descAlt ? "{= ${" + oConf.desc + "} || ${" + oConf.descAlt + "} || '' }" : "{" + oConf.desc + "}"
            };
            var sInfoTemplate = buildTemplateInfo(sCleanPath, oConf);
            if (sInfoTemplate) {
                oTemplateConfig.info = sInfoTemplate;
            }

            oSelectDialog.bindAggregation("items", {
                path: sCleanPath,
                filters: aActiveContextFilters,
                template: new StandardListItem(oTemplateConfig)
            });

            if (oView && oView.addDependent) {
                oView.addDependent(oSelectDialog);
            }
            oSelectDialog.addStyleClass("sapUiSizeCompact");
            oSelectDialog.open();
        },

        _openInquiryTypeValueHelp: function (oView, oInput, oModel, sPath, aActiveContextFilters, fnCallback) {
            if (InquiryTypeValueHelpDialog && typeof InquiryTypeValueHelpDialog.open === "function") {
                InquiryTypeValueHelpDialog.open(oView, oInput, oModel, sPath, aActiveContextFilters, fnCallback);
            }
        },

        _openMaterialValueHelp: function (oView, oInput, oModel, sPath, oConf, aActiveContextFilters, fnCallback) {
            if (MaterialValueHelpDialog && typeof MaterialValueHelpDialog.open === "function") {
                MaterialValueHelpDialog.open(oView, oInput, oModel, sPath, oConf, aActiveContextFilters, fnCallback);
            }
        },

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
                if (oConf.info && oConf.searchInfo !== false) {
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
