sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    var COLORS = {
        '201': '#8E44AD', // SAP Purple / Cost Center
        '261': '#0070F2', // SAP Horizon / Fiori Blue
        '301': '#E76500', // SAP Orange
        '311': '#107E3E'  // SAP Forest Green
    };

    /**
     * Generate responsive SVG Donut Chart for movement type distribution
     */
    function _generateDistributionSvg(aDistribution, nTotal) {
        if (!Array.isArray(aDistribution) || aDistribution.length === 0 || !nTotal) {
            return '<div style="display:flex;align-items:center;justify-content:center;height:240px;color:#6a6d70;font-size:0.875rem;">No distribution data available</div>';
        }

        var size = 220;
        var strokeWidth = 26;
        var radius = (size - strokeWidth) / 2;
        var center = size / 2;
        var circumference = 2 * Math.PI * radius;

        var accumulatedAngle = 0;
        var aPaths = [];

        aDistribution.forEach(function (item) {
            var pct = Number(item.Percentage) || 0;
            if (pct <= 0) return;

            var strokeDasharray = (pct / 100 * circumference) + ' ' + circumference;
            var strokeDashoffset = -accumulatedAngle * circumference;
            accumulatedAngle += pct / 100;

            var sColor = COLORS[item.MovementType] || '#89919A';
            var sTooltip = item.MovementType + ' ' + (item.MovementTypeName || '') + ': ' + item.Count + ' (' + pct + '%)';

            aPaths.push(
                '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="transparent" ' +
                'stroke="' + sColor + '" stroke-width="' + strokeWidth + '" ' +
                'stroke-dasharray="' + strokeDasharray + '" stroke-dashoffset="' + strokeDashoffset + '" ' +
                'transform="rotate(-90 ' + center + ' ' + center + ')" style="transition: stroke-width 0.2s; cursor: pointer;">' +
                '<title>' + sTooltip + '</title>' +
                '</circle>'
            );
        });

        var sFormattedTotal = String(nTotal).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

        return '<div style="display:flex;justify-content:center;align-items:center;padding:10px 0;">' +
            '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="overflow:visible;">' +
            aPaths.join('') +
            '<text x="' + center + '" y="' + (center - 6) + '" text-anchor="middle" font-size="22" font-weight="700" fill="#32363a" font-family="Arial, sans-serif">' +
            sFormattedTotal +
            '</text>' +
            '<text x="' + center + '" y="' + (center + 14) + '" text-anchor="middle" font-size="11" fill="#6a6d70" font-family="Arial, sans-serif">' +
            'Total Postings' +
            '</text>' +
            '</svg>' +
            '</div>';
    }

    /**
     * Generate responsive SVG Multi-Series Trend Line Chart
     */
    function _generateTrendSvg(aTrend, nDays) {
        if (!Array.isArray(aTrend) || aTrend.length === 0) {
            return '<div style="display:flex;align-items:center;justify-content:center;height:240px;color:#6a6d70;font-size:0.875rem;">No trend data available</div>';
        }

        var iDays = typeof nDays === "number" && nDays > 0 ? nDays : 30;
        var aData = aTrend.slice(-iDays);

        var width = 640;
        var height = 230;
        var padLeft = 45;
        var padRight = 20;
        var padTop = 25;
        var padBottom = 35;

        var chartW = width - padLeft - padRight;
        var chartH = height - padTop - padBottom;

        // Find max Y across all 4 series
        var maxY = 0;
        aData.forEach(function (d) {
            var m = Math.max(d.Count201 || 0, d.Count261 || 0, d.Count301 || 0, d.Count311 || 0);
            if (m > maxY) maxY = m;
        });
        if (maxY < 5) maxY = 5;
        // Round up to nice number
        var step = Math.ceil(maxY / 4);
        maxY = step * 4;

        // Grid lines & Y labels
        var aGrid = [];
        for (var i = 0; i <= 4; i++) {
            var yVal = Math.round(i * step);
            var yPos = padTop + chartH - (i / 4) * chartH;
            aGrid.push(
                '<line x1="' + padLeft + '" y1="' + yPos + '" x2="' + (padLeft + chartW) + '" y2="' + yPos + '" stroke="#e5e5e5" stroke-dasharray="2,2" />' +
                '<text x="' + (padLeft - 8) + '" y="' + (yPos + 4) + '" font-size="10" fill="#6a6d70" text-anchor="end" font-family="Arial, sans-serif">' + yVal + '</text>'
            );
        }

        // X points & labels
        var nPoints = aData.length;
        var xStep = nPoints > 1 ? chartW / (nPoints - 1) : chartW;

        var aXLabels = [];
        var labelInterval = nPoints > 14 ? Math.ceil(nPoints / 7) : 1;

        for (var j = 0; j < nPoints; j++) {
            if (j % labelInterval === 0 || j === nPoints - 1) {
                var xPos = padLeft + j * xStep;
                var sDateLabel = aData[j].DateLabel || aData[j].PostingDate || '';
                aXLabels.push(
                    '<text x="' + xPos + '" y="' + (height - 10) + '" font-size="10" fill="#6a6d70" text-anchor="middle" font-family="Arial, sans-serif">' +
                    sDateLabel +
                    '</text>'
                );
            }
        }

        // Series paths & points
        function buildSeries(sField, sColor, sName) {
            var aPts = [];
            var aCircles = [];

            for (var k = 0; k < nPoints; k++) {
                var val = aData[k][sField] || 0;
                var x = padLeft + k * xStep;
                var y = padTop + chartH - (val / maxY) * chartH;
                aPts.push(x.toFixed(1) + ',' + y.toFixed(1));

                var sTip = (aData[k].PostingDate || '') + ' • ' + sName + ': ' + val;
                aCircles.push(
                    '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.5" fill="' + sColor + '" stroke="#ffffff" stroke-width="1.5">' +
                    '<title>' + sTip + '</title>' +
                    '</circle>'
                );
            }

            return '<polyline fill="none" stroke="' + sColor + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="' + aPts.join(' ') + '" />' +
                   aCircles.join('');
        }

        var sSeries201 = buildSeries('Count201', COLORS['201'], '201 Cost Center');
        var sSeries261 = buildSeries('Count261', COLORS['261'], '261 Goods Issue');
        var sSeries301 = buildSeries('Count301', COLORS['301'], '301 Plant Transfer');
        var sSeries311 = buildSeries('Count311', COLORS['311'], '311 SLoc Transfer');

        return '<div style="width:100%;overflow-x:auto;">' +
            '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" style="display:block;max-width:100%;">' +
            aGrid.join('') +
            aXLabels.join('') +
            sSeries201 +
            sSeries261 +
            sSeries301 +
            sSeries311 +
            '</svg>' +
            '</div>';
    }

    var GoodsIssueDashboardModel = {
        /**
         * Create and return the initial JSONModel for the dashboard view
         * @returns {sap.ui.model.json.JSONModel}
         */
        createModel: function () {
            return new JSONModel({
                loading: true,
                error: "",
                lastUpdated: null,
                kpis: {
                    mvt201: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    mvt261: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    mvt301: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    mvt311: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    overall: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" }
                },
                activeKpiCard: "ALL", // "ALL", "201", "261", "301", "311"
                distribution: [],
                distributionSvg: "",
                trend: [],
                trendSvg: "",
                trendPeriod: "30", // "7" or "30"
                allDocuments: [],
                documents: [],
                totalDocumentsCount: 0,
                typeFilter: "ALL",
                searchQuery: "",
                sortProperty: "PostingDate",
                sortDescending: true,
                selectedDocument: null,
                plantFilter: ""
            });
        },

        /**
         * Update model with data returned by server getDashboardData
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oData - GIDashboardData
         */
        setServerData: function (oModel, oData) {
            if (!oModel || !oData) return;

            var oKpis = oData.Kpis || {};
            var aDist = oData.Distribution || [];
            var aTrend = oData.Trend || [];
            var aDocs = oData.RecentDocuments || [];
            var nOverallTotal = oKpis.Overall ? oKpis.Overall.TotalCount : 0;

            oModel.setProperty("/kpis", {
                mvt201: {
                    totalCount: oKpis.Mvt201 ? oKpis.Mvt201.TotalCount : 0,
                    openPendingCount: oKpis.Mvt201 ? oKpis.Mvt201.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt201 ? oKpis.Mvt201.TodayPostingsCount : 0
                },
                mvt261: {
                    totalCount: oKpis.Mvt261 ? oKpis.Mvt261.TotalCount : 0,
                    openPendingCount: oKpis.Mvt261 ? oKpis.Mvt261.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt261 ? oKpis.Mvt261.TodayPostingsCount : 0
                },
                mvt301: {
                    totalCount: oKpis.Mvt301 ? oKpis.Mvt301.TotalCount : 0,
                    openPendingCount: oKpis.Mvt301 ? oKpis.Mvt301.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt301 ? oKpis.Mvt301.TodayPostingsCount : 0
                },
                mvt311: {
                    totalCount: oKpis.Mvt311 ? oKpis.Mvt311.TotalCount : 0,
                    openPendingCount: oKpis.Mvt311 ? oKpis.Mvt311.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt311 ? oKpis.Mvt311.TodayPostingsCount : 0
                },
                overall: {
                    totalCount: nOverallTotal,
                    openPendingCount: oKpis.Overall ? oKpis.Overall.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Overall ? oKpis.Overall.TodayPostingsCount : 0
                }
            });

            oModel.setProperty("/distribution", aDist);
            oModel.setProperty("/distributionSvg", _generateDistributionSvg(aDist, nOverallTotal));

            oModel.setProperty("/trend", aTrend);
            var iPeriod = parseInt(oModel.getProperty("/trendPeriod") || "30", 10);
            oModel.setProperty("/trendSvg", _generateTrendSvg(aTrend, iPeriod));

            oModel.setProperty("/allDocuments", aDocs);
            oModel.setProperty("/lastUpdated", oData.LastUpdated || new Date().toISOString());
            oModel.setProperty("/loading", false);
            oModel.setProperty("/error", "");

            this.filterAndSort(oModel);
        },

        /**
         * Update trend period (7 or 30 days) and re-render chart SVG
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sPeriod - "7" or "30"
         */
        setTrendPeriod: function (oModel, sPeriod) {
            var iDays = parseInt(sPeriod || "30", 10);
            oModel.setProperty("/trendPeriod", String(iDays));
            var aTrend = oModel.getProperty("/trend") || [];
            oModel.setProperty("/trendSvg", _generateTrendSvg(aTrend, iDays));
        },

        /**
         * Filter and sort documents based on current model state
         * @param {sap.ui.model.json.JSONModel} oModel
         */
        filterAndSort: function (oModel) {
            if (!oModel) return;

            var aAll = oModel.getProperty("/allDocuments") || [];
            var sType = oModel.getProperty("/typeFilter") || "ALL";
            var sQuery = (oModel.getProperty("/searchQuery") || "").trim().toLowerCase();
            var sSortProp = oModel.getProperty("/sortProperty") || "PostingDate";
            var bSortDesc = oModel.getProperty("/sortDescending") !== false;

            var aFiltered = aAll.filter(function (doc) {
                // Movement type match
                if (sType !== "ALL" && doc.MovementType !== sType) {
                    return false;
                }
                // Text search match across multiple fields
                if (sQuery) {
                    var sMatDoc = String(doc.MaterialDocument || "").toLowerCase();
                    var sMat = String(doc.Material || "").toLowerCase();
                    var sDesc = String(doc.MaterialDesc || "").toLowerCase();
                    var sPlant = String(doc.Plant || "").toLowerCase();
                    var sSLoc = String(doc.StorageLocation || "").toLowerCase();
                    var sUser = String(doc.User || "").toLowerCase();
                    var sCostCenter = String(doc.CostCenter || "").toLowerCase();
                    var sOrder = String(doc.OrderNo || "").toLowerCase();
                    var sResv = String(doc.ReservationNo || "").toLowerCase();

                    var bMatch = sMatDoc.indexOf(sQuery) !== -1 ||
                                 sMat.indexOf(sQuery) !== -1 ||
                                 sDesc.indexOf(sQuery) !== -1 ||
                                 sPlant.indexOf(sQuery) !== -1 ||
                                 sSLoc.indexOf(sQuery) !== -1 ||
                                 sUser.indexOf(sQuery) !== -1 ||
                                 sCostCenter.indexOf(sQuery) !== -1 ||
                                 sOrder.indexOf(sQuery) !== -1 ||
                                 sResv.indexOf(sQuery) !== -1;
                    if (!bMatch) {
                        return false;
                    }
                }
                return true;
            });

            // Sorting
            aFiltered.sort(function (a, b) {
                var vA = a[sSortProp];
                var vB = b[sSortProp];

                if (vA === undefined || vA === null) vA = "";
                if (vB === undefined || vB === null) vB = "";

                if (typeof vA === "number" && typeof vB === "number") {
                    return bSortDesc ? vB - vA : vA - vB;
                }

                var sA = String(vA);
                var sB = String(vB);
                return bSortDesc ? sB.localeCompare(sA) : sA.localeCompare(sB);
            });

            oModel.setProperty("/documents", aFiltered);
            oModel.setProperty("/totalDocumentsCount", aFiltered.length);
        },

        /**
         * Update movement type filter (from segmented button or KPI card press)
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sType - "ALL", "261", "301", "311"
         */
        setTypeFilter: function (oModel, sType) {
            var sClean = (sType || "ALL").toUpperCase();
            oModel.setProperty("/typeFilter", sClean);
            oModel.setProperty("/activeKpiCard", sClean);
            this.filterAndSort(oModel);
        },

        /**
         * Update live search query
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sQuery
         */
        setSearchQuery: function (oModel, sQuery) {
            oModel.setProperty("/searchQuery", sQuery || "");
            this.filterAndSort(oModel);
        },

        /**
         * Update sort column and direction
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sProperty
         * @param {boolean} [bDescending]
         */
        setSorting: function (oModel, sProperty, bDescending) {
            var sCurrent = oModel.getProperty("/sortProperty");
            var bCurrentDesc = oModel.getProperty("/sortDescending");

            if (bDescending !== undefined) {
                oModel.setProperty("/sortProperty", sProperty);
                oModel.setProperty("/sortDescending", bDescending);
            } else if (sCurrent === sProperty) {
                oModel.setProperty("/sortDescending", !bCurrentDesc);
            } else {
                oModel.setProperty("/sortProperty", sProperty);
                oModel.setProperty("/sortDescending", true);
            }
            this.filterAndSort(oModel);
        }
    };

    return GoodsIssueDashboardModel;
});
