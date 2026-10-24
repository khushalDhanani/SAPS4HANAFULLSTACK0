const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');
const fs = require('fs');
const path = require('path');

describe('TrToHandler', () => {
  let handlers;
  let adapter;
  const req = (data) => ({ data, error: jest.fn((status, msg) => ({ status, msg })) });

  beforeEach(() => {
    handlers = {};
    adapter = { getTR: jest.fn(), lookupTR: jest.fn() };
    TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter });
  });

  it('delegates getOpenTRs with lgnum and mvt', async () => {
    adapter.getOpenTRs = jest.fn().mockResolvedValue([{ Tbnum: '0001000663' }]);
    await expect(handlers.getOpenTRs(req({ lgnum: 'W01', mvt: '319' }))).resolves.toEqual([{ Tbnum: '0001000663' }]);
    expect(adapter.getOpenTRs).toHaveBeenCalledWith('W01', '319', undefined); // user of the request (none in this fixture)
  });

  it('delegates getTR with the request values unchanged (no defaults)', async () => {
    adapter.getTR.mockResolvedValue({ Tbnum: '0001000663' });

    await expect(handlers.getTR(req({ tbnum: '1000663', lgnum: 'W01' }))).resolves.toEqual({ Tbnum: '0001000663' });
    expect(adapter.getTR).toHaveBeenCalledWith('1000663', 'W01');
  });

  it('delegates lookupTR to adapter', async () => {
    adapter.lookupTR = jest.fn().mockResolvedValue({ TransferRequirement: '1000663' });
    await expect(handlers.lookupTR(req({ tbnum: '1000663', lgnum: 'W01', docType: 'TR', tbpos: '0001' }))).resolves.toEqual({ TransferRequirement: '1000663' });
    expect(adapter.lookupTR).toHaveBeenCalledWith('1000663', 'W01', 'TR', '0001', undefined);
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

  it('maps adapter errors to req.error with their status, 500 when none', async () => {
    adapter.getTR.mockRejectedValue(Object.assign(new Error('Warehouse is missing or invalid'), { status: 400 }));
    adapter.lookupTR = jest.fn().mockRejectedValue(new Error('boom'));

    const r1 = req({ tbnum: '1' });
    await handlers.getTR(r1);
    expect(r1.error).toHaveBeenCalledWith(400, 'Warehouse is missing or invalid');

    const r2 = req({});
    await handlers.lookupTR(r2);
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
      data: { tbnum: '1001839', qty: 3, unit: 'KG', MovementType: '311', ...flags },
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

    it('case 2b: PGI on the created delivery fails -> the SAP reason reaches ErrorMessage, delivery number kept, status 90', async () => {
      adapter.createTOFromTR.mockResolvedValue({
        TransferOrder: '1037371', Confirmed: true, Status: '04', ReservationNo: '530233', ReservationItem: '0001',
        MovementType: '241', Material: '8000009754', Plant: '1120', StorageLocation: 'CS02', Quantity: 1, Unit: 'NOS', Batch: ''
      });
      const pgiErr = Object.assign(new Error('PGI failed for Outbound Delivery 0080000134: [E] Delivery has not yet been picked (completely); [E] Item 000010 requires exactly 1 serial numbers'), { status: 400, stage: 'PGI', deliveryNumber: '0080000134' });
      resProcessAdapter.postGoodsMovement = jest.fn().mockRejectedValue(pgiErr);

      const result = await handlers.createTOFromTR(mkReq({ autoConfirm: true, autoPostMigo: true, MovementType: '241' }));

      expect(result.DeliveryNumber).toBe('0080000134');
      expect(result.Status).toBe('90');
      expect(result.ErrorMessage).toContain('Delivery has not yet been picked');
      expect(result.ErrorMessage).toContain('requires exactly 1 serial numbers');
      expect(result.Message).toContain('Delivery has not yet been picked');
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
        MovementType: '201',
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

  it('createTOFromTR does not auto-post MIGO when the TR was created by an already posted material document', async () => {
    const postGoodsMovement = jest.fn();
    const h = {};
    const a = { createTOFromTR: jest.fn().mockResolvedValue({ success: true, Confirmed: true, TransferOrder: '0001037400', MovementType: '301', GoodsMovementPosted: true, MaterialDocument: '4900047610', Message: 'Transfer Order 0001037400 confirmed.' }) };
    TrToHandler.init({ on: (e, fn) => { h[e] = fn; } }, { adapter: a, resProcessAdapter: { checkAuthorization: jest.fn(), postGoodsMovement } });
    const result = await h.createTOFromTR(req({ lgnum: 'W12', tbnum: '1000891', MovementType: '301', autoConfirm: true, autoPostMigo: true }));
    expect(postGoodsMovement).not.toHaveBeenCalled();
    expect(result.MigoSkipped).toBe(true);
    expect(result.Message).toContain('material document 4900047610');
  });
});
