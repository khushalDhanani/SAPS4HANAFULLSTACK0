function createAiWidget(deps) {
    deps = deps || {};
    var Fragment = deps.Fragment;
    var JSONModel = deps.JSONModel;
    var ControllerClass = deps.ControllerClass;

    return {
        /** Loads the floating launcher + assistant panel once and mounts them into the page. */
        _initAIWidget: function () {
            var oView = this.getView(), that = this;
            if (this._pAIWidget) { return this._pAIWidget; }
            oView.setModel(new JSONModel({
                open: false,
                question: "",
                messages: [],
                busy: false,
                streaming: false,
                loadingStep: "",
                lastQuestion: "",
                followUps: []
            }), "aiDialog");
            this._pAIWidget = Fragment.load({
                id: oView.getId(),
                name: "saps4hana.fiori.modules.mm.purchase-order.view.AskAIDialog",
                controller: this
            }).then(function (aControls) {
                var oPage = that.byId("purchaseOrdersPage");
                [].concat(aControls).forEach(function (oCtl) { oPage.addContent(oCtl); });
                that._attachAILinkDelegation();
            });
            return this._pAIWidget;
        },

        _attachAILinkDelegation: function () {
            var oWidget = this.byId("aiWidget");
            if (!oWidget || this._bAILinkDelegated || typeof oWidget.addEventDelegate !== "function") { return; }
            this._bAILinkDelegated = true;
            var that = this;
            oWidget.addEventDelegate({
                onclick: function (oEvent) {
                    var oTarget = oEvent.target;
                    var oLink = oTarget && (oTarget.closest ? oTarget.closest(".aiPoLink") : null);
                    if (!oLink && oTarget && typeof oTarget.getAttribute === "function" && oTarget.getAttribute("data-po")) {
                        oLink = oTarget;
                    }
                    if (oLink && typeof oLink.getAttribute === "function") {
                        var sPo = oLink.getAttribute("data-po");
                        if (sPo) {
                            oEvent.preventDefault();
                            that.onNavToPO(sPo);
                        }
                    }
                }
            });
        },

        onNavToPO: function (sPo) {
            if (!sPo) { return; }
            var oComponent = this.getOwnerComponent && this.getOwnerComponent();
            var oRouter = oComponent && typeof oComponent.getRouter === "function" ? oComponent.getRouter() : null;
            if (oRouter && typeof oRouter.navTo === "function") {
                oRouter.navTo("purchaseOrderDetail", {
                    PurchaseOrder: String(sPo).trim()
                });
            }
        },

        onAskAI: function () {
            var that = this;
            this._initAIWidget().then(function () {
                that.getView().getModel("aiDialog").setProperty("/open", true);
                that._scrollAIChatToBottom();
                var oInput = that.byId("aiInput");
                if (oInput) { setTimeout(function () { oInput.focus(); }, 100); }
            });
        },

        onAIClose: function () {
            this.getView().getModel("aiDialog").setProperty("/open", false);
            var oFab = this.byId("aiFab");
            if (oFab && typeof oFab.focus === "function") {
                oFab.focus();
            }
        },

        onAIClear: function () {
            var oModel = this.getView().getModel("aiDialog");
            oModel.setProperty("/messages", []);
            oModel.setProperty("/question", "");
            oModel.setProperty("/followUps", []);
            oModel.setProperty("/loadingStep", "");
            oModel.setProperty("/lastQuestion", "");
            this._sLastQuestion = "";
        },

        onAIPreset: function (oEvent) {
            this.getView().getModel("aiDialog").setProperty("/question", oEvent.getSource().getText());
            this.onAIAsk();
        },

        onAIFollowUp: function (oEvent) {
            var sQuestion = "";
            if (oEvent && typeof oEvent.getSource === "function") {
                var oCtx = oEvent.getSource().getBindingContext("aiDialog");
                if (oCtx && oCtx.getProperty("question")) {
                    sQuestion = oCtx.getProperty("question");
                }
                if (!sQuestion && typeof oEvent.getSource().getText === "function") {
                    sQuestion = oEvent.getSource().getText();
                }
            } else if (typeof oEvent === "string") {
                sQuestion = oEvent;
            }
            if (sQuestion) {
                this.getView().getModel("aiDialog").setProperty("/question", sQuestion);
                this.onAIAsk();
            }
        },

        onAIRetry: function (oEvent) {
            var sQuestion = "";
            if (oEvent && typeof oEvent.getSource === "function") {
                var oCtx = oEvent.getSource().getBindingContext("aiDialog");
                if (oCtx && oCtx.getProperty("lastQuestion")) {
                    sQuestion = oCtx.getProperty("lastQuestion");
                }
            }
            var oModel = this.getView().getModel("aiDialog");
            if (!sQuestion) {
                sQuestion = oModel.getProperty("/lastQuestion") || this._sLastQuestion || "";
            }
            if (!sQuestion) {
                var aMsgs = oModel.getProperty("/messages") || [];
                for (var i = aMsgs.length - 1; i >= 0; i--) {
                    if (aMsgs[i].role === "user" && aMsgs[i].content) {
                        sQuestion = aMsgs[i].content;
                        break;
                    }
                }
            }
            if (sQuestion) {
                oModel.setProperty("/question", sQuestion);
                this.onAIAsk();
            }
        },

        onAIStop: function () {
            if (this._oAIAbortController) {
                try {
                    this._oAIAbortController.abort();
                } catch (e) {
                    // ignore
                }
                this._oAIAbortController = null;
            }
            var oModel = this.getView().getModel("aiDialog");
            oModel.setProperty("/busy", false);
            oModel.setProperty("/streaming", false);
            oModel.setProperty("/loadingStep", "");
            var aMessages = (oModel.getProperty("/messages") || []).slice();
            if (aMessages.length > 0) {
                var oLast = aMessages[aMessages.length - 1];
                if (oLast.role === "assistant" && !oLast.error) {
                    var sStopNote = "\n\n_[" + this.getText("aiStopped", null, "Generation stopped by user.") + "]_";
                    if (oLast.content.indexOf(sStopNote) === -1) {
                        oLast.content += sStopNote;
                        oLast.html = ControllerClass._toHtml(oLast.content);
                        this._refreshAIMessages(aMessages, true);
                    }
                }
            }
        },

        _scrollAIChatToBottom: function (iDuration) {
            var oScroll = this.byId("aiChatScroll");
            if (oScroll) { setTimeout(function () { oScroll.scrollTo(0, 1e6, iDuration == null ? 200 : iDuration); }, 50); }
        },

        _formatTime: function (d) {
            return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
        }
    };
}

var oExports = {
    createAiWidget: createAiWidget
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
