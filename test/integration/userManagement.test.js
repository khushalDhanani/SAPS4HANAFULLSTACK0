'use strict';

/**
 * Integration: real CAP HTTP, real role gate, real UserManagementService and UserManagementAdapter.
 * Only the RFC session and its connection parameters are stubbed. BAPI names, parameters and list/detail fields follow the adapter header and
 * tools/verify-su01-bapi-contracts.js; BAPI_USER_LOCK/UNLOCK answers were never read live (RETURN shape not proven).
 */

const cds = require('@sap/cds');
const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');

const cdsTest = cds.test(__dirname + '/../../');
const { axios } = cdsTest;

const BASE = '/odata/v4/user-management';
const ADMIN = { auth: { username: 'khushal', password: '' }, validateStatus: () => true };
const VIEWER = { auth: { username: 'test-viewer-1120', password: '' }, validateStatus: () => true };
const ANONYMOUS = { validateStatus: () => true };

const DEFAULT_ANSWERS = { RFC_READ_TABLE: { DATA: [] }, BAPI_USER_GET_DETAIL: { LOGONDATA: { USTYP: 'A' }, ISLOCKED: {}, RETURN: [] } };

/** Answers each function module from `answers` (a value, or a function that may throw); records every call. */
function stubRfc(answers = {}) {
    const calls = [];
    jest.spyOn(RfcClient.prototype, 'resolveConnectionParams').mockResolvedValue({ user: 'CONNECTED_ADMIN' });
    jest.spyOn(RfcClient.prototype, 'session').mockImplementation((fn) => fn(async (fm, params) => {
        calls.push({ fm, params });
        const answer = fm in answers ? answers[fm] : DEFAULT_ANSWERS[fm];
        return typeof answer === 'function' ? answer(params) : answer;
    }));
    return calls;
}

const down = () => { throw new Error('RFC connection dropped'); };
// lockUser reads the target's user type first; a dialog user is not protected.
const TYPE_READ = { fm: 'BAPI_USER_GET_DETAIL', params: { USERNAME: 'ALICE' } };
const detailOfType = (USTYP) => ({ LOGONDATA: { USTYP }, ISLOCKED: {}, RETURN: [] });
const LOCK_OK = { BAPI_USER_LOCK: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} };
const UNLOCK_OK = { BAPI_USER_UNLOCK: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} };

// Password-expiry enrichment uses only these non-secret columns (see readPasswordExpiryData).
const expiryReads = (username) => [
    { fm: 'RFC_READ_TABLE', params: {
        QUERY_TABLE: 'USR02', DELIMITER: '|',
        FIELDS: ['BNAME', 'USTYP', 'UFLAG', 'GLTGV', 'GLTGB', 'PWDCHGDATE', 'TRDAT', 'LTIME'].map((FIELDNAME) => ({ FIELDNAME })),
        OPTIONS: username ? [{ TEXT: `BNAME = '${username}'` }] : []
    } },
    { fm: 'RFC_READ_TABLE', params: {
        QUERY_TABLE: 'USER_ADDR', DELIMITER: '|',
        FIELDS: ['BNAME', 'NAME_TEXTC'].map((FIELDNAME) => ({ FIELDNAME })), OPTIONS: []
    } }
];

describe('Integration: SU01 user management', () => {
    beforeEach(() => {
        // CAP retains its service/adapter across requests; each case supplies fresh RFC answers.
        cds.services.UserManagementService._getAdapter().clearCache();
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Admin gate', () => {
        it.each([
            ['lockUser', `${BASE}/lockUser`],
            ['unlockUser', `${BASE}/unlockUser`]
        ])('%s: a non-Admin gets 403 and nothing reaches SAP', async (_name, url) => {
            const calls = stubRfc({ ...LOCK_OK, ...UNLOCK_OK });
            const res = await axios.post(url, { username: 'ALICE' }, VIEWER);
            expect(res.status).toBe(403);
            expect(calls).toEqual([]);
        });

        it.each([
            ['lockUser', `${BASE}/lockUser`],
            ['unlockUser', `${BASE}/unlockUser`]
        ])('%s: an unauthenticated caller gets 401 and nothing reaches SAP', async (_name, url) => {
            const calls = stubRfc({ ...LOCK_OK, ...UNLOCK_OK });
            const res = await axios.post(url, { username: 'ALICE' }, ANONYMOUS);
            expect(res.status).toBe(401);
            expect(calls).toEqual([]);
        });

        it.each([
            ['listUsers', `${BASE}/listUsers()`],
            ['getUserDetail', `${BASE}/getUserDetail(username='ALICE')`]
        ])('%s: a non-Admin gets 403 and nothing reaches SAP', async (_name, url) => {
            const calls = stubRfc();
            const res = await axios.get(url, VIEWER);
            expect(res.status).toBe(403);
            expect(calls).toEqual([]);
        });
    });

    describe('reads', () => {
        it('listUsers sends maxRows to SAP and returns the mapped users matching the search', async () => {
            const calls = stubRfc({
                BAPI_USER_GETLIST: {
                    USERLIST: [
                        { USERNAME: 'ALICE', FIRSTNAME: '', LASTNAME: '', FULLNAME: '' },
                        { USERNAME: 'BOB', FIRSTNAME: 'Bob', LASTNAME: 'Jones', FULLNAME: 'Bob Jones' }
                    ],
                    RETURN: []
                },
                BAPI_USER_GET_DETAIL: {
                    ADDRESS: { FULLNAME: 'Alice Smith' },
                    LOGONDATA: { USTYP: 'A', GLTGV: '00000000', GLTGB: '00000000' },
                    ISLOCKED: { GLOB_LOCK: 'U' },
                    LASTMODIFIED: { MODDATE: '20261001', MODIFIER: 'ADMIN' },
                    RETURN: []
                }
            });

            const res = await axios.get(`${BASE}/listUsers(search='ali',maxRows=100)`, ADMIN);

            expect(calls).toHaveLength(4);
            expect(calls).toEqual(expect.arrayContaining([
                { fm: 'BAPI_USER_GETLIST', params: { MAX_ROWS: 100 } },
                { fm: 'BAPI_USER_GET_DETAIL', params: { USERNAME: 'ALICE' } },
                ...expiryReads()
            ]));
            expect(res.status).toBe(200);
            expect(res.data.value).toEqual([{
                protectedReason: '',
                pwdLastChanged: '',
                pwdExpiresAt: '',
                pwdDaysRemaining: null,
                pwdStatus: 'valid',
                username: 'ALICE',
                firstName: '',
                lastName: '',
                fullName: 'Alice Smith',
                detailsAvailable: true,
                isLocked: false,
                userType: 'A',
                validFrom: '00000000',
                validTo: '00000000',
                lastChanged: '20261001',
                lastChangedBy: 'ADMIN'
            }]);
        });

        it('listUsers and getUserDetail flag why a user cannot be locked', async () => {
            const detailBy = { ALICE: 'A', SVC: 'S', SYS: 'B', [ADMIN.auth.username.toUpperCase()]: 'A', CONNECTED_ADMIN: 'A' };
            stubRfc({
                BAPI_USER_GETLIST: { USERLIST: Object.keys(detailBy).map((USERNAME) => ({ USERNAME })), RETURN: [] },
                BAPI_USER_GET_DETAIL: ({ USERNAME }) => detailOfType(detailBy[USERNAME])
            });

            const list = await axios.get(`${BASE}/listUsers(search='',maxRows=10)`, ADMIN);
            const reasons = Object.fromEntries(list.data.value.map((u) => [u.username, u.protectedReason]));
            expect(reasons).toEqual({ ALICE: '', SVC: 'type', SYS: 'type', [ADMIN.auth.username.toUpperCase()]: 'self', CONNECTED_ADMIN: 'connection' });

            const detail = await axios.get(`${BASE}/getUserDetail(username='SVC')`, ADMIN);
            expect(detail.data.protectedReason).toBe('type');
        });

        it('listUsers answers 502 with the adapter text when the RFC call fails', async () => {
            stubRfc({ BAPI_USER_GETLIST: down });
            const res = await axios.get(`${BASE}/listUsers()`, ADMIN);
            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('Failed to retrieve user list from SAP');
        });

        it('getUserDetail trims and upper-cases the username before it reaches SAP', async () => {
            const calls = stubRfc({
                BAPI_USER_GET_DETAIL: { ADDRESS: { FULLNAME: 'Alice Smith' }, LOGONDATA: { USTYP: 'A' }, ISLOCKED: { GLOB_LOCK: 'U' }, RETURN: [] }
            });

            const res = await axios.get(`${BASE}/getUserDetail(username='%20%20alice%20%20')`, ADMIN);

            expect(calls).toHaveLength(3);
            expect(calls).toEqual(expect.arrayContaining([
                { fm: 'BAPI_USER_GET_DETAIL', params: { USERNAME: 'ALICE' } },
                ...expiryReads('ALICE')
            ]));
            expect(res.status).toBe(200);
            expect(res.data).toMatchObject({ username: 'ALICE', fullName: 'Alice Smith', userType: 'A', isLocked: false });
        });

        it('getUserDetail returns the role and profile lists through OData, without password hashes', async () => {
            stubRfc({
                BAPI_USER_GET_DETAIL: {
                    LOGONDATA: { USTYP: 'A', PWDSALTEDHASH: 'SECRET-H' },
                    ISLOCKED: { GLOB_LOCK: 'U' },
                    ACTIVITYGROUPS: [{ AGR_NAME: 'Z_ROLE', AGR_TEXT: 'Role', FROM_DAT: '20250101', TO_DAT: '99991231' }],
                    PROFILES: [{ BAPIPROF: 'Z_PROF', BAPIPTEXT: 'Profile' }],
                    RETURN: []
                }
            });

            const res = await axios.get(`${BASE}/getUserDetail(username='ALICE')`, ADMIN);

            expect(res.status).toBe(200);
            expect(res.data.roles).toEqual([{ name: 'Z_ROLE', description: 'Role', validFrom: '20250101', validTo: '99991231' }]);
            expect(res.data.profiles).toEqual([{ name: 'Z_PROF', description: 'Profile' }]);
            expect(JSON.stringify(res.data)).not.toContain('SECRET');
        });

        it('getUserDetail answers 502 with the adapter text when the RFC call fails', async () => {
            stubRfc({ BAPI_USER_GET_DETAIL: down });
            const res = await axios.get(`${BASE}/getUserDetail(username='ALICE')`, ADMIN);
            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('Failed to retrieve user detail from SAP');
        });
    });

    describe('lockUser', () => {
        it('trims and upper-cases the username, locks, commits with WAIT and reports the user', async () => {
            const calls = stubRfc(LOCK_OK);

            const res = await axios.post(`${BASE}/lockUser`, { username: '  alice  ' }, ADMIN);

            expect(calls).toEqual([
                TYPE_READ,
                { fm: 'BAPI_USER_LOCK', params: { USERNAME: 'ALICE' } },
                { fm: 'BAPI_TRANSACTION_COMMIT', params: { WAIT: 'X' } }
            ]);
            expect(res.status).toBe(200);
            expect(res.data).toMatchObject({ success: true, message: "User 'ALICE' locked successfully in SAP", username: 'ALICE' });
        });

        it.each(['B', 'S'])('refuses a user of protected type %s with 403, and sends no lock', async (USTYP) => {
            const calls = stubRfc({ ...LOCK_OK, BAPI_USER_GET_DETAIL: detailOfType(USTYP) });

            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);

            expect(res.status).toBe(403);
            expect(calls).toEqual([TYPE_READ]);
        });

        it('refuses the logged-in user with 403, and nothing reaches SAP', async () => {
            const calls = stubRfc(LOCK_OK);

            const res = await axios.post(`${BASE}/lockUser`, { username: ADMIN.auth.username }, ADMIN);

            expect(res.status).toBe(403);
            expect(calls).toEqual([]);
        });

        it('fails closed: no lock is sent when the type read fails', async () => {
            const calls = stubRfc({ ...LOCK_OK, BAPI_USER_GET_DETAIL: down });

            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);

            expect(res.status).toBe(502);
            expect(calls).toEqual([TYPE_READ]);
        });

        it('rolls back without a commit on an E message, and returns the SAP message id', async () => {
            const calls = stubRfc({
                BAPI_USER_LOCK: { RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '001', MESSAGE: 'No authorization' }] },
                BAPI_TRANSACTION_ROLLBACK: {}
            });

            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);

            expect(calls.map((c) => c.fm)).toEqual(['BAPI_USER_GET_DETAIL', 'BAPI_USER_LOCK', 'BAPI_TRANSACTION_ROLLBACK']);
            expect(res.status).toBe(502);
            expect(res.data.error).toMatchObject({ code: 'SU/001', message: 'SAP error: No authorization' });
        });

        it('reports a warning and its messages when the BAPI returns type W', async () => {
            stubRfc({ ...LOCK_OK, BAPI_USER_LOCK: { RETURN: [{ TYPE: 'W', ID: 'SU', NUMBER: '002', MESSAGE: 'Careful' }] } });

            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);

            expect(res.status).toBe(200);
            expect(res.data).toMatchObject({ status: 'warning', messages: [{ type: 'W', id: 'SU', number: '002', message: 'Careful' }] });
        });

        it('rejects a reason over 500 characters before anything reaches SAP', async () => {
            const calls = stubRfc(LOCK_OK);

            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE', reason: 'x'.repeat(501) }, ADMIN);

            expect(res.status).toBe(400);
            expect(calls).toEqual([]);
        });

        it('writes an audit line with who, target, action, result and reason, for success and refusal', async () => {
            const info = jest.spyOn(console, 'info').mockImplementation(() => {});
            const log = jest.spyOn(console, 'log').mockImplementation(() => {});
            const auditLines = () => [...info.mock.calls, ...log.mock.calls].map((args) => args.join(' ')).filter((line) => line.includes('AUDIT'));
            stubRfc({ ...LOCK_OK });
            await axios.post(`${BASE}/lockUser`, { username: 'ALICE', reason: 'Left\nthe company' }, ADMIN);
            expect(auditLines().join()).toEqual(expect.stringContaining('"target":"ALICE","action":"lock","result":"success","reason":"Left\\nthe company"'));
            expect(auditLines().join()).toContain(`"who":"${ADMIN.auth.username}"`);

            stubRfc({ ...LOCK_OK, BAPI_USER_GET_DETAIL: detailOfType('S') });
            await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);
            expect(auditLines().join()).toContain('"result":"refused"');
        });

        it('refuses the RFC connection user in any case with 403, and nothing reaches SAP', async () => {
            const calls = stubRfc(LOCK_OK);

            const res = await axios.post(`${BASE}/lockUser`, { username: 'connected_admin' }, ADMIN);

            expect(res.status).toBe(403);
            expect(res.data.error.message).toBe("Cannot lock user 'CONNECTED_ADMIN': operation refused because it is the active RFC connection user");
            expect(calls).toEqual([]);
        });

        it('answers 502 with the adapter text when the lock call fails', async () => {
            stubRfc({ BAPI_USER_LOCK: down });
            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);
            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('Failed to lock user in SAP: RFC connection dropped');
        });

        it('answers 502, not success, when the commit call fails after the lock', async () => {
            stubRfc({ BAPI_USER_LOCK: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: () => { throw new Error('commit failed'); } });
            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);
            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('commit failed');
        });
    });

    describe.each([
        ['lockUser', 'BAPI_USER_LOCK', 'lock', 'locked', 'ALICE'],
        ['unlockUser', 'BAPI_USER_UNLOCK', 'unlock', 'unlocked', 'BOB']
    ])('%s: the commit result', (action, bapi, verb, done, username) => {
        const run = (commit, rollback) => {
            const calls = stubRfc({ [bapi]: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: commit, BAPI_TRANSACTION_ROLLBACK: rollback });
            return { calls, sent: axios.post(`${BASE}/${action}`, { username }, ADMIN) };
        };
        // lockUser reads the user type first; these tests are about what follows it.
        const names = (calls) => calls.map((c) => c.fm).filter((fm) => fm !== 'BAPI_USER_GET_DETAIL');

        it.each(['E', 'A'])('answers 502 and rolls back when the commit returns a type %s message', async (TYPE) => {
            const { calls, sent } = run({ RETURN: { TYPE, MESSAGE: 'Update terminated' } });

            const res = await sent;

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe(`SAP did not commit the ${verb} of user '${username}': Update terminated`);
            expect(names(calls)).toEqual([bapi, 'BAPI_TRANSACTION_COMMIT', 'BAPI_TRANSACTION_ROLLBACK']);
        });

        it('finds the error when the commit returns a list of messages', async () => {
            const { sent } = run({ RETURN: [{ TYPE: 'S', MESSAGE: 'Saved' }, { TYPE: 'E', MESSAGE: 'Update terminated' }] });

            expect((await sent).status).toBe(502);
        });

        it('still reports the commit error when the rollback also fails', async () => {
            const { sent } = run({ RETURN: { TYPE: 'E', MESSAGE: 'Update terminated' } }, down);

            const res = await sent;

            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe(`SAP did not commit the ${verb} of user '${username}': Update terminated`);
        });

        it.each([
            ['an empty result row', { RETURN: { TYPE: '', MESSAGE: '' } }],
            ['a warning', { RETURN: { TYPE: 'W', MESSAGE: 'Note' } }]
        ])('reports success with no rollback when the commit returns %s', async (_name, commit) => {
            const { calls, sent } = run(commit);

            const res = await sent;

            expect(res.status).toBe(200);
            expect(res.data.message).toBe(`User '${username}' ${done} successfully in SAP`);
            expect(names(calls)).toEqual([bapi, 'BAPI_TRANSACTION_COMMIT']);
        });
    });

    describe('unlockUser', () => {
        it('allows unlocking a protected user, so it can be recovered', async () => {
            const calls = stubRfc({ ...UNLOCK_OK, BAPI_USER_GET_DETAIL: detailOfType('S') });

            const res = await axios.post(`${BASE}/unlockUser`, { username: 'ALICE' }, ADMIN);

            expect(res.status).toBe(200);
            expect(calls.map((c) => c.fm)).toEqual(['BAPI_USER_UNLOCK', 'BAPI_TRANSACTION_COMMIT']);
        });

        it('trims and upper-cases the username, unlocks, commits with WAIT and reports the user', async () => {
            const calls = stubRfc(UNLOCK_OK);

            const res = await axios.post(`${BASE}/unlockUser`, { username: '  bob  ' }, ADMIN);

            expect(calls).toEqual([
                { fm: 'BAPI_USER_UNLOCK', params: { USERNAME: 'BOB' } },
                { fm: 'BAPI_TRANSACTION_COMMIT', params: { WAIT: 'X' } }
            ]);
            expect(res.status).toBe(200);
            expect(res.data).toMatchObject({ success: true, message: "User 'BOB' unlocked successfully in SAP", username: 'BOB' });
        });

        it('answers 502 with the adapter text when the unlock call fails', async () => {
            stubRfc({ BAPI_USER_UNLOCK: down });
            const res = await axios.post(`${BASE}/unlockUser`, { username: 'BOB' }, ADMIN);
            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('Failed to unlock user in SAP: RFC connection dropped');
        });

        it('answers 502, not success, when the commit call fails after the unlock', async () => {
            stubRfc({ BAPI_USER_UNLOCK: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: () => { throw new Error('commit failed'); } });
            const res = await axios.post(`${BASE}/unlockUser`, { username: 'BOB' }, ADMIN);
            expect(res.status).toBe(502);
            expect(res.data.error.message).toBe('commit failed');
        });
    });
});
