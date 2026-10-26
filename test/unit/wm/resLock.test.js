'use strict';

/**
 * SAP-side reservation lock behind a feature flag. [mock only, not SAP verification]
 * Z_WM_RES_LOCK is a proposal (docs/abap/z_wm_res_lock.fugr.abap) and is not deployed; these tests only prove the
 * JS contract: flag off = no RFC call; flag on = lock, step and unlock on one session; refused lock = 409, no step.
 */
const cds = require('@sap/cds');
const { withReservationLock, isLockConflict } = require('../../../srv/integration/s4hana/wm/resLock');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');

const withFlag = async (value, fn) => {
  const saved = cds.env.s4.resLockEnabled;
  const savedEnv = process.env.S4_RES_LOCK_ENABLED;
  delete process.env.S4_RES_LOCK_ENABLED; delete process.env.CDS_S4_RES_LOCK_ENABLED;
  cds.env.s4.resLockEnabled = value;
  try { return await fn(); } finally { cds.env.s4.resLockEnabled = saved; if (savedEnv !== undefined) process.env.S4_RES_LOCK_ENABLED = savedEnv; }
};

/** One fake connection: records every FM call in order. */
function fakeRfc(lockResult = { EV_SUCCESS: 'S', EV_MESSAGE: 'locked' }) {
  const calls = [];
  const call = jest.fn(async (fm, params) => {
    calls.push([fm, params]);
    if (fm === 'Z_WM_RES_LOCK') return params.IV_ACTION === 'L' ? lockResult : { EV_SUCCESS: 'S' };
    if (fm === 'AUTHORITY_CHECK') throw Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' });
    if (fm === 'BAPI_GOODSMVT_CREATE') return { MATERIALDOCUMENT: '4900000050', MATDOCUMENTYEAR: '2026', RETURN: [] };
    if (fm === 'RFC_READ_TABLE') return { DATA: [] };
    return {};
  });
  const rfc = {
    calls,
    call,
    session: jest.fn(async (fn) => fn(call)),
    readTable: jest.fn(async (table, fields, options = {}) => {
      const allArgs = [fields, options].map((a) => (Array.isArray(a) ? a.join(' ') : (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a || '')))).join(' ');
      if ((table === 'MATDOC' || table === 'MSEG') && /4900000050/.test(allArgs)) {
        return [{ MBLNR: '4900000050', MJAHR: '2026', ZEILE: '0001', BWART: '201', MATNR: '8000000023', WERKS: '1120', MENGE: '1.000', MEINS: 'KG' }];
      }
      return [];
    }),
  };
  return rfc;
}

describe('withReservationLock [mock only, not SAP verification]', () => {
  it('flag off (default): runs the step with no rfc at all and never calls Z_WM_RES_LOCK', async () => {
    const rfc = fakeRfc();
    const res = await withFlag(undefined, () => withReservationLock(rfc, { rsnum: '524979', rspos: '1' }, async (scoped) => scoped));
    expect(res).toBeUndefined();
    expect(rfc.call).not.toHaveBeenCalled();
    expect(rfc.session).not.toHaveBeenCalled();
    await withFlag('false', async () => expect(await withReservationLock(rfc, { rsnum: '1' }, async (s) => s)).toBeUndefined());
    await withFlag(undefined, async () => expect(await withReservationLock(undefined, null, async (s) => s)).toBeUndefined());
  });

  it('flag on: lock, step FMs and unlock run on the same connection, in that order', async () => {
    const rfc = fakeRfc();
    await withFlag(true, () => withReservationLock(rfc, { rsnum: '524979', rspos: '1' }, async (scoped) => {
      await scoped.call('BAPI_GOODSMVT_CREATE', {});
      await scoped.session((call) => call('BAPI_TRANSACTION_COMMIT', {}));
      return 'done';
    }));
    expect(rfc.session).toHaveBeenCalledTimes(1); // one session for lock + step + unlock
    expect(rfc.calls.map((c) => c[0])).toEqual(['Z_WM_RES_LOCK', 'BAPI_GOODSMVT_CREATE', 'BAPI_TRANSACTION_COMMIT', 'Z_WM_RES_LOCK']);
    expect(rfc.calls[0][1]).toEqual({ IV_RSNUM: '0000524979', IV_RSPOS: '0001', IV_ACTION: 'L', IV_WAIT: ' ' });
    expect(rfc.calls[3][1]).toEqual({ IV_RSNUM: '0000524979', IV_RSPOS: '0001', IV_ACTION: 'U' });
  });

  it('flag on: a refused lock fails closed with 409 and runs no step; the step error still unlocks', async () => {
    const rfc = fakeRfc({ EV_SUCCESS: 'E', EV_MESSAGE: 'Reservation 0000524979/0001 is locked by user OTHER' });
    const step = jest.fn();
    await expect(withFlag('X', () => withReservationLock(rfc, { rsnum: '524979' }, step))).rejects.toMatchObject({ status: 409, code: 'RES_LOCKED', message: /locked by user OTHER/ });
    expect(step).not.toHaveBeenCalled();
    expect(rfc.calls).toHaveLength(1);

    const ok = fakeRfc();
    await expect(withFlag(true, () => withReservationLock(ok, { rsnum: '1' }, async () => { throw new Error('BAPI failed'); }))).rejects.toThrow('BAPI failed');
    expect(ok.calls.map((c) => c[0])).toEqual(['Z_WM_RES_LOCK', 'Z_WM_RES_LOCK']);
    expect(isLockConflict(Object.assign(new Error('x'), { code: 'RES_LOCKED' }))).toBe(true);
  });

  it('flag on: the goods-movement handler posts inside the locked session and returns 409 on a conflict without touching tracking', async () => {
    const rfc = fakeRfc();
    const adapter = new ReservationProcessAdapter({ rfc });
    const handlers = {};
    TrToHandler.init({ on: (e, fn) => { handlers[e] = fn; } }, { adapter: {}, resProcessAdapter: adapter });
    const data = { ReservationNo: '524979', MovementType: '201', Material: '8000000023', Plant: '1120', Quantity: 1, Unit: 'KG', CostCenter: '1011201301' };
    const res = await withFlag(true, () => handlers.postMigoGoodsMovement({ data }));
    expect(res.Status).toBe('05');
    const fms = rfc.calls.map((c) => c[0]);
    expect(fms[0]).toBe('Z_WM_RES_LOCK');
    expect(fms[fms.length - 1]).toBe('Z_WM_RES_LOCK');
    expect(fms).toContain('BAPI_GOODSMVT_CREATE');
    expect(rfc.session).toHaveBeenCalledTimes(1);

    const busy = fakeRfc({ EV_SUCCESS: 'E', EV_MESSAGE: 'locked elsewhere' });
    TrToHandler.init({ on: (e, fn) => { handlers[e] = fn; } }, { adapter: {}, resProcessAdapter: new ReservationProcessAdapter({ rfc: busy }) });
    await expect(withFlag(true, () => handlers.postMigoGoodsMovement({ data }))).rejects.toMatchObject({ status: 409 });
    expect(busy.calls.map((c) => c[0])).toEqual(['Z_WM_RES_LOCK']);
  });
});
