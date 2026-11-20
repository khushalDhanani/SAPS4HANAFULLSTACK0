function createAiChat(deps) {
    deps = deps || {};
    var ODataClient = deps.ODataClient;
    var InvisibleMessage = deps.InvisibleMessage;
    var ControllerClass = deps.ControllerClass;

    return {
        onAIAsk: function () {
            var that = this;
            var oModel = this.getView().getModel("aiDialog");
            var sQuestion = (oModel.getProperty("/question") || "").trim();
            if (!sQuestion || oModel.getProperty("/busy")) { return; }
            this._sLastQuestion = sQuestion;
            oModel.setProperty("/lastQuestion", sQuestion);
            var aMessages = (oModel.getProperty("/messages") || []).slice();
            aMessages.push({ role: "user", content: sQuestion, html: ControllerClass._toHtml(sQuestion), meta: that._formatTime(new Date()) });
            oModel.setProperty("/messages", aMessages);
            oModel.setProperty("/question", "");
            oModel.setProperty("/busy", true);
            oModel.setProperty("/streaming", false);
            oModel.setProperty("/loadingStep", that.getText("aiLoadingRetrieving", null, "Retrieving verified SAP records..."));
            oModel.setProperty("/followUps", []);
            this._scrollAIChatToBottom();

            if (typeof AbortController !== "undefined") {
                this._oAIAbortController = new AbortController();
            } else {
                this._oAIAbortController = null;
            }
            var oSignal = this._oAIAbortController ? this._oAIAbortController.signal : null;

            var oAnswer = null, oScope;
            var oPayload;
            var oIntents = ControllerClass._detectProcurementIntents(sQuestion);
            var oPlan = ControllerClass._buildRetrievalPlan(sQuestion, oIntents);
            var oValidation = ControllerClass._validateRetrievalPlan(oPlan);
            var bItems = oIntents.intents.indexOf("ITEM") !== -1 ||
                         oIntents.intents.indexOf("DELIVERY_DATE") !== -1 ||
                         oIntents.intents.indexOf("QUANTITY") !== -1 ||
                         oIntents.intents.indexOf("MATERIAL") !== -1 ||
                         ControllerClass._asksAboutItems(sQuestion);
            var bStatus = oIntents.intents.indexOf("STATUS") !== -1 || ControllerClass._asksAboutStatus(sQuestion);
            return Promise.all([
                this._fetchAIContextRows().then(function (aRows) { return that._fetchMentionedPurchaseOrders(sQuestion, aRows); })
                    .then(function (oCtx) {
                        if (!bItems) { return oCtx; }
                        return that._fetchItemsForPOs(oCtx.rows.map(function (r) { return r.po; })).then(function (aItems) { oCtx.items = aItems; return oCtx; });
                    }),
                bStatus ? this._getAIStatusBreakdown() : null,
                this._fetchTopPOsByNet(15),
                this._searchItems(sQuestion)
            ]).then(function (aRes) {
                if (oSignal && oSignal.aborted) {
                    var oErrAbort = new Error("AbortError");
                    oErrAbort.name = "AbortError";
                    throw oErrAbort;
                }
                var oCtx = aRes[0];
                oScope = that._getAIScope(oCtx.rows.length, oCtx.isFallback, oCtx.queryFailed);
                oScope.statusCounts = aRes[1];
                oScope.topPOsByNet = aRes[2];
                oScope.items = oCtx.items || null;
                oScope.search = aRes[3];
                oScope.intents = oIntents;
                oScope.retrievalPlan = oPlan;
                oScope.retrievalValidation = oValidation;
                if (oScope.search && oScope.search.headers.length) {
                    var mSeen = {};
                    oCtx.rows.forEach(function (r) { mSeen[r.po] = true; });
                    oScope.search.headers.forEach(function (r) { if (!mSeen[r.po]) { oCtx.rows.push(r); mSeen[r.po] = true; } });
                }
                oScope.shown = oCtx.rows.length;
                if (!oScope.queryFailed && !oScope.isFallback) {
                    oScope.completeness = ControllerClass._classifyCompleteness(oScope.shown, oScope.total, false, false);
                }
                that._oLastAIScope = oScope;
                oPayload = {
                    messages: aMessages.filter(function (m) { return !m.error; }).map(function (m) { return { role: m.role, content: m.content }; }),
                    system: ControllerClass._buildAISystemPrompt(oCtx.rows, oCtx.notFound, oScope)
                };
                oModel.setProperty("/loadingStep", that.getText("aiLoadingGenerating", null, "Analyzing verified SAP records..."));
                return that._streamAIChat(oPayload, function (sPartial) {
                    if (!oAnswer) {
                        oAnswer = { role: "assistant", content: "", html: "", meta: "" };
                        aMessages.push(oAnswer);
                        oModel.setProperty("/streaming", true);
                        oModel.setProperty("/loadingStep", "");
                    }
                    oAnswer.content = sPartial;
                    oAnswer.html = ControllerClass._toHtml(sPartial);
                    that._refreshAIMessages(aMessages);
                }, oSignal).catch(function (oErr) {
                    if (oErr && (oErr.name === "AbortError" || (oSignal && oSignal.aborted))) {
                        throw oErr;
                    }
                    if (oAnswer) { throw oErr; }
                    return ODataClient.post("/odata/v4/ai/chat", oPayload).then(function (r) { return { content: (r && r.answer) || "", model: r && r.model }; });
                });
            }).then(function (oResult) {
                if (oSignal && oSignal.aborted) { return; }
                if (!oAnswer) { oAnswer = { role: "assistant" }; aMessages.push(oAnswer); }
                if (oResult.truncated) { oResult.content += "\n\n_" + that.getText("aiTruncated") + "_"; }
                oAnswer.content = oResult.content;
                oAnswer.html = ControllerClass._toHtml(oResult.content);
                oAnswer.meta = ControllerClass._aiMetaText(that, oScope, oResult.model);
                oAnswer.metaTooltip = ControllerClass._aiMetaTooltip(oScope);
                var aFollowUps = ControllerClass._generateFollowUps(oScope, sQuestion);
                oModel.setProperty("/followUps", aFollowUps);
            }).catch(function (oErr) {
                if (oErr && (oErr.name === "AbortError" || (oSignal && oSignal.aborted))) {
                    if (!oAnswer) {
                        var sStoppedText = "_[" + that.getText("aiStopped", null, "Generation stopped by user.") + "]_";
                        aMessages.push({ role: "assistant", content: sStoppedText, html: ControllerClass._toHtml(sStoppedText), meta: "" });
                    }
                    return;
                }
                var sMsg = (oErr && oErr.message) || String(oErr);
                aMessages.push({
                    role: "assistant",
                    error: true,
                    content: sMsg,
                    html: ControllerClass._toHtml(sMsg),
                    lastQuestion: sQuestion,
                    meta: ""
                });
                oModel.setProperty("/followUps", [
                    { text: "Retry: " + (sQuestion.length > 30 ? sQuestion.slice(0, 30) + "..." : sQuestion), question: sQuestion }
                ]);
            }).finally(function () {
                that._oAIAbortController = null;
                oModel.setProperty("/busy", false);
                oModel.setProperty("/streaming", false);
                oModel.setProperty("/loadingStep", "");
                that._refreshAIMessages(aMessages, true);
                var oLastMessage = aMessages[aMessages.length - 1];
                if (oLastMessage && oLastMessage.role === "assistant" && oLastMessage.content) {
                    var oInvisible = InvisibleMessage && typeof InvisibleMessage.getInstance === "function" ? InvisibleMessage.getInstance() : null;
                    if (oInvisible && typeof oInvisible.announce === "function") {
                        oInvisible.announce(oLastMessage.content, "Polite");
                    }
                }
            });
        },

        _refreshAIMessages: function (aMessages, bNow) {
            var that = this, oModel = this.getView().getModel("aiDialog");
            var apply = function () { that._iAIRaf = null; oModel.setProperty("/messages", aMessages.slice()); that._scrollAIChatToBottom(0); };
            if (bNow || typeof requestAnimationFrame !== "function") { if (this._iAIRaf) { cancelAnimationFrame(this._iAIRaf); } apply(); return; }
            if (!this._iAIRaf) { this._iAIRaf = requestAnimationFrame(apply); }
        },

        _streamAIChat: function (oPayload, fnPartial, oSignal) {
            if (typeof fetch !== "function" || typeof TextDecoder !== "function") { return Promise.reject(new Error("streaming unsupported")); }
            var mHeaders = Object.assign({ "Content-Type": "application/json", "Accept": "text/event-stream" }, ODataClient.authHeaders());
            var oFetchOptions = { method: "POST", headers: mHeaders, body: JSON.stringify(oPayload), credentials: "same-origin" };
            if (oSignal) {
                oFetchOptions.signal = oSignal;
            }
            return fetch("/ai/chat/stream", oFetchOptions).then(function (oRes) {
                if (!oRes.ok || !oRes.body) { throw new Error("stream HTTP " + oRes.status); }
                var oReader = oRes.body.getReader(), oDec = new TextDecoder(), sBuf = "", sText = "", sModel = null, sTruncated = false;
                return new Promise(function (resolve, reject) {
                    if (oSignal) {
                        if (oSignal.aborted) {
                            try { oReader.cancel(); } catch (e) {}
                            var oAbortErr = new Error("AbortError");
                            oAbortErr.name = "AbortError";
                            reject(oAbortErr);
                            return;
                        }
                        oSignal.addEventListener("abort", function () {
                            try { oReader.cancel(); } catch (e) {}
                            var oAbortErr = new Error("AbortError");
                            oAbortErr.name = "AbortError";
                            reject(oAbortErr);
                        });
                    }
                    var pump = function () {
                        oReader.read().then(function (r) {
                            if (r.done) { resolve({ content: sText, model: sModel, truncated: sTruncated }); return; }
                            sBuf += oDec.decode(r.value, { stream: true });
                            var o = ControllerClass._parseSSE(sBuf);
                            sBuf = o.rest;
                            for (var i = 0; i < o.events.length; i++) {
                                var e = o.events[i];
                                if (e.error) { reject(new Error(e.error)); return; }
                                if (e.delta) { sText += e.delta; fnPartial(sText); }
                                if (e.done) { sModel = e.model || sModel; if (e.finishReason === "length") { sTruncated = true; } }
                            }
                            pump();
                        }).catch(reject);
                    };
                    pump();
                });
            });
        }
    };
}

var oExports = {
    createAiChat: createAiChat
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
