const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');

describe('TrToHandler', () => {
  let handlers;
  let adapter;
  const req = (data) => ({ data, error: jest.fn((status, msg) => ({ status, msg })) });

  beforeEach(() => {
    handlers = {};
    adapter = { getTR: jest.fn(), checkSU: jest.fn(), createTO: jest.fn() };
    TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter });
  });

  it('delegates getOpenTRs with lgnum and mvt', async () => {
    adapter.getOpenTRs = jest.fn().mockResolvedValue([{ Tbnum: '0001000663' }]);
    await expect(handlers.getOpenTRs(req({ lgnum: 'W01', mvt: '319' }))).resolves.toEqual([{ Tbnum: '0001000663' }]);
    expect(adapter.getOpenTRs).toHaveBeenCalledWith('W01', '319');
  });

  it('delegates getTR / checkSU with the request values unchanged (no defaults)', async () => {
    adapter.getTR.mockResolvedValue({ Tbnum: '0001000663' });
    adapter.checkSU.mockResolvedValue({ IsValid: true });

    await expect(handlers.getTR(req({ tbnum: '1000663', lgnum: 'W01' }))).resolves.toEqual({ Tbnum: '0001000663' });
    await handlers.checkSU(req({ lenum: '1000043935', tbnum: '1000663' }));

    expect(adapter.getTR).toHaveBeenCalledWith('1000663', 'W01');
    expect(adapter.checkSU).toHaveBeenCalledWith('1000043935', '1000663', undefined);
  });

  it('passes only operator input to createTO (item, unit, limits come from SAP)', async () => {
    adapter.createTO.mockResolvedValue({ TransferOrder: '1036601', Success: true, Confirmed: false });
    const r = req({ lgnum: 'W01', tbnum: '1000663', lenum: '1000043935', qty: 50, unit: 'KG', openQty: 999, confirmImmediate: true });

    await expect(handlers.createTO(r)).resolves.toMatchObject({ TransferOrder: '1036601', Confirmed: false });
    expect(adapter.createTO).toHaveBeenCalledWith({ lgnum: 'W01', tbnum: '1000663', lenum: '1000043935', qty: 50 });
  });

  it('maps adapter errors to req.error with their status, 500 when none', async () => {
    adapter.getTR.mockRejectedValue(Object.assign(new Error('Warehouse is missing or invalid'), { status: 400 }));
    adapter.createTO.mockRejectedValue(new Error('boom'));

    const r1 = req({ tbnum: '1' });
    await handlers.getTR(r1);
    expect(r1.error).toHaveBeenCalledWith(400, 'Warehouse is missing or invalid');

    const r2 = req({});
    await handlers.createTO(r2);
    expect(r2.error).toHaveBeenCalledWith(500, 'boom');
  });
});
