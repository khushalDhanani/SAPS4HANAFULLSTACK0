'use strict';

const { resolveCustomerSalesArea } = require('../../../srv/integration/s4hana/sd/customerSalesArea');

const rfcWith = (rows) => ({ readTable: jest.fn(async () => rows) });
const A = { VKORG: '1000', VTWEG: '14', SPART: '00', LOEVM: '' };
const B = { VKORG: '1000', VTWEG: '10', SPART: '52', LOEVM: '' };

describe('resolveCustomerSalesArea (KNVV, read-only, no defaults)', () => {
  test('exactly one maintained sales area is used when nothing is requested', async () => {
    const rfc = rfcWith([A, { ...B, LOEVM: 'X' }]); // deleted row ignored
    await expect(resolveCustomerSalesArea(rfc, '1120')).resolves.toEqual({ salesOrganization: '1000', distributionChannel: '14', division: '00' });
    expect(rfc.readTable).toHaveBeenCalledWith('KNVV', ['VKORG', 'VTWEG', 'SPART', 'LOEVM'], ["KUNNR = '0000001120'"]);
  });
  test('several maintained sales areas and nothing requested -> 400 listing them', async () => {
    await expect(resolveCustomerSalesArea(rfcWith([A, B]), '10135')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('1000/14/00, 1000/10/52') });
  });
  test('requested sales area is accepted only when KNVV has it', async () => {
    await expect(resolveCustomerSalesArea(rfcWith([A, B]), '10135', { salesOrganization: '1000', distributionChannel: '10', division: '52' })).resolves.toEqual({ salesOrganization: '1000', distributionChannel: '10', division: '52' });
    await expect(resolveCustomerSalesArea(rfcWith([A]), '1120', { salesOrganization: '1000', distributionChannel: '10', division: '52' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('not maintained for customer 1120') });
  });
  test('partial request (only sales org) -> 400', async () => {
    await expect(resolveCustomerSalesArea(rfcWith([A]), '1120', { salesOrganization: '1000' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('given together') });
  });
  test('no sales area -> 400; RFC read error -> 502; no RFC -> 503; bad customer key -> 400 before any read', async () => {
    await expect(resolveCustomerSalesArea(rfcWith([]), '1120')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('no sales area') });
    await expect(resolveCustomerSalesArea({ readTable: jest.fn(async () => { throw new Error('RFC_COMMUNICATION_FAILURE'); }) }, '1120')).rejects.toMatchObject({ status: 502 });
    await expect(resolveCustomerSalesArea(null, '1120')).rejects.toMatchObject({ status: 503 });
    const rfc = rfcWith([A]);
    await expect(resolveCustomerSalesArea(rfc, "1' OR KUNNR <> '")).rejects.toMatchObject({ status: 400 });
    expect(rfc.readTable).not.toHaveBeenCalled();
  });
});
