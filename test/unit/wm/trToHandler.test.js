const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');
const fs = require('fs');
const path = require('path');

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
    expect(adapter.getOpenTRs).toHaveBeenCalledWith('W01', '319', undefined); // user of the request (none in this fixture)
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

  it('normalizes LTAK-RSNUM with sapKey before the RESB filter [mock only, not browser verification]', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../srv/wm/tr-to/handlers/trTo.handler.js'), 'utf8');
    expect(source).toMatch(/const rsnum = rsnumRaw \? sapKey\(rsnumRaw, 'rsnum'\)\.padStart\(10, '0'\) : '';/);
    expect(source).toMatch(/readTable\('RESB',[^\n]+`RSNUM = '\$\{rsnum\}'`/);
  });

  it('passes only the database tracking row to validate a reservation/TR mismatch [mock only, not browser verification]', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../srv/wm/tr-to/handlers/trTo.handler.js'), 'utf8');
    expect(source).toMatch(/const trackedReservation = existing\?\.TransferRequirement && existing\?\.ReservationNo/);
    expect(source).toMatch(/result\.ReservationMovementType !== result\.MovementType/);
    expect(source).toMatch(/MessageType: 'W'/);
    expect(source).toMatch(/MessageText: `Linked reservation staging: TR movement[\s\S]*verify the TR destination before processing\.`/);
  });

  it('scopes the tracking lookup by warehouse when TR numbers collide across warehouses', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../srv/wm/tr-to/handlers/trTo.handler.js'), 'utf8');
    const lookup = source.slice(source.indexOf('const handleCreateTOFromTR'), source.indexOf("srv.on('createTOFromTR'"));
    expect(lookup).toMatch(/if \(ReservationTrack && wh\)/);
    expect(lookup.match(/WarehouseNumber: wh/g)).toHaveLength(4);
    expect(lookup).toMatch(/TransferRequirement: tbnum, WarehouseNumber: wh/);
    expect(lookup).toMatch(/ReservationNo: rsnum, WarehouseNumber: wh/);
    expect(lookup).toMatch(/trackedReservation = existing\?\.TransferRequirement[\s\S]*WarehouseNumber: existing\.WarehouseNumber/);
  });

  it('persists an L9/514 delivery number when MIGO/PGI fails so retry can resume that delivery', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../srv/wm/tr-to/handlers/trTo.handler.js'), 'utf8');
    const catchBlock = source.slice(source.indexOf('// Rollback executed by the adapter; tracking goes to 90 (GI error, retryable)'), source.indexOf("srv.on('postMigoGoodsMovement'"));
    expect(catchBlock).toMatch(/const failedDeliveryNo = err\.deliveryNumber \|\| err\.DeliveryNumber \|\| existingTrack\?\.DeliveryNumber/);
    expect(catchBlock).toMatch(/if \(failedDeliveryNo\) errorFields\.DeliveryNumber = failedDeliveryNo/);
    expect(catchBlock).toMatch(/DeliveryNumber: failedDeliveryNo/);
    expect(source).toMatch(/deliveryNumber: data\.deliveryNumber \|\| data\.DeliveryNumber \|\| existingTrack\?\.DeliveryNumber/);
  });

  it('does not return the technical RFC user as ConfirmedBy when CAP has no user identity', async () => {
    const previousUsername = process.env.S4_USERNAME;
    process.env.S4_USERNAME = 'technical-rfc-user';
    adapter.createTOFromTR = jest.fn().mockResolvedValue({
      success: true, TransferOrder: '0001030001', Confirmed: true, Status: '04'
    });
    try {
      const result = await handlers.createTOFromTR(req({ lgnum: 'W13', tbnum: '1000663', autoConfirm: true }));
      expect(result.ConfirmedBy).toBe('');
    } finally {
      if (previousUsername === undefined) delete process.env.S4_USERNAME;
      else process.env.S4_USERNAME = previousUsername;
    }
  });

  // ─── autoConfirm × autoPostMigo MIGO gate matrix (handler level) ───────────
  // Tests the fix at trTo.handler.js: `data.autoConfirm !== false && data.autoPostMigo && result.Confirmed`
  // [mock only, not SAP verification]
  describe('autoConfirm × autoPostMigo MIGO gate [mock only, not SAP verification]', () => {
    let resProcessAdapter;
    const mkReq = (flags) => ({
      data: { tbnum: '1001839', qty: 3, unit: 'KG', ...flags },
      user: { id: 'tester' },
      error: jest.fn()
    });

    beforeEach(() => {
      resProcessAdapter = {
        rfc: null,
        withRfc: null,
        checkAuthorization: jest.fn().mockResolvedValue(undefined),
        postGoodsMovement: jest.fn()
      };
      // Re-init with both adapters wired
      handlers = {};
      adapter = {
        createTOFromTR: jest.fn(),
        rfc: null,
        withRfc: null
      };
      TrToHandler.init(
        { on: (event, fn) => { handlers[event] = fn; } },
        { adapter, resProcessAdapter }
      );
    });

    it('case 1: autoConfirm=true autoPostMigo=true — MIGO triggered after confirm', async () => {
      adapter.createTOFromTR.mockResolvedValue({
        TransferOrder: '99001', Confirmed: true, Status: '04',
        ReservationNo: '524979', ReservationItem: '0001',
        MovementType: '311', Material: '8000000023', Plant: '1120',
        StorageLocation: 'HS01', Quantity: 3, Unit: 'KG', Batch: ''
      });
      resProcessAdapter.postGoodsMovement = jest.fn().mockResolvedValue({
        materialDocument: '4900099001', materialDocYear: '2026',
        status: '05', reservationNo: '524979', batch: '', stockEffect: 'transferred'
      });

      await handlers.createTOFromTR(mkReq({ autoConfirm: true, autoPostMigo: true }));

      expect(resProcessAdapter.postGoodsMovement).toHaveBeenCalledTimes(1);
    });

    it('case 2: autoConfirm=true autoPostMigo=false — MIGO NOT triggered even though confirmed', async () => {
      adapter.createTOFromTR.mockResolvedValue({
        TransferOrder: '99002', Confirmed: true, Status: '04',
        ReservationNo: '524979', ReservationItem: '0001',
        MovementType: '311', Material: '8000000023', Plant: '1120',
        StorageLocation: 'HS01', Quantity: 3, Unit: 'KG', Batch: ''
      });
      resProcessAdapter.postGoodsMovement = jest.fn();

      await handlers.createTOFromTR(mkReq({ autoConfirm: true, autoPostMigo: false }));

      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('case 3: autoConfirm=false autoPostMigo=true — MIGO NOT triggered (confirm was skipped, Confirmed=false)', async () => {
      adapter.createTOFromTR.mockResolvedValue({
        TransferOrder: '99003', Confirmed: false, Status: '03',
        ReservationNo: '524979', ReservationItem: '0001',
        MovementType: '311', Material: '8000000023', Plant: '1120',
        StorageLocation: 'HS01', Quantity: 3, Unit: 'KG', Batch: ''
      });
      resProcessAdapter.postGoodsMovement = jest.fn();

      await handlers.createTOFromTR(mkReq({ autoConfirm: false, autoPostMigo: true }));

      // autoConfirm=false → MIGO gate: `data.autoConfirm !== false` is false → MIGO skipped
      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('case 4: autoConfirm=false autoPostMigo=false — MIGO NOT triggered', async () => {
      adapter.createTOFromTR.mockResolvedValue({
        TransferOrder: '99004', Confirmed: false, Status: '03',
        ReservationNo: '524979', ReservationItem: '0001',
        MovementType: '311', Material: '8000000023', Plant: '1120',
        StorageLocation: 'HS01', Quantity: 3, Unit: 'KG', Batch: ''
      });
      resProcessAdapter.postGoodsMovement = jest.fn();

      await handlers.createTOFromTR(mkReq({ autoConfirm: false, autoPostMigo: false }));

      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('case 5: MIGO goods movement uses reservation movement type (201), never the TR (311), when they differ [mock only, not browser verification]', async () => {
      adapter.createTOFromTR.mockResolvedValue({
        TransferOrder: '99005', Confirmed: true, Status: '04',
        ReservationNo: '527870', ReservationItem: '0001',
        MovementType: '311', ReservationMovementType: '201',
        Material: '8000005294', Plant: '1120',
        StorageLocation: 'HS01', Quantity: 1, Unit: 'NOS', Batch: ''
      });
      resProcessAdapter.postGoodsMovement = jest.fn().mockResolvedValue({
        MaterialDocument: '4900050199', MaterialDocYear: '2026', StockEffect: 'Goods issue posted'
      });

      await handlers.createTOFromTR(mkReq({
        autoConfirm: true,
        autoPostMigo: true,
        ReservationMovementType: '201'
      }));

      expect(resProcessAdapter.postGoodsMovement).toHaveBeenCalledTimes(1);
      expect(resProcessAdapter.postGoodsMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          movementType: '201',
          reservationNo: '527870'
        })
      );
    });
  });
});
