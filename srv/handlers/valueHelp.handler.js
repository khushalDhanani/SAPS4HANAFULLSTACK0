const { applyPaging, applyWhere } = require('../common/filterUtils');

/**
 * The projection's own `where` (e.g. `where Language = 'EN'`) of a value help entity. CAP does not forward it when
 * req.query is handed to the remote S/4 service, so it is added to the query here — only when every field it
 * references exists on the entity (a renamed field would make the remote query invalid).
 */
function projectionWhere(target) {
    const where = target && ((target.projection && target.projection.where) || (target.query && target.query.SELECT && target.query.SELECT.where));
    if (!Array.isArray(where) || where.length === 0) return null;
    const refs = JSON.stringify(where).match(/"ref":\["([^"]+)"/g) || [];
    const elements = (target && target.elements) || {};
    return refs.every((r) => elements[r.slice(8, -1)]) ? where : null;
}

/**
 * Generic Value Help Handler Registration
 *
 * Provides shared CAP infrastructure for registering READ handlers for value help entity sets
 * against backend data readers with query dispatch, deduplication, and count support.
 *
 * @param {import('@sap/cds').Service} srv - The CAP service instance
 * @param {Array<{ entities: string[], read: Function, deduplicateBy?: string, filterInMemory?: boolean }>} [groups] - Value help entity groups;
 *   `filterInMemory` applies the OData $filter here for readers that return a whole SAP table (RFC reads).
 */
function registerValueHelpHandlers(srv, groups) {
    // If groups not provided, fall back to MM Purchase Order value help configuration
    const resolvedGroups = groups && groups.length > 0
        ? groups
        : require('../mm/purchase-order/handlers/valueHelp.config').poValueHelpConfig;

    for (const group of resolvedGroups) {
        const { entities, read, deduplicateBy } = group;
        if (!entities || entities.length === 0 || typeof read !== 'function') continue;

        srv.on('READ', entities, async (req) => {
            const entityName = req.target ? req.target.name.split('.').pop() : '';

            const pWhere = projectionWhere(req.target);
            if (pWhere && req.query && req.query.SELECT) {
                const where = req.query.SELECT.where;
                req.query.SELECT.where = where && where.length ? [{ xpr: where }, 'and', { xpr: pWhere }] : [...pWhere];
            }

            let results;
            try {
                results = await read(req.query);
            } catch (err) {
                return req.error(err.status || 502, err.message);
            }

            // RFC-backed readers return the whole SAP table; apply the client's $filter here.
            if (group.filterInMemory && Array.isArray(results)) {
                results = applyWhere(results, req.query?.SELECT?.where);
            }

            // Safety guard: For Purchase Order DocumentTypeVH, ensure category 'F'
            if (entityName === 'DocumentTypeVH' && Array.isArray(results)) {
                results = results.filter(item => !item || !item.PurchasingDocumentCategory || item.PurchasingDocumentCategory === 'F');
            }

            const dedupeKey = (group.entityDeduplicateBy && group.entityDeduplicateBy[entityName]) || deduplicateBy;

            let finalResults = results;
            if (dedupeKey && Array.isArray(results)) {
                const seen = new Set();
                finalResults = results.filter(item => {
                    if (!item || item[dedupeKey] === undefined || item[dedupeKey] === null) return true;
                    if (seen.has(item[dedupeKey])) return false;
                    seen.add(item[dedupeKey]);
                    return true;
                });
                if (results.$count !== undefined) {
                    finalResults.$count = results.$count;
                }
            }

            return applyPaging(finalResults, req);
        });
    }
}

module.exports = registerValueHelpHandlers;
module.exports.projectionWhere = projectionWhere;
