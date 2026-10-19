'use strict';

/**
 * Step 7.6: stock pre-check before BAPI_RESERVATION_CREATE1 (ReservationProcessAdapter.checkStockForReservation).
 * MB21 needs no stock: shortages are warnings; a non-existent batch blocks. Mock RFC only - no SAP call.
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

const input = { plant: '1120', storageLocation: 'CS01', material: '1000000045', quantity: 10, unit: 'KG', warehouseNumber: 'W01' };
const MAT = '000000001000000045';

function rfcWith(tables = {}) {
  return {
    call: jest.fn(),
    session: jest.fn(),
    readTable: jest.fn(async (table, _fields, where) => {
      const v = tables[table];
      return typeof v === 'function' ? v(where) : (v || []);
    })
  };
}
const adapterWith = (tables, opts = {}) => new ReservationProcessAdapter({ rfc: rfcWith(tables), ...opts });
const stock = { MARA: [{ MEINS: 'KG' }], MARD: [{ LABST: '50.000' }], LQUA: [{ LGTYP: '001', LGPLA: 'A-01', LGORT: 'CS01', CHARG: '', VERME: '50.000' }] };

describe('Step 7.6: stock pre-check before reservation creation', () => {
  test('sufficient stock: no warnings, figures reported', async () => {
    const res = await adapterWith(stock).checkStockForReservation(input);
    expect(res).toMatchObject({ warnings: [], unrestricted: 50, wmStock: 50, baseUnit: 'KG', comparable: true, reads: 'ok', requested: { quantity: 10, unit: 'KG' } });
  });

  test('insufficient unrestricted and WM stock: warnings only (reservation still allowed)', async () => {
    const res = await adapterWith({ ...stock, MARD: [{ LABST: '4.000' }], LQUA: [{ LGTYP: '001', VERME: '4.000' }] }).checkStockForReservation(input);
    expect(res.warnings).toEqual([
      expect.stringMatching(/^Unrestricted stock of material 1000000045 in plant 1120 \/ storage location CS01 4 KG is below the requested 10 KG \(MARD\)$/),
      expect.stringMatching(/^WM stock of material 1000000045 in warehouse W01 \/ storage location CS01 4 KG is below the requested 10 KG \(LQUA\)$/)
    ]);
  });

  test('batch-specific insufficient stock: MCHB and batch-filtered LQUA are compared', async () => {
    const a = adapterWith({
      ...stock,
      MCHA: [{ LVORM: '' }],
      MCHB: [{ CLABS: '2.000' }],
      LQUA: (where) => (where.some((w) => w.includes("CHARG = 'B1'")) ? [{ LGTYP: '001', VERME: '2.000' }] : [{ LGTYP: '001', VERME: '50.000' }])
    });
    const res = await a.checkStockForReservation({ ...input, batch: 'B1' });
    expect(res.batchStock).toBe(2);
    expect(res.warnings).toEqual([
      expect.stringMatching(/batch B1 .* 2 KG is below the requested 10 KG \(MCHB\)/),
      expect.stringMatching(/WM stock of batch B1 in warehouse W01 \/ storage location CS01 2 KG is below the requested 10 KG \(LQUA\)/)
    ]);
  });

  test('batch that does not exist for the material/plant: blocking 400 before any BAPI', async () => {
    const a = adapterWith({ ...stock, MCHA: [], MCH1: [] }, { checkMarcExistence: true });
    await expect(a.checkStockForReservation({ ...input, batch: 'NOPE' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Batch NOPE does not exist in receiving plant 1120 master data \(MCHA\/MCH1\)/) });
  });

  test('no WM quant in the SLoc: warning names the SLocs that do have quants, interim 9xx types ignored', async () => {
    const a = adapterWith({
      ...stock,
      LQUA: (where) => (where.some((w) => w.includes("LGORT = 'CS01'"))
        ? [{ LGTYP: '916', VERME: '5.000' }]
        : [{ LGTYP: '001', LGORT: 'HS01', VERME: '5.000' }, { LGTYP: '921', LGORT: 'ST02', VERME: '9.000' }])
    });
    const res = await a.checkStockForReservation(input);
    expect(res.wmStock).toBe(0);
    expect(res.otherSlocs).toEqual(['HS01']);
    expect(res.warnings).toEqual(['Storage location CS01 has no WM stock for material 1000000045 in warehouse W01. Available in storage location(s): HS01.']);
  });

  test('valid despite non-WM stock: MARD covers the quantity, no quant anywhere -> warning only, no error', async () => {
    const res = await adapterWith({ ...stock, LQUA: [] }).checkStockForReservation(input);
    expect(res.unrestricted).toBe(50);
    expect(res.warnings).toEqual(['Material 1000000045 has no WM stock in warehouse W01 (plant 1120).']);
  });

  test('requested unit differs from base unit: quantities are not compared, warning says so', async () => {
    const res = await adapterWith({ ...stock, MARA: [{ MEINS: 'G' }], MARD: [{ LABST: '1.000' }] }).checkStockForReservation(input);
    expect(res.comparable).toBe(false);
    expect(res.warnings).toEqual([expect.stringMatching(/Requested unit KG differs from base unit G .*MARM conversion not applied/)]);
  });

  test('read failure: never throws, reports unverified', async () => {
    const a = adapterWith({ MARA: () => { throw new Error('RFC down'); } });
    const res = await a.checkStockForReservation(input);
    expect(res.reads).toBe('failed');
    expect(res.warnings).toEqual([expect.stringMatching(/Stock pre-check could not be completed \(RFC down\)/)]);
  });

  test('reads only the tables it needs: MARA, MARD, LQUA (+MCHA/MCHB with a batch)', async () => {
    const a = adapterWith(stock);
    await a.checkStockForReservation(input);
    expect(a.rfc.readTable.mock.calls.map((c) => c[0])).toEqual(['MARA', 'MARD', 'LQUA']);
    expect(a.rfc.readTable.mock.calls[2][2]).toEqual(["LGNUM = 'W01'", `AND MATNR = '${MAT}'`, "AND WERKS = '1120'", "AND LGORT = 'CS01'", 'AND VERME > 0']);
  });
});
