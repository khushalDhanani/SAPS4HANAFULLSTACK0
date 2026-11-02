'use strict';

const { selectSuites } = require('../../e2e/support/selectSuites');

describe('selectSuites (runAllE2E --only)', () => {
    const SUITES = [
        { name: 'Shell screens', file: 'shell/verifyShellScreens.e2e.js' },
        { name: 'WM screens', file: 'wm/verifyWmScreens.e2e.js' },
        { name: 'Plant isolation', file: 'negative/verifyPlantIsolation.e2e.js' }
    ];
    const names = (list) => list.map((s) => s.name);

    it.each([[''], [undefined], [' , ']])('runs every suite with no terms (%p)', (only) => {
        expect(selectSuites(SUITES, only)).toEqual(SUITES);
    });

    it('matches a name or a file, in any case, and keeps the suite order', () => {
        expect(names(selectSuites(SUITES, 'NEGATIVE/, shell'))).toEqual(['Shell screens', 'Plant isolation']);
    });

    it('throws on a term that matches nothing, so a typo cannot pass with no tests run', () => {
        expect(() => selectSuites(SUITES, 'shell,wmm')).toThrow('--only matches no suite: wmm');
    });
});
