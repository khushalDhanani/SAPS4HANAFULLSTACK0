'use strict';

const { resolveWarehouse } = require('../../../srv/integration/s4hana/wm/warehouseResolver');

describe('WM warehouse resolver', () => {
  test('uses the route warehouse first without reading SAP', async () => {
    const rfc = { readTable: jest.fn() };

    await expect(resolveWarehouse(rfc, {
      warehouseNumber: 'W13',
      trNumber: '1000889',
      toNumber: '1037368',
      plant: '1120',
      storageLocation: 'CS02'
    })).resolves.toBe('W13');

    expect(rfc.readTable).not.toHaveBeenCalled();
  });

  test('resolves from the TR header before trying lower-priority sources', async () => {
    const rfc = { readTable: jest.fn().mockResolvedValue([{ LGNUM: 'W12' }]) };

    await expect(resolveWarehouse(rfc, {
      trNumber: '1000889',
      toNumber: '1037368',
      plant: '1120',
      storageLocation: 'CS02'
    })).resolves.toBe('W12');

    expect(rfc.readTable).toHaveBeenCalledTimes(1);
    expect(rfc.readTable).toHaveBeenCalledWith('LTBK', ['LGNUM'], ["TBNUM = '0001000889'"], 10);
  });

  test('resolves from the TO header when no TR header was supplied', async () => {
    const rfc = { readTable: jest.fn().mockResolvedValue([{ LGNUM: 'W11' }]) };

    await expect(resolveWarehouse(rfc, { toNumber: '1037368' })).resolves.toBe('W11');

    expect(rfc.readTable).toHaveBeenCalledWith('LTAK', ['LGNUM'], ["TANUM = '0001037368'"], 10);
  });

  test('resolves from T320 using plant and storage location when document headers have no row', async () => {
    const rfc = {
      readTable: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ LGNUM: 'W10' }])
    };

    await expect(resolveWarehouse(rfc, {
      trNumber: '1000889',
      plant: '1120',
      storageLocation: 'CS02'
    })).resolves.toBe('W10');

    expect(rfc.readTable).toHaveBeenNthCalledWith(1, 'LTBK', ['LGNUM'], ["TBNUM = '0001000889'"], 10);
    expect(rfc.readTable).toHaveBeenNthCalledWith(2, 'T320', ['LGNUM'], ["( WERKS = '1120' AND LGORT = 'CS02' )"], 10);
  });

  test('throws a clear error when no request source resolves a warehouse', async () => {
    const rfc = { readTable: jest.fn().mockResolvedValue([]) };

    await expect(resolveWarehouse(rfc, {
      trNumber: '1000889',
      plant: '1120',
      storageLocation: 'CS02'
    })).rejects.toMatchObject({
      status: 400,
      message: 'Cannot resolve warehouse: SAP T320 has no assignment for plant 1120 / storage location CS02.'
    });
  });

  test('throws a clear error when there are no resolution inputs', async () => {
    await expect(resolveWarehouse({ readTable: jest.fn() }, {})).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Cannot resolve warehouse: provide a route warehouse')
    });
  });
});
