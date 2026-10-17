'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const { RfcClient } = require('../../srv/integration/s4hana/RfcClient');
const TrToAdapter = require('../../srv/integration/s4hana/wm/TrToAdapter');

describe('Jest outbound network safeguard [MOCK]', () => {
  test('test setup removes SAP credentials and destination bindings', () => {
    for (const key of [
      'S4_DESTINATION_URL', 'S4_DESTINATION_NAME', 'S4_USERNAME', 'S4_PASSWORD', 'S4_RFC_SYSNR',
      'CDS_S4_DESTINATION_URL', 'CDS_S4_USERNAME', 'CDS_S4_PASSWORD', 'VCAP_SERVICES'
    ]) {
      expect(process.env[key]).toBeUndefined();
    }
  });

  test('denies non-loopback HTTP, HTTPS, fetch, sockets, TLS, and DNS [MOCK]', async () => {
    const socket = net.connect({ host: '198.51.100.8', port: 443 });
    const socketError = await new Promise((resolve) => socket.once('error', resolve));
    expect(socketError.code).toBe('JEST_OUTBOUND_NETWORK_BLOCKED');

    expect(() => http.get('http://198.51.100.8/')).toThrow(/Jest blocked outbound network access/);
    expect(() => https.get('https://198.51.100.8/')).toThrow(/Jest blocked outbound network access/);
    await expect(fetch('https://example.com/')).rejects.toMatchObject({ code: 'JEST_OUTBOUND_NETWORK_BLOCKED' });
    expect(() => tls.connect({ host: 'example.com', port: 443 })).toThrow(/Jest blocked outbound network access/);
    const dnsError = await new Promise((resolve) => dns.lookup('example.com', (error) => resolve(error)));
    expect(dnsError.code).toBe('JEST_OUTBOUND_NETWORK_BLOCKED');
  });

  test('node-rfc stub is used by direct and RfcClient imports; explicit injected mock works [MOCK]', async () => {
    const direct = require('node-rfc');
    await expect(new direct.Client({}).open()).rejects.toMatchObject({ code: 'JEST_OUTBOUND_NETWORK_BLOCKED' });
    const configuredEnv = {
      S4_DESTINATION_URL: 'https://not-used.example.invalid',
      S4_RFC_SYSNR: '00',
      S4_CLIENT: '220',
      S4_USERNAME: 'TEST_ONLY',
      S4_PASSWORD: 'TEST_ONLY'
    };
    const adapterRfc = new TrToAdapter().rfc;
    adapterRfc.env = configuredEnv;
    await expect(adapterRfc.call('RFC_PING')).rejects.toMatchObject({ code: 'JEST_OUTBOUND_NETWORK_BLOCKED' });
    await expect(new RfcClient(configuredEnv).session(async () => 'unreachable'))
      .rejects.toMatchObject({ code: 'JEST_OUTBOUND_NETWORK_BLOCKED' });

    const explicitMock = { open: jest.fn(), close: jest.fn(), call: jest.fn().mockResolvedValue({ ok: true }) };
    const injected = new RfcClient(configuredEnv, () => ({ Client: jest.fn(() => explicitMock) }));
    await expect(injected.call('TEST_READ_ONLY_FM')).resolves.toEqual({ ok: true });
  });
});
