function _aiMetaText(oCtl, oScope, sModel) {
    oScope = oScope || {};
    var aParts = [];
    if (oScope.isFallback || oScope.queryFailed) {
        aParts.push(oCtl.getText("aiMetaFallback"));
    } else if (oScope.total != null) {
        aParts.push(oCtl.getText("aiMetaTotal", [oScope.total]));
    }
    if (oScope.statusCounts && oScope.statusCounts.byStatus) { aParts.push(oCtl.getText("aiMetaStatus")); }
    aParts.push(oCtl.getText("aiMetaRows", [oScope.shown != null ? oScope.shown : 0]));
    aParts.push(oCtl.getText("aiMetaModel", [sModel || "-"]));
    return aParts.join(" \u00B7 ");
}

function _aiMetaTooltip(oScope) {
    oScope = oScope || {};
    var a = [];
    if (oScope.isFallback || oScope.queryFailed) {
        a.push("Fallback table rows only (server query failed; incomplete context)");
    } else if (oScope.total != null) {
        a.push(oScope.total + " purchase orders in the " + (oScope.filtered ? "filtered " : "") + "list (server count)");
    }
    if (oScope.completeness === "EXACT_TOTAL") {
        a.push("Exact totals: all " + (oScope.total != null ? oScope.total : oScope.shown) + " matching purchase orders analyzed.");
    } else if (oScope.completeness === "PARTIAL_RESULT") {
        a.push("Partial result: " + (oScope.shown || 0) + " of " + (oScope.total != null ? oScope.total : "unknown") + " purchase orders loaded (capped context; row aggregates are partial).");
    } else if (oScope.completeness === "EMPTY_RESULT") {
        a.push("Empty result: 0 purchase orders match.");
    }
    a.push((oScope.shown || 0) + " most recent purchase orders sent to the model with exact aggregates (supplier, status, company, type, month)");
    if (oScope.statusCounts && oScope.statusCounts.byStatus) {
        a.push("Status counts (server): " + Object.keys(oScope.statusCounts.byStatus).map(function (k) { return k + " " + oScope.statusCounts.byStatus[k]; }).join(", "));
    }
    return a.join("\n");
}

function _toHtml(sText) {
    if (!sText) { return ""; }
    var esc = function (t) {
        return String(t || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    };
    var inline = function (t) {
        var aPoLinks = [];
        t = t.replace(/\[([^\]]+)\]\((?:#\/mm\/purchase-orders\/|po:)(\d{10})\)/gi, function (m, text, po) {
            var idx = aPoLinks.length;
            aPoLinks.push("<a href=\"#/mm/purchase-orders/" + po + "\" class=\"aiPoLink\" data-po=\"" + po + "\" title=\"Open Purchase Order " + po + " in Detail View\">" + text + "</a>");
            return "@@POLINK_" + idx + "@@";
        });
        t = t.replace(/\b(PO|Purchase Order)\s+(\d{10})\b/gi, function (m, prefix, po) {
            var idx = aPoLinks.length;
            aPoLinks.push(prefix + " <a href=\"#/mm/purchase-orders/" + po + "\" class=\"aiPoLink\" data-po=\"" + po + "\" title=\"Open Purchase Order " + po + " in Detail View\">" + po + "</a>");
            return "@@POLINK_" + idx + "@@";
        });
        t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "[image: $1]");
        t = t.replace(/\[([^\]]+)\]\((https?:\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&'*+,;=%]+)\)/g, function (m, text, url) {
            if (/javascript:|data:|vbscript:|file:|about:|&quot;|&#39;|[<>"']/i.test(url)) {
                return text;
            }
            return "<a href=\"" + url + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + text + "</a>";
        });
        t = t
            .replace(/`([^`]+)`/g, function (m, c) { return "<code>" + c + "</code>"; })
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>")
            .replace(/\[(Verified SAP (?:Fact|Record)s?)\]/gi, "<span class=\"aiBadge aiBadgeVerified\">$1</span>")
            .replace(/\[(AI Interpretation|AI-generated interpretation)\]/gi, "<span class=\"aiBadge aiBadgeInterpretation\">$1</span>")
            .replace(/\[(Retrieval Status:[^\]]+)\]/gi, function (m, text) {
                if (/FAILED|FALLBACK|ERROR|NOT_FOUND/i.test(text)) {
                    return "<span class=\"aiBadge aiBadgeFailed\">" + text + "</span>";
                }
                return "<span class=\"aiBadge aiBadgeRetrieval\">" + text + "</span>";
            })
            .replace(/\[(Data Scope:[^\]]+)\]/gi, function (m, text) {
                if (/FAILED|FALLBACK|ERROR/i.test(text)) {
                    return "<span class=\"aiBadge aiBadgeFailed\">" + text + "</span>";
                }
                if (/PARTIAL|CAPPED/i.test(text)) {
                    return "<span class=\"aiBadge aiBadgePartial\">" + text + "</span>";
                }
                if (/EMPTY/i.test(text)) {
                    return "<span class=\"aiBadge aiBadgeEmpty\">" + text + "</span>";
                }
                return "<span class=\"aiBadge aiBadgeScope\">" + text + "</span>";
            })
            .replace(/\[(Completeness:[^\]]+)\]/gi, function (m, text) {
                if (/FAILED|FALLBACK/i.test(text)) {
                    return "<span class=\"aiBadge aiBadgeFailed\">" + text + "</span>";
                }
                if (/PARTIAL/i.test(text)) {
                    return "<span class=\"aiBadge aiBadgePartial\">" + text + "</span>";
                }
                if (/EMPTY/i.test(text)) {
                    return "<span class=\"aiBadge aiBadgeEmpty\">" + text + "</span>";
                }
                return "<span class=\"aiBadge aiBadgeScope\">" + text + "</span>";
            });
        t = t.replace(/@@POLINK_(\d+)@@/g, function (m, idx) {
            return aPoLinks[Number(idx)];
        });
        return t;
    };
    var aLines = esc(sText).replace(/\r\n?/g, "\n").split("\n");
    var aOut = [], sList = null, bPara = false, bCode = false, aTable = null;
    var closeList = function () { if (sList) { aOut.push("</" + sList + ">"); sList = null; } };
    var closePara = function () { if (bPara) { aOut.push("</p>"); bPara = false; } };
    var flushTable = function () {
        if (!aTable) { return; }
        var aRows = aTable.filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r); });
        var cells = function (r) {
            return r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) {
                var sTrimmed = c.trim();
                if (/^\d{10}$/.test(sTrimmed)) {
                    return "<a href=\"#/mm/purchase-orders/" + sTrimmed + "\" class=\"aiPoLink\" data-po=\"" + sTrimmed + "\" title=\"Open Purchase Order " + sTrimmed + " in Detail View\">" + sTrimmed + "</a>";
                }
                return inline(sTrimmed);
            });
        };
        var h = "<table><thead><tr>" + cells(aRows[0]).map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>";
        aRows.slice(1).forEach(function (r) {
            h += "<tr>" + cells(r).map(function (c) { return "<td" + (/^[\d,.\s%()-]+$/.test(c) && /\d/.test(c) ? " class=\"num\"" : "") + ">" + c + "</td>"; }).join("") + "</tr>";
        });
        aOut.push(h + "</tbody></table>");
        aTable = null;
    };
    aLines.forEach(function (l) {
        if (/^\s*```/.test(l)) {
            closePara(); closeList(); flushTable();
            aOut.push(bCode ? "</code></pre>" : "<pre><code>");
            bCode = !bCode; return;
        }
        if (bCode) { aOut.push(l + "\n"); return; }
        if (/^\s*\|.*\|\s*$/.test(l)) { closePara(); closeList(); (aTable = aTable || []).push(l); return; }
        flushTable();
        var m;
        if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(l))) {
            closePara(); closeList();
            var n = Math.min(m[1].length + 2, 6);
            aOut.push("<h" + n + ">" + inline(m[2]) + "</h" + n + ">"); return;
        }
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { closePara(); closeList(); aOut.push("<hr/>"); return; }
        if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) {
            closePara();
            if (sList !== "ul") { closeList(); aOut.push("<ul>"); sList = "ul"; }
            aOut.push("<li>" + inline(m[1]) + "</li>"); return;
        }
        if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) {
            closePara();
            if (sList !== "ol") { closeList(); aOut.push("<ol>"); sList = "ol"; }
            aOut.push("<li>" + inline(m[1]) + "</li>"); return;
        }
        if ((m = /^\s*(?:>|&gt;)\s*(.*)$/.exec(l))) {
            closePara(); closeList();
            aOut.push("<blockquote>" + inline(m[1]) + "</blockquote>"); return;
        }
        if (!l.trim()) { closePara(); closeList(); return; }
        closeList();
        if (bPara) { aOut.push("<br/>" + inline(l)); } else { aOut.push("<p>" + inline(l)); bPara = true; }
    });
    closePara(); closeList(); flushTable();
    if (bCode) { aOut.push("</code></pre>"); }
    return aOut.join("");
}

function _parseSSE(sBuffer) {
    var aEvents = [], aParts = sBuffer.split("\n\n"), sRest = aParts.pop();
    aParts.forEach(function (sBlock) {
        sBlock.split("\n").forEach(function (sLine) {
            if (sLine.indexOf("data:") === 0) {
                try { aEvents.push(JSON.parse(sLine.slice(5).trim())); } catch (e) { /* ignore malformed */ }
            }
        });
    });
    return { events: aEvents, rest: sRest };
}

var oExports = {
    _aiMetaText: _aiMetaText,
    _aiMetaTooltip: _aiMetaTooltip,
    _toHtml: _toHtml,
    _parseSSE: _parseSSE
};

var isNode = typeof module !== "undefined" && module.exports;
if (isNode) {
    module.exports = oExports;
}
if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
    sap.ui.define([], function () {
        return oExports;
    });
}
