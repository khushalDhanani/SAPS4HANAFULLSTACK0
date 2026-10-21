'use strict';

const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');

const noLoader = () => { throw Object.assign(new Error('not loaded in test'), { code: 'MODULE_NOT_FOUND' }); };
const dest = (originalProperties) => jest.fn(async () => ({ originalProperties }));
const fullProps = { 'jco.client.ashost': 'sap.internal', 'jco.client.sysnr': '00', 'jco.client.client': '220', 'jco.client.user': 'TECH', 'jco.client.passwd': 'secret' };

describe('RfcClient.resolveConnectionParams — BTP RFC destination first, local env only outside production', () => {
  test('maps the RFC destination properties and caches them per instance', async () => {
    const getDestination = dest(fullProps);
    const rfc = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC', NODE_ENV: 'production' }, noLoader, getDestination);
    await expect(rfc.resolveConnectionParams()).resolves.toEqual({ ashost: 'sap.internal', sysnr: '00', client: '220', user: 'TECH', passwd: 'secret', lang: 'EN', trace: '0' });
    await rfc.resolveConnectionParams();
    expect(getDestination).toHaveBeenCalledTimes(1);
    expect(getDestination).toHaveBeenCalledWith({ destinationName: 'S4_RFC' });
  });

  test('fails closed when the destination lacks RFC properties, naming the missing ones and never the password', async () => {
    const rfc = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC' }, noLoader, dest({ URL: 'https://x', Name: 'S4_RFC' }));
    await expect(rfc.resolveConnectionParams()).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/lacks jco\.client\.ashost, jco\.client\.sysnr.*properties present: URL, Name/) });
  });

  test('destination lookup error and missing destination are 503 with the destination name', async () => {
    await expect(new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC' }, noLoader, jest.fn(async () => { throw new Error('no binding'); })).resolveConnectionParams())
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining("'S4_RFC' could not be read") });
    await expect(new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC' }, noLoader, jest.fn(async () => null)).resolveConnectionParams())
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining("'S4_RFC' not found") });
  });

  test('without a destination name: local env in development, refused in production', async () => {
    const env = { S4_DESTINATION_URL: 'https://sap.local:44300', S4_RFC_SYSNR: '00', S4_CLIENT: '100', S4_USERNAME: 'U', S4_PASSWORD: 'P' };
    await expect(new RfcClient(env, noLoader).resolveConnectionParams()).resolves.toMatchObject({ ashost: 'sap.local', client: '100' });
    await expect(new RfcClient({ ...env, NODE_ENV: 'production' }, noLoader).resolveConnectionParams())
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('S4_RFC_DESTINATION_NAME') });
  });
});
