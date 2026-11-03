'use strict';

const fs = require('fs');
const path = require('path');
const { toAdtSource } = require('../../../tools/adt-create-quar-label');
const { GoodsIssueAttemptStore } = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');

const root = path.join(__dirname, '../../..');
const fugr = fs.readFileSync(path.join(root, 'docs/abap/zwm_post_attempt.fugr.abap'), 'utf8');
const tabl = fs.readFileSync(path.join(root, 'docs/abap/zwm_post_attempt.tabl.ddl'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'srv/wm/goods-issue/GoodsIssueAttemptStore.js'), 'utf8');

/** Field name -> ABAP type text from the `define table` body. */
const tableFields = Object.fromEntries(
    [...tabl.matchAll(/^\s*(?:key\s+)?([a-z_]+)\s*:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()])
);
const snake = (name) => name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
const listIn = (constant) => [...storeSource.match(new RegExp(`const ${constant} = \\[([^\\]]+)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const moduleSource = (name) => toAdtSource(fugr, name);

// Offline only: this checks the proposal against the current store. It proves nothing about SAP.
describe('ZWM_POST_ATTEMPT proposal (offline)', () => {
    it('has a column for every field the attempt store writes', async () => {
        const store = new GoodsIssueAttemptStore({ db: null });
        const row = await store.create({ ReferenceDocument: 'GITEST' });
        const missing = Object.keys(row).filter((k) => k !== 'ID').map(snake).filter((f) => !tableFields[f]);
        expect(missing).toEqual([]);
    });

    it('keys the claim on client and reference, so the primary key decides who wins', () => {
        expect([...tabl.matchAll(/^\s*key\s+([a-z_]+)/gm)].map((m) => m[1])).toEqual(['mandt', 'reference_document']);
        expect(tableFields.reference_document).toBe('abap.char(16) not null');
    });

    it('accepts every status the store uses, and each fits the column', () => {
        const setStatus = moduleSource('Z_WM_ATTEMPT_SET_STATUS');
        const statuses = [...listIn('OPEN_STATUSES'), ...listIn('FINAL_STATUSES'), 'queued'];
        statuses.forEach((status) => {
            expect(setStatus).toContain(`'${status}'`);
            expect(status.length).toBeLessThanOrEqual(20);
        });
    });

    it('marks the same statuses final as the store', () => {
        const finalBranch = moduleSource('Z_WM_ATTEMPT_SET_STATUS').match(/WHEN ([^\n]+)\.\n\s+GET TIME STAMP/)[1];
        expect([...finalBranch.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual(listIn('FINAL_STATUSES').sort());
    });

    it('open-only read returns the statuses the recheck resolves', () => {
        const open = moduleSource('Z_WM_ATTEMPT_READ').match(/status IN \(([^)]+)\)/)[1];
        expect([...open.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual(listIn('OPEN_STATUSES').sort());
    });

    it('commits the claim only after a successful insert, and the read never writes', () => {
        const claim = moduleSource('Z_WM_ATTEMPT_CLAIM');
        expect(claim.indexOf('INSERT zwm_post_attempt')).toBeGreaterThan(-1);
        expect(claim.indexOf('COMMIT WORK')).toBeGreaterThan(claim.indexOf('INSERT zwm_post_attempt'));
        expect(claim).toMatch(/ls_attempt-status\s+= 'sending'/);
        expect(moduleSource('Z_WM_ATTEMPT_READ')).not.toMatch(/\b(COMMIT|INSERT|UPDATE|DELETE|MODIFY)\b/);
    });

    it('produces a valid inline ADT signature for each module', () => {
        expect(moduleSource('Z_WM_ATTEMPT_READ')).toMatch(/ {2}TABLES\n {4}ET_ATTEMPTS STRUCTURE ZWM_POST_ATTEMPT\.\n/);
        ['Z_WM_ATTEMPT_CLAIM', 'Z_WM_ATTEMPT_SET_STATUS', 'Z_WM_ATTEMPT_READ'].forEach((name) => {
            const src = moduleSource(name);
            expect(src).toMatch(/^FUNCTION z_wm_attempt_[a-z_]+\n {2}IMPORTING\n/);
            expect(src).not.toMatch(/^\*"/m);
            expect(src.match(/^FUNCTION /gm)).toHaveLength(1);
        });
    });
});
