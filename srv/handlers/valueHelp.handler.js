/**
 * Generic Value Help Handler Registration
 *
 * Provides shared CAP infrastructure for registering READ handlers for value help entity sets
 * against backend data readers with query dispatch, deduplication, and count support.
 *
 * @param {import('@sap/cds').Service} srv - The CAP service instance
 * @param {Array<{ entities: string[], read: Function, deduplicateBy?: string }>} [groups] - Value help entity groups
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
            let results = await read(req.query);

            const entityName = req.target ? req.target.name.split('.').pop() : '';

            // For Purchase Order DocumentTypeVH, restrict to category 'F' (Purchase Orders)
            if (entityName === 'DocumentTypeVH' && Array.isArray(results)) {
                results = results.filter(item => !item || !item.PurchasingDocumentCategory || item.PurchasingDocumentCategory === 'F');
            }

            const dedupeKey = (group.entityDeduplicateBy && group.entityDeduplicateBy[entityName]) || deduplicateBy;

            if (dedupeKey && Array.isArray(results)) {
                const seen = new Set();
                const filtered = results.filter(item => {
                    if (!item || item[dedupeKey] === undefined || item[dedupeKey] === null) return true;
                    if (seen.has(item[dedupeKey])) return false;
                    seen.add(item[dedupeKey]);
                    return true;
                });
                if (results.$count !== undefined) {
                    filtered.$count = results.$count;
                }
                return filtered;
            }

            return results;
        });
    }
}

module.exports = registerValueHelpHandlers;
