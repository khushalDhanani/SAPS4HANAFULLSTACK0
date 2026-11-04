'use strict';

/**
 * Integration: real CAP HTTP, real role gate, real UserManagementService and UserManagementAdapter.
 * Only the RFC session is stubbed. BAPI names, parameters and list/detail fields follow the adapter header and
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

/** Answers each function module from `answers` (a value, or a function that may throw); records every call. */
function stubRfc(answers = {}) {
    const calls = [];
    jest.spyOn(RfcClient.prototype, 'session').mockImplementation((fn) => fn(async (fm, params) => {
        calls.push({ fm, params });
        const answer = answers[fm];
        return typeof answer === 'function' ? answer(params) : answer;
    }));
    return calls;
}

const down = () => { throw new Error('RFC connection dropped'); };
const LOCK_OK = { BAPI_USER_LOCK: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} };
const UNLOCK_OK = { BAPI_USER_UNLOCK: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} };

describe('Integration: SU01 user management', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.S4_USERNAME;
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
                        { USERNAME: 'ALICE', FIRSTNAME: 'Alice', LASTNAME: 'Smith', FULLNAME: 'Alice Smith' },
                        { USERNAME: 'BOB', FIRSTNAME: 'Bob', LASTNAME: 'Jones', FULLNAME: 'Bob Jones' }
                    ],
                    RETURN: []
                }
            });

            const res = await axios.get(`${BASE}/listUsers(search='ali',maxRows=100)`, ADMIN);

            expect(calls).toEqual([{ fm: 'BAPI_USER_GETLIST', params: { MAX_ROWS: 100 } }]);
            expect(res.status).toBe(200);
            expect(res.data.value).toEqual([{ username: 'ALICE', firstName: 'Alice', lastName: 'Smith', fullName: 'Alice Smith' }]);
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

            expect(calls).toEqual([{ fm: 'BAPI_USER_GET_DETAIL', params: { USERNAME: 'ALICE' } }]);
            expect(res.status).toBe(200);
            expect(res.data).toMatchObject({ username: 'ALICE', fullName: 'Alice Smith', userType: 'A', isLocked: false });
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
                { fm: 'BAPI_USER_LOCK', params: { USERNAME: 'ALICE' } },
                { fm: 'BAPI_TRANSACTION_COMMIT', params: { WAIT: 'X' } }
            ]);
            expect(res.status).toBe(200);
            expect(res.data).toMatchObject({ success: true, message: "User 'ALICE' locked successfully in SAP", username: 'ALICE' });
        });

        it('refuses the connection user from S4_USERNAME in any case with 403, and nothing reaches SAP', async () => {
            process.env.S4_USERNAME = 'CONNECTED_ADMIN';
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

        // Known defect: srv/integration/s4hana/admin/UserManagementAdapter.js:191 ignores the commit RETURN, which srv/integration/s4hana/sd/salesDocBapi.js:70 checks, so a rejected commit is reported as locked
        it.failing('answers 502, not success, when the commit returns an error message', async () => {
            stubRfc({ BAPI_USER_LOCK: { RETURN: [] }, BAPI_TRANSACTION_COMMIT: { RETURN: { TYPE: 'E', MESSAGE: 'Update terminated' } } });
            const res = await axios.post(`${BASE}/lockUser`, { username: 'ALICE' }, ADMIN);
            expect(res.status).toBe(502);
        });
    });

    describe('unlockUser', () => {
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
