function createCreateSalesInquiryMessages(deps) {
    deps = deps || {};
    var JSONModel = deps.JSONModel;
    var MessagePopover = deps.MessagePopover;
    var MessageItem = deps.MessageItem;
    var MessageToast = deps.MessageToast;
    var SalesInquiryModel = deps.SalesInquiryModel;

    return {
        onCheckIncompletion: function () {
            var oModel = this.getView().getModel("newInquiry");
            var bValid = SalesInquiryModel.validateForm(oModel);
            var aGaps = SalesInquiryModel.getIncompletionGaps(oModel);
            if (bValid && aGaps.length === 0) {
                MessageToast.show("Document is complete. No incompletions detected.");
            } else {
                this.onMessageButtonPress();
            }
        },

        onMessageButtonPress: function (oEvent) {
            var oModel = this.getView().getModel("newInquiry");
            var oErrors = oModel.getProperty("/errors") || {};
            var aItems = oModel.getProperty("/items") || [];
            var aMessages = [];

            Object.keys(oErrors).forEach(function (field) {
                if (oErrors[field] && oErrors[field].state === "Error") {
                    aMessages.push({
                        type: "Error",
                        title: oErrors[field].text,
                        subtitle: "Header: " + field
                    });
                }
            });

            aItems.forEach(function (item, idx) {
                if (item && item.errors) {
                    Object.keys(item.errors).forEach(function (field) {
                        if (item.errors[field] && item.errors[field].state === "Error") {
                            aMessages.push({
                                type: "Error",
                                title: item.errors[field].text,
                                subtitle: "Item " + (idx + 1) + ": " + field
                            });
                        }
                    });
                }
            });

            (oModel.getProperty("/readinessGaps") || []).forEach(function (gap) {
                aMessages.push({ type: "Warning", title: gap.title, subtitle: gap.subtitle });
            });

            if (aMessages.length === 0) {
                MessageToast.show("No issues detected.");
                return;
            }

            if (!this._oMessagePopover) {
                this._oMessagePopover = new MessagePopover({
                    items: {
                        path: "msg>/",
                        template: new MessageItem({
                            type: "{msg>type}",
                            title: "{msg>title}",
                            subtitle: "{msg>subtitle}"
                        })
                    }
                });
                this.getView().addDependent(this._oMessagePopover);
            }

            var oMsgModel = new JSONModel(aMessages);
            this._oMessagePopover.setModel(oMsgModel, "msg");

            var that = this;
            var oSource = (oEvent && typeof oEvent.getSource === "function") ? oEvent.getSource() : null;
            var oBtn = oSource || (typeof this.byId === "function" ? this.byId("btnInquiryMessages") : null);
            if (!oBtn || !oBtn.getDomRef()) {
                oBtn = (typeof this.byId === "function" ? (this.byId("btnSaveInquiry") || this.byId("btnCheckIncompletion")) : null);
            }

            setTimeout(function () {
                if (that._oMessagePopover && !that._oMessagePopover.isOpen()) {
                    var oTarget = (oBtn && oBtn.getDomRef()) ? oBtn : (typeof that.byId === "function" ? (that.byId("btnSaveInquiry") || that.byId("btnCheckIncompletion")) : null);
                    if (oTarget && oTarget.getDomRef()) {
                        that._oMessagePopover.openBy(oTarget);
                    }
                }
            }, 50);
        },

        onDismissError: function () {
            var oModel = this.getView().getModel("newInquiry");
            oModel.setProperty("/hasError", false);
            oModel.setProperty("/errorMessage", "");
        }
    };
}

var oExports = {
    createCreateSalesInquiryMessages: createCreateSalesInquiryMessages
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
