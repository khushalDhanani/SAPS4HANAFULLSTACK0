sap.ui.define([
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem"
], function (Filter, FilterOperator, SelectDialog, StandardListItem) {
    "use strict";

    var oValueHelpConfig = {
        "/DocumentTypeVH": { title: "Select Document Type", key: "PurchasingDocumentType", desc: "PurchasingDocumentType_Text" },
        "/CompanyCodeVH": { title: "Select Company Code", key: "CompanyCode", desc: "CompanyCodeName" },
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
        "/SalesInquiryTypeVH": { title: "Select Inquiry Type", key: "SalesDocumentType", desc: "SalesDocumentTypeName" },
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
            var oBinding = oInput.getBinding("suggestionItems");
            if (!oBinding) return;

            var sPath = oBinding.getPath();
            var oConf = this.getConfig(sPath);
            if (!oConf) return;

            var oModel = oBinding.getModel() || (oView && oView.getModel("salesInquiry")) || oInput.getModel();

            var aActiveContextFilters = Array.isArray(aInitialFilters) ? aInitialFilters.slice() : [];

            var oSelectDialog = new SelectDialog({
                title: oConf.title,
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
                                oSelectedData = {
                                    Material: oBindingContext.getProperty("Material") || sKey,
                                    MaterialName: oBindingContext.getProperty("MaterialName") || oBindingContext.getProperty("Material_Text") || oSelectedItem.getDescription() || "",
                                    Material_Text: oBindingContext.getProperty("Material_Text") || oBindingContext.getProperty("MaterialName") || oSelectedItem.getDescription() || "",
                                    MaterialBaseUnit: oBindingContext.getProperty("MaterialBaseUnit"),
                                    Plant: oBindingContext.getProperty("Plant"),
                                    MaterialGroup: oBindingContext.getProperty("MaterialGroup")
                                };
                            }
                        }

                        if (typeof fnCallback === "function") {
                            fnCallback(sKey, oSelectedItem, oSelectedData);
                        }
                    }
                }
            });

            if (oModel) {
                oSelectDialog.setModel(oModel);
            }

            var oTemplateConfig = {
                title: "{" + oConf.key + "}",
                description: oConf.descAlt ? "{= ${" + oConf.desc + "} || ${" + oConf.descAlt + "} || '' }" : "{" + oConf.desc + "}"
            };
            if (oConf.info) {
                if (sPath === "/MaterialVH") {
                    oTemplateConfig.info = "{= ${MaterialBaseUnit} ? (${MaterialBaseUnit} + (${Plant} ? ' / Plant ' + ${Plant} : '')) : (${Plant} ? 'Plant ' + ${Plant} : '') }";
                } else if (sPath === "/SupplierVH") {
                    oTemplateConfig.info = "{= ${CompanyCode} ? 'CoCode ' + ${CompanyCode} : '' }";
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
            oSelectDialog.open();
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
            var oBinding = oInput.getBinding("suggestionItems");
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
