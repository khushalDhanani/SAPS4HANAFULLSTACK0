sap.ui.define([
    "saps4hana/fiori/modules/wm/goods-issue/controller/GoodsIssueTransferBaseController",
    "saps4hana/fiori/modules/wm/goods-issue/model/GoodsIssue311Model",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue311Service"
], function (GoodsIssueTransferBaseController, GoodsIssue311Model, GoodsIssue311Service) {
    "use strict";

    // Movement type 311 (Storage-Location-to-Storage-Location Transfer). All behaviour is inherited
    // from the shared transfer base controller; only the per-type wiring differs.
    return GoodsIssueTransferBaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue311", {
        _getConfig: function () {
            return {
                type: "311",
                modelName: "gi311",
                i18nPrefix: "gi311",
                route: "wmGoodsIssue311",
                Model: GoodsIssue311Model,
                Service: GoodsIssue311Service
            };
        }
    });
});
