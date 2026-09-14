const cds = require('@sap/cds');
const cdsTest = cds.test(__dirname + '/../../');
const { GET, axios } = cdsTest;

/**
 * Cloud Foundry readiness check (mta.yaml: readiness-health-check-http-endpoint: /health).
 * The platform calls this endpoint without credentials and expects HTTP 200.
 */
describe('Integration: /health readiness endpoint', () => {

    it('should answer GET /health with 200 and status UP without authentication', async () => {
        const { status, data, headers } = await GET('/health');

        expect(status).toBe(200);
        expect(data).toEqual({ status: 'UP' });
        expect(headers['cache-control']).toBe('no-store');
    });

    it('should not redirect or challenge for credentials', async () => {
        const response = await axios.get('/health', {
            maxRedirects: 0,
            validateStatus: () => true
        });

        expect(response.status).toBe(200);
        expect(response.headers['www-authenticate']).toBeUndefined();
    });

});
