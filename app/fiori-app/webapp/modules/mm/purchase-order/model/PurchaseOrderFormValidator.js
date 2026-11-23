(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory(require("./PurchaseOrderRules"), require("./PurchaseOrderValidationLimits"), require("./PurchaseOrderHeaderValidator"));
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define(["./PurchaseOrderRules", "./PurchaseOrderValidationLimits", "./PurchaseOrderHeaderValidator"], factory);
    }
})(this, function (_rules, Limits, HeaderValidator) {
    "use strict";

    var TAX_CODE_MAX_LEN = Limits.TAX_CODE_MAX_LEN;

    /**
     * Validates all line items, sets item.errors states and appends summary entries to aErrorList.
     */
    function _validateItems(aItems, oPoRule, sCleanDocType, fnResolve, aErrorList) {
        // Items errors
        if (aItems.length === 0) {
            aErrorList.push({
                type: "Error",
                title: fnResolve("poValSummaryAtLeastOneItem", null, "Please add at least one line item."),
                field: "Items Table",
                description: fnResolve("poValSummaryAtLeastOneItemDesc", null, "Click 'Add Item' to insert at least one purchasing line item."),
                controlId: "poItemsTable"
            });
        } else {
            var bMaterialRequired = oPoRule ? oPoRule.materialRequired !== false : true;
            var bStorageLocationRequired = oPoRule ? oPoRule.storageLocationRequired !== false : true;
            aItems.forEach(function (item, idx) {
                var sItemNo = item.PurchaseOrderItem || "Item #" + (idx + 1);
                item.errors = item.errors || {};
                item.errors.Plant = { state: "None", text: "" };
                item.errors.StorageLocation = { state: "None", text: "" };
                item.errors.Material = { state: "None", text: "" };
                item.errors.PurchaseOrderItemText = { state: "None", text: "" };
                item.errors.OrderQuantity = { state: "None", text: "" };
                item.errors.UnitOfMeasure = { state: "None", text: "" };
                item.errors.NetPriceAmount = { state: "None", text: "" };
                item.errors.TaxCode = { state: "None", text: "" };
                item.errors.PurchaseOrderItemCategory = { state: "None", text: "" };
                item.errors.AccountAssignmentCategory = { state: "None", text: "" };

                if (bMaterialRequired && (!item.Material || !String(item.Material).trim())) {
                    item.errors.Material = { state: "Error", text: fnResolve("poValMaterialRequired", null, "Material is required.") };
                    aErrorList.push({
                        type: "Error",
                        title: fnResolve("poValItemMaterialRequired", [sItemNo], sItemNo + ": Material is required."),
                        field: sItemNo + " / Material",
                        description: "Select a valid material master number (e.g. TG11).",
                        itemIndex: idx,
                        cellIndex: 5,
                        controlId: "poItemsTable"
                    });
                } else if (!bMaterialRequired && !item.Material && (!item.PurchaseOrderItemText || !String(item.PurchaseOrderItemText).trim())) {
                    item.errors.PurchaseOrderItemText = { state: "Error", text: "Short Text (Description) is required when Material is omitted." };
                    aErrorList.push({
                        type: "Error",
                        title: sItemNo + ": Short Text (Description) is required.",
                        field: sItemNo + " / Description",
                        description: "Enter a descriptive short text for this service/blanket line item.",
                        itemIndex: idx,
                        cellIndex: 6,
                        controlId: "poItemsTable"
                    });
                }

                if (!item.Plant || !String(item.Plant).trim()) {
                    item.errors.Plant = { state: "Error", text: fnResolve("poValItemPlantRequired", [""], "Plant is required.") };
                    aErrorList.push({
                        type: "Error",
                        title: fnResolve("poValItemPlantRequired", [sItemNo], sItemNo + ": Plant is required."),
                        field: sItemNo + " / Plant",
                        description: "Specify an authorized plant (e.g. 1010).",
                        itemIndex: idx,
                        cellIndex: 3,
                        controlId: "poItemsTable"
                    });
                } else if (oPoRule && oPoRule.allowedPlantPrefix && !String(item.Plant).trim().startsWith(oPoRule.allowedPlantPrefix)) {
                    var sPlantErr = sItemNo + ": Plant " + item.Plant + " must start with '" + oPoRule.allowedPlantPrefix + "' for " + sCleanDocType + ".";
                    item.errors.Plant = { state: "Error", text: sPlantErr };
                    aErrorList.push({
                        type: "Error",
                        title: sPlantErr,
                        field: sItemNo + " / Plant",
                        description: "Select a plant matching the company code / plant prefix for " + sCleanDocType + ".",
                        itemIndex: idx,
                        cellIndex: 3,
                        controlId: "poItemsTable"
                    });
                }

                if (bStorageLocationRequired && (!item.StorageLocation || !String(item.StorageLocation).trim())) {
                    item.errors.StorageLocation = { state: "Error", text: fnResolve("poValItemStorageLocRequired", [""], "Storage Location is required.") };
                    aErrorList.push({
                        type: "Error",
                        title: fnResolve("poValItemStorageLocRequired", [sItemNo], sItemNo + ": Storage Location is required."),
                        field: sItemNo + " / Storage Location",
                        description: "Specify the receiving storage location within the plant (e.g. 101A).",
                        itemIndex: idx,
                        cellIndex: 4,
                        controlId: "poItemsTable"
                    });
                }
                if (!item.UnitOfMeasure || !String(item.UnitOfMeasure).trim()) {
                    item.errors.UnitOfMeasure = { state: "Error", text: fnResolve("poValItemUnitRequired", [""], "Unit of Measure is required.") };
                    aErrorList.push({
                        type: "Error",
                        title: fnResolve("poValItemUnitRequired", [sItemNo], sItemNo + ": Unit of Measure is required."),
                        field: sItemNo + " / Unit of Measure",
                        description: "Specify the order unit of measure (e.g. PC, KG).",
                        itemIndex: idx,
                        cellIndex: 8,
                        controlId: "poItemsTable"
                    });
                }
                var fQty = parseFloat(item.OrderQuantity);
                if (!item.OrderQuantity || isNaN(fQty) || fQty <= 0) {
                    item.errors.OrderQuantity = { state: "Error", text: fnResolve("poValItemQtyPositive", [""], "Order Quantity must be greater than 0.") };
                    aErrorList.push({
                        type: "Error",
                        title: fnResolve("poValItemQtyPositive", [sItemNo], sItemNo + ": Order Quantity must be greater than 0."),
                        field: sItemNo + " / Quantity",
                        description: "Enter a positive numeric quantity.",
                        itemIndex: idx,
                        cellIndex: 7,
                        controlId: "poItemsTable"
                    });
                }
                if (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && String(item.NetPriceAmount).trim() !== "") {
                    var fPrice = parseFloat(item.NetPriceAmount);
                    if (isNaN(fPrice) || fPrice < 0) {
                        item.errors.NetPriceAmount = { state: "Error", text: fnResolve("poValItemNetPricePositive", [""], "Net Price must be non-negative.") };
                        aErrorList.push({
                            type: "Error",
                            title: fnResolve("poValItemNetPricePositive", [sItemNo], sItemNo + ": Net Price must be non-negative."),
                            field: sItemNo + " / Net Price",
                            description: "Enter 0.00 or a positive net price.",
                            itemIndex: idx,
                            cellIndex: 9,
                            controlId: "poItemsTable"
                        });
                    }
                }
                if (item.TaxCode && String(item.TaxCode).trim().length > TAX_CODE_MAX_LEN) {
                    item.errors.TaxCode = { state: "Error", text: fnResolve("poValItemTaxCodeMaxLen", [""], "Tax Code exceeds " + TAX_CODE_MAX_LEN + " characters.") };
                    aErrorList.push({
                        type: "Error",
                        title: fnResolve("poValItemTaxCodeMaxLen", [sItemNo], sItemNo + ": Tax Code exceeds " + TAX_CODE_MAX_LEN + " characters."),
                        field: sItemNo + " / Tax Code",
                        description: "Enter a " + TAX_CODE_MAX_LEN + "-character SAP tax code (e.g. V1, I0).",
                        itemIndex: idx,
                        cellIndex: 10,
                        controlId: "poItemsTable"
                    });
                }

                if (oPoRule && oPoRule.allowedItemCategories && item.PurchaseOrderItemCategory && !oPoRule.allowedItemCategories.includes(String(item.PurchaseOrderItemCategory).trim())) {
                    var sCatErr = sItemNo + ": Item Category " + item.PurchaseOrderItemCategory + " is not allowed for " + sCleanDocType + " (Allowed: " + oPoRule.allowedItemCategories.join(", ") + ").";
                    item.errors.PurchaseOrderItemCategory = { state: "Error", text: sCatErr };
                    aErrorList.push({
                        type: "Error",
                        title: sCatErr,
                        field: sItemNo + " / Item Category",
                        description: "Choose an authorized item category for " + sCleanDocType + ".",
                        itemIndex: idx,
                        cellIndex: 1,
                        controlId: "poItemsTable"
                    });
                }
                if (oPoRule && oPoRule.allowedAcctAssignmentCategories && item.AccountAssignmentCategory && !oPoRule.allowedAcctAssignmentCategories.includes(String(item.AccountAssignmentCategory).trim())) {
                    var sAcctErr = sItemNo + ": Account Assignment Category " + item.AccountAssignmentCategory + " is not allowed for " + sCleanDocType + " (Allowed: " + oPoRule.allowedAcctAssignmentCategories.join(", ") + ").";
                    item.errors.AccountAssignmentCategory = { state: "Error", text: sAcctErr };
                    aErrorList.push({
                        type: "Error",
                        title: sAcctErr,
                        field: sItemNo + " / Account Assignment",
                        description: "Choose an authorized account assignment category for " + sCleanDocType + ".",
                        itemIndex: idx,
                        cellIndex: 2,
                        controlId: "poItemsTable"
                    });
                }
            });
        }
    }

    /**
     * PurchaseOrderFormValidator
     *
     * Full-form validation of the Purchase Order model. Called through the
     * PurchaseOrderValidator facade.
     */
    return {
        /**
         * Validates the form data and updates field error states on the model for UI binding.
         *
         * @param {Object} oValidator - PurchaseOrderValidator facade
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Function} [fnTextResolver]
         * @returns {{ isValid: boolean, errorCount: number, errorList: Array<{title: string, field: string, description: string, controlId: any}>, errorMessage: string }}
         */
        validateForm: function (oValidator, oModel, fnTextResolver) {
            if (!oModel) return { isValid: false, errorCount: 0, errorList: [], errorMessage: "" };
            var fnResolve = fnTextResolver || oValidator.getText.bind(oValidator);
            var oData = typeof oModel.getData === "function" ? oModel.getData() : oModel;
            var oHeader = oData.header || {};
            var aItems = oData.items || [];
            var aErrorList = [];

            var sDocType = oHeader.PurchaseOrderType;
            var sCleanDocType = sDocType ? String(sDocType).trim().toUpperCase() : "";
            var oPoRule = (_rules && _rules.PO_TYPES && _rules.PO_TYPES[sCleanDocType]) || null;


            var oHeaderErrors = HeaderValidator.validateHeader(oValidator, oHeader, oPoRule, sCleanDocType, fnResolve, aErrorList);
            _validateItems(aItems, oPoRule, sCleanDocType, fnResolve, aErrorList);

            var bHasError = aErrorList.length > 0;
            var sSummary = "";
            if (bHasError) {
                sSummary = aErrorList.length === 1
                    ? aErrorList[0].title
                    : fnResolve("poValSummaryMultiErrors", [aErrorList.length], aErrorList.length + " validation errors found. Please correct the highlighted fields.");
            }

            if (typeof oModel.setProperty === "function") {
                oModel.setProperty("/errors", oHeaderErrors);
                oModel.setProperty("/items", aItems);
                oModel.setProperty("/hasError", bHasError);
                oModel.setProperty("/errorMessage", sSummary);
                oModel.setProperty("/errorCount", aErrorList.length);
                oModel.setProperty("/errorList", aErrorList);
            } else {
                oData.errors = oHeaderErrors;
                oData.items = aItems;
                oData.hasError = bHasError;
                oData.errorMessage = sSummary;
                oData.errorCount = aErrorList.length;
                oData.errorList = aErrorList;
            }

            return {
                isValid: !bHasError,
                errorCount: aErrorList.length,
                errorList: aErrorList,
                errorMessage: sSummary
            };
        }
    };
});
