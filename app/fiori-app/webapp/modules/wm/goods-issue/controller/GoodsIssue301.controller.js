sap.ui.define([
    "saps4hana/fiori/modules/wm/goods-issue/controller/GoodsIssueTransferBaseController",
    "saps4hana/fiori/modules/wm/goods-issue/model/GoodsIssue301Model",
    "saps4hana/fiori/modules/wm/goods-issue/service/GoodsIssue301Service"
], function (GoodsIssueTransferBaseController, GoodsIssue301Model, GoodsIssue301Service) {
    "use strict";

    // Movement type 301 (Plant-to-Plant Transfer). All behaviour is inherited from the shared
    // transfer base controller; only the per-type wiring differs.
    return GoodsIssueTransferBaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssue301", {
        _getConfig: function () {
            return {
                type: "301",
                modelName: "gi301",
                i18nPrefix: "gi301",
                route: "wmGoodsIssue301",
                pendingRoute: "wmGoodsIssue301Pending",
                Model: GoodsIssue301Model,
                Service: GoodsIssue301Service
            };
        }
    });
});
