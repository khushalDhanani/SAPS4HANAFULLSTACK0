const { extractS4ErrorMessage } = require('../../srv/integration/s4hana/PurchaseOrderErrorMapper');
const s4Errors = require('../fixtures/s4ErrorResponses.json');

describe('Unit: Error Mapping', () => {

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
