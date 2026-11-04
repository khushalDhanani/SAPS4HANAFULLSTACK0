'use strict';

/**
 * UI ↔ model contracts the E2E screen suites caught failing at runtime:
 * - value-help fields used by the UI must exist on the CAP entities they read (compiled CDS model);
 * - OverflowToolbarLayoutData priorities must be valid sap.m.OverflowToolbarPriority values.
 */

const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');

const ROOT = path.join(__dirname, '../../..');
const WEBAPP = path.join(ROOT, 'app/fiori-app/webapp');

// sap.m.OverflowToolbarPriority in UI5 1.136.22 (resources/sap/m/library-dbg.js), the version index.html loads
const OVERFLOW_PRIORITIES = ['NeverOverflow', 'Never', 'High', 'Low', 'Disappear', 'AlwaysOverflow', 'Always'];

function files(dir, ext) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? files(p, ext) : (p.endsWith(ext) ? [p] : []);
    });
}

describe('UI view/model contracts', () => {
    let model;
    beforeAll(async () => {
        model = await cds.load(path.join(ROOT, 'srv'));
    }, 60000);

    /** Every service entity with this (unqualified) name, e.g. ItemCategoryVH in PurchaseOrderService. */
    const entitiesNamed = (name) => Object.entries(model.definitions)
        .filter(([fq, d]) => d.kind === 'entity' && fq.endsWith(`Service.${name}`))
        .map(([fq, d]) => ({ fq, elements: Object.keys(d.elements || {}) }));

    const valueHelpConfigs = () => {
        const src = fs.readFileSync(path.join(WEBAPP, 'service/ValueHelpService.js'), 'utf8');
        return [...src.matchAll(/"\/(\w+)": \{[^}]*?key: "(\w+)", desc: "(\w+)"(?:, descAlt: "(\w+)")?/g)];
    };

    // OrderTypeVH (ValueHelpService.js:51) has no service entity and no view or controller opens it; reported as a
    // dead config. Any further entry without an entity, or fixing this one, fails here on purpose.
    it('the only value-help dialog config without a service entity is OrderTypeVH', () => {
        const configs = valueHelpConfigs();
        expect(configs.length).toBeGreaterThan(10);
        expect(configs.filter(([, entity]) => entitiesNamed(entity).length === 0).map(([, entity]) => entity)).toEqual(['OrderTypeVH']);
    });

    // The config is keyed by entity-set path only and shared by several services, so an entry with a service entity
    // must match at least one of that name.
    it('every value-help dialog config with a service entity names its key and desc fields', () => {
        const configs = valueHelpConfigs();
        const problems = configs
            .filter(([, entity]) => entitiesNamed(entity).length > 0)
            .filter(([, entity, key, desc, descAlt]) => !entitiesNamed(entity).some(({ elements }) =>
                elements.includes(key) && (elements.includes(desc) || (descAlt && elements.includes(descAlt)))))
            .map(([, entity, key, desc]) => `${entity}: no service entity has ${key} + ${desc}`);
        expect(problems).toEqual([]);
    });

    it('PO create view suggestion items bind fields that exist on their PurchaseOrderService entity', () => {
        const xml = fs.readFileSync(path.join(WEBAPP, 'modules/mm/purchase-order/view/CreatePurchaseOrder.view.xml'), 'utf8');
        const problems = [];
        // suggestionItems="{path: '/X', ...}"> followed by its ListItem template; only simple {Field} bindings are checked
        for (const [, entity, template] of xml.matchAll(/suggestionItems="\{path: '\/(\w+)'[^"]*"\s*>\s*<suggestionItems>\s*(<core:ListItem[^>]*\/>)/g)) {
            const def = model.definitions[`PurchaseOrderService.${entity}`];
            if (!def) { problems.push(`PurchaseOrderService.${entity} not found`); continue; }
            for (const [, attr, field] of template.matchAll(/(key|text|additionalText)="\{(\w+)\}"/g)) {
                if (!def.elements[field]) problems.push(`${entity}.${attr}: ${field} missing`);
            }
        }
        expect(problems).toEqual([]);
    });

    it('every OverflowToolbarLayoutData priority in the app views is a valid OverflowToolbarPriority', () => {
        const invalid = files(WEBAPP, '.xml').flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/OverflowToolbarLayoutData[^>]*priority="([^"{]+)"/g)]
            .filter(([, p]) => !OVERFLOW_PRIORITIES.includes(p))
            .map(([, p]) => `${path.relative(WEBAPP, f)}: ${p}`));
        expect(invalid).toEqual([]);
    });
});
