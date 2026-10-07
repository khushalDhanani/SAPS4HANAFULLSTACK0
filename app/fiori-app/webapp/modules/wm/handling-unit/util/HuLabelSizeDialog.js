sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout"
], function (Fragment, JSONModel, Layout) {
    "use strict";

    var LS_KEY = "saps4hana_fiori_hu_label_size"; // last chosen size, remembered per browser
    var DEFAULT_LIMIT = 500; // >this many labels shows the extra warning strip (mirrors the old _confirmCount)
    var PREVIEW_MAX_W = 64, PREVIEW_MAX_H = 40; // px box the proportional stock-size preview fits inside

    function readPref() {
        try { return Layout.byKey(window.localStorage.getItem(LS_KEY)); } catch (e) { return Layout.DEFAULT; }
    }
    function writePref(sKey) {
        try { window.localStorage.setItem(LS_KEY, sKey); } catch (e) { /* private mode / disabled storage: just don't remember */ }
    }

    /** The 4 sizes as picker rows: name/dims/description (i18n) + a proportional preview rectangle (px). */
    function buildRows(oController) {
        return Layout.ORDER.map(function (k) {
            var s = Layout.SIZES[k];
            var fScale = Math.min(PREVIEW_MAX_W / s.widthMm, PREVIEW_MAX_H / s.heightMm);
            return {
                key: k,
                name: oController.getText(s.nameKey),
                dims: oController.getText("huSizeDims", [s.widthMm, s.heightMm]),
                desc: oController.getText(s.descKey),
                previewW: Math.round(s.widthMm * fScale),
                previewH: Math.round(s.heightMm * fScale)
            };
        });
    }

    /**
     * Opens the shared label-size picker on oController's view.
     * Resolves the chosen size key (and persists it) on confirm; resolves null on Cancel (no side effects).
     * @param {sap.ui.core.mvc.Controller} oController owns the view; supplies getText + i18n model
     * @param {{verb:string, count:number, limit:number=}} oOpts verb "print"|"download"; count of labels (1 = single row)
     * @returns {Promise<string|null>}
     */
    function open(oController, oOpts) {
        var nCount = oOpts.count || 0;
        var bBulk = nCount > 1;
        var nLimit = oOpts.limit || DEFAULT_LIMIT;
        var sConfirmKey = oOpts.verb === "download"
            ? (bBulk ? "huDownloadSizeConfirm" : "huDownloadSizeConfirmOne")
            : (bBulk ? "huPrintSizeConfirm" : "huPrintSizeConfirmOne");
        var oModel = new JSONModel({
            selectedKey: readPref(),
            sizes: buildRows(oController),
            confirmText: oController.getText(sConfirmKey, bBulk ? [nCount] : []),
            showLimitWarning: nCount > nLimit,
            warningText: nCount > nLimit ? oController.getText("huPrintAllLarge", [nCount, nLimit]) : ""
        });

        return new Promise(function (resolve) {
            var oDialog;
            var oHandlers = {
                onSelectLabelSize: function (oEvent) {
                    var oItem = oEvent.getParameter("listItem") || oEvent.getSource().getSelectedItem();
                    oModel.setProperty("/selectedKey", oItem.getBindingContext("huSize").getProperty("key"));
                },
                onConfirmLabelSize: function () {
                    var sKey = oModel.getProperty("/selectedKey");
                    writePref(sKey);
                    oDialog.close();
                    resolve(sKey);
                },
                onCancelLabelSize: function () {
                    oDialog.close();
                    resolve(null); // Cancel: no persist, no job
                }
            };
            Fragment.load({
                name: "saps4hana.fiori.modules.wm.handling-unit.view.SelectLabelSizeDialog",
                controller: oHandlers
            }).then(function (oLoaded) {
                oDialog = oLoaded;
                oDialog.setModel(oModel, "huSize");
                oDialog.attachAfterClose(function () { oDialog.destroy(); });
                oController.getView().addDependent(oDialog); // propagate the i18n model
                oDialog.open();
            });
        });
    }

    return { open: open, readPref: readPref, LS_KEY: LS_KEY };
});
