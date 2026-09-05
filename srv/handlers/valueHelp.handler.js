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
            const results = await read(req.query);

            if (deduplicateBy && Array.isArray(results)) {
                const seen = new Set();
                const filtered = results.filter(item => {
                    if (!item || !item[deduplicateBy]) return true;
                    if (seen.has(item[deduplicateBy])) return false;
                    seen.add(item[deduplicateBy]);
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
