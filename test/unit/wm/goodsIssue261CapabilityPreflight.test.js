const fs = require('fs');
const path = require('path');
const {
  METADATA_PATH,
  assert261CapabilityReady
} = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssue261CapabilityPreflight');

const metadata = fs.readFileSync(path.resolve(__dirname, '../../../srv/external/API_MATERIAL_DOCUMENT_SRV.xml'), 'utf8');

function setup(overrides = {}) {
  const client = {
    resolveDestination: jest.fn().mockResolvedValue({
      url: 'https://sap.example.invalid',
      sapClient: '220',
      authentication: 'BasicAuthentication'
    }),
    getText: jest.fn().mockResolvedValue(metadata),
    ...overrides.client
  };
  const rfc = {
    readTable: jest.fn().mockResolvedValue([]),
    ...overrides.rfc
  };
  return { client, rfc };
}

describe('Goods Issue 261 capability preflight', () => {
  test('requires the configured material-document create contract and RFC read-back path', async () => {
    const { client, rfc } = setup();
    await expect(assert261CapabilityReady({
      requestedMovementType: '261', validatedMovementType: '261', client, rfc, expectedSapClient: '220'
    })).resolves.toMatchObject({
      ready: true, movementType: '261', service: 'API_MATERIAL_DOCUMENT_SRV',
      sapClient: '220', createEntitySet: 'A_MaterialDocumentHeader', readbackTable: 'MATDOC'
    });
    expect(client.getText).toHaveBeenCalledWith(METADATA_PATH);
    expect(rfc.readTable).toHaveBeenCalledWith('MATDOC', ['MBLNR', 'MJAHR', 'BWART'], ["MBLNR = '0000000000'"], 1);
  });

  test('blocks when the required service is missing (404) without trying another service', async () => {
    const missing = Object.assign(new Error('HTTP 404'), { status: 404 });
    const { client, rfc } = setup({ client: { getText: jest.fn().mockRejectedValue(missing) } });
    await expect(assert261CapabilityReady({ requestedMovementType: '261', validatedMovementType: '261', client, rfc }))
      .rejects.toMatchObject({ status: 404 });
    expect(client.getText).toHaveBeenCalledTimes(1);
    expect(client.getText).toHaveBeenCalledWith(METADATA_PATH);
    expect(rfc.readTable).not.toHaveBeenCalled();
  });

  test('surfaces HTTP 501 unchanged and does not fall back to ZMMIM_MATDOC_SRV', async () => {
    const unsupported = Object.assign(new Error('CREATE_ENTITY not implemented'), { status: 501 });
    const { client, rfc } = setup({ client: { getText: jest.fn().mockRejectedValue(unsupported) } });
    await expect(assert261CapabilityReady({ requestedMovementType: '261', validatedMovementType: '261', client, rfc }))
      .rejects.toMatchObject({ status: 501, message: 'CREATE_ENTITY not implemented' });
    expect(client.getText.mock.calls.flat().join(' ')).not.toContain('ZMMIM_MATDOC_SRV');
    expect(rfc.readTable).not.toHaveBeenCalled();
  });

  test('rejects metadata from a different SAP service', async () => {
    const wrongService = '<edmx:Edmx><Schema Namespace="OTHER"><atom:link href="/sap/opu/odata/sap/OTHER/$metadata"/></Schema></edmx:Edmx>';
    const { client, rfc } = setup({ client: { getText: jest.fn().mockResolvedValue(wrongService) } });
    await expect(assert261CapabilityReady({ requestedMovementType: '261', validatedMovementType: '261', client, rfc }))
      .rejects.toMatchObject({ status: 502, code: 'GI261_WRONG_ODATA_SERVICE' });
    expect(rfc.readTable).not.toHaveBeenCalled();
  });

  test('blocks on unavailable RFC MATDOC read access', async () => {
    const { client, rfc } = setup({ rfc: { readTable: jest.fn().mockRejectedValue(new Error('RFC unavailable')) } });
    await expect(assert261CapabilityReady({ requestedMovementType: '261', validatedMovementType: '261', client, rfc }))
      .rejects.toMatchObject({ status: 503, code: 'GI261_READBACK_RFC_UNAVAILABLE' });
  });

  test('rejects a movement-type mutation before metadata or RFC calls', async () => {
    const { client, rfc } = setup();
    await expect(assert261CapabilityReady({ requestedMovementType: '201', validatedMovementType: '261', client, rfc }))
      .rejects.toMatchObject({ status: 400, code: 'GI261_MOVEMENT_TYPE_MISMATCH' });
    expect(client.getText).not.toHaveBeenCalled();
    expect(rfc.readTable).not.toHaveBeenCalled();
  });

  test('blocks when metadata does not prove CREATE for the expected material document entity', async () => {
    const withoutCreate = metadata.replace(/<Annotation Term="Capabilities\.InsertRestrictions">[\s\S]*?<\/Annotation>/, '');
    const { client, rfc } = setup({ client: { getText: jest.fn().mockResolvedValue(withoutCreate) } });
    await expect(assert261CapabilityReady({ requestedMovementType: '261', validatedMovementType: '261', client, rfc }))
      .rejects.toMatchObject({ status: 501, code: 'GI261_CREATE_CAPABILITY_NOT_PROVEN' });
    expect(rfc.readTable).not.toHaveBeenCalled();
  });

  describe('destination checks run before the metadata read', () => {
    const preflightWith = (resolveDestination, expectedSapClient) => {
      const { client, rfc } = setup({ client: { resolveDestination } });
      return { client, run: assert261CapabilityReady({ requestedMovementType: '261', validatedMovementType: '261', client, rfc, expectedSapClient }) };
    };

    test('keeps the status of a failed destination lookup', async () => {
      const failure = Object.assign(new Error('destination refused'), { status: 401 });
      const { client, run } = preflightWith(jest.fn().mockRejectedValue(failure));
      await expect(run).rejects.toMatchObject({ status: 401, code: 'GI261_DESTINATION_UNAVAILABLE' });
      expect(client.getText).not.toHaveBeenCalled();
    });

    test('answers 503 when the destination lookup fails with no status', async () => {
      const { run } = preflightWith(jest.fn().mockRejectedValue(new Error('no destination service')));
      await expect(run).rejects.toMatchObject({ status: 503, code: 'GI261_DESTINATION_UNAVAILABLE' });
    });

    test('blocks a destination with no endpoint', async () => {
      const { client, run } = preflightWith(jest.fn().mockResolvedValue({ sapClient: '220', authentication: 'BasicAuthentication' }));
      await expect(run).rejects.toMatchObject({ status: 503, code: 'GI261_DESTINATION_UNAVAILABLE' });
      expect(client.getText).not.toHaveBeenCalled();
    });

    test('blocks a destination with no SAP client', async () => {
      const { client, run } = preflightWith(jest.fn().mockResolvedValue({ url: 'https://sap.example.invalid', authentication: 'BasicAuthentication' }));
      await expect(run).rejects.toMatchObject({ status: 503, code: 'GI261_DESTINATION_CLIENT_MISMATCH' });
      expect(client.getText).not.toHaveBeenCalled();
    });

    test('blocks a destination pointing at a SAP client other than the expected one', async () => {
      const destination = { url: 'https://sap.example.invalid', sapClient: '100', authentication: 'BasicAuthentication' };
      const { client, run } = preflightWith(jest.fn().mockResolvedValue(destination), '220');
      await expect(run).rejects.toMatchObject({ status: 503, code: 'GI261_DESTINATION_CLIENT_MISMATCH' });
      expect(client.getText).not.toHaveBeenCalled();
    });

    test('accepts the SAP client from the sap-client header', async () => {
      const destination = { url: 'https://sap.example.invalid', headers: { 'sap-client': '220' }, authentication: 'BasicAuthentication' };
      const { run } = preflightWith(jest.fn().mockResolvedValue(destination), '220');
      await expect(run).resolves.toMatchObject({ ready: true, sapClient: '220' });
    });

    test('blocks a destination with no declared authentication mode', async () => {
      const { client, run } = preflightWith(jest.fn().mockResolvedValue({ url: 'https://sap.example.invalid', sapClient: '220' }));
      await expect(run).rejects.toMatchObject({ status: 503, code: 'GI261_DESTINATION_AUTH_UNVERIFIED' });
      expect(client.getText).not.toHaveBeenCalled();
    });
  });
});
