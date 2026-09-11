sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/sales-inquiry";

    /**
     * SalesInquiryService
     * Encapsulates Sales Inquiry API communication with the CAP backend.
     */
    return {
        /**
         * Sanitizes payload against CAP InquiryHeader and InquiryItem schema.
         * Strips UI-only and unmapped client-state properties such as CustomerCity.
         *
         * @private
         * @param {Object} oPayload
         * @returns {Object}
         */
        _sanitizePayload: function (oPayload) {
            if (!oPayload || typeof oPayload !== "object") return oPayload;
            var rawHeader = oPayload.header || {};
            var rawItems = Array.isArray(oPayload.items) ? oPayload.items : [];

            var ALLOWED_HEADER_FIELDS = [
                "SalesInquiryType",
                "SalesOrganization",
                "DistributionChannel",
                "OrganizationDivision",
                "SoldToParty",
                "CustomerName",
                "ShipToParty",
                "PurchaseOrderByCustomer",
                "CustomerPurchaseOrderDate",
                "SalesInquiryDate",
                "BindingPeriodValidityStartDate",
                "BindingPeriodValidityEndDate",
                "TransactionCurrency",
                "TotalNetAmount"
            ];

            var ALLOWED_ITEM_FIELDS = [
                "SalesInquiryItem",
                "Material",
                "SalesInquiryItemText",
                "OrderQuantity",
                "OrderQuantityUnit",
                "NetPriceAmount",
                "NetAmount",
                "TransactionCurrency"
            ];

            var cleanHeader = {};
            ALLOWED_HEADER_FIELDS.forEach(function (field) {
                if (rawHeader[field] !== undefined && rawHeader[field] !== null) {
                    cleanHeader[field] = rawHeader[field];
                }
            });

            var cleanItems = rawItems.map(function (item) {
                var cleanItem = {};
                ALLOWED_ITEM_FIELDS.forEach(function (field) {
                    if (item[field] !== undefined && item[field] !== null) {
                        cleanItem[field] = item[field];
                    }
                });
                return cleanItem;
            });

            return {
                header: cleanHeader,
                items: cleanItems
            };
        },

        /**
         * Dispatches createSalesInquiry action to the CAP OData service.
         *
         * @param {Object} oPayload
         * @param {Object} oPayload.header
         * @param {Array<Object>} oPayload.items
         * @returns {Promise<string>} Resolves to created Sales Inquiry ID
         */
        createSalesInquiry: function (oPayload) {
            var sUrl = SERVICE_BASE + "/createSalesInquiry";
            var oCleanPayload = this._sanitizePayload(oPayload);
            return ODataClient.post(sUrl, oCleanPayload).then(function (result) {
                if (!result) return "";
                return result.value || result.SalesInquiry || result;
            });
        },

        /**
         * Queries Sales Inquiries list from CAP OData service.
         *
         * @param {string} [sQuery] Optional OData query string (e.g. "?$top=10")
         * @returns {Promise<Array<Object>>}
         */
        getSalesInquiries: function (sQuery) {
            var sUrl = SERVICE_BASE + "/SalesInquiries" + (sQuery || "");
            return ODataClient.get(sUrl).then(function (result) {
                if (!result) return [];
                return result.value || (result.d && result.d.results) || [];
            });
        },

        /**
         * Queries a single Sales Inquiry by key.
         *
         * @param {string} sInquiryNumber
         * @returns {Promise<Object>}
         */
        getSalesInquiry: function (sInquiryNumber) {
            var sUrl = SERVICE_BASE + "/SalesInquiries('" + encodeURIComponent(sInquiryNumber) + "')?$expand=to_Items";
            return ODataClient.get(sUrl);
        },

        /**
         * Loads actual configuration and master data concurrently from CAP service:
         * Inquiry Types, Sales Organizations, Distribution Channels, and Divisions.
         *
         * @returns {Promise<{ inquiryTypes: Array<Object>, salesOrgs: Array<Object>, distChannels: Array<Object>, divisions: Array<Object> }>}
         */
        loadConfiguration: function () {
            return Promise.all([
                ODataClient.get(SERVICE_BASE + "/SalesInquiryTypeVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/SalesOrganizationVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/DistributionChannelVH").then(function (res) { return (res && res.value) || []; }),
                ODataClient.get(SERVICE_BASE + "/DivisionVH").then(function (res) { return (res && res.value) || []; })
            ]).then(function (aResults) {
                return {
                    inquiryTypes: aResults[0] || [],
                    salesOrgs: aResults[1] || [],
                    distChannels: aResults[2] || [],
                    divisions: aResults[3] || []
                };
            }).catch(function (err) {
                console.warn("[SalesInquiryService] Error loading configuration data:", err);
                return {
                    inquiryTypes: [],
                    salesOrgs: [],
                    distChannels: [],
                    divisions: []
                };
            });
        },

        /**
         * Retrieves commercial defaults for a specific customer from S/4HANA:
         * Customer Name, City, Country, Currency, and default Ship-to Party.
         *
         * @param {string} sCustomer
         * @param {string} [sSalesOrg]
         * @param {string} [sDistChannel]
         * @param {string} [sDivision]
         * @returns {Promise<{ Customer: string, CustomerName: string, City: string, Country: string, Currency: string, ShipToParty: string, ShipToPartyName: string, derived: boolean }>}
         */
        getCustomerDefaults: function (sCustomer, sSalesOrg, sDistChannel, sDivision) {
            if (!sCustomer || String(sCustomer).trim() === "") {
                return Promise.resolve({
                    Customer: "",
                    CustomerName: "",
                    City: "",
                    Country: "",
                    Currency: "INR",
                    ShipToParty: "",
                    ShipToPartyName: "",
                    derived: false
                });
            }

            var sParams = "Customer='" + encodeURIComponent(String(sCustomer).trim()) + "'";
            if (sSalesOrg) sParams += ",SalesOrganization='" + encodeURIComponent(String(sSalesOrg).trim()) + "'";
            if (sDistChannel) sParams += ",DistributionChannel='" + encodeURIComponent(String(sDistChannel).trim()) + "'";
            if (sDivision) sParams += ",Division='" + encodeURIComponent(String(sDivision).trim()) + "'";

            var sUrl = SERVICE_BASE + "/getCustomerDefaults(" + sParams + ")";
            return ODataClient.get(sUrl).then(function (result) {
                return result || {
                    Customer: sCustomer,
                    CustomerName: "",
                    City: "",
                    Country: "",
                    Currency: "INR",
                    ShipToParty: sCustomer,
                    ShipToPartyName: "",
                    derived: false
                };
            }).catch(function () {
                return {
                    Customer: sCustomer,
                    CustomerName: "",
                    City: "",
                    Country: "",
                    Currency: "INR",
                    ShipToParty: sCustomer,
                    ShipToPartyName: "",
                    derived: false
                };
            });
        },

        /**
         * Retrieves standard initial defaults for VA11 Sales Inquiry creation.
         */
        getSalesInquiryDefaults: function () {
            var sUrl = SERVICE_BASE + "/getSalesInquiryDefaults()";
            return ODataClient.get(sUrl).catch(function () {
                var today = new Date().toISOString().split("T")[0];
                var validityEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                return {
                    SalesInquiryType: "ZIN",
                    SalesOrganization: "1000",
                    DistributionChannel: "10",
                    OrganizationDivision: "52",
                    SalesInquiryDate: today,
                    BindingPeriodValidityStartDate: today,
                    BindingPeriodValidityEndDate: validityEnd,
                    TransactionCurrency: "INR",
                    derived: true
                };
            });
        },

        /**
         * Looks up Material master data details including MaterialBaseUnit from S/4HANA.
         *
         * @param {string} sMaterial
         * @returns {Promise<Object|null>}
         */
        getMaterialDetails: function (sMaterial) {
            if (!sMaterial || String(sMaterial).trim() === "") {
                return Promise.resolve(null);
            }

            var sClean = encodeURIComponent(String(sMaterial).trim());

            var sFilter =
                "?$filter=MaterialType eq 'ZFRT' and (" +
                "Material eq '" + sClean + "' or " +
                "MaterialName eq '" + sClean + "' or " +
                "contains(MaterialName,'" + sClean + "')" +
                ")&$top=1";

            return ODataClient.get(SERVICE_BASE + "/MaterialVH" + sFilter)
                .then(function (res) {
                    var aItems = (res && (res.value || (res.d && res.d.results))) || [];
                    return aItems.length > 0 ? aItems[0] : null;
                })
                .catch(function (err) {
                    console.warn(
                        "[SalesInquiryService] Error fetching FG material for " + sMaterial + ":",
                        err
                    );
                    return null;
                });
        },

        /**
         * Directly retrieves the configured Base Unit of Measure for a Material.
         *
         * @param {string} sMaterial
         * @returns {Promise<string|null>}
         */
        getMaterialUnit: function (sMaterial) {
            return this.getMaterialDetails(sMaterial).then(function (oMaterial) {
                return (oMaterial && (oMaterial.MaterialBaseUnit || oMaterial.BaseUnit || oMaterial.OrderQuantityUnit)) || null;
            });
        }
    };
});
