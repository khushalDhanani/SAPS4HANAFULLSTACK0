function createCreateSalesOrderMessages(deps) {
    deps = deps || {};
    var JSONModel = deps.JSONModel;
    var MessagePopover = deps.MessagePopover;
    var MessageItem = deps.MessageItem;
    var MessageToast = deps.MessageToast;
    var SalesOrderModel = deps.SalesOrderModel;

    return {
        onCheckIncompletion: function () {
            var oModel = this.getView().getModel("newOrder");
            var bValid = SalesOrderModel.validateForm(oModel);
            var aGaps = SalesOrderModel.getIncompletionGaps(oModel);
            if (bValid && aGaps.length === 0) {
                MessageToast.show("Document is complete. No incompletions detected.");
            } else {
                this.onMessageButtonPress();
            }
        },

        onDismissError: function () {
            var oModel = this.getView().getModel("newOrder");
            if (oModel) {
                oModel.setProperty("/hasError", false);
                oModel.setProperty("/errorMessage", "");
            }
        },

        onMessageButtonPress: function (oEvent) {
            var oSource = (oEvent && oEvent.getSource) ? oEvent.getSource() : this.byId("btnOrderMessages");
            if (!oSource) return;

            var oModel = this.getView().getModel("newOrder");
            var aErrors = oModel.getProperty("/errorList") || [];

            if (!this._oMessagePopover) {
                var oMessageTemplate = new MessageItem({
                    type: "Error",
                    title: "{title}",
                    description: "{description}"
                });

                this._oMessagePopover = new MessagePopover({
                    items: {
                        path: "/",
                        template: oMessageTemplate
                    }
                });
                this.getView().addDependent(this._oMessagePopover);
            }

            var aItemsData = aErrors.map(function (err) {
                return {
                    title: err.message,
                    description: "Field: " + err.field
                };
            });

            var oMsgModel = new JSONModel(aItemsData);
            this._oMessagePopover.setModel(oMsgModel);
            this._oMessagePopover.toggle(oSource);
        }
    };
}

var oExports = {
    createCreateSalesOrderMessages: createCreateSalesOrderMessages
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
