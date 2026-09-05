const { extractS4ErrorMessage, mapS4Error } = require('../../srv/integration/s4hana/S4ErrorMapper');
const s4Errors = require('../fixtures/s4ErrorResponses.json');

describe('Unit: Error Mapping', () => {

    describe('extractS4ErrorMessage', () => {
        it('should extract message from innererror.errordetails array', () => {
            const mockError = {
                response: {
                    data: s4Errors.addressIncompleteError
                }
            };

            const result = extractS4ErrorMessage(mockError);
            expect(result).toBe('Address is incomplete. Please enter country/region.; Enter Plant');
        });

        it('should extract simple OData error.message.value', () => {
            const mockError = {
                response: {
                    data: s4Errors.simpleError
                }
            };

            const result = extractS4ErrorMessage(mockError);
            expect(result).toBe('Supplier 10300001 is blocked for purchasing organization 1010');
        });

        it('should parse JSON embedded in error.message string', () => {
            const embeddedJson = JSON.stringify(s4Errors.addressIncompleteError);
            const mockError = new Error(`Request failed with status code 400: ${embeddedJson}`);

            const result = extractS4ErrorMessage(mockError);
            expect(result).toBe('Address is incomplete. Please enter country/region.; Enter Plant');
        });

        it('should fall back to standard error.message when no OData format is present', () => {
            const standardError = new Error('Network timeout connecting to Gateway');
            expect(extractS4ErrorMessage(standardError)).toBe('Network timeout connecting to Gateway');
        });

        it('should handle null or undefined error gracefully', () => {
            expect(extractS4ErrorMessage(null)).toBe('Unknown error occurred during S/4HANA operation');
            expect(extractS4ErrorMessage(undefined)).toBe('Unknown error occurred during S/4HANA operation');
        });
    });

    describe('mapS4Error (Semantic HTTP Status Code Classification)', () => {
        it('should map SAP business validation errors to HTTP 422 Unprocessable Entity', () => {
            const validationError = {
                response: {
                    status: 400,
                    data: s4Errors.addressIncompleteError
                }
            };
            const mapped = mapS4Error(validationError);
            expect(mapped.status).toBe(422);
            expect(mapped.message).toContain('Address is incomplete');
            expect(mapped.code).toBe('AM/216');
        });

        it('should map blocked supplier or plant validation to HTTP 422', () => {
            const supplierError = {
                response: {
                    status: 400,
                    data: s4Errors.simpleError
                }
            };
            const mapped = mapS4Error(supplierError);
            expect(mapped.status).toBe(422);
            expect(mapped.message).toContain('Supplier 10300001 is blocked');
        });

        it('should map authentication failures to HTTP 401 Unauthorized', () => {
            const authError = {
                response: {
                    status: 401,
                    data: { error: { message: { value: 'Authentication failed for destination user' } } }
                }
            };
            const mapped = mapS4Error(authError);
            expect(mapped.status).toBe(401);
            expect(mapped.message).toContain('Authentication failed');
        });

        it('should map authorization failures to HTTP 403 Forbidden', () => {
            const authzError = {
                response: {
                    status: 403,
                    data: {
                        error: {
                            code: '/IWBEP/CX_MGW_NOT_AUTHORIZED',
                            message: { value: 'No authorization to create purchase orders' }
                        }
                    }
                }
            };
            const mapped = mapS4Error(authzError);
            expect(mapped.status).toBe(403);
            expect(mapped.message).toContain('No authorization');
        });

        it('should map missing resource errors to HTTP 404 Not Found', () => {
            const notFoundError = {
                response: {
                    status: 404,
                    data: { error: { message: { value: 'Material TG11 does not exist in system' } } }
                }
            };
            const mapped = mapS4Error(notFoundError);
            expect(mapped.status).toBe(404);
        });

        it('should map locking and enqueue conflicts to HTTP 409 Conflict', () => {
            const lockError = {
                response: {
                    status: 409,
                    data: { error: { message: { value: 'Purchasing document is locked by user CB9980000001' } } }
                }
            };
            const mapped = mapS4Error(lockError);
            expect(mapped.status).toBe(409);
        });

        it('should map network disconnects and connection refused to HTTP 503 Service Unavailable', () => {
            const connError = new Error('connect ECONNREFUSED 10.0.0.1:443');
            connError.code = 'ECONNREFUSED';

            const mapped = mapS4Error(connError);
            expect(mapped.status).toBe(503);
            expect(mapped.message).toContain('ECONNREFUSED');
        });

        it('should map bad gateway and timeout errors to HTTP 502 Bad Gateway', () => {
            const gatewayError = {
                response: {
                    status: 502,
                    data: { error: { message: { value: 'Gateway Timeout' } } }
                }
            };
            const mapped = mapS4Error(gatewayError);
            expect(mapped.status).toBe(502);
        });

        it('should map generic syntax bad requests without business codes to HTTP 400', () => {
            const badReqError = {
                response: {
                    status: 400,
                    data: { error: { message: { value: 'Bad Request: malformed JSON payload' } } }
                }
            };
            const mapped = mapS4Error(badReqError);
            expect(mapped.status).toBe(400);
        });

        it('should fall back to HTTP 500 for unexpected technical crashes or null inputs', () => {
            const techError = new Error('Unexpected null pointer exception');
            const mapped = mapS4Error(techError);
            expect(mapped.status).toBe(500);

            const nullMapped = mapS4Error(null);
            expect(nullMapped.status).toBe(500);
            expect(nullMapped.message).toContain('Unknown error');
        });
    });

});
