'use strict';

const {
  LOCAL_CREDENTIAL_SOURCES,
  stripTrailingSlashes,
  originOf,
  extractUserJwt,
} = require('./S4HttpUtils');
const { S4HttpError, DESTINATION_NOT_CONFIGURED, DESTINATION_LOOKUP_FAILED } = require('./S4HttpErrors');
const LOG = require('../../common/logger')('s4-client');

/**
 * Resolves the S/4HANA destination (see resolution order in S4HttpClient).
 * Passes userJwt to support Principal Propagation destinations.
 *
 * In production only the BTP destination counts: a failed lookup is an error (DESTINATION_LOOKUP_FAILED,
 * 503) and local Basic credentials are never substituted, so the caller's identity cannot be swapped for
 * a shared technical user. Outside production a failed lookup is logged and local configuration is used.
 *
 * @param {object} client - S4HttpClient instance
 * @param {object} [options]
 * @returns {Promise<object|null>} Cloud SDK destination, or null when nothing is configured
 * @throws {S4HttpError} DESTINATION_LOOKUP_FAILED in production when the lookup itself fails
 */
async function resolveDestination(client, options = {}) {
  if (options.destination) return options.destination;

  const userJwt = extractUserJwt(options);

  const env = client._env;
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';

  try {
    const dest = client.destinationName ? await client._getDestination({
      destinationName: client.destinationName,
      ...(userJwt ? { userJwt } : {}),
    }) : null;
    if (dest && dest.url) return dest;
  } catch (err) {
    if (isProduction) {
      LOG.error(`Lookup of S/4HANA destination '${client.destinationName}' failed: ${err.message}`);
      throw new S4HttpError(`S/4HANA destination '${client.destinationName}' could not be looked up; the request was not sent to SAP.`, {
        status: 503,
        code: DESTINATION_LOOKUP_FAILED,
        cause: err,
      });
    }
    // Local development without a Destination service binding: use local configuration.
    LOG.warn(`Lookup of S/4HANA destination '${client.destinationName}' failed (${err.message}); using local configuration.`);
  }
  if (isProduction) return null;

  if (env.S4_DESTINATION_URL) {
    return {
      url: stripTrailingSlashes(env.S4_DESTINATION_URL),
      username: env.S4_USERNAME,
      password: env.S4_PASSWORD,
      authentication: 'BasicAuthentication',
      ...(env.S4_CLIENT ? { sapClient: String(env.S4_CLIENT) } : {}),
    };
  }

  const requires = client._cdsRequires() || {};
  for (const name of LOCAL_CREDENTIAL_SOURCES) {
    const creds = requires[name]?.credentials;
    if (creds && creds.url) {
      const sapClient = creds.headers?.['sap-client'] || creds.client;
      return {
        url: originOf(creds.url),
        username: creds.username,
        password: creds.password,
        authentication: 'BasicAuthentication',
        ...(sapClient ? { sapClient: String(sapClient) } : {}),
      };
    }
  }

  return null;
}

/**
 * Resolves destination or throws S4HttpError if unconfigured.
 *
 * @param {object} client - S4HttpClient instance
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function requireDestination(client, options = {}) {
  const dest = await resolveDestination(client, options);
  if (!dest) {
    throw new S4HttpError('S/4HANA Destination could not be resolved or is not configured', {
      status: 502,
      code: DESTINATION_NOT_CONFIGURED,
    });
  }
  return dest;
}

module.exports = {
  resolveDestination,
  requireDestination,
};
