function createCreatePurchaseOrderMessages(deps) {
    deps = deps || {};
    var MessagePopover = deps.MessagePopover;
    var MessageItem = deps.MessageItem;

    return {
        onDismissError: function () {
            var oModel = this.getView().getModel("newPO");
            if (oModel) {
                oModel.setProperty("/hasError", false);
                oModel.setProperty("/errorMessage", "");
            }
        },

        _initMessagePopover: function () {
            var that = this;
            var oMessageTemplate = new MessageItem({
                type: "{newPO>type}",
                title: "{newPO>title}",
                subtitle: "{newPO>field}",
                description: "{newPO>description}",
                activeTitle: true
            });

            this._oMessagePopover = new MessagePopover({
                items: {
                    path: "newPO>/errorList",
                    template: oMessageTemplate
                },
                itemSelect: function (oEvent) {
                    var oItem = oEvent.getParameter("item");
                    if (oItem) {
                        var oContext = oItem.getBindingContext("newPO");
                        if (oContext) {
                            that._navigateToErrorTarget(oContext.getObject());
                        }
                    }
                }
            });
            this.getView().addDependent(this._oMessagePopover);
        },

        _whenRendered: function (oControl) {
            return new Promise(function (resolve) {
                if (!oControl) {
                    resolve(null);
                    return;
                }
                var oDomRef = typeof oControl.getDomRef === "function" ? oControl.getDomRef() : null;
                if (oDomRef) {
                    resolve(oControl);
                    return;
                }
                if (typeof oControl.addEventDelegate === "function") {
                    var iFallbackTimer;
                    var oDelegate = {
                        onAfterRendering: function () {
                            if (iFallbackTimer) {
                                clearTimeout(iFallbackTimer);
                            }
                            if (typeof oControl.removeEventDelegate === "function") {
                                oControl.removeEventDelegate(oDelegate);
                            }
                            resolve(oControl);
                        }
                    };
                    oControl.addEventDelegate(oDelegate);
                    iFallbackTimer = setTimeout(function () {
                        if (typeof oControl.removeEventDelegate === "function") {
                            oControl.removeEventDelegate(oDelegate);
                        }
                        resolve(oControl);
                    }, 500);
                } else {
                    resolve(oControl);
                }
            });
        },

        _focusAndScrollIntoView: function (oControl) {
            if (!oControl) return;
            this._whenRendered(oControl).then(function (oRenderedControl) {
                if (!oRenderedControl) return;
                if (typeof oRenderedControl.focus === "function") {
                    oRenderedControl.focus();
                }
                var oDomRef = typeof oRenderedControl.getDomRef === "function" ? oRenderedControl.getDomRef() : null;
                if (oDomRef && typeof oDomRef.scrollIntoView === "function") {
                    oDomRef.scrollIntoView({ behavior: "smooth", block: "center" });
                }
            });
        },

        _openMessagePopover: function () {
            var oBtn = this.byId("btnMessages");
            if (!oBtn) return;
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            var that = this;
            this._whenRendered(oBtn).then(function (oButtonControl) {
                if (oButtonControl && that._oMessagePopover && !that._oMessagePopover.isOpen()) {
                    var oDom = typeof oButtonControl.getDomRef === "function" ? oButtonControl.getDomRef() : null;
                    if (oDom || typeof that._oMessagePopover.openBy === "function") {
                        that._oMessagePopover.openBy(oButtonControl);
                    }
                }
            });
        },

        _navigateToErrorTarget: function (oError) {
            if (!oError) return;
            var that = this;

            if (typeof oError.controlId === "string" && oError.controlId !== "poItemsTable") {
                var oControl = this.byId(oError.controlId);
                if (oControl) {
                    this._focusAndScrollIntoView(oControl);
                    return;
                }
            }

            var oTable = this.byId("poItemsTable");
            if (oTable) {
                this._whenRendered(oTable).then(function (oRenderedTable) {
                    if (!oRenderedTable) return;
                    var iItemIndex = oError.itemIndex !== undefined ? oError.itemIndex : 0;
                    var aTableItems = typeof oRenderedTable.getItems === "function" ? oRenderedTable.getItems() : [];
                    if (aTableItems && aTableItems[iItemIndex]) {
                        var oRow = aTableItems[iItemIndex];
                        var aCells = typeof oRow.getCells === "function" ? oRow.getCells() : [];
                        var iCellIndex = oError.cellIndex !== undefined ? oError.cellIndex : 1;
                        var oTargetCell = aCells[iCellIndex] || oRow;
                        that._focusAndScrollIntoView(oTargetCell);
                    }
                });
            }
        },

        onMessageButtonPress: function (oEvent) {
            var oSource = oEvent ? oEvent.getSource() : this.byId("btnMessages");
            if (!this._oMessagePopover) {
                this._initMessagePopover();
            }
            this._oMessagePopover.toggle(oSource);
        },

        _getErrorMessageConfig: function (oError) {
            var iStatus = (oError && oError.status) || 500;
            var sMessage = (oError && oError.message) || "";

            if (oError && oError.responseText) {
                try {
                    var oParsed = JSON.parse(oError.responseText);
                    if (oParsed.error && oParsed.error.message) {
                        sMessage = typeof oParsed.error.message === "object" ? (oParsed.error.message.value || sMessage) : oParsed.error.message;
                    }
                } catch (e) {}
            } else if (oError && oError.error && oError.error.message) {
                sMessage = typeof oError.error.message === "object" ? (oError.error.message.value || sMessage) : oError.error.message;
            }

            switch (iStatus) {
                case 400:
                    return {
                        title: this.getText("poErrTitleInvalidInput", null, "Invalid Input"),
                        message: sMessage || this.getText("poErrTitleInvalidInput", null, "Invalid Input")
                    };
                case 401:
                    return {
                        title: this.getText("poErrTitleAuthFailed", null, "Authentication Failed"),
                        message: this.getText("poErrMsgAuthFailed", null, "Your session is unauthenticated or has expired. Please log in again.")
                    };
                case 403:
                    return {
                        title: this.getText("poErrTitleAuthDenied", null, "Authorization Denied"),
                        message: sMessage || this.getText("poErrMsgAuthDenied", null, "You do not have permission to create Purchase Orders in this Purchasing Organization or Group.")
                    };
                case 404:
                    return {
                        title: this.getText("poErrTitleNotFound", null, "Resource Not Found"),
                        message: sMessage || this.getText("poErrMsgNotFound", null, "One or more referenced master data records (Supplier, Material, Plant) were not found in SAP.")
                    };
                case 409:
                    return {
                        title: this.getText("poErrTitleLocked", null, "Document Locked / Conflict"),
                        message: sMessage || this.getText("poErrMsgLocked", null, "The purchasing record or supplier is currently locked in SAP S/4HANA by another process. Please retry shortly.")
                    };
                case 422:
                    return {
                        title: this.getText("poErrTitleValidation", null, "Business Validation Error"),
                        message: sMessage
                    };
                case 502:
                case 503:
                    return {
                        title: this.getText("poErrTitleUnavailable", null, "S/4HANA Backend Unavailable"),
                        message: this.getText("poErrMsgUnavailable", null, "The SAP S/4HANA backend system is currently unreachable. Please check connectivity or destination configuration.")
                    };
                case 500:
                default:
                    return {
                        title: this.getText("poErrTitleAppError", null, "Application Error"),
                        message: sMessage
                    };
            }
        }
    };
}

var oExports = {
    createCreatePurchaseOrderMessages: createCreatePurchaseOrderMessages
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
