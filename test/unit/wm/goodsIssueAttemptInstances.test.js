'use strict';

/**
 * Production runs 2 instances: two stores sharing one database, each with its own memory. [mock only, not SAP verification]
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const { GoodsIssueAttemptStore, ATTEMPT_ENTITY } = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');

const ATTEMPT = { ReferenceDocument: 'GIINSTANCE1', RequestHash: 'H1', MovementType: '261', ReservationNo: '0000528779', ReservationItem: '1', IssueQty: 1 };

describe('Attempt store with a database: the database is the only source', () => {
  let a;
  let b;

  beforeEach(async () => {
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    a = new GoodsIssueAttemptStore();
    b = new GoodsIssueAttemptStore();
  });

  it('does not keep attempts in memory, so memory cannot grow', async () => {
    await a.create(ATTEMPT);
    await a.setStatus(ATTEMPT.ReferenceDocument, 'posted', { MaterialDocument: '4900000001' });
    expect(a._memoryStore.size).toBe(0);
  });

  it('reads the status another instance wrote', async () => {
    await a.create(ATTEMPT);
    await b.setStatus(ATTEMPT.ReferenceDocument, 'unconfirmed');
    expect(await a.getByReference(ATTEMPT.ReferenceDocument)).toMatchObject({ Status: 'unconfirmed' });
  });

  it('does not return an attempt the database no longer has', async () => {
    await a.create(ATTEMPT);
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    expect(await a.getByReference(ATTEMPT.ReferenceDocument)).toBeNull();
  });

  it('claims a key once across instances', async () => {
    const first = await a.createOrGet(ATTEMPT);
    const second = await b.createOrGet(ATTEMPT);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });
});

describe('Attempt store with no database: memory is the fallback', () => {
  it('still records and resolves attempts in isolated unit test', async () => {
    const store = new GoodsIssueAttemptStore({ db: null });
    expect(store.isAvailable()).toBe(true);
    await store.create(ATTEMPT);
    await store.setStatus(ATTEMPT.ReferenceDocument, 'posted');
    expect(await store.getByReference(ATTEMPT.ReferenceDocument)).toMatchObject({ Status: 'posted' });
  });
});

describe('Production mode: durable database is mandatory and memory store is strictly forbidden', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('fails closed when no database is bound in production, rejecting attempt creation with 503', async () => {
    process.env.NODE_ENV = 'production';
    const store = new GoodsIssueAttemptStore({ db: null, useMemoryStore: true });
    expect(store.isAvailable()).toBe(false);
    await expect(store.create(ATTEMPT)).rejects.toMatchObject({
      status: 503,
      code: 'DB_UNAVAILABLE'
    });
    await expect(store.createOrGet(ATTEMPT)).rejects.toMatchObject({
      status: 503,
      code: 'DB_UNAVAILABLE'
    });
    await expect(store.setStatus(ATTEMPT.ReferenceDocument, 'posted')).rejects.toMatchObject({
      status: 503,
      code: 'DB_UNAVAILABLE'
    });
  });
});
