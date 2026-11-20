sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/modules/wm/mib-label/service/MibLabelService",
    "saps4hana/fiori/modules/wm/mib-label/util/MibLabelPdf",
    "saps4hana/fiori/service/AuthService",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "saps4hana/fiori/modules/wm/mib-label/controller/MibLabelTableManager",
    "saps4hana/fiori/modules/wm/mib-label/controller/MibLabelActionCoordinator",
    "saps4hana/fiori/modules/wm/mib-label/controller/MibLabelPreviewManager"
], function (
    BaseController,
    JSONModel,
    MibLabelService,
    MibLabelPdf,
    AuthService,
    MessageBox,
    MessageToast,
    MibLabelTableManager,
    MibLabelActionCoordinator,
    MibLabelPreviewManager
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

    var modTable = req(MibLabelTableManager, "./MibLabelTableManager");
    var modActions = req(MibLabelActionCoordinator, "./MibLabelActionCoordinator");
    var modPreview = req(MibLabelPreviewManager, "./MibLabelPreviewManager");

    var fnTable = typeof createMibLabelTableManager === "function" ? createMibLabelTableManager : (modTable && modTable.createMibLabelTableManager);
    var fnActions = typeof createMibLabelActionCoordinator === "function" ? createMibLabelActionCoordinator : (modActions && modActions.createMibLabelActionCoordinator);
    var fnPreview = typeof createMibLabelPreviewManager === "function" ? createMibLabelPreviewManager : (modPreview && modPreview.createMibLabelPreviewManager);

    var mTable = typeof fnTable === "function" ? fnTable({
        MibLabelService: MibLabelService
    }) : {};

    var mActions = typeof fnActions === "function" ? fnActions({
        MibLabelService: MibLabelService,
        MibLabelPdf: MibLabelPdf
    }) : {};

    var mPreview = typeof fnPreview === "function" ? fnPreview({
        MibLabelService: MibLabelService,
        MibLabelPdf: MibLabelPdf,
        MessageBox: MessageBox,
        MessageToast: MessageToast
    }) : {};

    var oMembers = {

        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                warehouseNumber: "W01",
                transferOrderNumber: "",
                weightedBy: "",
                checkedBy: "",
                variant: "vertical",
                pdfSource: "",
                pdfTitle: "",
                fileName: "",
                labelCount: 0,
                message: "",
                messageType: "Information",
                warehouseState: "None",
                warehouseStateText: "",
                toState: "None",
                toStateText: "",
                weightedByState: "None",
                weightedByStateText: "",
                checkedByState: "None",
                checkedByStateText: ""
            });
            this.setModel(oViewModel, "mibView");

            var dTo = new Date();
            var dFrom = new Date(dTo.getFullYear(), dTo.getMonth(), dTo.getDate() - 6);
            var oListModel = new JSONModel({
                warehouseNumber: "W01",
                dateFrom: dFrom,
                dateTo: dTo,
                transferOrderNumber: "",
                transferOrders: [],
                listed: false,
                more: false,
                selectedCount: 0
            });
            this.setModel(oListModel, "mibList");

            this._iRequest = 0;
            var oRouter = this.getRouter && this.getRouter();
            if (oRouter && oRouter.getRoute("wmMibLabel")) {
                oRouter.getRoute("wmMibLabel").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._clearPreview();
            var oVm = this.getModel("mibView");
            var oList = this.getModel("mibList");
            var oUser = AuthService.getCurrentUser();
            if (oUser && oUser.username && !oVm.getProperty("/weightedBy")) {
                oVm.setProperty("/weightedBy", oUser.username.toUpperCase());
            }

            MibLabelService.getWarehouseContext().then(function (oContext) {
                if (oContext && oContext.warehouses && oContext.warehouses.length > 0) {
                    var sCurrent = oVm.getProperty("/warehouseNumber");
                    if (!sCurrent) {
                        oVm.setProperty("/warehouseNumber", oContext.warehouses[0]);
                    }
                    var sListWh = oList.getProperty("/warehouseNumber");
                    if (!sListWh) {
                        oList.setProperty("/warehouseNumber", oContext.warehouses[0]);
                    }
                }
            }).catch(function () {
                // Ignore context lookup failures
            });
        },

        _notifyResult: function () {
            var oVm = this.getModel("mibView");
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
        },

        onExit: function () {
            if (typeof this._revokePdfUrl === "function") {
                this._revokePdfUrl();
            }
        }
    };

    Object.assign(oMembers, mTable, mActions, mPreview);

    var Controller = BaseController.extend("saps4hana.fiori.modules.wm.mib-label.controller.MibLabel", oMembers);

    var oTargetProto = Controller.prototype || Controller;
    Object.assign(oTargetProto, mTable, mActions, mPreview);

    return Controller;
});
