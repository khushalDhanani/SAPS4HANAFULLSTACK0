const authAdapter = require('../../srv/integration/s4hana/AuthAdapter');
const connectivity = require('@sap-cloud-sdk/connectivity');

describe('Unit: AuthAdapter (S/4HANA Credential Validation)', () => {
    const originalEnvUrl = process.env.S4_DESTINATION_URL;
    const originalEnvClient = process.env.S4_CLIENT;

    afterEach(() => {
        if (originalEnvUrl !== undefined) {
            process.env.S4_DESTINATION_URL = originalEnvUrl;
        } else {
            delete process.env.S4_DESTINATION_URL;
        }
        if (originalEnvClient !== undefined) {
            process.env.S4_CLIENT = originalEnvClient;
        } else {
            delete process.env.S4_CLIENT;
        }
        jest.restoreAllMocks();
    });

    describe('validateCredentials', () => {
        it('should return error when username is missing or empty', async () => {
            const res1 = await authAdapter.validateCredentials('', 'secret');
            expect(res1.authenticated).toBe(false);
            expect(res1.statusCode).toBe(400);
            expect(res1.message).toContain('Username is required');

            const res2 = await authAdapter.validateCredentials(null, 'secret');
            expect(res2.authenticated).toBe(false);
            expect(res2.statusCode).toBe(400);
        });

        it('should return error when password is missing or empty', async () => {
            const res1 = await authAdapter.validateCredentials('CB9980000001', '');
            expect(res1.authenticated).toBe(false);
            expect(res1.statusCode).toBe(400);
            expect(res1.message).toContain('Password is required');

            const res2 = await authAdapter.validateCredentials('CB9980000001', null);
            expect(res2.authenticated).toBe(false);
            expect(res2.statusCode).toBe(400);
        });

        it('should return 500 if destination URL cannot be resolved', async () => {
            delete process.env.S4_DESTINATION_URL;
            jest.spyOn(authAdapter, 'resolveBaseUrl').mockResolvedValueOnce(null);

            const res = await authAdapter.validateCredentials('CB9980000001', 'secret');
            expect(res.authenticated).toBe(false);
            expect(res.statusCode).toBe(500);
            expect(res.message).toContain('S/4HANA system is not configured');
        });

        it('should return authenticated: true when S/4 Gateway returns 200 OK', async () => {
            const mockFetch = jest.fn().mockResolvedValueOnce({
                ok: true,
                status: 200
            });

            const res = await authAdapter.validateCredentials('cb9980000001', 'Welcome123!', {
                baseUrl: 'http://s4hana.example.corp:8000',
                client: '220',
                fetchFn: mockFetch
            });

            expect(res.authenticated).toBe(true);
            expect(res.statusCode).toBe(200);
            expect(res.system).toBe('PRD - Client 220');
            expect(res.client).toBe('220');
            expect(mockFetch).toHaveBeenCalledTimes(1);

            const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
            expect(calledUrl).toBe('http://s4hana.example.corp:8000/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$top=1&sap-client=220');
            expect(calledOptions.method).toBe('GET');
            expect(calledOptions.headers.Authorization).toBe('Basic ' + Buffer.from('cb9980000001:Welcome123!').toString('base64'));
        });

        it('should return 401 when S/4 Gateway rejects credentials', async () => {
            const mockFetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 401
            });

            const res = await authAdapter.validateCredentials('baduser', 'wrongpass', {
                baseUrl: 'http://s4hana.example.corp:8000',
                fetchFn: mockFetch
            });

            expect(res.authenticated).toBe(false);
            expect(res.statusCode).toBe(401);
            expect(res.message).toContain('Invalid username or password');
        });

        it('should return 403 when S/4 Gateway returns forbidden (e.g. SU01 locked)', async () => {
            const mockFetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 403
            });

            const res = await authAdapter.validateCredentials('lockeduser', 'pass', {
                baseUrl: 'http://s4hana.example.corp:8000',
                fetchFn: mockFetch
            });

            expect(res.authenticated).toBe(false);
            expect(res.statusCode).toBe(403);
            expect(res.message).toContain('Invalid username or password');
        });

        it('should handle network connection failures with 503 Service Unavailable', async () => {
            const mockFetch = jest.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const res = await authAdapter.validateCredentials('cb9980000001', 'pass', {
                baseUrl: 'http://s4hana.example.corp:8000',
                fetchFn: mockFetch
            });

            expect(res.authenticated).toBe(false);
            expect(res.statusCode).toBe(503);
            expect(res.message).toContain('Cannot connect to S/4HANA system');
        });

        it('should handle unexpected HTTP error status from Gateway', async () => {
            const mockFetch = jest.fn().mockResolvedValueOnce({
                ok: false,
                status: 502
            });

            const res = await authAdapter.validateCredentials('cb9980000001', 'pass', {
                baseUrl: 'http://s4hana.example.corp:8000',
                fetchFn: mockFetch
            });

            expect(res.authenticated).toBe(false);
            expect(res.statusCode).toBe(502);
            expect(res.message).toContain('unexpected response (HTTP 502)');
        });

        it('should execute catalog query via SAP Cloud SDK executeHttpRequest', async () => {
            const mockExecuteHttp = jest.fn().mockResolvedValueOnce({
                status: 200,
                data: { d: { results: [{ ServiceUrl: '/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV' }] } }
            });

            const res = await authAdapter.validateCredentials('cb9980000001', 'Welcome123!', {
                baseUrl: 'https://s4hana-btp.corp:44300',
                client: '100',
                executeHttpRequest: mockExecuteHttp
            });

            expect(res.authenticated).toBe(true);
            expect(res.statusCode).toBe(200);
            expect(res.system).toBe('PRD - Client 100');
            expect(mockExecuteHttp).toHaveBeenCalledTimes(1);

            const [calledDest, calledConfig] = mockExecuteHttp.mock.calls[0];
            expect(calledDest.url).toBe('https://s4hana-btp.corp:44300');
            expect(calledDest.username).toBe('cb9980000001');
            expect(calledDest.password).toBe('Welcome123!');
            expect(calledDest.authentication).toBe('BasicAuthentication');
            expect(calledConfig.method).toBe('get');
            expect(calledConfig.url).toContain('sap-client=100');
        });
    });

    describe('resolveBaseUrl & Destination Resolution', () => {
        it('should resolve base URL from process.env.S4_DESTINATION_URL and trim trailing slashes', async () => {
            process.env.S4_DESTINATION_URL = 'http://172.27.100.32:8000///';
            const url = await authAdapter.resolveBaseUrl();
            expect(url).toBe('http://172.27.100.32:8000');
        });

        it('should resolve base URL from BTP Destination Service when env is unset', async () => {
            delete process.env.S4_DESTINATION_URL;
            jest.spyOn(connectivity, 'getDestination').mockResolvedValueOnce({
                url: 'https://my-btp-destination.corp:443/'
            });

            const url = await authAdapter.resolveBaseUrl();
            expect(url).toBe('https://my-btp-destination.corp:443');
        });

        it('should prioritize BTP Destination Service over local environment variables', async () => {
            process.env.S4_DESTINATION_URL = 'http://local-env:8000';
            jest.spyOn(connectivity, 'getDestination').mockResolvedValueOnce({
                url: 'https://btp-managed-destination.corp:443/'
            });

            const url = await authAdapter.resolveBaseUrl();
            expect(url).toBe('https://btp-managed-destination.corp:443');
        });
    });
});
