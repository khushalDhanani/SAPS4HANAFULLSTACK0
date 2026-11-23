'use strict';

/** The accessibility suite must fail on a new rule and on a recorded rule that hits more nodes, not on less. */

const { regressions } = require('../../e2e/a11y/verifyA11yScreens.e2e');

describe('E2E accessibility baseline comparison', () => {
    it('reports a rule the baseline does not record', () => {
        expect(regressions({ 'aria-allowed-attr': 5, 'color-contrast': 1 }, { 'aria-allowed-attr': 5 })).toEqual(['color-contrast']);
    });

    it('reports a recorded rule that hits more nodes', () => {
        expect(regressions({ 'aria-allowed-attr': 6 }, { 'aria-allowed-attr': 5 })).toEqual(['aria-allowed-attr']);
    });

    it('accepts the same or fewer nodes, and a route without violations', () => {
        expect(regressions({ 'aria-allowed-attr': 5, 'label-content-name-mismatch': 1 }, { 'aria-allowed-attr': 5, 'label-content-name-mismatch': 10 })).toEqual([]);
        expect(regressions({}, {})).toEqual([]);
    });
});
