'use strict';

/**
 * Integration: real CAP HTTP, real role gate, real service, adapter, monitor and store on SQLite.
 * SAP's reads, the mailer and the clock are mocked: no SAP call and no email leaves this test.
 */

jest.mock('../../srv/common/mailer', () => ({ isConfigured: jest.fn(() => true), sendMail: jest.fn() }));

const cds = require('@sap/cds');
const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');
const mailer = require('../../srv/common/mailer');
const monitor = require('../../srv/admin/lockNotifier');
const { UserManagementAdapter } = require('../../srv/integration/s4hana/admin/UserManagementAdapter');

const cdsTest = cds.test(__dirname + '/../../');
const { axios } = cdsTest;

const BASE = '/odata/v4/user-management';
const ADMIN = { auth: { username: 'khushal', password: '' }, validateStatus: () => true };
const VIEWER = { auth: { username: 'test-viewer-1120', password: '' }, validateStatus: () => true };
const SNAPSHOT = 'saps4hana.admin.UserLockSnapshot';
const CONTEXT = 'saps4hana.admin.UserLockContext';
const EVENT = 'saps4hana.admin.UserLockNotification';
const MONITOR = 'saps4hana.admin.UserLockMonitor';
const { SELECT, DELETE, UPDATE } = cds.ql;

let sap;
let clock;
const tick = () => { clock = new Date(clock.getTime() + 60000); return clock; };
const stamp = () => tick().toISOString().replace(/\D/g, '').slice(0, 14);

/** A stub SAP: a lock changes USR02 and adds a USH02 row, as SU01 was seen to on DS4/220. */
function setLock(username, uflag, by = 'SAPADMIN') {
  sap.uflag[username] = uflag;
  (sap.history[username] = sap.history[username] || []).push({ stamp: stamp(), by, uflag });
}

function stubSap() {
  jest.spyOn(RfcClient.prototype, 'resolveConnectionParams').mockResolvedValue({ user: 'CONNECTED_ADMIN' });
  jest.spyOn(RfcClient.prototype, 'session').mockImplementation((fn) => fn(async (fm, params) => {
    sap.calls.push({ fm, params });
    if (sap.down) throw new Error('RFC connection dropped');
    if (fm === 'BAPI_USER_LOCK') {
      if (sap.lockFails.includes(params.USERNAME)) {
        return { RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '001', MESSAGE: 'No authorization' }] };
      }
      setLock(params.USERNAME, 64, 'KHUSHAL');
      return { RETURN: [] };
    }
    if (fm === 'BAPI_USER_UNLOCK') {
      setLock(params.USERNAME, 0, 'KHUSHAL');
      return { RETURN: [] };
    }
    if (fm === 'BAPI_TRANSACTION_COMMIT' || fm === 'BAPI_TRANSACTION_ROLLBACK') return {};
    if (fm === 'BAPI_USER_GET_DETAIL') {
      return { ADDRESS: {}, LOGONDATA: { USTYP: 'A', PWDSALTEDHASH: 'SECRET-HASH' }, ISLOCKED: {}, RETURN: [] };
    }
    if (fm === 'RFC_READ_TABLE' && params.QUERY_TABLE === 'USR02') {
      return { DATA: Object.entries(sap.uflag).map(([u, f]) => ({ WA: `${u}|${f}` })) };
    }
    if (fm === 'RFC_READ_TABLE' && params.QUERY_TABLE === 'USER_ADDR') {
      if (sap.namesDown) throw new Error('View not readable');
      return { DATA: Object.keys(sap.uflag).map((u) => ({ WA: `${u}|${u} Name` })) };
    }
    if (fm === 'RFC_READ_TABLE' && params.QUERY_TABLE === 'USH02') {
      const name = /'(.*)'/.exec(params.OPTIONS[0].TEXT)[1];
      return { DATA: (sap.history[name] || []).map((h) => ({ WA: `${h.stamp.slice(0, 8)}|${h.stamp.slice(8)}|${h.by}|${h.uflag}` })) };
    }
    throw new Error(`Unexpected call ${fm}`);
  }));
}

const NO_WAIT = [0, 0, 0];
const adapter = () => new UserManagementAdapter();
const poll = () => monitor.pollOnce(adapter(), { now: tick(), retryDelays: NO_WAIT });
const events = () => cds.db.run(SELECT.from(EVENT).orderBy('username', 'lockedAt'));
const snapshotOf = async (username) => (await cds.db.run(SELECT.one.from(SNAPSHOT).where({ username })))?.uflag;
const lock = (username, extra = {}) => axios.post(`${BASE}/lockUser`, { username, ...extra }, ADMIN);
const mailed = () => mailer.sendMail.mock.calls.map(([mail]) => mail);
const backdateContexts = (seconds) => cds.db.run(UPDATE(CONTEXT).set({ at: new Date(clock.getTime() - seconds * 1000).toISOString() }));

function spyLogs() {
  const spies = ['info', 'log', 'warn', 'error'].map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  return () => spies.flatMap((spy) => spy.mock.calls).map((args) => args.join(' ')).join('\n');
}

describe('Integration: lock monitor', () => {
  beforeEach(async () => {
    sap = { uflag: { ALICE: 0, BOB: 0, CAROL: 0, DAVE: 0, ERIN: 0, KHUSHAL: 0 }, history: {}, calls: [], lockFails: [], down: false, namesDown: false };
    clock = new Date();
    for (const entity of [EVENT, SNAPSHOT, CONTEXT, MONITOR]) await cds.db.run(DELETE.from(entity));
    mailer.sendMail.mockReset();
    mailer.sendMail.mockResolvedValue({});
    mailer.isConfigured.mockReturnValue(true);
    process.env.LOCK_NOTIFY_TO = 'khushal@example.test';
    stubSap();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    ['LOCK_NOTIFY_TO', 'LOCK_MAX_PER_EMAIL', 'LOCK_POLL_INTERVAL_SEC'].forEach((name) => delete process.env[name]);
  });

  describe('detection', () => {
    test('the baseline run sends nothing, even with users already locked', async () => {
      sap.uflag.ALICE = 64;
      sap.uflag.BOB = 128;

      expect(await poll()).toMatchObject({ baseline: 6, newlyLocked: 0, email: 'none' });
      expect(await poll()).toMatchObject({ newlyLocked: 0, email: 'none' });

      expect(mailer.sendMail).not.toHaveBeenCalled();
      expect(await snapshotOf('ALICE')).toBe(64);
    });

    test('a new lock triggers one email', async () => {
      await poll();
      setLock('ALICE', 64);

      expect(await poll()).toMatchObject({ newlyLocked: 1, email: 'sent' });

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0]).toMatchObject({ to: 'khushal@example.test', subject: '[SAP Alert] User ALICE locked' });
      expect((await events())[0]).toMatchObject({
        username: 'ALICE', fullName: 'ALICE Name', lockType: 'Locked by administrator', lockedBy: 'SAPADMIN', source: 'SAP / automatic', status: 'sent',
      });
    });

    test('several new locks in one cycle send one email', async () => {
      await poll();
      ['ALICE', 'BOB', 'CAROL'].forEach((user) => setLock(user, 64));

      await poll();

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].subject).toBe('[SAP Alert] 3 users locked');
    });

    test('users already locked stay silent, and a later unlock and lock is a new event', async () => {
      await poll();
      setLock('ALICE', 64);
      await poll();
      await poll();
      await poll();
      expect(mailed()).toHaveLength(1);

      setLock('ALICE', 0);
      await poll();
      setLock('ALICE', 64);
      await poll();

      expect(mailed()).toHaveLength(2);
      expect(await events()).toHaveLength(2);
    });

    test('a change of lock type on a locked user stays silent', async () => {
      sap.uflag.ALICE = 128;
      await poll();
      setLock('ALICE', 192);

      await poll();

      expect(mailer.sendMail).not.toHaveBeenCalled();
      expect(await snapshotOf('ALICE')).toBe(192);
    });

    test('a user new since the baseline who is locked counts as a new lock', async () => {
      await poll();
      setLock('NEWUSER', 32);

      await poll();

      expect(mailed()[0].subject).toBe('[SAP Alert] User NEWUSER locked');
      expect((await events())[0].lockType).toBe('Global lock (CUA)');
    });

    test('a wrong-password lock is detected with no app involved', async () => {
      await poll();
      setLock('BOB', 128, 'BOB');

      await poll();

      expect((await events())[0]).toMatchObject({ lockType: 'Locked due to incorrect logon attempts', source: 'SAP / automatic', lockedBy: 'BOB' });
    });

    test('reads all users in one call, and never calls BAPI_USER_GET_DETAIL', async () => {
      await poll();
      ['ALICE', 'BOB'].forEach((user) => setLock(user, 64));
      sap.calls = [];

      await poll();

      expect(sap.calls.filter((c) => c.params.QUERY_TABLE === 'USR02')).toHaveLength(1);
      expect(sap.calls.filter((c) => c.params.QUERY_TABLE === 'USER_ADDR')).toHaveLength(1);
      expect(sap.calls.filter((c) => c.fm === 'BAPI_USER_GET_DETAIL')).toEqual([]);
      expect(sap.calls.find((c) => c.params.QUERY_TABLE === 'USR02').params.FIELDS).toEqual([{ FIELDNAME: 'BNAME' }, { FIELDNAME: 'UFLAG' }]);
    });

    test('a quiet cycle reads only USR02', async () => {
      await poll();
      sap.calls = [];

      await poll();

      expect(sap.calls.map((c) => c.params.QUERY_TABLE)).toEqual(['USR02']);
    });

    test('still alerts when names or history cannot be read', async () => {
      await poll();
      sap.namesDown = true;
      sap.uflag.ALICE = 64; // no USH02 row

      await poll();

      expect((await events())[0]).toMatchObject({ username: 'ALICE', fullName: '', lockedBy: 'Unknown' });
      expect(mailed()).toHaveLength(1);
    });
  });

  describe('SAP read failure', () => {
    test('sends nothing, keeps the snapshot, and the next tick catches up', async () => {
      await poll();
      setLock('ALICE', 64);
      sap.down = true;

      expect(await poll()).toMatchObject({ failed: true, email: 'none' });

      expect(mailer.sendMail).not.toHaveBeenCalled();
      expect(await snapshotOf('ALICE')).toBe(0);

      sap.down = false;
      await poll();
      expect(mailed()).toHaveLength(1);
    });

    test('an empty read counts as a failure, not as everyone gone', async () => {
      setLock('ALICE', 64);
      await poll();
      const saved = sap.uflag;
      sap.uflag = {};

      expect(await poll()).toMatchObject({ failed: true });

      expect(await snapshotOf('ALICE')).toBe(64);
      sap.uflag = saved;
      await poll();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('a failure on the very first run stores no baseline', async () => {
      sap.down = true;
      await poll();
      expect(await cds.db.run(SELECT.from(SNAPSHOT))).toEqual([]);
    });
  });

  describe('dedupe across a restart', () => {
    /** A restart: every module and its memory is gone. Only the database remains. */
    function restarted() {
      let fresh;
      jest.isolateModules(() => {
        // The database and the mock mailer stand for what outlives a restart and the outside world.
        jest.doMock('@sap/cds', () => cds);
        jest.doMock('../../srv/common/mailer', () => mailer);
        fresh = require('../../srv/admin/lockNotifier');
      });
      return fresh;
    }

    test('a sent lock is not emailed again after a restart', async () => {
      await poll();
      setLock('ALICE', 64);
      await poll();
      expect(mailed()).toHaveLength(1);

      const fresh = restarted();
      await fresh.pollOnce(adapter(), { now: tick(), retryDelays: NO_WAIT });

      expect(mailed()).toHaveLength(1);
    });

    test('a baseline stored before a restart is not repeated, and no email follows', async () => {
      sap.uflag.ALICE = 64;
      await poll();

      const result = await restarted().pollOnce(adapter(), { now: tick(), retryDelays: NO_WAIT });

      expect(result.baseline).toBeUndefined();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('a lock queued before a restart is sent after it, once', async () => {
      await poll();
      setLock('ALICE', 64);
      mailer.sendMail.mockRejectedValue(new Error('down'));
      await poll();
      mailer.sendMail.mockReset();
      mailer.sendMail.mockResolvedValue({});

      const fresh = restarted();
      await fresh.pollOnce(adapter(), { now: tick(), retryDelays: NO_WAIT });
      await fresh.pollOnce(adapter(), { now: tick(), retryDelays: NO_WAIT });

      expect(mailed()).toHaveLength(1);
    });

    test('the same username and lock time is never stored twice', async () => {
      await poll();
      setLock('ALICE', 64);
      await poll();
      const [first] = await events();
      await cds.db.run(UPDATE(SNAPSHOT).set({ uflag: 0 }).where({ username: 'ALICE' }));
      // USH02 unchanged, so its row is not newer than the last one reported: detection time is used instead.
      await poll();

      const rows = await events();
      expect(rows.filter((r) => r.lockedAt === first.lockedAt)).toHaveLength(1);
    });
  });

  describe('mail failure', () => {
    test('retries 3 times, queues, and the next cycle sends it with any new lock in one email', async () => {
      const logs = spyLogs();
      await poll();
      setLock('ALICE', 64);
      mailer.sendMail.mockRejectedValue(Object.assign(new Error('smtp://user:hunter2@secret-host refused'), { responseCode: 535 }));

      expect(await poll()).toMatchObject({ email: 'queued' });

      expect(mailer.sendMail).toHaveBeenCalledTimes(4);
      expect((await events())[0]).toMatchObject({ status: 'pending', attempts: 4, lastError: '535' });
      expect(logs()).toContain('"target":"ALICE","action":"lock-detected","result":"notification failed"');
      expect(logs()).not.toContain('hunter2');

      mailer.sendMail.mockReset();
      mailer.sendMail.mockResolvedValue({});
      setLock('BOB', 128);
      expect(await poll()).toMatchObject({ email: 'sent' });

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].subject).toBe('[SAP Alert] 2 users locked');
      expect((await events()).map((r) => r.status)).toEqual(['sent', 'sent']);
      expect(logs()).toContain('"target":"ALICE","action":"lock-detected","result":"notification sent"');
    });

    test('stops at the attempt that worked', async () => {
      await poll();
      setLock('ALICE', 64);
      mailer.sendMail.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValue({});

      expect(await poll()).toMatchObject({ email: 'sent' });

      expect(mailer.sendMail).toHaveBeenCalledTimes(3);
      expect((await events())[0]).toMatchObject({ status: 'sent', attempts: 3 });
    });

    test('audits a failure once, not once per cycle', async () => {
      const logs = spyLogs();
      await poll();
      setLock('ALICE', 64);
      mailer.sendMail.mockRejectedValue(new Error('down'));

      await poll();
      await poll();
      await poll();

      expect(logs().match(/"result":"notification failed"/g)).toHaveLength(1);
    });

    test('never stops the poller, whose status stays OK', async () => {
      await poll();
      setLock('ALICE', 64);
      mailer.sendMail.mockRejectedValue(new Error('down'));

      await expect(poll()).resolves.toMatchObject({ email: 'queued' });

      expect(await monitor.monitorStatus(clock)).toMatchObject({ state: 'ok', pendingEmails: 1 });
    });

    test('never affects a lock', async () => {
      await poll();
      mailer.sendMail.mockRejectedValue(new Error('down'));

      const res = await lock('ALICE');

      expect(res.status).toBe(200);
      expect(sap.uflag.ALICE).toBe(64);
    });
  });

  describe('flood guard', () => {
    test('above the limit, one email lists the first and counts the rest, and all are done', async () => {
      process.env.LOCK_MAX_PER_EMAIL = '2';
      await poll();
      ['ALICE', 'BOB', 'CAROL', 'DAVE'].forEach((user) => setLock(user, 64));

      await poll();

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].subject).toBe('[SAP Alert] 4 users locked');
      expect(mailed()[0].text).toContain('and 2 more');
      expect((await events()).every((r) => r.status === 'sent')).toBe(true);
    });
  });

  describe('context from the app', () => {
    test('an app lock sends no email itself: the next cycle reports it with who and why', async () => {
      await poll();

      const res = await lock('alice', { reason: 'Left the company' });

      expect(res.status).toBe(200);
      expect(mailer.sendMail).not.toHaveBeenCalled();

      await poll();
      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].text).toContain('Left the company');
      expect((await events())[0]).toMatchObject({ source: 'Fiori app', lockedBy: 'khushal', reason: 'Left the company' });
      expect(await cds.db.run(SELECT.from(CONTEXT))).toEqual([]);
    });

    test('five users locked together give one email, even if a check lands mid-run', async () => {
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });
      await lock('BOB', { bulkRunId: 'run-1' });

      expect(await monitor.pollOnce(adapter(), { now: new Date(), retryDelays: NO_WAIT })).toMatchObject({ newlyLocked: 0, held: 2 });
      expect(mailer.sendMail).not.toHaveBeenCalled();

      await lock('CAROL', { bulkRunId: 'run-1' });
      await lock('DAVE', { bulkRunId: 'run-1' });
      await lock('ERIN', { bulkRunId: 'run-1' });
      await backdateContexts(30);
      await monitor.pollOnce(adapter(), { now: clock, retryDelays: NO_WAIT });

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].subject).toBe('[SAP Alert] 5 users locked');
    });

    test('a failed user in a run has no event and is not in the email', async () => {
      await poll();
      sap.lockFails = ['CAROL'];
      await lock('ALICE', { bulkRunId: 'run-1' });
      await lock('CAROL', { bulkRunId: 'run-1' });
      await backdateContexts(30);

      await monitor.pollOnce(adapter(), { now: clock, retryDelays: NO_WAIT });

      expect(mailed()[0].text).toContain('ALICE');
      expect(mailed()[0].text).not.toContain('CAROL');
    });

    test('a failed lock leaves no note to mislabel a later lock by someone else', async () => {
      await poll();
      sap.lockFails = ['ALICE'];
      const res = await lock('ALICE', { reason: 'Attempt' });
      expect(res.status).toBe(502);
      expect(await cds.db.run(SELECT.from(CONTEXT))).toEqual([]);

      setLock('ALICE', 64);
      await poll();

      expect((await events())[0]).toMatchObject({ source: 'SAP / automatic', lockedBy: 'SAPADMIN', reason: '' });
    });

    test('a lock then Undo before the next check sends no email', async () => {
      await poll();
      await lock('ALICE', { reason: 'Mistake' });
      await axios.post(`${BASE}/unlockUser`, { username: 'ALICE' }, ADMIN);

      await poll();

      expect(mailer.sendMail).not.toHaveBeenCalled();
      expect(await cds.db.run(SELECT.from(CONTEXT))).toEqual([]);
    });

    test('a note write failure never stops the lock', async () => {
      await poll();
      jest.spyOn(require('../../srv/admin/lockEventStore'), 'writeContext').mockRejectedValue(new Error('DB down'));

      const res = await lock('ALICE');

      expect(res.status).toBe(200);
      expect(sap.uflag.ALICE).toBe(64);
    });

    test('no password hash reaches the email or the log', async () => {
      const logs = spyLogs();
      await poll();
      await lock('ALICE');
      await poll();

      expect(JSON.stringify(mailed())).not.toContain('SECRET');
      expect(logs()).not.toContain('SECRET');
    });
  });

  describe('non-overlapping ticks', () => {
    test('a tick is skipped while the last cycle is still running', async () => {
      await poll();
      let release;
      const slow = { readLockFlags: () => new Promise((resolve) => { release = () => resolve([{ username: 'ALICE', uflag: 0 }]); }) };

      const first = monitor.runCycle(slow);
      const second = await monitor.runCycle(slow);

      expect(second).toEqual({ skipped: true });
      release();
      await first;
      expect(await monitor.runCycle(adapter(), { now: tick(), retryDelays: NO_WAIT })).not.toEqual({ skipped: true });
    });

    test('an unexpected failure does not stop later ticks', async () => {
      const broken = { readLockFlags: async () => [{ username: 'A', uflag: 0 }] };
      jest.spyOn(require('../../srv/admin/lockEventStore'), 'readSnapshots').mockRejectedValueOnce(new Error('DB down'));

      expect(await monitor.runCycle(broken)).toEqual({ failed: true });
      expect(await monitor.runCycle(adapter(), { now: tick(), retryDelays: NO_WAIT })).toMatchObject({ baseline: 6 });
    });
  });

  describe('status for the screen', () => {
    const status = () => axios.get(`${BASE}/getLockMonitor()`, ADMIN);

    test('reports recipient, interval and limit, from config', async () => {
      process.env.LOCK_POLL_INTERVAL_SEC = '30';
      process.env.LOCK_MAX_PER_EMAIL = '20';

      const res = await status();

      expect(res.data).toMatchObject({ state: 'starting', recipient: 'khushal@example.test', pollIntervalSec: 30, maxPerEmail: 20, pendingEmails: 0 });
    });

    test('goes OK after a check, failed after a failed one, and stale when checks stop', async () => {
      await poll();
      expect(await monitor.monitorStatus(clock)).toMatchObject({ state: 'ok' });
      expect((await monitor.monitorStatus(clock)).lastCheckedAt).toBe(clock.toISOString());

      expect(await monitor.monitorStatus(new Date(clock.getTime() + 181000))).toMatchObject({ state: 'stale' });

      sap.down = true;
      await poll();
      expect(await monitor.monitorStatus(clock)).toMatchObject({ state: 'failed' });

      sap.down = false;
      await poll();
      expect(await monitor.monitorStatus(clock)).toMatchObject({ state: 'ok' });
    });

    test('is off when email is not configured, and no SAP read happens on a lock', async () => {
      mailer.isConfigured.mockReturnValue(false);

      expect((await status()).data).toMatchObject({ state: 'off' });

      await lock('ALICE');
      expect(await cds.db.run(SELECT.from(CONTEXT))).toEqual([]);
      expect(sap.calls.filter((c) => c.fm === 'RFC_READ_TABLE')).toEqual([]);
    });

    test('is off when the interval is 0', async () => {
      process.env.LOCK_POLL_INTERVAL_SEC = '0';
      expect((await status()).data).toMatchObject({ state: 'off' });
    });

    test('a bulk run goes from queued to sent, and to retrying when mail fails', async () => {
      const runStatus = async (id) => (await axios.get(`${BASE}/getBulkLockEmailStatus(bulkRunId='${id}')`, ADMIN)).data.status;
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });
      expect(await runStatus('run-1')).toBe('queued');

      await backdateContexts(30);
      mailer.sendMail.mockRejectedValue(new Error('down'));
      await monitor.pollOnce(adapter(), { now: clock, retryDelays: NO_WAIT });
      expect(await runStatus('run-1')).toBe('retrying');

      mailer.sendMail.mockReset();
      mailer.sendMail.mockResolvedValue({});
      await poll();
      expect(await runStatus('run-1')).toBe('sent');
    });

    test('reports not_configured, and refuses non-admins and bad run ids', async () => {
      mailer.isConfigured.mockReturnValue(false);
      const url = (id) => `${BASE}/getBulkLockEmailStatus(bulkRunId='${id}')`;

      expect((await axios.get(url('run-1'), ADMIN)).data.status).toBe('not_configured');
      expect((await axios.get(url('run-1'), VIEWER)).status).toBe(403);
      expect((await axios.get(`${BASE}/getLockMonitor()`, VIEWER)).status).toBe(403);
      expect((await axios.get(url('bad%20id!'), ADMIN)).status).toBe(400);
      expect((await lock('ALICE', { bulkRunId: 'bad id!' })).status).toBe(400);
    });
  });
});
