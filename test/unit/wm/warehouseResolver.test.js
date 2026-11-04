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

  test('refuses with 409 when one TR number exists in several warehouses', async () => {
    const rfc = { readTable: async () => [{ LGNUM: 'W12' }, { LGNUM: 'W13' }] };
    await expect(resolveWarehouse(rfc, { trNumber: '1000889' })).rejects.toMatchObject({
      status: 409,
      message: 'Cannot resolve warehouse: Transfer Requirement 1000889 exists in multiple warehouses (W12, W13)'
    });
  });

  test('refuses with 409 when a plant and storage location map to several warehouses in T320', async () => {
    const rfc = { readTable: async () => [{ LGNUM: 'W10' }, { LGNUM: 'W11' }] };
    await expect(resolveWarehouse(rfc, { plant: '1120', storageLocation: 'CS02' })).rejects.toMatchObject({
      status: 409,
      message: 'Cannot resolve warehouse: plant 1120 / storage location CS02 maps to multiple warehouses (W10, W11)'
    });
  });

  test('counts repeated rows of one warehouse as that single warehouse', async () => {
    const rfc = { readTable: async () => [{ LGNUM: 'W12' }, { LGNUM: 'W12 ' }] };
    await expect(resolveWarehouse(rfc, { trNumber: '1000889' })).resolves.toBe('W12');
  });

  test('resolves from the reservation on the TR header', async () => {
    const reads = [];
    const rfc = { readTable: async (...args) => { reads.push(args); return [{ LGNUM: 'W14' }]; } };
    await expect(resolveWarehouse(rfc, { reservationNumber: '524979' })).resolves.toBe('W14');
    expect(reads).toEqual([['LTBK', ['LGNUM'], ["RSNUM = '0000524979'"], 10]]);
  });

  test('tells the caller to supply a warehouse when no RFC client is available', async () => {
    await expect(resolveWarehouse(null, { trNumber: '1000889' })).rejects.toMatchObject({
      status: 400,
      message: 'Cannot resolve warehouse: provide a warehouse number; SAP document lookup is unavailable.'
    });
  });

  test('rejects a warehouse number with a quote before any read', async () => {
    const reads = [];
    const rfc = { readTable: async (...args) => { reads.push(args); return []; } };
    await expect(resolveWarehouse(rfc, { warehouseNumber: "W1'" })).rejects.toMatchObject({ status: 400 });
    expect(reads).toEqual([]);
  });
});
