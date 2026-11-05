'use strict';

/**
 * Integration: real CAP HTTP, real role gate, real service, adapter, notifier and store on SQLite.
 * Only the RFC session and the mailer are stubbed: no SAP call and no email leaves this test.
 */

jest.mock('../../srv/common/mailer', () => ({ isConfigured: jest.fn(() => true), sendMail: jest.fn() }));

const cds = require('@sap/cds');
const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');
const mailer = require('../../srv/common/mailer');
const notifier = require('../../srv/admin/lockNotifier');
const { UserManagementAdapter } = require('../../srv/integration/s4hana/admin/UserManagementAdapter');

const cdsTest = cds.test(__dirname + '/../../');
const { axios } = cdsTest;

const BASE = '/odata/v4/user-management';
const ADMIN = { auth: { username: 'khushal', password: '' }, validateStatus: () => true };
const VIEWER = { auth: { username: 'test-viewer-1120', password: '' }, validateStatus: () => true };
const SNAPSHOT = 'saps4hana.admin.UserLockSnapshot';
const EVENT = 'saps4hana.admin.UserLockNotification';
const { SELECT, DELETE, UPDATE } = cds.ql;

/** A stub SAP holding UFLAG and USH02 per user. A lock changes both, as SU01 was seen to on DS4/220. */
let sap;
let clock;
const nextStamp = () => `2026110510${String(clock++).padStart(4, '0')}`;
function setLock(username, uflag, by = 'SAPADMIN') {
  sap.uflag[username] = uflag;
  (sap.history[username] = sap.history[username] || []).push({ stamp: nextStamp(), by, uflag });
}
function stubSap() {
  jest.spyOn(RfcClient.prototype, 'resolveConnectionParams').mockResolvedValue({ user: 'CONNECTED_ADMIN' });
  jest.spyOn(RfcClient.prototype, 'session').mockImplementation((fn) => fn(async (fm, params) => {
    sap.calls.push({ fm, params });
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
      const flag = sap.uflag[params.USERNAME] || 0;
      return {
        ADDRESS: { FULLNAME: `${params.USERNAME} Name` },
        LOGONDATA: { USTYP: 'A', PWDSALTEDHASH: 'SECRET-HASH', BCODE: 'SECRET-B' },
        ISLOCKED: { GLOB_LOCK: flag & 32 ? 'L' : 'U', LOCAL_LOCK: flag & 64 ? 'L' : 'U', WRNG_LOGON: flag & 128 ? 'L' : 'U', NO_USER_PW: 'U' },
        RETURN: [],
      };
    }
    if (fm === 'RFC_READ_TABLE' && params.QUERY_TABLE === 'USR02') {
      const only = params.OPTIONS.length ? /'(.*)'/.exec(params.OPTIONS[0].TEXT)[1] : null;
      return { DATA: Object.entries(sap.uflag).filter(([u]) => !only || u === only).map(([u, f]) => ({ WA: `${u}|${f}` })) };
    }
    if (fm === 'RFC_READ_TABLE' && params.QUERY_TABLE === 'USH02') {
      const name = /'(.*)'/.exec(params.OPTIONS[0].TEXT)[1];
      return { DATA: (sap.history[name] || []).map((h) => ({ WA: `${h.stamp.slice(0, 8)}|${h.stamp.slice(8)}|${h.by}|${h.uflag}` })) };
    }
    throw new Error(`Unexpected call ${fm}`);
  }));
}

const adapter = () => new UserManagementAdapter();
const poll = () => notifier.pollOnce(adapter());
const events = () => cds.db.run(SELECT.from(EVENT).orderBy('username'));
const lock = (username, extra = {}, user = ADMIN) => axios.post(`${BASE}/lockUser`, { username, ...extra }, user);
const finish = (bulkRunId, user = ADMIN) => axios.post(`${BASE}/finishBulkLock`, { bulkRunId }, user);
const mailed = () => mailer.sendMail.mock.calls.map(([mail]) => mail);

async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Integration: lock notification email', () => {
  beforeEach(async () => {
    sap = { uflag: { ALICE: 0, BOB: 0, CAROL: 0, KHUSHAL: 0 }, history: {}, calls: [], lockFails: [] };
    clock = 1;
    await cds.db.run(DELETE.from(EVENT));
    await cds.db.run(DELETE.from(SNAPSHOT));
    mailer.sendMail.mockReset();
    mailer.sendMail.mockResolvedValue({});
    mailer.isConfigured.mockReturnValue(true);
    process.env.LOCK_NOTIFY_TO = 'alerts@example.test';
    stubSap();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.LOCK_NOTIFY_TO;
  });

  describe('polling job', () => {
    test('the first run stores a silent baseline, so existing locks send nothing', async () => {
      sap.uflag.ALICE = 64;
      sap.uflag.BOB = 128;

      expect(await poll()).toMatchObject({ baseline: 4, newlyLocked: 0, status: 'none' });
      expect(await poll()).toMatchObject({ baseline: 0, newlyLocked: 0, status: 'none' });

      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('reads USR02 by name only, so no hash column is requested', async () => {
      await poll();
      const read = sap.calls.find((c) => c.fm === 'RFC_READ_TABLE' && c.params.QUERY_TABLE === 'USR02');
      expect(read.params.FIELDS).toEqual([{ FIELDNAME: 'BNAME' }, { FIELDNAME: 'UFLAG' }]);
    });

    test('a lock made outside the app is reported once, with SAP time and who changed it', async () => {
      await poll();
      setLock('ALICE', 64);

      expect(await poll()).toMatchObject({ newlyLocked: 1, status: 'sent' });
      await poll();

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0]).toMatchObject({ to: 'alerts@example.test', subject: '[SAP Alert] User ALICE locked' });
      const [row] = await events();
      expect(row).toMatchObject({ username: 'ALICE', source: 'SAP', lockType: 'admin-local', lockedBy: 'SAPADMIN', fullName: 'ALICE Name', lockedAtSource: 'sap', status: 'sent' });
      expect(row.lockedAt).toBe(sap.history.ALICE[0].stamp);
    });

    test('a wrong-password lock is reported as automatic', async () => {
      await poll();
      setLock('BOB', 128);

      await poll();

      expect(await events()).toEqual([expect.objectContaining({ username: 'BOB', source: 'auto', lockType: 'wrong-password', lockedBy: 'System' })]);
    });

    test('several locks in one cycle go in one summary email', async () => {
      await poll();
      setLock('ALICE', 64);
      setLock('BOB', 128);

      await poll();

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].subject).toBe('[SAP Alert] 2 users locked');
    });

    test('an empty read changes nothing: it does not count as everyone unlocked', async () => {
      setLock('ALICE', 64);
      await poll();
      const saved = sap.uflag;
      sap.uflag = {};

      expect(await poll()).toMatchObject({ skipped: true });

      sap.uflag = saved;
      await poll();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('an unlock then a later lock outside the app is a new event', async () => {
      await poll();
      setLock('ALICE', 64);
      await poll();
      setLock('ALICE', 0);
      await poll();
      setLock('ALICE', 64);
      await poll();

      expect(mailed()).toHaveLength(2);
      expect(await events()).toHaveLength(2);
    });

    test('a re-lock with no new history row still reports once, at detection time', async () => {
      await poll();
      setLock('ALICE', 64);
      await poll();
      sap.uflag.ALICE = 0;
      await poll();
      sap.uflag.ALICE = 64; // USH02 unchanged: its newest row is the first lock

      await poll();
      await poll();

      const rows = await events();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.lockedAtSource).sort()).toEqual(['detected', 'sap']);
      expect(mailed()).toHaveLength(2);
    });

    test('never lets a user unreadable by the BAPI block the alert', async () => {
      await poll();
      setLock('ALICE', 64);
      const real = RfcClient.prototype.session.getMockImplementation();
      jest.spyOn(RfcClient.prototype, 'session').mockImplementation((fn) => fn(async (fm, params) => {
        if (fm === 'BAPI_USER_GET_DETAIL') throw new Error('RFC down');
        let answer;
        await real((call) => call(fm, params).then((r) => { answer = r; }));
        return answer;
      }));

      await poll();

      expect(await events()).toEqual([expect.objectContaining({ username: 'ALICE', lockType: 'admin-local', fullName: '' })]);
    });
  });

  describe('app lock path', () => {
    test('a single lock sends one email with the reason, and a poll adds no duplicate', async () => {
      await poll();

      const res = await lock('alice', { reason: 'Left the company' });

      expect(res.status).toBe(200);
      await waitFor(() => mailer.sendMail.mock.calls.length === 1);
      expect(mailed()[0].subject).toBe('[SAP Alert] User ALICE locked');
      expect(mailed()[0].text).toContain('Left the company');
      expect(mailed()[0].text).toContain('This app');

      await poll();
      expect(mailed()).toHaveLength(1);
      expect(await events()).toEqual([expect.objectContaining({ username: 'ALICE', source: 'app', lockedBy: 'khushal', reason: 'Left the company' })]);
    });

    test('a lock the job already reported is not reported again by the app', async () => {
      await poll();
      setLock('ALICE', 64);
      await poll();
      expect(mailed()).toHaveLength(1);

      await lock('ALICE');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mailed()).toHaveLength(1);
      expect(await events()).toHaveLength(1);
    });

    test('the job leaves a user alone while the app is locking it', async () => {
      await poll();
      await notifier.beforeAppLock('ALICE');
      setLock('ALICE', 64);

      expect(await poll()).toMatchObject({ newlyLocked: 0 });

      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('a lock after the app window lapsed, as after a crash, is reported by the job', async () => {
      await poll();
      await notifier.beforeAppLock('ALICE');
      setLock('ALICE', 64);
      await cds.db.run(UPDATE(SNAPSHOT).set({ appLockUntil: '2020-01-01T00:00:00.000Z' }).where({ username: 'ALICE' }));

      expect(await poll()).toMatchObject({ newlyLocked: 1 });
    });

    test('Unlock then a new lock through the app is a new event', async () => {
      await poll();
      await lock('ALICE');
      await waitFor(() => mailer.sendMail.mock.calls.length === 1);

      await axios.post(`${BASE}/unlockUser`, { username: 'ALICE' }, ADMIN);
      await lock('ALICE');
      await waitFor(() => mailer.sendMail.mock.calls.length === 2);

      expect(await events()).toHaveLength(2);
    });

    test('a refused lock records and sends nothing', async () => {
      sap.lockFails = ['ALICE'];
      await poll();

      const res = await lock('ALICE');

      expect(res.status).toBe(502);
      expect(await events()).toEqual([]);
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('a failed mail never fails the lock, and is retried', async () => {
      mailer.sendMail.mockRejectedValue(Object.assign(new Error('secret-host refused pass=hunter2'), { responseCode: 535 }));
      await poll();

      const res = await lock('ALICE');

      expect(res.status).toBe(200);
      expect(sap.uflag.ALICE).toBe(64);
      await waitFor(() => mailer.sendMail.mock.calls.length >= 1);
    });

    test('a database failure after the lock never fails the lock', async () => {
      await poll();
      const store = require('../../srv/admin/lockEventStore');
      jest.spyOn(store, 'claimLock').mockRejectedValue(new Error('DB down'));

      const res = await lock('ALICE');

      expect(res.status).toBe(200);
      expect(sap.uflag.ALICE).toBe(64);
    });

    test('email text holds no password hash read with the user', async () => {
      await poll();
      await lock('ALICE');
      await waitFor(() => mailer.sendMail.mock.calls.length === 1);

      expect(JSON.stringify(mailed()[0])).not.toContain('SECRET');
    });
  });

  describe('bulk summary', () => {
    test('sends one email at the end, listing only the locked users', async () => {
      await poll();
      sap.lockFails = ['CAROL'];

      await lock('ALICE', { bulkRunId: 'run-1' });
      await lock('BOB', { bulkRunId: 'run-1' });
      await lock('CAROL', { bulkRunId: 'run-1' });
      expect(mailer.sendMail).not.toHaveBeenCalled();

      const res = await finish('run-1');

      expect(res.data).toMatchObject({ status: 'sent', count: 2 });
      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].subject).toBe('[SAP Alert] 2 users locked');
      expect(mailed()[0].text).toContain('ALICE');
      expect(mailed()[0].text).toContain('BOB');
      expect(mailed()[0].text).not.toContain('CAROL');
    });

    test('a second finish sends nothing', async () => {
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });
      await finish('run-1');

      const again = await finish('run-1');

      expect(again.data).toMatchObject({ status: 'none', count: 0 });
      expect(mailed()).toHaveLength(1);
    });

    test('another admin cannot finish someone else\'s run', async () => {
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });

      expect(await notifier.finishBulkRun('run-1', 'someone-else')).toEqual({ status: 'none', count: 0 });
      expect(mailer.sendMail).not.toHaveBeenCalled();

      expect((await finish('run-1')).data).toMatchObject({ status: 'sent', count: 1 });
    });

    test('a run whose browser went away is sent by the job, once', async () => {
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });
      await lock('BOB', { bulkRunId: 'run-1' });
      await cds.db.run(UPDATE(EVENT).set({ createdAt: '2020-01-01T00:00:00.000Z' }));

      await poll();
      await poll();

      expect(mailed()).toHaveLength(1);
      expect(mailed()[0].subject).toBe('[SAP Alert] 2 users locked');
    });

    test('a run still in progress is left for its finish call', async () => {
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });

      await poll();

      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    test('a send left in flight by a crash goes out again', async () => {
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });
      await cds.db.run(UPDATE(EVENT).set({ status: 'sending', claimedAt: '2020-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' }));

      await notifier.recoverAbandoned();

      expect(mailed()).toHaveLength(1);
      expect((await events())[0].status).toBe('sent');
    });

    test('reports not_configured with no RFC read when mail is not set up', async () => {
      mailer.isConfigured.mockReturnValue(false);

      const res = await finish('run-1');
      await lock('ALICE', { bulkRunId: 'run-1' });

      expect(res.data).toMatchObject({ status: 'not_configured', count: 0 });
      expect(sap.calls.filter((c) => c.fm === 'RFC_READ_TABLE')).toEqual([]);
      expect(await events()).toEqual([]);
    });

    test('a non-admin is refused, and a bad run id is rejected', async () => {
      expect((await finish('run-1', VIEWER)).status).toBe(403);
      expect((await finish('bad id!')).status).toBe(400);
      expect((await lock('ALICE', { bulkRunId: 'bad id!' })).status).toBe(400);
    });
  });

  describe('retries', () => {
    const pendingEvents = async () => {
      await poll();
      await lock('ALICE', { bulkRunId: 'run-1' });
      return require('../../srv/admin/lockEventStore').claimRun('run-1', 'khushal');
    };
    const logLines = (spies) => spies.flatMap((spy) => spy.mock.calls).map((args) => args.join(' ')).join('\n');

    test('retries with success stops at the attempt that worked', async () => {
      const rows = await pendingEvents();
      mailer.sendMail.mockReset();
      mailer.sendMail.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValue({});

      expect(await notifier.deliver(rows, { retryDelays: [0, 0, 0] })).toBe('retrying');

      await waitFor(() => mailer.sendMail.mock.calls.length === 3);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await events())[0]).toMatchObject({ status: 'sent', attempts: 3 });
    });

    test('after the first send and 3 retries it is failed, audited, and logs no SMTP detail', async () => {
      const spies = [jest.spyOn(console, 'info').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'warn').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
      const rows = await pendingEvents();
      mailer.sendMail.mockReset();
      mailer.sendMail.mockRejectedValue(Object.assign(new Error('smtp://user:hunter2@secret-host refused'), { responseCode: 535 }));

      await notifier.deliver(rows, { retryDelays: [0, 0, 0] });

      await waitFor(() => mailer.sendMail.mock.calls.length === 4);
      await waitFor(() => logLines(spies).includes('notification failed'));
      expect(mailer.sendMail).toHaveBeenCalledTimes(4);
      expect((await events())[0]).toMatchObject({ status: 'failed', lastError: '535' });
      expect(logLines(spies)).toContain('"action":"notify","result":"notification failed"');
      expect(logLines(spies)).not.toContain('hunter2');
    });

    test('a successful send is audited', async () => {
      const spies = [jest.spyOn(console, 'info').mockImplementation(() => {}), jest.spyOn(console, 'log').mockImplementation(() => {})];
      const rows = await pendingEvents();

      await notifier.deliver(rows);

      expect(logLines(spies)).toContain('"action":"notify","result":"sent"');
    });
  });
});
