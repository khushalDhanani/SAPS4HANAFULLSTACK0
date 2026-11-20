sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/quarantine-label/service/QuarantineLabelService",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelLayout",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelPdf",
    "saps4hana/fiori/modules/wm/quarantine-label/util/ZquarLabelRows",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/wm/quarantine-label/controller/QuarantineLabelTableManager",
    "saps4hana/fiori/modules/wm/quarantine-label/controller/QuarantineLabelActionCoordinator",
    "saps4hana/fiori/modules/wm/quarantine-label/controller/QuarantineLabelPreviewManager"
], function (
    BaseController,
    JSONModel,
    QuarantineLabelService,
    ZquarLabelLayout,
    ZquarLabelPdf,
    ZquarLabelRows,
    MessageBox,
    MessageToast,
    AuthService,
    QuarantineLabelTableManager,
    QuarantineLabelActionCoordinator,
    QuarantineLabelPreviewManager
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modTable = req(QuarantineLabelTableManager, "./QuarantineLabelTableManager");
    var modActions = req(QuarantineLabelActionCoordinator, "./QuarantineLabelActionCoordinator");
    var modPreview = req(QuarantineLabelPreviewManager, "./QuarantineLabelPreviewManager");

    var fnTable = typeof createQuarantineLabelTableManager === "function" ? createQuarantineLabelTableManager : (modTable && modTable.createQuarantineLabelTableManager);
    var fnActions = typeof createQuarantineLabelActionCoordinator === "function" ? createQuarantineLabelActionCoordinator : (modActions && modActions.createQuarantineLabelActionCoordinator);
    var fnPreview = typeof createQuarantineLabelPreviewManager === "function" ? createQuarantineLabelPreviewManager : (modPreview && modPreview.createQuarantineLabelPreviewManager);

    var mTable = typeof fnTable === "function" ? fnTable({
        QuarantineLabelService: QuarantineLabelService
    }) : {};

    var mActions = typeof fnActions === "function" ? fnActions({
        QuarantineLabelService: QuarantineLabelService,
        ZquarLabelLayout: ZquarLabelLayout,
        ZquarLabelPdf: ZquarLabelPdf,
        ZquarLabelRows: ZquarLabelRows,
        AuthService: AuthService
    }) : {};

    var mPreview = typeof fnPreview === "function" ? fnPreview({
        QuarantineLabelService: QuarantineLabelService,
        ZquarLabelLayout: ZquarLabelLayout,
        ZquarLabelPdf: ZquarLabelPdf,
        ZquarLabelRows: ZquarLabelRows,
        AuthService: AuthService
    }) : {};

    var oMembers = {

        onInit: function () {
            this.setModel(new JSONModel({
                materialDocument: "",
                year: String(new Date().getFullYear()),
                text: "",
                variant: "vertical",
                busy: false,
                message: "",
                messageType: "Information",
                docState: "None", docStateText: "",
                yearState: "None", yearStateText: "",
                textState: "None", textStateText: "",
                pdfUrl: "",
                fileName: "",
                labelCount: 0
            }), "qlView");
            // Goods-receipt list (movement type 101): plant + posting-date range (default last 7 days) or one document
            var dTo = new Date();
            var dFrom = new Date(dTo.getFullYear(), dTo.getMonth(), dTo.getDate() - 6);
            this.setModel(new JSONModel({
                plant: "", dateFrom: dFrom, dateTo: dTo, materialDocument: "", year: String(dTo.getFullYear()),
                documents: [], listed: false, more: false, selectedCount: 0
            }), "qlList");
            this._iRequest = 0;
            this._initPlant();
            var oRouter = this.getRouter && this.getRouter();
            if (oRouter && oRouter.getRoute("wmQuarantineLabels")) {
                oRouter.getRoute("wmQuarantineLabels").attachPatternMatched(this._clearPreview, this);
            }
        },

        onExit: function () {
            if (typeof this._clearPreview === "function") {
                this._clearPreview();
            }
        },

        /**
         * List actions run far from the page-top message strip (a long list scrolls it out of view): repeat the result
         * where the user is — errors and warnings in a dialog, success as a toast. The strip keeps the same text.
         */
        _notifyResult: function () {
            var oVm = this.getModel("qlView");
            var sText = oVm.getProperty("/message");
            if (!sText) {
                return;
            }
            var sType = oVm.getProperty("/messageType");
            if (sType === "Error") {
                MessageBox.error(sText);
            } else if (sType === "Warning") {
                MessageBox.warning(sText);
            } else {
                MessageToast.show(sText);
            }
        },

        _scrollTo: function (sId) {
            var oCtrl = this.byId && this.byId(sId);
            var oDom = oCtrl && oCtrl.getDomRef && oCtrl.getDomRef();
            if (oDom && oDom.scrollIntoView) {
                oDom.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }
    };

    Object.assign(oMembers, mTable, mActions, mPreview);

    var Controller = BaseController.extend("saps4hana.fiori.modules.wm.quarantine-label.controller.QuarantineLabels", oMembers);

    var oTargetProto = Controller.prototype || Controller;
    Object.assign(oTargetProto, mTable, mActions, mPreview);

    return Controller;
});
