#!/usr/bin/env node
/**
 * Generates PurchaseOrderRules.js for UI5 frontend from the authoritative
 * config/schema/purchaseOrderRules.json schema.
 *
 * Usage:
 *   node tools/generate-po-rules.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.resolve(__dirname, '../config/schema/purchaseOrderRules.json');
const TARGET_PATH = path.resolve(__dirname, '../app/fiori-app/webapp/modules/mm/purchase-order/model/PurchaseOrderRules.js');

function generateRulesContent(schema) {
    const jsonStr = JSON.stringify(schema, null, 4);

    return `// AUTO-GENERATED from config/schema/purchaseOrderRules.json - DO NOT EDIT MANUALLY
// Generated on: ${new Date().toISOString()}
// To regenerate: node tools/generate-po-rules.js

(function (root, factory) {
    "use strict";
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory();
    }
    if (typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function" && typeof module === "undefined") {
        sap.ui.define([], factory);
    }
})(this, function () {
    "use strict";

    var SCHEMA = ${jsonStr};

    var PurchaseOrderRules = {
        SCHEMA: SCHEMA,

        PATTERNS: {
            CURRENCY: new RegExp(SCHEMA.patterns.currency),
            DOC_TYPE_PREFIX: new RegExp(SCHEMA.patterns.docTypePrefix)
        },

        HEADER: SCHEMA.header,
        ITEM: SCHEMA.item,
        ITEMS_LIST: SCHEMA.itemsList,
        PO_TYPES: SCHEMA.poTypes || {}
    };

    if (typeof Object.freeze === "function") {
        Object.freeze(PurchaseOrderRules);
        Object.freeze(PurchaseOrderRules.PATTERNS);
        Object.freeze(PurchaseOrderRules.HEADER);
        Object.freeze(PurchaseOrderRules.ITEM);
        Object.freeze(PurchaseOrderRules.ITEMS_LIST);
        if (PurchaseOrderRules.PO_TYPES) {
            Object.freeze(PurchaseOrderRules.PO_TYPES);
        }
    }

    return PurchaseOrderRules;
});
`;
}

function run() {
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.error(`Error: Schema file not found at ${SCHEMA_PATH}`);
        process.exit(1);
    }

    const schemaRaw = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const schema = JSON.parse(schemaRaw);

    if (!schema.patterns || !schema.header || !schema.item || !schema.itemsList) {
        console.error('Error: Schema is missing required sections (patterns, header, item, itemsList)');
        process.exit(1);
    }

    const content = generateRulesContent(schema);
    fs.mkdirSync(path.dirname(TARGET_PATH), { recursive: true });
    fs.writeFileSync(TARGET_PATH, content, 'utf8');
    console.log(`[generate-po-rules] Successfully generated: ${TARGET_PATH}`);
}

if (require.main === module) {
    run();
}

module.exports = {
    generateRulesContent,
    SCHEMA_PATH,
    TARGET_PATH
};
