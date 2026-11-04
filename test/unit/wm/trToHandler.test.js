const TrToHandler = require('../../support/trToHandlerAsAdmin');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

describe('TrToHandler', () => {
  let handlers;
  let adapter;
  const req = (data) => ({ data, error: jest.fn((status, msg) => ({ status, msg })) });

  beforeEach(() => {
    handlers = {};
    adapter = { getTR: jest.fn(), lookupTR: jest.fn() };
    TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter });
  });

  describe('reads through the real TrToAdapter, with only SAP doubled', () => {
    // Row shapes as in trToAdapter.test.js (values from W01, TR 1000663); not proven against SAP here.
    const HEADER = { LGNUM: 'W01', TBNUM: '0001000663', BWLVS: '319', BETYP: 'P', BENUM: '0001002749', RSNUM: '0000517858', BDATU: '20260923', STATU: '', NLTYP: '100', NLPLA: '1002749' };
    const ITEM = { LGNUM: 'W01', TBNUM: '0001000663', TBPOS: '0001', MATNR: '000000001000000867', WERKS: '1000', LGORT: 'RM01', CHARG: '', MENGE: '17323.200', TAMEN: '0.000', MEINS: 'KG', ELIKZ: '' };
    let fmCalls;
    let reads;
    let tableRows;

    beforeEach(() => {
      fmCalls = [];
      reads = [];
      tableRows = {};
      const rfc = {
        call: async (fm, params) => {
          fmCalls.push([fm, params]);
          return { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [ITEM] };
        },
        readTable: async (table, _fields, where = []) => {
          reads.push([table, where]);
          return tableRows[table] || [];
        }
      };
      handlers = {};
      TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter: new TrToAdapter({ rfc }) });
    });

    it('getOpenTRs without a warehouse reads only the warehouse of the plant of the CAP user, for the requested movement', async () => {
      tableRows.T320 = [{ WERKS: '1120', LGNUM: 'W01' }];
      tableRows.LTBK = [{ LGNUM: 'W01', TBNUM: '0001000663', BWLVS: '319', STATU: '', BDATU: '20260923' }];
      const clerk = { is: () => false, attr: { Plant: ['1120'] } };

      const rows = await handlers.getOpenTRs({ ...req({ lgnum: '', mvt: '319' }), user: clerk });

      expect(rows.map((row) => row.Tbnum)).toEqual(['0001000663']);
      expect(reads).toEqual([
        ['T320', ["WERKS = '1120'"]],
        ['LTBK', ["LGNUM = 'W01'", "AND STATU <> 'E'", "AND STATU <> 'U'", "AND BWLVS = '319'"]]
      ]);
    });

    it('getTR sends the requested TR and warehouse to SAP and returns the mapped TR', async () => {
      const tr = await handlers.getTR(req({ tbnum: '1000663', lgnum: 'W01' }));

      expect(fmCalls).toEqual([['Z_WM_GET_TR_MATERIAL_LIST', { IV_TR_NUMBER: '0001000663', IV_LGNUM: 'W01' }]]);
      expect(tr.Tbnum).toBe('0001000663');
      expect(tr.Items[0]).toMatchObject({ Tbpos: '0001', Material: '1000000867', OpenQty: 17323.2 });
    });

    it('lookupTR returns the requested open TR item from SAP', async () => {
      const detail = await handlers.lookupTR(req({ tbnum: '1000663', lgnum: 'W01', docType: 'TR', tbpos: '0001' }));

      expect(fmCalls[0]).toEqual(['Z_WM_GET_TR_MATERIAL_LIST', { IV_TR_NUMBER: '0001000663', IV_LGNUM: 'W01' }]);
      expect(detail).toMatchObject({ Material: '1000000867', Plant: '1000', StorageLocation: 'RM01', OpenQty: 17323.2, Unit: 'KG' });
    });

    it('getFifoBatches reads the quants of the requested material, plant, storage location and warehouse', async () => {
      tableRows.LQUA = [{ LQNUM: '1', CHARG: 'B01', VERME: '5.000', MEINS: 'KG', WDATU: '20261001', LGTYP: 'RM1', LGPLA: 'BIN1', WERKS: '1120', LGORT: 'CS01' }];

      const batches = await handlers.getFifoBatches(req({ material: '1000000867', plant: '1120', storageLocation: 'CS01', warehouseNumber: 'W01' }));

      expect(reads.find(([table]) => table === 'LQUA')[1]).toEqual([
        "LGNUM = 'W01'", "AND MATNR = '000000001000000867'", "AND LGTYP NOT LIKE '9%'", 'AND VERME > 0', "AND CHARG <> ' '", "AND WERKS = '1120'", "AND LGORT = 'CS01'"
      ]);
      expect(batches.map((batch) => batch.Batch)).toEqual(['B01']);
    });

    it('getAvailableSerials reads EQUI for the requested material', async () => {
      tableRows.EQUI = [{ SERNR: 'SER002' }, { SERNR: 'SER001' }];

      const serials = await handlers.getAvailableSerials(req({ material: '8000006485', plant: '1120', storageLocation: 'CS01', batch: 'B01' }));

      expect(reads).toEqual([['EQUI', ["MATNR = '000000008000006485'", "AND SERNR <> ' '"]]]);
      expect(serials).toEqual(['SER001', 'SER002']);
    });
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

  it('postMigoGoodsMovement pads LTAK-RSNUM to 10 digits for the RESB read and refuses a reservation of another movement', async () => {
    const rfc = {
      readTable: async (table, _fields, where = []) => {
        if (table === 'LTAK') return [{ LGNUM: '', TBNUM: '', RSNUM: '528771', BWLVS: '311', KQUIT: 'X' }];
        if (table === 'RESB' && where[0] === "RSNUM = '0000528771'") return [{ BWART: '201' }];
        return [];
      }
    };
    handlers = {};
    TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter: {}, resProcessAdapter: new ReservationProcessAdapter({ rfc }) });

    await expect(handlers.postMigoGoodsMovement(req({ MovementType: '311', TransferOrder: '1037299', Plant: '1120', Material: 'M1', Quantity: 1, Unit: 'NOS' })))
      .rejects.toMatchObject({ status: 400, message: 'Reservation BWART 201 does not exactly equal requested MovementType 311; Goods Issue was not posted.' });
  });

  describe('retry of a delivery created by SAP message L9/514 (real adapter, only SAP doubled)', () => {
    // Table rows as in autoMigoPosting.test.js L9/514 cases; the SAP shape is not proven here.
    const buildRfc = (pgiReturn) => {
      const fmCalls = [];
      const rows = {
        T001K: [{ BWKEY: '1120', BUKRS: '1000' }],
        ANLA: [{ AKTIV: '20200101', DEAKT: '00000000', XLOEV: '', XSPEB: '' }],
        MARC: [{ XCHPF: '' }],
        MBEW: [{ BWKEY: '1120' }],
        MARD: [{ LGORT: 'CS02', LABST: '10.000' }],
        T320: [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS02' }],
        LIKP: [{ VBELN: '0080000115', WBSTK: 'A', KOSTK: 'C', LVSTK: 'C' }],
        VBFA: [{ VBELV: '0080000115', VBELN: '5000999999', VBTYP_N: 'R' }],
        RESB: [{ RSNUM: '0000530233', RSPOS: '0001', MATNR: '000000008000009754', WERKS: '1120', LGORT: 'CS02', BDMNG: '1.000', ENMNG: '1.000', MEINS: 'NOS', KZEAR: 'X', XLOEK: '' }]
      };
      const rfc = {
        session: (fn) => fn(rfc.call),
        call: async (fm, params) => {
          fmCalls.push([fm, params]);
          if (fm === 'AUTHORITY_CHECK') throw Object.assign(new Error('authorized'), { key: 'USER_IS_AUTHORIZED' });
          if (fm === 'BAPI_OUTB_DELIVERY_CONFIRM_DEC') return pgiReturn;
          return {};
        },
        readTable: async (table, _fields, where = []) => {
          if (table === 'MATDOC') {
            return where.join(' ').includes('5000999999')
              ? [{ MBLNR: '5000999999', MJAHR: '2026', ZEILE: '0001', BWART: '241', MATNR: '000000008000009754', WERKS: '1120', LGORT: 'CS02', MENGE: '1.000', MEINS: 'NOS', RSNUM: '0000530233', RSPOS: '0001', ANLN1: '000000400001' }]
              : [];
          }
          // The delivery is known only from the request: the lookup by reservation item finds nothing.
          if (table === 'LIPS') {
            return where.join(' ').includes('VBELN')
              ? [{ VBELN: '0080000115', POSNR: '000010', LGNUM: 'W01', MATNR: '000000008000009754', LFIMG: '1.000' }]
              : [];
          }
          return rows[table] || [];
        }
      };
      return { rfc, fmCalls };
    };
    const retryRequest = () => req({
      ReservationNo: '530233', ReservationItem: '0001', MovementType: '241', Material: '8000009754', Plant: '1120', StorageLocation: 'CS02',
      Quantity: 1, Unit: 'NOS', AssetNo: '400001', SubNumber: '0000', DeliveryNumber: '0080000115', ProcessId: 'A5B42701-1111-4222-8333-000000000115'
    });
    const init = (rfc) => {
      handlers = {};
      TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter: {}, resProcessAdapter: new ReservationProcessAdapter({ rfc }) });
    };

    it('a request naming DeliveryNumber posts goods issue on that delivery and creates no goods movement', async () => {
      const { rfc, fmCalls } = buildRfc({ RETURN: [] });
      init(rfc);

      const result = await handlers.postMigoGoodsMovement(retryRequest());

      expect(fmCalls.map(([fm]) => fm)).not.toContain('BAPI_GOODSMVT_CREATE');
      expect(fmCalls.find(([fm]) => fm === 'BAPI_OUTB_DELIVERY_CONFIRM_DEC')[1]).toMatchObject({ DELIVERY: '0080000115' });
      expect(result).toMatchObject({ Success: true, DeliveryNumber: '0080000115', MaterialDocument: '5000999999', Status: '05' });
    });

    it('a failed goods issue answers status 90 and keeps the delivery number so the next retry can resume it', async () => {
      const { rfc } = buildRfc({ RETURN: [{ TYPE: 'E', ID: 'VL', NUMBER: '001', MESSAGE: 'Delivery item blocked for goods issue' }] });
      init(rfc);

      const result = await handlers.postMigoGoodsMovement(retryRequest());

      expect(result).toMatchObject({ Success: false, DeliveryNumber: '0080000115', MaterialDocument: '', Status: '90' });
      expect(result.ErrorMessage).toContain('Delivery item blocked for goods issue');
    });
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

  // [mock only, not SAP verification]
  describe('postMigoGoodsMovement double-posting guard fails closed [mock only, not SAP verification]', () => {
    const LTAK_ROW = { LGNUM: 'W01', TBNUM: '0001000850', RSNUM: '', BWLVS: '311', KQUIT: 'X' };
    let resProcessAdapter;
    let readTable;
    const mkReq = () => ({
      data: { MovementType: '311', TransferOrder: '1037299', Plant: '1120', Material: 'M1', Quantity: 1, Unit: 'NOS' },
      user: { id: 'tester' },
      error: jest.fn()
    });

    beforeEach(() => {
      readTable = jest.fn(async (table) => (table === 'LTAK' ? [LTAK_ROW] : []));
      resProcessAdapter = {
        rfc: { readTable },
        withRfc: null,
        checkAuthorization: jest.fn().mockResolvedValue(undefined),
        postGoodsMovement: jest.fn().mockResolvedValue({ materialDocument: '4900099001', materialDocYear: '2026', status: '05' })
      };
      handlers = {};
      adapter = { getTR: jest.fn().mockResolvedValue({ Mblnr: '' }) };
      TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter, resProcessAdapter });
    });

    it('rejects with 409 and posts nothing when the TR was created by a posted material document', async () => {
      adapter.getTR.mockResolvedValue({ Mblnr: '4900050046' });

      await expect(handlers.postMigoGoodsMovement(mkReq())).rejects.toMatchObject({ status: 409 });
      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('rejects with 503 and posts nothing when the TR cannot be read', async () => {
      adapter.getTR.mockRejectedValue(new Error('RFC down'));

      await expect(handlers.postMigoGoodsMovement(mkReq())).rejects.toMatchObject({ status: 503 });
      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('rejects with 503 and posts nothing when the TO header cannot be read', async () => {
      readTable.mockRejectedValue(new Error('RFC down'));

      await expect(handlers.postMigoGoodsMovement(mkReq())).rejects.toMatchObject({ status: 503 });
      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('still posts once when the TR has no material document', async () => {
      await handlers.postMigoGoodsMovement(mkReq());

      expect(resProcessAdapter.postGoodsMovement).toHaveBeenCalledTimes(1);
    });

    it('still posts when only an optional metadata read fails after the guard passed', async () => {
      readTable.mockImplementation(async (table) => {
        if (table === 'LTAK') return [LTAK_ROW];
        throw Object.assign(new Error('RFC down'), { status: 503 });
      });

      await handlers.postMigoGoodsMovement(mkReq());

      expect(resProcessAdapter.postGoodsMovement).toHaveBeenCalledTimes(1);
    });
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
