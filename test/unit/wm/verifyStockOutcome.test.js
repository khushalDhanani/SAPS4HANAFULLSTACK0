'use strict';

/**
 * verifyStock must be able to fail. Real adapter over a plain RFC double, so the production path runs.
 * Rows follow the adapter's own MATDOC and MARD field lists; the SAP shape is not proven here.
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');

const adapterOver = ({ matdoc, stockByLgort }) => new ReservationProcessAdapter({
  rfc: {
    readTable: async (table, _fields, where = []) => {
      if (table === 'MATDOC') return matdoc;
      if (table === 'MARD') {
        const lgort = /LGORT = '(\w+)'/.exec(where.join(' '))[1];
        return stockByLgort[lgort] === undefined ? [] : [{ LABST: stockByLgort[lgort] }];
      }
      return [];
    }
  }
});
const row201 = { MBLNR: '5000123456', MJAHR: '2026', BWART: '201', MATNR: '000000008000000023', WERKS: '1120', LGORT: 'HS01', MENGE: '5.000' };
const row311 = { ...row201, BWART: '311', UMWRK: '1120', UMLGO: 'CS01' };
const request201 = { materialDocument: '5000123456', materialDocumentYear: '2026', movementType: '201', material: '8000000023', quantity: 5, plant: '1120', storageLocation: 'HS01' };
const request311 = { ...request201, movementType: '311', receivingStorageLocation: 'CS01' };

describe('verifyStock', () => {
  test('201: reports the source stock delta when stock dropped by the posted quantity', async () => {
    const res = await adapterOver({ matdoc: [row201], stockByLgort: { HS01: '95.000' } }).verifyStock({ ...request201, initialSourceStock: 100 });

    expect(res.sourceStock).toMatchObject({ initial: 100, resulting: 95, delta: -5, decreased: true });
  });

  // Known defect: srv/integration/s4hana/wm/ReservationProcessAdapter.js:1462 throws only when resulting > initial, so unchanged stock returns verified: true although the movement moved nothing.
  test.failing('201: refuses when the source stock did not change', async () => {
    const adapter = adapterOver({ matdoc: [row201], stockByLgort: { HS01: '100.000' } });

    await expect(adapter.verifyStock({ ...request201, initialSourceStock: 100 }))
      .rejects.toMatchObject({ status: 400, stage: 'STOCK_VERIFICATION', message: expect.stringContaining('Source stock did not decrease') });
  });

  // Known defect: srv/integration/s4hana/wm/ReservationProcessAdapter.js:1531 throws only when the destination dropped, so an unchanged destination returns verified: true.
  test.failing('311: refuses when the destination stock did not change', async () => {
    const adapter = adapterOver({ matdoc: [row311], stockByLgort: { HS01: '95.000', CS01: '20.000' } });

    await expect(adapter.verifyStock({ ...request311, initialSourceStock: 100, initialDestStock: 20 }))
      .rejects.toMatchObject({ status: 400, stage: 'STOCK_VERIFICATION', message: expect.stringContaining('Destination SLoc stock did not increase') });
  });

  // Known defect: srv/integration/s4hana/wm/ReservationProcessAdapter.js:1436 sets consumedQuantity from the requested quantity, so the mismatch check at :1468 compares a value with itself and SAP's MENGE is ignored.
  test.failing('201: refuses when the SAP document quantity differs from the requested quantity', async () => {
    const adapter = adapterOver({ matdoc: [{ ...row201, MENGE: '3.000' }], stockByLgort: { HS01: '97.000' } });

    await expect(adapter.verifyStock({ ...request201, initialSourceStock: 100 }))
      .rejects.toMatchObject({ status: 400, stage: 'STOCK_VERIFICATION', message: expect.stringContaining('Consumed quantity mismatch') });
  });
});
