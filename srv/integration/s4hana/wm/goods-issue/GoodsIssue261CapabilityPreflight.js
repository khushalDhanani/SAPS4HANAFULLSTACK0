'use strict';

const METADATA_PATH = '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/$metadata';
const READBACK_TABLE = 'MATDOC';

function preflightError(message, { status = 503, code = 'GI261_CAPABILITY_UNAVAILABLE', cause } = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function assert261Request(requestedMovementType, validatedMovementType) {
  const requested = String(requestedMovementType ?? '').trim();
  const validated = String(validatedMovementType ?? '').trim();
  if (requested !== '261' || validated !== '261') {
    throw preflightError(
      `261 capability preflight requires requestedMovementType=261 and validatedMovementType=261 (got ${requested || '(missing)'}/${validated || '(missing)'}).`,
      { status: 400, code: 'GI261_MOVEMENT_TYPE_MISMATCH' }
    );
  }
}

function assertMaterialDocumentMetadata(metadata) {
  const xml = typeof metadata === 'string' ? metadata : '';
  const expectedService = /<Schema\b[^>]*Namespace=["']API_MATERIAL_DOCUMENT_SRV["']/i.test(xml) &&
    /href=["'][^"']*\/API_MATERIAL_DOCUMENT_SRV\/\$metadata["']/i.test(xml);
  const headerEntitySet = /<EntitySet\b(?=[^>]*\bName=["']A_MaterialDocumentHeader["'])(?=[^>]*\bEntityType=["'][^"']*A_MaterialDocumentHeaderType["'])[^>]*\/?\s*>/i.test(xml);
  const materialDocumentAnnotations = [...xml.matchAll(/<Annotations\b[^>]*\bTarget=["']API_MATERIAL_DOCUMENT_SRV\.API_MATERIAL_DOCUMENT_SRV_Entities\/A_MaterialDocumentHeader["'][^>]*>[\s\S]*?<\/Annotations>/gi)]
    .map((match) => match[0]);
  const createSupported = materialDocumentAnnotations.some((annotation) =>
    /Capabilities\.InsertRestrictions/i.test(annotation) && /Creates a material document/i.test(annotation));
  const itemNavigation = /<NavigationProperty\b(?=[^>]*\bName=["']to_MaterialDocumentItem["'])/i.test(xml);
  const movementProperty = /<Property\b(?=[^>]*\bName=["']GoodsMovementType["'])/i.test(xml);

  if (!expectedService) {
    throw preflightError('The live $metadata response is not API_MATERIAL_DOCUMENT_SRV.', {
      status: 502,
      code: 'GI261_WRONG_ODATA_SERVICE'
    });
  }
  if (!headerEntitySet || !createSupported || !itemNavigation || !movementProperty) {
    throw preflightError('Live API_MATERIAL_DOCUMENT_SRV metadata does not prove the required material-document create and item read contract.', {
      status: 501,
      code: 'GI261_CREATE_CAPABILITY_NOT_PROVEN'
    });
  }
}

async function assert261CapabilityReady({
  requestedMovementType,
  validatedMovementType,
  client,
  rfc,
  expectedSapClient = ''
} = {}) {
  assert261Request(requestedMovementType, validatedMovementType);
  if (!client || typeof client.resolveDestination !== 'function' || typeof client.getText !== 'function') {
    throw preflightError('S/4 HTTP destination and metadata client are unavailable.', { code: 'GI261_ODOATA_CLIENT_UNAVAILABLE' });
  }
  if (!rfc || typeof rfc.readTable !== 'function') {
    throw preflightError('Read-only RFC material-document verification is unavailable.', { code: 'GI261_READBACK_RFC_UNAVAILABLE' });
  }

  let destination;
  try {
    destination = await client.resolveDestination();
  } catch (cause) {
    throw preflightError('S/4 destination resolution failed; 261 posting is blocked.', {
      status: cause.status || 503,
      code: 'GI261_DESTINATION_UNAVAILABLE',
      cause
    });
  }
  if (!destination?.url) {
    throw preflightError('S/4 destination resolution returned no endpoint; 261 posting is blocked.', {
      code: 'GI261_DESTINATION_UNAVAILABLE'
    });
  }
  const sapClient = String(destination.sapClient || destination.headers?.['sap-client'] || '').trim();
  if (!sapClient || (expectedSapClient && sapClient !== String(expectedSapClient).trim())) {
    throw preflightError('Resolved S/4 destination has no SAP client or does not match the configured expected client.', {
      status: 503,
      code: 'GI261_DESTINATION_CLIENT_MISMATCH'
    });
  }
  if (!String(destination.authentication || '').trim()) {
    throw preflightError('Resolved S/4 destination has no declared authentication mode.', {
      status: 503,
      code: 'GI261_DESTINATION_AUTH_UNVERIFIED'
    });
  }

  // Keep the exact service path: HTTP 404/501/403 and all other failures are surfaced; no fallback.
  const metadata = await client.getText(METADATA_PATH);
  assertMaterialDocumentMetadata(metadata);

  try {
    // This is the same documented, read-only table/field path used by strict material-document
    // read-back. The impossible document key limits returned data while proving table authorization.
    await rfc.readTable(READBACK_TABLE, ['MBLNR', 'MJAHR', 'BWART'], ["MBLNR = '0000000000'"], 1);
  } catch (cause) {
    throw preflightError('Read-only RFC access to the MATDOC verification path failed; 261 posting is blocked.', {
      status: 503,
      code: 'GI261_READBACK_RFC_UNAVAILABLE',
      cause
    });
  }

  return {
    ready: true,
    movementType: '261',
    service: 'API_MATERIAL_DOCUMENT_SRV',
    sapClient,
    createEntitySet: 'A_MaterialDocumentHeader',
    readbackTable: READBACK_TABLE
  };
}

module.exports = {
  METADATA_PATH,
  READBACK_TABLE,
  assert261Request,
  assertMaterialDocumentMetadata,
  assert261CapabilityReady
};
