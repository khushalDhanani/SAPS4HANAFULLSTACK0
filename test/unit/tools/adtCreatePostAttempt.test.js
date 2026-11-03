'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, tableSource, buildPlan, MODULES } = require('../../../tools/adt-create-post-attempt');

const TOOL = path.join(__dirname, '../../../tools/adt-create-post-attempt.js');

// Offline only: builds what the tool would send. It proves nothing about SAP.
describe('adt-create-post-attempt (offline)', () => {
    it.each([
        [[], /--package/],
        [['--package', '$TMP', '--transport', 'DS4K900123'], /--package/],
        [['--package', 'ZAMM'], /--transport/],
        [['--package', 'ZAMM', '--transport', 'xxxxx'], /--transport/],
        [['--package', 'ZAMM', '--transport', 'DS4K12'], /--transport/]
    ])('refuses %j', (args, msg) => {
        expect(() => parseArgs(args)).toThrow(msg);
    });

    it('accepts ZAMM with a request number, and reads print-only', () => {
        expect(parseArgs(['--package', 'ZAMM', '--transport', 'DS4K900123'])).toEqual({ pkg: 'ZAMM', transport: 'DS4K900123', printOnly: false });
        expect(parseArgs(['--package', 'ZAMM', '--transport', 'DS4K900123', '--print-only']).printOnly).toBe(true);
    });

    it('sends the table definition from its first annotation, without the file notes', () => {
        const { table } = buildPlan('ZAMM');
        expect(table.source.startsWith('@EndUserText.label')).toBe(true);
        expect(table.source).not.toMatch(/proposal, NOT created/);
        expect(table.source).toMatch(/key reference_document : abap\.char\(16\) not null;/);
        expect(table.xml).toContain('adtcore:type="TABL/DT"');
        expect(table.xml).toContain('<adtcore:packageRef adtcore:name="ZAMM"/>');
        expect(() => tableSource('// nothing here')).toThrow(/not found/);
    });

    it('marks all three modules remote-enabled and gives each only its own source', () => {
        const { modules } = buildPlan('ZAMM');
        expect(modules.map((m) => m.name)).toEqual(MODULES.map((m) => m.name));
        for (const m of modules) {
            expect(m.xml).toContain('fmodule:processingType="rfc"');
            expect(m.source.match(/^FUNCTION /gm)).toHaveLength(1);
            expect(m.source.startsWith(`FUNCTION ${m.name.toLowerCase()}\n`)).toBe(true);
        }
    });

    it('is blocked without the live opt-in, before reading any argument', () => {
        const env = { ...process.env };
        delete env.ALLOW_LIVE_SAP_TOOLS;
        const run = spawnSync(process.execPath, [TOOL, '--package', 'ZAMM', '--transport', 'DS4K900123'], { env, encoding: 'utf8' });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(/requires ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap/);
    });

    it('--print-only makes no SAP call: it works with no connection settings at all', () => {
        const env = { PATH: process.env.PATH, ALLOW_LIVE_SAP_TOOLS: '1' };
        const run = spawnSync(process.execPath, [TOOL, '--allow-live-sap', '--package', 'ZAMM', '--transport', 'DS4K900123', '--print-only'], { env, encoding: 'utf8' });
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(/^PRINT ONLY: no SAP call was made/);
        expect(run.stdout).toContain('define table zwm_post_attempt');
        expect(run.stdout).toContain('FUNCTION z_wm_attempt_read');
    });
});
