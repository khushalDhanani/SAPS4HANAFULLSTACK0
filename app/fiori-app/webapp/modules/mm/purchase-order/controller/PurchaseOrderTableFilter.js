function createTableFilter(deps) {
    deps = deps || {};
    var Filter = deps.Filter;
    var FilterOperator = deps.FilterOperator;
    var ValueHelpService = deps.ValueHelpService;
    var ControllerClass = deps.ControllerClass;

    return {
        _buildFilterBarContextFilters: function (oSource) {
            var aFilters = [];
            if (!oSource) return aFilters;

            var sField = "";
            if (typeof oSource.data === "function") {
                sField = oSource.data("field") || "";
            }
            if (!sField) {
                var sId = typeof oSource.getId === "function" ? oSource.getId() : (oSource.id || "");
                var sControlId = sId.indexOf("--") !== -1 ? sId.split("--").pop() : sId;
                var FILTER_ID_MAP = {
                    "fbSupplier": "Supplier",
                    "fbPurchasingOrg": "PurchasingOrganization",
                    "fbDocType": "PurchaseOrderType"
                };
                sField = FILTER_ID_MAP[sControlId] || sControlId;
            }

            if (sField === "Supplier") {
                var oFbCompanyCode = typeof this.byId === "function" ? this.byId("fbCompanyCode") : null;
                var sCoCode = oFbCompanyCode && typeof oFbCompanyCode.getValue === "function" ? oFbCompanyCode.getValue().trim() : "";
                if (sCoCode) {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, sCoCode));
                }
                var oFbDocType = typeof this.byId === "function" ? this.byId("fbDocType") : null;
                var sDocType = oFbDocType && typeof oFbDocType.getValue === "function" ? oFbDocType.getValue().trim() : "";
                if (sDocType === "ZDOM") {
                    aFilters.push(new Filter("SupplierAccountGroup", FilterOperator.EQ, "ZDOM"));
                } else if (sDocType === "ZSTO") {
                    aFilters.push(new Filter("SupplierAccountGroup", FilterOperator.EQ, "ZINT"));
                }
            } else if (sField === "PurchasingOrganization") {
                var oFbCompanyCodePurch = typeof this.byId === "function" ? this.byId("fbCompanyCode") : null;
                var sCoCodePurch = oFbCompanyCodePurch && typeof oFbCompanyCodePurch.getValue === "function" ? oFbCompanyCodePurch.getValue().trim() : "";
                if (sCoCodePurch) {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, sCoCodePurch));
                }
            } else if (sField === "CompanyCode") {
                var oFbDocTypeComp = typeof this.byId === "function" ? this.byId("fbDocType") : null;
                var sDocTypeComp = oFbDocTypeComp && typeof oFbDocTypeComp.getValue === "function" ? oFbDocTypeComp.getValue().trim() : "";
                if (sDocTypeComp === "ZDOM") {
                    aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, "1000"));
                }
            } else if (sField === "PurchaseOrderType") {
                aFilters.push(new Filter("PurchasingDocumentType", FilterOperator.StartsWith, "Z"));
            }

            return aFilters;
        },

        onValueHelpRequest: function (oEvent) {
            var oSource = oEvent.getSource();
            var aInitialFilters = this._buildFilterBarContextFilters(oSource);
            if (aInitialFilters.length > 0) {
                ValueHelpService.openValueHelp(this.getView(), oSource, null, aInitialFilters);
            } else {
                ValueHelpService.openValueHelp(this.getView(), oSource);
            }
        },

        onSuggest: function (oEvent) {
            var oSource = oEvent.getSource();
            var sValue = oEvent.getParameter("suggestValue");
            var aContextFilters = this._buildFilterBarContextFilters(oSource);
            if (aContextFilters.length > 0) {
                ValueHelpService.applySuggestionFilter(oSource, sValue, aContextFilters);
            } else {
                ValueHelpService.applySuggestionFilter(oSource, sValue);
            }
        },

        onSearch: function () {
            this._applyFilters();
        },

        onFilterBarSearch: function () {
            this._applyFilters();
        },

        onFilterBarClear: function () {
            var oFbPO = this.byId("fbPO");
            var oFbSupplier = this.byId("fbSupplier");
            var oFbCompanyCode = this.byId("fbCompanyCode");
            var oFbPurchasingOrg = this.byId("fbPurchasingOrg");
            var oFbPurchasingGroup = this.byId("fbPurchasingGroup");
            var oFbDocType = this.byId("fbDocType");
            var oFbDateRange = this.byId("fbDateRange");
            var oFbCreatedBy = this.byId("fbCreatedBy");
            var oFbStatus = this.byId("fbStatus");

            if (oFbPO) oFbPO.setValue("");
            if (oFbSupplier) oFbSupplier.setValue("");
            if (oFbCompanyCode) oFbCompanyCode.setValue("");
            if (oFbPurchasingOrg) oFbPurchasingOrg.setValue("");
            if (oFbPurchasingGroup) oFbPurchasingGroup.setValue("");
            if (oFbDocType) oFbDocType.setValue("");
            if (oFbCreatedBy) oFbCreatedBy.setValue("");

            if (oFbDateRange) {
                oFbDateRange.setValue("");
                if (typeof oFbDateRange.setDateValue === "function") {
                    oFbDateRange.setDateValue(null);
                    oFbDateRange.setSecondDateValue(null);
                }
            }

            if (oFbStatus) {
                oFbStatus.setSelectedKey("");
            }

            this._applyFilters();
        },

        _formatDateToISO: function (oDate) {
            if (!oDate || !(oDate instanceof Date) || isNaN(oDate.getTime())) {
                return null;
            }
            var iYear = oDate.getFullYear();
            var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
            var sDay = String(oDate.getDate()).padStart(2, "0");
            return iYear + "-" + sMonth + "-" + sDay;
        },

        _buildFilterCriteria: function () {
            var aFilters = [];

            // 1. Global Toolbar Search Query
            var oSearchField = this.byId("searchField");
            var sQuery = oSearchField ? oSearchField.getValue() : "";
            if (sQuery && sQuery.trim().length > 0) {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("PurchaseOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("Supplier", FilterOperator.Contains, sTrimmed),
                        new Filter("SupplierName", FilterOperator.Contains, sTrimmed),
                        new Filter("CompanyCode", FilterOperator.Contains, sTrimmed),
                        new Filter("CreatedByUser", FilterOperator.Contains, sTrimmed),
                        new Filter("UserFullName", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            // 2. FilterBar: Purchase Order Number
            var oFbPO = this.byId("fbPO");
            if (oFbPO && oFbPO.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrder", FilterOperator.Contains, oFbPO.getValue().trim()));
            }

            // 3. FilterBar: Supplier (Matches ID or Name)
            var oFbSupplier = this.byId("fbSupplier");
            if (oFbSupplier && oFbSupplier.getValue().trim() !== "") {
                var sSupplier = oFbSupplier.getValue().trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("Supplier", FilterOperator.Contains, sSupplier),
                        new Filter("SupplierName", FilterOperator.Contains, sSupplier)
                    ],
                    and: false
                }));
            }

            // 4. FilterBar: Company Code
            var oFbCompanyCode = this.byId("fbCompanyCode");
            if (oFbCompanyCode && oFbCompanyCode.getValue().trim() !== "") {
                aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, oFbCompanyCode.getValue().trim()));
            }

            // 5. FilterBar: Purchasing Organization
            var oFbPurchasingOrg = this.byId("fbPurchasingOrg");
            if (oFbPurchasingOrg && oFbPurchasingOrg.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchasingOrganization", FilterOperator.EQ, oFbPurchasingOrg.getValue().trim()));
            }

            // 6. FilterBar: Purchasing Group
            var oFbPurchasingGroup = this.byId("fbPurchasingGroup");
            if (oFbPurchasingGroup && oFbPurchasingGroup.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchasingGroup", FilterOperator.EQ, oFbPurchasingGroup.getValue().trim()));
            }

            // 7. FilterBar: Purchase Order Type
            var oFbDocType = this.byId("fbDocType");
            if (oFbDocType && oFbDocType.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrderType", FilterOperator.EQ, oFbDocType.getValue().trim()));
            }

            // 8. FilterBar: Creation Date Range
            var oFbDateRange = this.byId("fbDateRange");
            if (oFbDateRange) {
                var dStart = typeof oFbDateRange.getDateValue === "function" ? oFbDateRange.getDateValue() : null;
                var dEnd = typeof oFbDateRange.getSecondDateValue === "function" ? oFbDateRange.getSecondDateValue() : null;
                var sStart = this._formatDateToISO(dStart);
                var sEnd = this._formatDateToISO(dEnd);

                if (sStart && sEnd) {
                    if (sStart === sEnd) {
                        aFilters.push(new Filter("CreationDate", FilterOperator.EQ, sStart));
                    } else {
                        aFilters.push(new Filter("CreationDate", FilterOperator.BT, sStart, sEnd));
                    }
                } else if (sStart) {
                    aFilters.push(new Filter("CreationDate", FilterOperator.GE, sStart));
                }
            }

            // 9. FilterBar: Created By (Matches Username or Full Name)
            var oFbCreatedBy = this.byId("fbCreatedBy");
            if (oFbCreatedBy && oFbCreatedBy.getValue().trim() !== "") {
                var sCreatedBy = oFbCreatedBy.getValue().trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("CreatedByUser", FilterOperator.Contains, sCreatedBy),
                        new Filter("UserFullName", FilterOperator.Contains, sCreatedBy)
                    ],
                    and: false
                }));
            }

            // 10. FilterBar: SAP status code or Deleted, as shown in the Status column
            var oFbStatus = this.byId("fbStatus");
            var oStatusFilter = oFbStatus ? ControllerClass._statusFilter(oFbStatus.getSelectedKey()) : null;
            if (oStatusFilter) { aFilters.push(oStatusFilter); }

            return aFilters;
        },

        _applyFilters: function () {
            var aFilters = this._buildFilterCriteria();
            var oFinalFilter = aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : [];

            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(oFinalFilter);
            }
        }
    };
}

var oExports = {
    createTableFilter: createTableFilter
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
