sap.ui.define([
    "sap/base/security/encodeXML"
], function (encodeXML) {
    "use strict";

    /**
     * Pure rules of the Sub-User Master: KPIs, filters, selection and bulk results.
     * No controls and no model, so each rule can be tested on its own.
     * Who is protected from locking is decided on the server (srv/admin/protectedUsers.js).
     */

    var BULK_CONCURRENCY = 5; // parallel lock or unlock calls; each one is its own SAP LUW
    var LIST_LIMIT = 1000; // the most rows listUsers accepts

    var EMPTY_FILTERS = { lockStatus: "", userTypes: [], changedBy: [], changedFrom: "", changedTo: "", search: "" };

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    /** SAP-style YYYYMMDD of a Date, in the browser's own day. */
    function dayKey(dDate) {
        return dDate.getFullYear() + pad(dDate.getMonth() + 1) + pad(dDate.getDate());
    }

    function daysBefore(dDate, iDays) {
        return dayKey(new Date(dDate.getFullYear(), dDate.getMonth(), dDate.getDate() - iDays));
    }

    function lockStatusOf(oUser) {
        if (!oUser.detailsAvailable) {
            return "unavailable";
        }
        return oUser.isLocked ? "locked" : "active";
    }

    function emptyFilters() {
        return Object.assign({}, EMPTY_FILTERS, { userTypes: [], changedBy: [] });
    }

    /** Counts over the whole list, never the filtered rows, so a card keeps its value while filtered. */
    function computeKpis(aUsers, dToday) {
        var sToday = dayKey(dToday);
        var sWeekStart = daysBefore(dToday, 6);
        return aUsers.reduce(function (oKpis, oUser) {
            var sStatus = lockStatusOf(oUser);
            oKpis.total++;
            oKpis.active += sStatus === "active" ? 1 : 0;
            oKpis.locked += sStatus === "locked" ? 1 : 0;
            oKpis.changedToday += oUser.lastChanged === sToday ? 1 : 0;
            oKpis.changedLast7 += (oUser.lastChanged >= sWeekStart && oUser.lastChanged <= sToday) ? 1 : 0;
            return oKpis;
        }, { total: 0, active: 0, locked: 0, changedToday: 0, changedLast7: 0 });
    }

    function matchesSearch(oUser, sSearch) {
        var sNeedle = String(sSearch || "").trim().toLowerCase();
        return !sNeedle
            || String(oUser.username || "").toLowerCase().indexOf(sNeedle) !== -1
            || String(oUser.fullName || "").toLowerCase().indexOf(sNeedle) !== -1;
    }

    /** All filters combine with AND. */
    function filterUsers(aUsers, oFilters) {
        return aUsers.filter(function (oUser) {
            return (!oFilters.lockStatus || lockStatusOf(oUser) === oFilters.lockStatus)
                && (!oFilters.userTypes.length || oFilters.userTypes.indexOf(oUser.userType) !== -1)
                && (!oFilters.changedBy.length || oFilters.changedBy.indexOf(oUser.lastChangedBy) !== -1)
                && (!oFilters.changedFrom || oUser.lastChanged >= oFilters.changedFrom)
                && (!oFilters.changedTo || (!!oUser.lastChanged && oUser.lastChanged <= oFilters.changedTo))
                && matchesSearch(oUser, oFilters.search);
        });
    }

    /** The filters a KPI card stands for. */
    function kpiFilter(sKpi, dToday) {
        return {
            active: { lockStatus: "active" },
            locked: { lockStatus: "locked" },
            changedToday: { changedFrom: dayKey(dToday), changedTo: dayKey(dToday) },
            changedLast7: { changedFrom: daysBefore(dToday, 6), changedTo: dayKey(dToday) }
        }[sKpi] || null;
    }

    /** A card is selected exactly when the filters hold its values, so cards and filters cannot disagree. */
    function isKpiSelected(sKpi, oFilters, dToday) {
        if (sKpi === "total") {
            return !hasActiveFilters(oFilters);
        }
        var oWanted = kpiFilter(sKpi, dToday);
        return !!oWanted && Object.keys(oWanted).every(function (sKey) {
            return oFilters[sKey] === oWanted[sKey];
        });
    }

    /** Clicking a card applies its filter; clicking it again clears that filter. Total clears everything. */
    function toggleKpi(sKpi, oFilters, dToday) {
        if (sKpi === "total") {
            return emptyFilters();
        }
        var oWanted = kpiFilter(sKpi, dToday);
        if (!oWanted) {
            return oFilters;
        }
        if (isKpiSelected(sKpi, oFilters, dToday)) {
            var oCleared = {};
            Object.keys(oWanted).forEach(function (sKey) {
                oCleared[sKey] = "";
            });
            return Object.assign({}, oFilters, oCleared);
        }
        return Object.assign({}, oFilters, oWanted);
    }

    function hasActiveFilters(oFilters) {
        return !!(oFilters.lockStatus || oFilters.userTypes.length || oFilters.changedBy.length
            || oFilters.changedFrom || oFilters.changedTo || String(oFilters.search || "").trim());
    }

    /** Removes one chip's value and returns the new filters. */
    function removeChip(oFilters, sChipKey) {
        var iSplit = sChipKey.indexOf(":");
        var sType = sChipKey.slice(0, iSplit);
        var sValue = sChipKey.slice(iSplit + 1);
        var oNext = Object.assign({}, oFilters);
        if (sType === "userTypes" || sType === "changedBy") {
            oNext[sType] = oFilters[sType].filter(function (sItem) {
                return sItem !== sValue;
            });
        } else if (sType === "changed") {
            oNext.changedFrom = "";
            oNext.changedTo = "";
        } else {
            oNext[sType] = "";
        }
        return oNext;
    }

    /** Same order as sap/ui/model/Sorter's default: empty values first when ascending. */
    function sortUsers(aUsers, oSort) {
        if (!oSort || !oSort.property) {
            return aUsers.slice();
        }
        var iSign = oSort.descending ? -1 : 1;
        var fnRank = function (vValue) {
            return vValue === null || vValue === undefined || vValue === "" ? 0 : 1;
        };
        return aUsers.slice().sort(function (oA, oB) {
            var vA = oA[oSort.property];
            var vB = oB[oSort.property];
            var iRank = fnRank(vA) - fnRank(vB);
            if (iRank) {
                return iRank * iSign;
            }
            if (typeof vA === "string" && typeof vB === "string") {
                return vA.localeCompare(vB) * iSign;
            }
            return (vA === vB ? 0 : (vA < vB ? -1 : 1)) * iSign;
        });
    }

    /** Escaped HTML with the matched text wrapped. Values come from SAP, so nothing is passed through unescaped. */
    function highlight(sValue, sSearch) {
        var sText = String(sValue === null || sValue === undefined ? "" : sValue);
        var sNeedle = String(sSearch || "").trim();
        var iAt = sNeedle ? sText.toLowerCase().indexOf(sNeedle.toLowerCase()) : -1;
        if (iAt === -1) {
            return encodeXML(sText);
        }
        return encodeXML(sText.slice(0, iAt))
            + "<span class=\"adminSearchMatch\">" + encodeXML(sText.slice(iAt, iAt + sNeedle.length)) + "</span>"
            + encodeXML(sText.slice(iAt + sNeedle.length));
    }

    /** RFC 4180 quoting, plus a leading ' on values a spreadsheet would run as a formula. */
    function csvCell(vValue) {
        var sText = String(vValue === null || vValue === undefined ? "" : vValue);
        if (/^[=+\-@\t\r]/.test(sText)) {
            sText = "'" + sText;
        }
        return /[",\r\n]/.test(sText) ? "\"" + sText.replace(/"/g, "\"\"") + "\"" : sText;
    }

    function toCsv(aRows, aColumns) {
        var aLines = [aColumns.map(function (oColumn) {
            return csvCell(oColumn.label);
        }).join(",")];
        aRows.forEach(function (oRow) {
            aLines.push(aColumns.map(function (oColumn) {
                return csvCell(oColumn.value(oRow));
            }).join(","));
        });
        return aLines.join("\r\n");
    }

    function isSelectable(oUser) {
        return !!oUser.detailsAvailable && !oUser.protectedReason;
    }

    /** What the selection toolbar offers. Lock needs one active user selected, Unlock one locked user. */
    function selectionState(aUsers, aVisible) {
        var aSelected = aUsers.filter(function (oUser) {
            return oUser.selected;
        });
        var aEligible = aVisible.filter(isSelectable);
        var iEligibleSelected = aEligible.filter(function (oUser) {
            return oUser.selected;
        }).length;
        return {
            count: aSelected.length,
            canLock: aSelected.some(function (oUser) {
                return lockStatusOf(oUser) === "active";
            }),
            canUnlock: aSelected.some(function (oUser) {
                return lockStatusOf(oUser) === "locked";
            }),
            all: aEligible.length > 0 && iEligibleSelected === aEligible.length,
            partial: iEligibleSelected > 0 && iEligibleSelected < aEligible.length
        };
    }

    /** Selected users split into those the action changes and those already in the target state. */
    function bulkTargets(aUsers, sAction) {
        var sChanges = sAction === "lock" ? "active" : "locked";
        var oTargets = { run: [], skipped: [] };
        aUsers.forEach(function (oUser) {
            if (oUser.selected) {
                (lockStatusOf(oUser) === sChanges ? oTargets.run : oTargets.skipped).push(oUser.username);
            }
        });
        return oTargets;
    }

    /** Warnings count as succeeded: SAP did the change and the row shows the message. */
    function aggregateResults(aResults) {
        return aResults.reduce(function (oSum, oResult) {
            oSum.succeeded += (oResult.status === "success" || oResult.status === "warning") ? 1 : 0;
            oSum.failed += oResult.status === "error" ? 1 : 0;
            oSum.skipped += oResult.status === "skipped" ? 1 : 0;
            return oSum;
        }, { succeeded: 0, failed: 0, skipped: 0 });
    }

    function usernamesWithStatus(aResults, aStatuses) {
        return aResults.filter(function (oResult) {
            return aStatuses.indexOf(oResult.status) !== -1;
        }).map(function (oResult) {
            return oResult.username;
        });
    }

    /** "SU/001" as OData returns it, split back into the BAPI RETURN fields. */
    function errorToResult(sUsername, oError) {
        var aCode = /^([^/]+)\/(.+)$/.exec((oError && oError.code) || "");
        return {
            username: sUsername,
            status: "error",
            messages: [{
                type: "E",
                id: aCode ? aCode[1] : "",
                number: aCode ? aCode[2] : "",
                message: (oError && oError.message) || ""
            }]
        };
    }

    /**
     * Runs fnWorker over aItems with at most iLimit running at once. Once fnIsCancelled is true no new item
     * starts, and running ones finish. Results keep the order of aItems; an item never started is undefined.
     */
    function runWithConcurrency(aItems, iLimit, fnWorker, fnIsCancelled, fnOnProgress) {
        var aResults = new Array(aItems.length);
        var iNext = 0;
        var iDone = 0;
        function runNext() {
            if (iNext >= aItems.length || fnIsCancelled()) {
                return Promise.resolve();
            }
            var iIndex = iNext++;
            return Promise.resolve().then(function () {
                return fnWorker(aItems[iIndex]);
            }).then(function (oResult) {
                aResults[iIndex] = oResult;
                iDone++;
                fnOnProgress(iDone, aItems.length);
                return runNext();
            });
        }
        var aRunners = [];
        for (var i = 0; i < Math.min(iLimit, aItems.length); i++) {
            aRunners.push(runNext());
        }
        return Promise.all(aRunners).then(function () {
            return aResults;
        });
    }

    return {
        BULK_CONCURRENCY: BULK_CONCURRENCY,
        LIST_LIMIT: LIST_LIMIT,
        dayKey: dayKey,
        emptyFilters: emptyFilters,
        computeKpis: computeKpis,
        filterUsers: filterUsers,
        isKpiSelected: isKpiSelected,
        toggleKpi: toggleKpi,
        hasActiveFilters: hasActiveFilters,
        removeChip: removeChip,
        sortUsers: sortUsers,
        highlight: highlight,
        toCsv: toCsv,
        isSelectable: isSelectable,
        selectionState: selectionState,
        bulkTargets: bulkTargets,
        aggregateResults: aggregateResults,
        usernamesWithStatus: usernamesWithStatus,
        errorToResult: errorToResult,
        runWithConcurrency: runWithConcurrency
    };
});
