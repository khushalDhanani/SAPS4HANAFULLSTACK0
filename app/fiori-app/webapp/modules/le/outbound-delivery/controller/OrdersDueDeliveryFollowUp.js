(function () {
    "use strict";

    function createOrdersDueDeliveryFollowUp(deps) {
        deps = deps || {};
        var MessageBox = deps.MessageBox;
        var OutboundDeliveryService = deps.OutboundDeliveryService;

        return {
            _statusLabel: function (sCode) {
                var m = { A: "not started", B: "partial", C: "complete", "": "not relevant" };
                return (sCode || "") + " (" + (m[sCode || ""] || sCode) + ")";
            },

            onLoadDeliveryStatus: function () {
                var that = this;
                var oFU = this.getView().getModel("deliveryFollowUp");
                var oInput = this.byId && this.byId("inpFollowUpDelivery");
                if (oInput && typeof oInput.getValue === "function") {
                    oFU.setProperty("/delivery", String(oInput.getValue() || "").trim());
                }
                var sDelivery = (oFU.getProperty("/delivery") || "").trim();
                oFU.setProperty("/status", null);
                oFU.setProperty("/statusText", "");
                oFU.setProperty("/canBill", false);
                oFU.setProperty("/billingTypes", []);
                oFU.setProperty("/billingType", "");
                if (!sDelivery) { return Promise.resolve(); }
                oFU.setProperty("/busy", true);
                return OutboundDeliveryService.getDeliveryStatus(sDelivery)
                    .then(function (o) {
                        oFU.setProperty("/status", o);
                        var sETag = (o && (o["@odata.etag"] || o.ETag || o.etag)) || "";
                        oFU.setProperty("/etag", sETag);
                        oFU.setProperty("/statusText", that._text("dlvFollowUpStatus", "Type {0} · Ship-to {1} · Picking {2} · Goods movement {3} · Billing {4}")
                            .replace("{0}", o.DeliveryDocumentType).replace("{1}", o.SoldToParty).replace("{2}", that._statusLabel(o.OverallPickingStatus))
                            .replace("{3}", that._statusLabel(o.OverallGoodsMovementStatus)).replace("{4}", that._statusLabel(o.OverallDelivReltdBillgStatus)));
                        oFU.setProperty("/canBill", o.OverallGoodsMovementStatus === "C" && ["A", "B"].indexOf(o.OverallDelivReltdBillgStatus) !== -1);
                    })
                    .catch(function (err) {
                        oFU.setProperty("/statusText", (err && (err.message || err.statusText)) || "Delivery status could not be read from SAP.");
                    })
                    .finally(function () { oFU.setProperty("/busy", false); });
            },

            onLoadBillingTypes: function () {
                var oFU = this.getView().getModel("deliveryFollowUp");
                var sDelivery = (oFU.getProperty("/delivery") || "").trim();
                if (!sDelivery) {
                    MessageBox.error(this._text("msgDeliveryNumberRequired", "Enter a delivery number."));
                    return;
                }
                oFU.setProperty("/busy", true);
                return OutboundDeliveryService.getBillingDocumentTypes(sDelivery)
                    .then(function (aTypes) {
                        oFU.setProperty("/billingTypes", aTypes);
                        oFU.setProperty("/billingType", aTypes.length === 1 ? aTypes[0].BillingDocumentType : "");
                        if (aTypes.length === 0) {
                            MessageBox.warning("S/4HANA returned no billing document type for delivery " + sDelivery + ".");
                        }
                    })
                    .catch(function (err) {
                        oFU.setProperty("/billingTypes", []);
                        MessageBox.error((err && (err.message || err.statusText)) || "Billing document types could not be read.");
                    })
                    .finally(function () { oFU.setProperty("/busy", false); });
            },

            onCreateBillingDocument: function () {
                var that = this;
                var oFU = this.getView().getModel("deliveryFollowUp");
                if (oFU && oFU.getProperty("/busy")) return;
                var sDelivery = (oFU.getProperty("/delivery") || "").trim();
                var sType = oFU.getProperty("/billingType") || "";
                if (!sDelivery) {
                    MessageBox.error(this._text("msgDeliveryNumberRequired", "Enter a delivery number."));
                    return;
                }
                MessageBox.confirm(this._text("msgConfirmBilling", "Create billing document (type {1}) in S/4HANA for delivery {0}?")
                    .replace("{0}", sDelivery).replace("{1}", sType || this._text("dlvFollowUpTypeBySap", "determined by SAP copy control")), {
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.OK) { return; }
                        oFU.setProperty("/busy", true);
                        var sETag = oFU.getProperty("/etag") || "";
                        OutboundDeliveryService.createBillingDocument(
                            { delivery: sDelivery, billingType: sType, billingDate: oFU.getProperty("/billingDate") },
                            sETag ? { etag: sETag } : undefined
                        )
                            .then(function (oRes) {
                                var sNo = oRes && oRes.BillingDocument;
                                var aMsgs = (oRes && oRes.Messages) || [];
                                var sDetail = aMsgs.map(function (m) { return m.Message; }).filter(Boolean).join("\n");
                                var sMsg = that._text("msgBillingCreated", "Billing document {0} created in S/4HANA for delivery {1}.").replace("{0}", sNo).replace("{1}", sDelivery);
                                oFU.setProperty("/lastResult", sMsg);
                                MessageBox.success(sMsg + (sDetail ? "\n\n" + sDetail : ""), {
                                    onClose: function () { that.onLoadDeliveryStatus(); }
                                });
                            })
                            .catch(function (err) {
                                if (err && (err.status === 409 || err.statusCode === 409 || err.code === "STALE_DATA")) {
                                    var sConflictMsg = (err.message || that._text("msgStaleDataConflict", "This delivery was modified by another user or session in SAP S/4HANA (stale data).")) +
                                        "\n\n" + that._text("msgPromptReloadData", "Please reload the latest delivery data from SAP before retrying.");
                                    MessageBox.error(sConflictMsg, {
                                        title: that._text("titleStaleDataConflict", "Document Changed / Stale Data"),
                                        onClose: function () {
                                            that.onLoadDeliveryStatus();
                                        }
                                    });
                                    return;
                                }
                                MessageBox.error((err && (err.message || err.statusText)) || "Billing document could not be created.");
                            })
                            .finally(function () { oFU.setProperty("/busy", false); });
                    }
                });
            }
        };
    }

    var oExports = {
        createOrdersDueDeliveryFollowUp: createOrdersDueDeliveryFollowUp
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
})();
