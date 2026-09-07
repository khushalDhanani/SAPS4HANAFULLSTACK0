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
        "/SupplierVH": { title: "Select Supplier", key: "Supplier", desc: "SupplierName" },
        "/CurrencyVH": { title: "Select Currency", key: "Currency", desc: "Currency_Text" },
        "/IncotermsClassificationVH": { title: "Select Incoterms", key: "IncotermsClassification", desc: "IncotermsClassificationName" },
        "/PaymentTermsVH": { title: "Select Payment Terms", key: "PaymentTerms", desc: "PaymentTermsName" },
        "/MaterialVH": { title: "Select Material", key: "Material", desc: "MaterialName" },
        "/MaterialGroupVH": { title: "Select Material Group", key: "MaterialGroup", desc: "MaterialGroupName" },
        "/PlantVH": { title: "Select Plant", key: "Plant", desc: "PlantName" },
        "/StorageLocationVH": { title: "Select Storage Location", key: "StorageLocation", desc: "StorageLocationName" },
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
         * @returns {{ title: string, key: string, desc: string }|undefined}
         */
        getConfig: function (sPath) {
            return oValueHelpConfig[sPath];
        },

        /**
         * Instantiates and opens a SelectDialog for the given input control.
         *
         * @param {sap.ui.core.mvc.View} oView
         * @param {sap.m.Input} oInput
         * @param {Function} [fnCallback]
         */
        openValueHelp: function (oView, oInput, fnCallback) {
            var oBinding = oInput.getBinding("suggestionItems");
            if (!oBinding) return;

            var sPath = oBinding.getPath();
            var oConf = this.getConfig(sPath);
            if (!oConf) return;

            var oSelectDialog = new SelectDialog({
                title: oConf.title,
                search: function (oSearchEvent) {
                    var sValue = oSearchEvent.getParameter("value");
                    var oFilter = new Filter({
                        filters: [
                            new Filter(oConf.key, FilterOperator.Contains, sValue),
                            new Filter(oConf.desc, FilterOperator.Contains, sValue)
                        ],
                        and: false
                    });
                    oSearchEvent.getSource().getBinding("items").filter([oFilter]);
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
                        if (typeof fnCallback === "function") {
                            fnCallback(sKey, oSelectedItem);
                        }
                    }
                }
            });

            oSelectDialog.bindAggregation("items", {
                path: sPath,
                template: new StandardListItem({
                    title: "{" + oConf.key + "}",
                    description: "{" + oConf.desc + "}"
                })
            });

            if (oView && oView.addDependent) {
                oView.addDependent(oSelectDialog);
            }
            oSelectDialog.open();
        },

        /**
         * Applies filter to autocomplete suggestion items as the user types.
         *
         * @param {sap.m.Input} oInput
         * @param {string} sValue
         */
        applySuggestionFilter: function (oInput, sValue) {
            var oBinding = oInput.getBinding("suggestionItems");
            if (!oBinding) return;

            var sPath = oBinding.getPath();
            var oConf = this.getConfig(sPath);
            if (!oConf) return;

            var aFilters = [];
            if (sValue) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter(oConf.key, FilterOperator.Contains, sValue),
                        new Filter(oConf.desc, FilterOperator.Contains, sValue)
                    ],
                    and: false
                }));
            }

            oBinding.filter(aFilters);
        }
    };
});
