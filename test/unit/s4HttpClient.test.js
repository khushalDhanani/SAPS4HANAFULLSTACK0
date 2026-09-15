const {
    S4HttpClient,
    S4HttpError,
    serviceRootOf,
    joinQuery,
    DESTINATION_NOT_CONFIGURED
} = require('../../srv/integration/s4hana/S4HttpClient');
const { loadLocalEnv, parseEnvFile } = require('../../srv/integration/s4hana/localEnv');

/** Builds an axios-style error the way the Cloud SDK surfaces failed responses. */
function axiosError(status, data, headers = {}) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, data, headers };
    return err;
}

/** The SDK sometimes wraps the axios error (ErrorWithCause); the client must look through it. */
function wrappedSdkError(status, data) {
    const outer = new Error('HTTP request to S/4HANA failed');
    outer.cause = axiosError(status, data);
    return outer;
}

const DEST = { url: 'https://s4.example.corp:44300', username: 'tech', password: 'secret', authentication: 'BasicAuthentication', sapClient: '220' };

function makeClient(overrides = {}) {
    const executeHttpRequest = overrides.executeHttpRequest || jest.fn();
    const getDestination = overrides.getDestination || jest.fn().mockResolvedValue(DEST);
    const client = new S4HttpClient({
        getDestination,
        executeHttpRequest,
        env: overrides.env || {},
        cdsRequires: overrides.cdsRequires || (() => ({}))
    });
    return { client, executeHttpRequest, getDestination };
}

describe('Unit: S4HttpClient (shared SAP Cloud SDK client for S/4HANA)', () => {

    describe('helpers', () => {
        it('derives the OData V2 service root for sap and scwm namespaces', () => {
            expect(serviceRootOf('/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/PostGoodsReceipt?InboundDelivery=\'1\''))
                .toBe('/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/');
            expect(serviceRootOf('/sap/opu/odata/scwm/PICKCART_SRV/WarehouseTaskSet'))
                .toBe('/sap/opu/odata/scwm/PICKCART_SRV/');
        });

        it('derives the OData V4 service root', () => {
            expect(serviceRootOf('/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001/GIItem(ReservationNo=\'1\')/ns.postGoodsIssue'))
                .toBe('/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001/');
        });

        it('joins query strings regardless of leading ? or & and existing queries', () => {
            expect(joinQuery('/a', '$top=1')).toBe('/a?$top=1');
            expect(joinQuery('/a', '?$top=1')).toBe('/a?$top=1');
            expect(joinQuery('/a?x=1', '$top=1')).toBe('/a?x=1&$top=1');
            expect(joinQuery('/a', '')).toBe('/a');
        });

        it('parses dotenv content and loads it without overriding existing values', () => {
            expect(parseEnvFile('# c\nA=1\nB="two words"\n\nC=\'x\'\nBAD')).toEqual([['A', '1'], ['B', 'two words'], ['C', 'x']]);
            const env = { A: 'keep', NODE_ENV: 'test' };
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4env-'));
            fs.writeFileSync(path.join(dir, '.env.local'), 'A=override\nB=fromLocal\n');
            fs.writeFileSync(path.join(dir, '.env'), 'B=fromEnv\nC=fromEnv\n');
            expect(loadLocalEnv({ root: dir, env })).toBe(true);
            expect(env).toEqual({ A: 'keep', B: 'fromLocal', C: 'fromEnv', NODE_ENV: 'test' });
            expect(loadLocalEnv({ root: dir, env: { NODE_ENV: 'production' } })).toBe(false);
        });
    });

    describe('resolveDestination', () => {
        it('prefers the destination returned by the SDK (BTP Destination service or registered destination)', async () => {
            const { client, getDestination } = makeClient({ env: { S4_DESTINATION_URL: 'https://ignored' } });
            await expect(client.resolveDestination()).resolves.toBe(DEST);
            expect(getDestination).toHaveBeenCalledWith({ destinationName: 'S4HANA_PO_API' });
        });

        it('honours S4_DESTINATION_NAME', async () => {
            const { client, getDestination } = makeClient({ env: { S4_DESTINATION_NAME: 'S4_QA' } });
            await client.resolveDestination();
            expect(getDestination).toHaveBeenCalledWith({ destinationName: 'S4_QA' });
        });

        it('falls back to S4_DESTINATION_URL credentials when the SDK has no destination', async () => {
            const { client } = makeClient({
                getDestination: jest.fn().mockRejectedValue(new Error('no destination service binding')),
                env: { S4_DESTINATION_URL: 'https://s4.example.corp:44300///', S4_USERNAME: 'u', S4_PASSWORD: 'p', S4_CLIENT: '220' }
            });
            await expect(client.resolveDestination()).resolves.toEqual({
                url: 'https://s4.example.corp:44300',
                username: 'u',
                password: 'p',
                authentication: 'BasicAuthentication',
                sapClient: '220'
            });
        });

        it('falls back to configured remote-service credentials using only their origin', async () => {
            const { client } = makeClient({
                getDestination: jest.fn().mockResolvedValue(null),
                cdsRequires: () => ({
                    MM_PUR_PO_MAINT_V2_SRV: { credentials: { url: 'https://host:44300/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV', username: 'a', password: 'b', headers: { 'sap-client': '220' } } }
                })
            });
            await expect(client.resolveDestination()).resolves.toEqual({
                url: 'https://host:44300',
                username: 'a',
                password: 'b',
                authentication: 'BasicAuthentication',
                sapClient: '220'
            });
        });

        it('returns null when nothing is configured', async () => {
            const { client } = makeClient({ getDestination: jest.fn().mockResolvedValue(undefined) });
            await expect(client.resolveDestination()).resolves.toBeNull();
        });
    });

    describe('get', () => {
        it('sends the request through the SDK with Accept, sap-client and the joined query, and disables SDK-side CSRF handling', async () => {
            const executeHttpRequest = jest.fn().mockResolvedValue({ status: 200, data: { d: { results: [{ Batch: 'B1' }] } }, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            const res = await client.get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch', { query: "$filter=Batch eq 'B1'&$top=1" });

            expect(res.data.d.results).toHaveLength(1);
            expect(executeHttpRequest).toHaveBeenCalledTimes(1);
            const [dest, config, options] = executeHttpRequest.mock.calls[0];
            expect(dest).toBe(DEST);
            expect(config).toEqual({
                method: 'get',
                url: "/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch?$filter=Batch eq 'B1'&$top=1",
                headers: { Accept: 'application/json', 'sap-client': '220' }
            });
            expect(options).toEqual({ fetchCsrfToken: false });
        });

        it('returns $metadata as text', async () => {
            const executeHttpRequest = jest.fn().mockResolvedValue({ status: 200, data: '<edmx:Edmx/>', headers: {} });
            const { client } = makeClient({ executeHttpRequest });
            await expect(client.getText('/sap/opu/odata/scwm/SIMPLE_INB_DLV_SRV/$metadata', { accept: 'application/xml' })).resolves.toBe('<edmx:Edmx/>');
            expect(executeHttpRequest.mock.calls[0][1]).toMatchObject({ method: 'get', responseType: 'text', headers: { Accept: 'application/xml' } });
        });

        it('normalises a wrapped SDK failure into an S4HttpError with status, SAP code, message and response', async () => {
            const body = { error: { code: '/IWBEP/CM_MGW_RT/026', message: { lang: 'en', value: 'Resource not found for segment I_Batch' } } };
            const executeHttpRequest = jest.fn().mockRejectedValue(wrappedSdkError(404, body));
            const { client } = makeClient({ executeHttpRequest });

            let caught;
            try { await client.get('/sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch'); } catch (e) { caught = e; }

            expect(caught).toBeInstanceOf(S4HttpError);
            expect(caught.status).toBe(404);
            expect(caught.statusCode).toBe(404);
            expect(caught.code).toBe('/IWBEP/CM_MGW_RT/026');
            expect(caught.message).toBe('S/4HANA GET /sap/opu/odata/sap/LO_BM_BATCH_SRV/I_Batch failed: HTTP 404 - Resource not found for segment I_Batch');
            expect(caught.response).toEqual({ status: 404, data: body, headers: {} });
        });

        it('maps a network failure to status 502 and keeps the underlying error code', async () => {
            const netErr = new Error('connect ECONNREFUSED');
            netErr.code = 'ECONNREFUSED';
            const { client } = makeClient({ executeHttpRequest: jest.fn().mockRejectedValue(netErr) });

            await expect(client.get('/sap/opu/odata/sap/X/Y')).rejects.toMatchObject({
                name: 'S4HttpError', status: 502, code: 'ECONNREFUSED', response: null
            });
        });

        it('fails with 502 and a dedicated code when no destination can be resolved', async () => {
            const executeHttpRequest = jest.fn();
            const { client } = makeClient({ executeHttpRequest, getDestination: jest.fn().mockResolvedValue(null) });

            await expect(client.get('/sap/opu/odata/sap/X/Y')).rejects.toMatchObject({ status: 502, code: DESTINATION_NOT_CONFIGURED });
            expect(executeHttpRequest).not.toHaveBeenCalled();
        });
    });

    describe('post', () => {
        const csrfResponse = {
            status: 200,
            data: {},
            headers: {
                'x-csrf-token': 'TOKEN-1',
                'set-cookie': ['SAP_SESSIONID_DS4_220=abc; path=/', 'sap-usercontext=sap-client=220; path=/']
            }
        };

        it('fetches the CSRF token and session cookies from the service root, then posts them with the payload and custom headers', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockResolvedValueOnce({ status: 201, data: { d: { MaterialDocument: '4900000001' } }, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            const res = await client.post("/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/PostGoodsReceipt?InboundDelivery='180000001'", {
                data: {},
                headers: { 'If-Match': '*' }
            });

            expect(res.data.d.MaterialDocument).toBe('4900000001');
            expect(executeHttpRequest).toHaveBeenCalledTimes(2);

            const [, probe, probeOptions] = executeHttpRequest.mock.calls[0];
            expect(probe).toEqual({
                method: 'get',
                url: '/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/',
                headers: { 'x-csrf-token': 'Fetch', Accept: 'application/json', 'sap-client': '220' }
            });
            expect(probeOptions).toEqual({ fetchCsrfToken: false });

            const [, postConfig, postOptions] = executeHttpRequest.mock.calls[1];
            expect(postConfig).toEqual({
                method: 'post',
                url: "/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/PostGoodsReceipt?InboundDelivery='180000001'",
                data: {},
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'sap-client': '220',
                    'x-csrf-token': 'TOKEN-1',
                    Cookie: 'SAP_SESSIONID_DS4_220=abc; sap-usercontext=sap-client=220',
                    'If-Match': '*'
                }
            });
            expect(postOptions).toEqual({ fetchCsrfToken: false });
        });

        it('uses an explicit csrfPath when the caller provides one', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockResolvedValueOnce({ status: 200, data: {}, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            await client.post('/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001/GIItem/ns.postGoodsIssue', {
                data: { IssueQty: 1 },
                csrfPath: '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1'
            });

            expect(executeHttpRequest.mock.calls[0][1].url).toBe('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1');
            expect(executeHttpRequest.mock.calls[1][1].data).toEqual({ IssueQty: 1 });
        });

        it('continues without a token when the CSRF probe fails, so SAP reports the real outcome of the POST', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const executeHttpRequest = jest.fn()
                .mockRejectedValueOnce(wrappedSdkError(403, 'Forbidden'))
                .mockRejectedValueOnce(wrappedSdkError(403, { error: { code: 'CSRF', message: { value: 'CSRF token validation failed' } } }));
            const { client } = makeClient({ executeHttpRequest });

            await expect(client.post('/sap/opu/odata/sap/API_X_SRV/Set', { data: { a: 1 } })).rejects.toMatchObject({
                status: 403, code: 'CSRF', message: expect.stringContaining('CSRF token validation failed')
            });
            expect(executeHttpRequest.mock.calls[1][1].headers['x-csrf-token']).toBeUndefined();
            expect(warn).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        });

        it('never keeps a token or cookie on the client between calls', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockResolvedValueOnce({ status: 200, data: {}, headers: {} })
                .mockResolvedValueOnce({ status: 200, data: {}, headers: { 'x-csrf-token': 'TOKEN-2', 'set-cookie': ['SAP_SESSIONID_DS4_220=xyz; path=/'] } })
                .mockResolvedValueOnce({ status: 200, data: {}, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            await client.post('/sap/opu/odata/sap/API_X_SRV/Set', { data: {} });
            await client.post('/sap/opu/odata/sap/API_X_SRV/Set', { data: {} });

            expect(executeHttpRequest.mock.calls[1][1].headers).toMatchObject({ 'x-csrf-token': 'TOKEN-1', Cookie: 'SAP_SESSIONID_DS4_220=abc; sap-usercontext=sap-client=220' });
            expect(executeHttpRequest.mock.calls[3][1].headers).toMatchObject({ 'x-csrf-token': 'TOKEN-2', Cookie: 'SAP_SESSIONID_DS4_220=xyz' });
            expect(Object.keys(client)).not.toEqual(expect.arrayContaining(['cookie', 'csrfToken', '_csrfToken']));
        });
    });
});
