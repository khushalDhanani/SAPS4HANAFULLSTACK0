'use strict';

let Logic;
const encodeXML = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

beforeAll(() => {
    global.sap = { ui: { define: (deps, factory) => { Logic = factory(encodeXML); } } };
    require('../../../app/fiori-app/webapp/modules/admin/user-management/util/UserListLogic.js');
});

const TODAY = new Date(2026, 10, 5);
const user = (username, extra = {}) => ({ username, fullName: `${username} Name`, detailsAvailable: true, isLocked: false, userType: 'A', lastChanged: '20260101', lastChangedBy: 'ADMIN', protectedReason: '', pwdStatus: 'valid', ...extra });
const USERS = [
    user('ALPHA', { lastChanged: '20261105', lastChangedBy: 'DRATHOD', pwdStatus: 'expiring_soon' }),
    user('BETA', { isLocked: true, lastChanged: '20261030', pwdStatus: 'expired' }),
    user('GAMMA', { isLocked: true, userType: 'S', lastChanged: '20261029', protectedReason: 'type', pwdStatus: 'exempt' }),
    user('DELTA', { detailsAvailable: false, isLocked: null, userType: null, lastChanged: null, lastChangedBy: null, pwdStatus: 'valid' })
];
const filters = (extra = {}) => ({ ...Logic.emptyFilters(), ...extra });
const names = (rows) => rows.map((row) => row.username);

describe('KPI counts', () => {
    test('count the whole list, with today and the last 7 days inclusive', () => {
        expect(Logic.computeKpis(USERS, TODAY)).toEqual({ total: 4, active: 1, locked: 2, changedToday: 1, changedLast7: 2, expiringSoon: 1, expired: 1 });
    });

    test('a user with unavailable details is neither active nor locked', () => {
        expect(Logic.computeKpis([USERS[3]], TODAY)).toEqual({ total: 1, active: 0, locked: 0, changedToday: 0, changedLast7: 0, expiringSoon: 0, expired: 0 });
    });

    test('are all zero for an empty list', () => {
        expect(Logic.computeKpis([], TODAY).total).toBe(0);
    });
});

describe('filter combination', () => {
    test.each([
        ['lock status', { lockStatus: 'locked' }, ['BETA', 'GAMMA']],
        ['unavailable status', { lockStatus: 'unavailable' }, ['DELTA']],
        ['password status expiring_soon', { pwdStatus: 'expiring_soon' }, ['ALPHA']],
        ['password status expired', { pwdStatus: 'expired' }, ['BETA']],
        ['user types', { userTypes: ['S', 'L'] }, ['GAMMA']],
        ['changed by', { changedBy: ['DRATHOD'] }, ['ALPHA']],
        ['date range', { changedFrom: '20261029', changedTo: '20261030' }, ['BETA', 'GAMMA']],
        ['search on username, any case', { search: 'alp' }, ['ALPHA']],
        ['search on full name', { search: 'gamma name' }, ['GAMMA']],
        ['every filter together, as AND', { lockStatus: 'locked', userTypes: ['A'], changedFrom: '20261001', search: 'bet' }, ['BETA']],
        ['AND with no overlap', { lockStatus: 'active', userTypes: ['S'] }, []]
    ])('%s', (_name, values, expected) => {
        expect(names(Logic.filterUsers(USERS, filters(values)))).toEqual(expected);
    });

    test('a date filter leaves out a user with no change date', () => {
        expect(names(Logic.filterUsers(USERS, filters({ changedTo: '20991231' })))).not.toContain('DELTA');
    });

    test('no filters keep every row', () => {
        expect(Logic.filterUsers(USERS, filters())).toHaveLength(4);
    });
});

describe('KPI cards and filters stay in sync', () => {
    test('clicking a card applies its filter and selects it; clicking again clears it', () => {
        const on = Logic.toggleKpi('locked', filters({ search: 'x' }), TODAY);
        expect(on).toMatchObject({ lockStatus: 'locked', search: 'x' });
        expect(Logic.isKpiSelected('locked', on, TODAY)).toBe(true);

        const off = Logic.toggleKpi('locked', on, TODAY);
        expect(off).toMatchObject({ lockStatus: '', search: 'x' });
        expect(Logic.isKpiSelected('locked', off, TODAY)).toBe(false);
    });

    test('expiringSoon and expired KPI cards toggle their filters', () => {
        const onExpiring = Logic.toggleKpi('expiringSoon', filters(), TODAY);
        expect(onExpiring).toMatchObject({ pwdStatus: 'expiring_soon' });
        expect(Logic.isKpiSelected('expiringSoon', onExpiring, TODAY)).toBe(true);

        const offExpiring = Logic.toggleKpi('expiringSoon', onExpiring, TODAY);
        expect(offExpiring).toMatchObject({ pwdStatus: '' });
        expect(Logic.isKpiSelected('expiringSoon', offExpiring, TODAY)).toBe(false);

        const onExpired = Logic.toggleKpi('expired', filters(), TODAY);
        expect(onExpired).toMatchObject({ pwdStatus: 'expired' });
        expect(Logic.isKpiSelected('expired', onExpired, TODAY)).toBe(true);
    });

    test('a card shows selected when the same value is set through the filter controls', () => {
        expect(Logic.isKpiSelected('active', filters({ lockStatus: 'active' }), TODAY)).toBe(true);
        expect(Logic.isKpiSelected('changedToday', filters({ changedFrom: '20261105', changedTo: '20261105' }), TODAY)).toBe(true);
        expect(Logic.isKpiSelected('changedLast7', filters({ changedFrom: '20261030', changedTo: '20261105' }), TODAY)).toBe(true);
        expect(Logic.isKpiSelected('changedLast7', filters({ changedFrom: '20261029', changedTo: '20261105' }), TODAY)).toBe(false);
    });

    test('Total clears every filter and is selected only with none active', () => {
        const cleared = Logic.toggleKpi('total', filters({ lockStatus: 'locked', userTypes: ['A'] }), TODAY);
        expect(cleared).toEqual(Logic.emptyFilters());
        expect(Logic.isKpiSelected('total', cleared, TODAY)).toBe(true);
        expect(Logic.isKpiSelected('total', filters({ search: 'x' }), TODAY)).toBe(false);
    });
});

describe('chips', () => {
    test('removing one chip keeps the others', () => {
        const start = filters({ userTypes: ['A', 'S'], changedBy: ['X'], changedFrom: '1', changedTo: '2', search: 'q', lockStatus: 'locked', pwdStatus: 'expiring_soon' });
        expect(Logic.removeChip(start, 'userTypes:A').userTypes).toEqual(['S']);
        expect(Logic.removeChip(start, 'changedBy:X').changedBy).toEqual([]);
        expect(Logic.removeChip(start, 'changed:')).toMatchObject({ changedFrom: '', changedTo: '', search: 'q' });
        expect(Logic.removeChip(start, 'lockStatus:')).toMatchObject({ lockStatus: '', search: 'q' });
        expect(Logic.removeChip(start, 'pwdStatus:')).toMatchObject({ pwdStatus: '', search: 'q' });
    });

    test('a value holding a colon is removed whole', () => {
        expect(Logic.removeChip(filters({ changedBy: ['A:B', 'C'] }), 'changedBy:A:B').changedBy).toEqual(['C']);
    });
});

describe('protected users and selection', () => {
    test('protected users and users with unavailable details cannot be selected', () => {
        expect(USERS.map(Logic.isSelectable)).toEqual([true, true, false, false]);
    });

    test('Lock needs an active user selected, and Unlock a locked one', () => {
        const rows = [user('A', { selected: true }), user('B', { isLocked: true })];
        expect(Logic.selectionState(rows, rows)).toMatchObject({ count: 1, canLock: true, canUnlock: false, all: false, partial: true });
        const locked = [user('A'), user('B', { isLocked: true, selected: true })];
        expect(Logic.selectionState(locked, locked)).toMatchObject({ canLock: false, canUnlock: true });
    });

    test('select-all state looks only at selectable visible rows', () => {
        const rows = [user('A', { selected: true }), user('P', { protectedReason: 'self' }), user('N', { detailsAvailable: false })];
        expect(Logic.selectionState(rows, rows)).toMatchObject({ all: true, partial: false });
        expect(Logic.selectionState([], [])).toMatchObject({ count: 0, all: false, partial: false });
    });

    test('users already in the target state are skipped', () => {
        const rows = [user('A', { selected: true }), user('B', { isLocked: true, selected: true }), user('C')];
        expect(Logic.bulkTargets(rows, 'lock')).toEqual({ run: ['A'], skipped: ['B'] });
        expect(Logic.bulkTargets(rows, 'unlock')).toEqual({ run: ['B'], skipped: ['A'] });
    });
});

describe('bulk results', () => {
    test('aggregate with warnings counted as succeeded', () => {
        const results = [{ status: 'success' }, { status: 'warning' }, { status: 'error' }, { status: 'skipped' }, { status: 'skipped' }];
        expect(Logic.aggregateResults(results)).toEqual({ succeeded: 2, failed: 1, skipped: 2 });
    });

    test('select the names to retry or undo by status', () => {
        const results = [{ username: 'A', status: 'success' }, { username: 'B', status: 'warning' }, { username: 'C', status: 'error' }];
        expect(Logic.usernamesWithStatus(results, ['error'])).toEqual(['C']);
        expect(Logic.usernamesWithStatus(results, ['success', 'warning'])).toEqual(['A', 'B']);
    });

    test('an error with a BAPI code keeps its id and number', () => {
        expect(Logic.errorToResult('A', { code: 'SU/001', message: 'No authorization' })).toEqual({
            username: 'A', status: 'error', messages: [{ type: 'E', id: 'SU', number: '001', message: 'No authorization' }]
        });
    });

    test('an error with no BAPI code still reports its text', () => {
        expect(Logic.errorToResult('A', { code: '502', message: 'Gateway' }).messages[0]).toMatchObject({ id: '', number: '', message: 'Gateway' });
    });
});

describe('runWithConcurrency', () => {
    const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

    test('never runs more than the limit, and keeps result order', async () => {
        let running = 0;
        let peak = 0;
        const worker = async (n) => {
            running++;
            peak = Math.max(peak, running);
            await nextTurn();
            running--;
            return n * 2;
        };
        const progress = [];
        const results = await Logic.runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, worker, () => false, (done, total) => progress.push(`${done}/${total}`));
        expect(peak).toBe(3);
        expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
        expect(progress[progress.length - 1]).toBe('7/7');
    });

    test('cancel stops new items, finishes running ones, and leaves the rest undefined', async () => {
        let cancelled = false;
        const started = [];
        const worker = async (n) => {
            started.push(n);
            if (n === 2) cancelled = true;
            await nextTurn();
            return n;
        };
        const results = await Logic.runWithConcurrency([1, 2, 3, 4, 5, 6], 2, worker, () => cancelled, () => {});
        expect(started).toEqual([1, 2]);
        expect(results.slice(0, 2)).toEqual([1, 2]);
        expect(results.slice(2)).toEqual([undefined, undefined, undefined, undefined]);
    });

    test('handles an empty list', async () => {
        await expect(Logic.runWithConcurrency([], 5, jest.fn(), () => false, jest.fn())).resolves.toEqual([]);
    });
});

describe('text output', () => {
    test('highlight escapes SAP values and wraps only the match', () => {
        expect(Logic.highlight('<b>Alice</b>', 'ali')).toBe('&lt;b&gt;<span class="adminSearchMatch">Ali</span>ce&lt;/b&gt;');
        expect(Logic.highlight('<b>', '')).toBe('&lt;b&gt;');
        expect(Logic.highlight(null, 'x')).toBe('');
    });

    test('a search that contains markup cannot inject it', () => {
        const html = Logic.highlight('a<img src=x>b', '<img src=x>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img src=x&gt;');
    });

    test('CSV quotes separators and neutralizes spreadsheet formulas', () => {
        const columns = [{ label: 'Name', value: (r) => r.name }, { label: 'By', value: (r) => r.by }];
        expect(Logic.toCsv([{ name: 'A, "B"', by: '=HYPERLINK("x")' }, { name: '+1', by: null }], columns))
            .toBe('Name,By\r\n"A, ""B""","\'=HYPERLINK(""x"")"\r\n\'+1,');
    });

    test('sort matches the column indicator direction, with empty values first when ascending', () => {
        expect(names(Logic.sortUsers(USERS, { property: 'lastChanged', descending: false }))).toEqual(['DELTA', 'GAMMA', 'BETA', 'ALPHA']);
        expect(names(Logic.sortUsers(USERS, { property: 'username', descending: true }))).toEqual(['GAMMA', 'DELTA', 'BETA', 'ALPHA']);
        expect(names(Logic.sortUsers(USERS, null))).toEqual(names(USERS));
    });
});
