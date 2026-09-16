sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/BusyIndicator",
    "sap/m/MessageBox",
    "saps4hana/fiori/modules/sd/sales-inquiry/service/SalesInquiryService"
], function (BaseController, JSONModel, BusyIndicator, MessageBox, SalesInquiryService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-inquiry.controller.SalesInquiryDetail", {
        onInit: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("salesInquiryDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sInquiryId = oEvent.getParameter("arguments").SalesInquiry;
            if (sInquiryId) {
                this._sInquiryId = sInquiryId;
                this._loadInquiry(sInquiryId);
            }
        },

        _loadInquiry: function (sId) {
            var that = this;
            BusyIndicator.show(0);

            SalesInquiryService.getSalesInquiry(sId).then(function (result) {
                BusyIndicator.hide();
                var oData = result || {};
                var oHeader = oData.header || oData;
                var aItems = oData.items || (Array.isArray(oData.to_Items) ? oData.to_Items : (oData.to_Items && oData.to_Items.results)) || [];

                var oModel = new JSONModel({
                    header: oHeader,
                    items: aItems,
                    itemsUnavailable: Boolean(oData.itemsUnavailable),
                    itemsUnavailableReason: oData.itemsUnavailableReason || ""
                });
                that.getView().setModel(oModel, "detail");
            }).catch(function (err) {
                BusyIndicator.hide();
                console.warn("[SalesInquiryDetail] Error loading inquiry:", err);
                var sMsg = (err && err.message) || String(err || "");
                MessageBox.error("Failed to load Sales Inquiry " + sId + " from SAP S/4HANA: " + sMsg);
            });
        },

        onNavBack: function () {
            BaseController.prototype.onNavBack.call(this, "salesInquiries");
        },

        onRefresh: function () {
            if (this._sInquiryId) {
                this._loadInquiry(this._sInquiryId);
            }
        },

        onCreateAnother: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesInquiry");
        }
    });
});
