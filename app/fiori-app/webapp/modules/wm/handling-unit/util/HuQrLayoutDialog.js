sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuQrPdf"
], function (Fragment, JSONModel, HuQrPdf) {
    "use strict";

    var LS_KEY = "saps4hana_fiori_hu_qr_layout";
    var LS_MAT_KEY = "saps4hana_fiori_hu_qr_inc_mat";
    var PREVIEW_MAX_W = 52, PREVIEW_MAX_H = 38;

    function readPref() {
        try { return window.localStorage.getItem(LS_KEY) || "A4grid"; } catch (e) { return "A4grid"; }
    }
    function writePref(sKey) {
        try { window.localStorage.setItem(LS_KEY, sKey); } catch (e) { /* ignore storage issues */ }
    }
    function readMatPref() {
        try { return window.localStorage.getItem(LS_MAT_KEY) !== "false"; } catch (e) { return true; }
    }
    function writeMatPref(b) {
        try { window.localStorage.setItem(LS_MAT_KEY, b ? "true" : "false"); } catch (e) { /* ignore storage issues */ }
    }

    /**
     * Builds list rows for the QR combine layout picker with localized labels,
     * cell grid descriptions, and a proportional preview box.
     */
    function buildRows(oController) {
        return HuQrPdf.ORDER.map(function (k) {
            var s = HuQrPdf.LAYOUTS[k];
            var fScale = Math.min(PREVIEW_MAX_W / s.pageW, PREVIEW_MAX_H / s.pageH);
            return {
                key: k,
                name: oController.getText(s.nameKey),
                dims: s.cols + " × " + s.rows + " (" + (s.cols * s.rows) + " " + oController.getText("huQrPerSheet") + ")",
                desc: oController.getText(s.descKey),
                cols: s.cols,
                rows: s.rows,
                previewW: Math.round(s.pageW * fScale),
                previewH: Math.round(s.pageH * fScale)
            };
        });
    }

    /**
     * Opens the QR combine layout picker dialog.
     * Resolves with { layout: string, includeMaterial: boolean } on confirm, or null on cancel.
     *
     * @param {sap.ui.core.mvc.Controller} oController
     * @param {{ count: number }} oOpts
     * @returns {Promise<{ layout: string, includeMaterial: boolean }|null>}
     */
    function open(oController, oOpts) {
        var nCount = (oOpts && oOpts.count) || 0;
        var sInfo = oController.getText("huQrCombineInfo", [nCount]);
        var sConfirmText = oController.getText("huQrCombineConfirm", [nCount]);
        var oModel = new JSONModel({
            selectedKey: readPref(),
            includeMaterial: readMatPref(),
            layouts: buildRows(oController),
            infoText: sInfo,
            confirmText: sConfirmText,
            count: nCount
        });

        return new Promise(function (resolve) {
            var oDialog;
            var oHandlers = {
                onSelectQrLayout: function (oEvent) {
                    var oItem = oEvent.getParameter("listItem") || oEvent.getSource().getSelectedItem();
                    oModel.setProperty("/selectedKey", oItem.getBindingContext("huQrLayout").getProperty("key"));
                },
                onConfirmQrLayout: function () {
                    var sKey = oModel.getProperty("/selectedKey");
                    var bMat = oModel.getProperty("/includeMaterial");
                    writePref(sKey);
                    writeMatPref(bMat);
                    oDialog.close();
                    resolve({ layout: sKey, includeMaterial: bMat });
                },
                onCancelQrLayout: function () {
                    oDialog.close();
                    resolve(null);
                }
            };
            Fragment.load({
                name: "saps4hana.fiori.modules.wm.handling-unit.view.SelectQrLayoutDialog",
                controller: oHandlers
            }).then(function (oLoaded) {
                oDialog = oLoaded;
                oDialog.setModel(oModel, "huQrLayout");
                oDialog.attachAfterClose(function () { oDialog.destroy(); });
                oController.getView().addDependent(oDialog);
                oDialog.open();
            });
        });
    }

    return { open: open, readPref: readPref, LS_KEY: LS_KEY };
});
