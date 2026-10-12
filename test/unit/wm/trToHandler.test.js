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

  it('delegates getTR / checkSU / getAvailableSUs with the request values unchanged (no defaults)', async () => {
    adapter.getTR.mockResolvedValue({ Tbnum: '0001000663' });
    adapter.checkSU.mockResolvedValue({ IsValid: true });
    adapter.getAvailableSUs = jest.fn().mockResolvedValue([{ StorageUnit: '1000041635' }]);

    await expect(handlers.getTR(req({ tbnum: '1000663', lgnum: 'W01' }))).resolves.toEqual({ Tbnum: '0001000663' });
    await handlers.checkSU(req({ lenum: '1000043935', tbnum: '1000663' }));
    await expect(handlers.getAvailableSUs(req({ tbnum: '1000663', lgnum: 'W01', tbpos: '0001' }))).resolves.toEqual([{ StorageUnit: '1000041635' }]);

    expect(adapter.getTR).toHaveBeenCalledWith('1000663', 'W01');
    expect(adapter.checkSU).toHaveBeenCalledWith('1000043935', '1000663', undefined);
    expect(adapter.getAvailableSUs).toHaveBeenCalledWith('1000663', 'W01', '0001');
  });

  it('delegates getFifoBatches and getAvailableSerials to adapter', async () => {
    adapter.getFifoBatches = jest.fn().mockResolvedValue([{ Batch: 'B01', FifoRank: 1 }]);
    adapter.getAvailableSerials = jest.fn().mockResolvedValue(['SER001', 'SER002']);

    await expect(handlers.getFifoBatches(req({ material: '1000000867', plant: '1120', storageLocation: 'CS01', warehouseNumber: 'W01' })))
      .resolves.toEqual([{ Batch: 'B01', FifoRank: 1 }]);
    expect(adapter.getFifoBatches).toHaveBeenCalledWith('1000000867', '1120', 'CS01', 'W01');

    await expect(handlers.getAvailableSerials(req({ material: '8000006485', plant: '1120', storageLocation: 'CS01', batch: 'B01' })))
      .resolves.toEqual(['SER001', 'SER002']);
    expect(adapter.getAvailableSerials).toHaveBeenCalledWith('8000006485', '1120', 'CS01', 'B01');
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
