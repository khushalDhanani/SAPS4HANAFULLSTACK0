var AI_CONTEXT_ROWS = 100;
var AI_ITEM_POS = 120;

var PROCUREMENT_INTENTS = {
    PURCHASE_ORDER: "PURCHASE_ORDER",
    SUPPLIER: "SUPPLIER",
    MATERIAL: "MATERIAL",
    ITEM: "ITEM",
    STATUS: "STATUS",
    DELIVERY_DATE: "DELIVERY_DATE",
    QUANTITY: "QUANTITY",
    SPEND: "SPEND"
};

function _extractPONumbers(sText) {
    var aFound = String(sText || "").match(/\b\d{10}\b/g) || [];
    return aFound.filter(function (n, i) { return aFound.indexOf(n) === i; }).slice(0, 5);
}

function _extractSearchTerms(sText) {
    var STOP = ("a an the and or of for to in on at by with from into about as is are was were be been do does did have has had " +
        "how many much what which who whom whose when where why show list give me find get tell count total sum number amount value " +
        "top most least highest lowest largest smallest biggest all any some each per every this that these those there their " +
        "purchase purchasing order orders ordered ordering po pos document documents item items line lines material materials product products plant plants receive receives receiving " +
        "supplier suppliers vendor vendors status open approved draft rejected pending released sent complete completed created " +
        "quantity qty unit units pcs nos pieces piece price prices net gross delivery date month year week day today yesterday recent latest new old " +
        "please can could would should you your we our my also only just with without between above below more than less " +
        "table format summary summarize summarise group grouped wise breakdown compare comparison company code org organisation organization " +
        "search searching look looking exist exists exists existing available data details detail info information report").split(/\s+/);
    var m = {};
    STOP.forEach(function (w) { m[w] = true; });
    var aFound = String(sText || "").match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || [];
    return aFound.map(function (w) { return w.replace(/^-+|-+$/g, ""); })
        .filter(function (w, i, a) { return w.length >= 3 && !m[w.toLowerCase()] && !/^\d+$/.test(w) && a.indexOf(w) === i; })
        .slice(0, 5);
}

function _asksAboutItems(sText) {
    return /\b(item|line|material|product|qty|quantit|plant|storage|deliver|due\b|schedul|overdue|price|unit\b|kg\b|requisition|tax|mat(erial)? ?group)/i.test(String(sText || ""));
}

function _asksAboutStatus(sText) {
    return /\b(open|approved|approval|draft|rejected|pending|status|released|complete)/i.test(String(sText || ""));
}

function _detectProcurementIntents(sQuestion) {
    var sText = String(sQuestion || "");
    var aIntents = [];
    var aPoNumbers = _extractPONumbers(sText);
    var aSearchTerms = _extractSearchTerms(sText);

    var bPo = aPoNumbers.length > 0 || /\b(po|pos|purchase\s*orders?|orders?|ebeln|headers?|creators?|created\s*by|company\s*codes?|bukrs|purch(?:asing)?\s*org(?:anization)?s?|ekorg|purch(?:asing)?\s*groups?|ekgrp|doc(?:ument)?\s*types?|bsart)\b/i.test(sText);
    if (bPo) { aIntents.push("PURCHASE_ORDER"); }

    var bSupplier = /\b(suppliers?|vendors?|lifnr|name1|sellers?|providers?|who\s+(?:sold|supplied|delivered|created)|partner)\b/i.test(sText);
    if (bSupplier) { aIntents.push("SUPPLIER"); }

    var bMaterial = /\b(materials?|matnr|products?|skus?|part\s*numbers?|commodit(?:y|ies)|goods)\b/i.test(sText) ||
        (aSearchTerms.length > 0 && !/\b(status|open|draft|sent|released)\b/i.test(sText));
    if (bMaterial) { aIntents.push("MATERIAL"); }

    var bItem = /\b(items?|line\s*items?|positions?|ebelp|plants?|werks|storage\s*loc(?:ation)?s?|sloc|lgort)\b/i.test(sText);
    if (bItem) { aIntents.push("ITEM"); }

    var bStatus = _asksAboutStatus(sText) ||
        /\b(status|lifecycle|approval|approved|draft|rejected|released|sent|pending|statu|procstat)\b/i.test(sText);
    if (bStatus) { aIntents.push("STATUS"); }

    var bDelivery = /\b(due\b|schedul|overdue|deliver(?:y|ies)?|eindt|eta|when\b|arrival|expected\b|timeline|dates?|today|tomorrow|yesterday|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2})\b/i.test(sText);
    if (bDelivery) { aIntents.push("DELIVERY_DATE"); }

    var bQty = /\b(quantit(?:y|ies)?|qty\b|menge|meins|units?\b|uom|volumes?|how\s+many\s+(?:items|units|boxes|pieces|kg|litres|meters|pcs|nos))\b/i.test(sText);
    if (bQty) { aIntents.push("QUANTITY"); }

    var bSpend = /\b(spends?|spending|net\s*amounts?|amounts?|netwr|prices?|costs?|values?|worth|expensive|largest|top\b|highest|cheapest|waers|currenc(?:y|ies)|usd|eur|inr|gbp|budget)\b/i.test(sText);
    if (bSpend) { aIntents.push("SPEND"); }

    if (aIntents.length === 0) { aIntents.push("PURCHASE_ORDER"); }

    var sPrimary = aIntents[0];
    if (aPoNumbers.length > 0 || (bPo && !bDelivery && !bSpend && !bStatus && !bQty && !bSupplier && !/\b(materials?|matnr|products?|skus?|commodit|goods)\b/i.test(sText))) {
        sPrimary = "PURCHASE_ORDER";
    } else if (bDelivery && /\b(due\b|schedul|overdue|when\b|arrival|expected)\b/i.test(sText)) {
        sPrimary = "DELIVERY_DATE";
    } else if (bSpend && /\b(largest|top|highest|total\s*spend|spend|cost)\b/i.test(sText)) {
        sPrimary = "SPEND";
    } else if (bStatus && /\b(status|open|draft|approved|rejected|released)\b/i.test(sText)) {
        sPrimary = "STATUS";
    } else if (bQty && /\b(how\s+many|quantit|qty|volume)\b/i.test(sText)) {
        sPrimary = "QUANTITY";
    } else if (bSupplier && /\b(suppliers?|vendors?|lifnr|name1|who\s+(?:sold|supplied|delivered))\b/i.test(sText)) {
        sPrimary = "SUPPLIER";
    } else if (bItem && /\b(items?|line\s*items?|positions?|plants?|storage\s*loc|sloc)\b/i.test(sText) && !/\b(materials?|matnr|products?|skus?|commodit|goods)\b/i.test(sText)) {
        sPrimary = "ITEM";
    } else if (bMaterial && (/\b(materials?|matnr|products?|skus?|commodit|goods)\b/i.test(sText) || (!bPo && !bItem && aSearchTerms.length > 0))) {
        sPrimary = "MATERIAL";
    } else if (bSupplier) {
        sPrimary = "SUPPLIER";
    } else if (bItem) {
        sPrimary = "ITEM";
    }

    return {
        intents: aIntents,
        primaryIntent: sPrimary,
        entities: {
            poNumbers: aPoNumbers, searchTerms: aSearchTerms,
            hasDeliveryIntent: bDelivery, hasSpendIntent: bSpend, hasStatusIntent: bStatus,
            hasQuantityIntent: bQty, hasMaterialIntent: bMaterial, hasSupplierIntent: bSupplier
        }
    };
}

function _buildRetrievalPlan(sQuestion, oIntents) {
    oIntents = oIntents || _detectProcurementIntents(sQuestion);
    var aOperations = [{
        id: "OP_CONTEXT_HEADERS", operation: "READ_CONTEXT_HEADERS",
        entitySet: "PurchaseOrders", servicePath: "/PurchaseOrders",
        purpose: "Load up to " + AI_CONTEXT_ROWS + " recent purchase order headers matching active filters",
        required: true
    }];

    if (oIntents.entities.poNumbers.length > 0) {
        oIntents.entities.poNumbers.forEach(function (sPo) {
            aOperations.push({
                id: "OP_EXPAND_PO_" + sPo, operation: "EXPAND_PURCHASE_ORDER", entitySet: "PurchaseOrders",
                servicePath: "/PurchaseOrders('" + encodeURIComponent(sPo) + "')?$expand=to_PurchaseOrderItem",
                po: sPo, purpose: "Retrieve complete document header and all line items (materials, quantities, delivery dates, net prices)",
                required: true
            });
        });
    }

    if (oIntents.intents.indexOf("STATUS") !== -1) {
        aOperations.push({
            id: "OP_STATUS_BREAKDOWN", operation: "SERVER_STATUS_COUNTS", entitySet: "PurchaseOrders",
            servicePath: "/PurchaseOrders/$count",
            purpose: "Calculate server-side counts across the entire list for every SAP purchasing document status code",
            required: true
        });
    }

    if (oIntents.intents.indexOf("SPEND") !== -1 || oIntents.intents.indexOf("SUPPLIER") !== -1 || oIntents.intents.indexOf("PURCHASE_ORDER") !== -1) {
        aOperations.push({
            id: "OP_TOP_SPEND", operation: "SERVER_SORTED_TOP_SPEND", entitySet: "PurchaseOrders",
            servicePath: "/PurchaseOrders?$orderby=PurchaseOrderNetAmount desc&$top=15",
            purpose: "Retrieve server-sorted top 15 purchase orders by net amount across the whole dataset",
            required: false
        });
    }

    if (oIntents.entities.searchTerms.length > 0) {
        aOperations.push({
            id: "OP_ITEM_SEARCH", operation: "WHOLE_DATASET_ITEM_SEARCH", entitySet: "PurchaseOrderItems",
            servicePath: "/PurchaseOrderItems?$filter=contains(PurchaseOrderItemText) or contains(Material)",
            terms: oIntents.entities.searchTerms,
            purpose: "Search all line items across the complete dataset for matching terms: " + JSON.stringify(oIntents.entities.searchTerms),
            required: true
        });
    }

    var bNeedsItems = oIntents.intents.indexOf("ITEM") !== -1 || oIntents.intents.indexOf("DELIVERY_DATE") !== -1 ||
                      oIntents.intents.indexOf("QUANTITY") !== -1 || oIntents.intents.indexOf("MATERIAL") !== -1;
    if (bNeedsItems) {
        aOperations.push({
            id: "OP_BATCH_ITEMS", operation: "BATCH_ITEM_EXPAND", entitySet: "PurchaseOrderItems",
            servicePath: "/PurchaseOrderItems?$filter=PurchaseOrder in [...]",
            purpose: "Load line items (delivery dates, order quantities, materials, net amounts) for up to " + AI_ITEM_POS + " context POs",
            required: true
        });
    }

    return {
        question: sQuestion, intents: oIntents.intents, primaryIntent: oIntents.primaryIntent,
        entities: oIntents.entities, operations: aOperations, timestamp: new Date().toISOString()
    };
}

function _validateRetrievalPlan(oPlan) {
    if (!oPlan || !Array.isArray(oPlan.operations) || oPlan.operations.length === 0) {
        return { isValid: false, reason: "Retrieval plan contains no operations", verifiedServices: [], groundingSources: [] };
    }
    var aAllowedEntitySets = ["PurchaseOrders", "PurchaseOrderItems"];
    var aVerifiedServices = [], aGroundingSources = [], bAllValid = true, sFailureReason = "";

    oPlan.operations.forEach(function (op) {
        if (aAllowedEntitySets.indexOf(op.entitySet) === -1) {
            bAllValid = false;
            sFailureReason = "Unverified SAP entity set: " + op.entitySet;
        }
        if (aVerifiedServices.indexOf(op.servicePath) === -1) { aVerifiedServices.push(op.servicePath); }
        var sSource = op.entitySet === "PurchaseOrders" ? "EKKO (PurchaseOrders)" : "EKPO (PurchaseOrderItems)";
        if (aGroundingSources.indexOf(sSource) === -1) { aGroundingSources.push(sSource); }
    });

    return {
        isValid: bAllValid,
        reason: bAllValid ? "Plan verified: all operations target validated SAP OData v4 endpoints" : sFailureReason,
        verifiedServices: aVerifiedServices, groundingSources: aGroundingSources,
        intentsCovered: oPlan.intents, primaryIntent: oPlan.primaryIntent
    };
}

function _generateFollowUps(oScope, sQuestion) {
    var aQuestions = [], sQ = (sQuestion || "").toLowerCase(), aPos = _extractPONumbers(sQuestion);
    var oIntents = oScope && oScope.intents ? oScope.intents : _detectProcurementIntents(sQuestion);
    var aIntents = (oIntents && oIntents.intents) || [];

    if (aPos.length > 0) {
        var sPo = aPos[0];
        aQuestions.push("Show delivery schedule and items for PO " + sPo);
        aQuestions.push("What is the approval status of PO " + sPo + "?");
        aQuestions.push("Who is the supplier and payment terms for PO " + sPo + "?");
    } else if (aIntents.indexOf("STATUS") !== -1 || sQ.indexOf("status") !== -1 || sQ.indexOf("approval") !== -1) {
        aQuestions.push("List all purchase orders pending approval (02)");
        aQuestions.push("Which purchase orders are released (08)?");
        aQuestions.push("Are there any rejected purchase orders?");
    } else if (aIntents.indexOf("SPEND") !== -1 || sQ.indexOf("spend") !== -1 || sQ.indexOf("net") !== -1 || sQ.indexOf("top") !== -1 || sQ.indexOf("amount") !== -1) {
        aQuestions.push("Which suppliers have the highest net spend?");
        aQuestions.push("Show top 5 purchase orders by net amount");
        aQuestions.push("What is the average PO value across the filtered list?");
    } else if (aIntents.indexOf("DELIVERY_DATE") !== -1 || sQ.indexOf("deliver") !== -1 || sQ.indexOf("due") !== -1 || sQ.indexOf("schedule") !== -1) {
        aQuestions.push("Which purchase orders are due this month?");
        aQuestions.push("Show overdue line items across all suppliers");
        aQuestions.push("List delivery dates for pending orders");
    } else if (aIntents.indexOf("SUPPLIER") !== -1 || sQ.indexOf("supplier") !== -1 || sQ.indexOf("vendor") !== -1) {
        aQuestions.push("What is the total spend per supplier?");
        aQuestions.push("Show purchase orders for the top supplier");
        aQuestions.push("Which suppliers have active pending orders?");
    } else if (aIntents.indexOf("MATERIAL") !== -1 || aIntents.indexOf("ITEM") !== -1 || sQ.indexOf("item") !== -1 || sQ.indexOf("material") !== -1) {
        aQuestions.push("Show line items and ordered quantities");
        aQuestions.push("Which materials have the highest ordered volumes?");
        aQuestions.push("List items pending delivery");
    } else {
        aQuestions.push("What is the total net spend across all filtered POs?");
        aQuestions.push("Show purchase orders pending approval");
        aQuestions.push("Which suppliers have the highest order volume?");
    }

    return aQuestions.slice(0, 3).map(function (s) {
        return { text: s, question: s };
    });
}

var oExports = {
    PROCUREMENT_INTENTS: PROCUREMENT_INTENTS,
    _extractPONumbers: _extractPONumbers,
    _extractSearchTerms: _extractSearchTerms,
    _asksAboutItems: _asksAboutItems,
    _asksAboutStatus: _asksAboutStatus,
    _detectProcurementIntents: _detectProcurementIntents,
    _buildRetrievalPlan: _buildRetrievalPlan,
    _validateRetrievalPlan: _validateRetrievalPlan,
    _generateFollowUps: _generateFollowUps
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
