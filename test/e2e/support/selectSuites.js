'use strict';

/**
 * Suites whose name or file contains one of the comma-separated terms (any case). No terms = all suites.
 * A term that matches nothing throws, so a typo can never report PASS for a run that tested nothing.
 */
function selectSuites(suites, only) {
    const terms = String(only || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!terms.length) return suites;
    const matches = (suite, term) => suite.name.toLowerCase().includes(term) || suite.file.toLowerCase().includes(term);
    const unknown = terms.filter((term) => !suites.some((suite) => matches(suite, term)));
    if (unknown.length) throw new Error(`--only matches no suite: ${unknown.join(', ')}`);
    return suites.filter((suite) => terms.some((term) => matches(suite, term)));
}

module.exports = { selectSuites };
