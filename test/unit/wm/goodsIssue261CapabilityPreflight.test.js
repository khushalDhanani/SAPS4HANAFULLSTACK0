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
});
