const {
    S4HttpClient,
    S4HttpError,
    serviceRootOf,
    joinQuery,
    DESTINATION_NOT_CONFIGURED
} = require('../../srv/integration/s4hana/S4HttpClient');

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
        env: { S4_DESTINATION_NAME: 'S4HANA_PO_API', ...(overrides.env || {}) }, // the client has no built-in destination name any more
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
            expect(serviceRootOf('/sap/opu/odata4/sap/c_salesordermanage_srv/srvd/sap/c_salesordermanage_sd/0001/SalesOrder(\'1\')/ns.confirm'))
                .toBe('/sap/opu/odata4/sap/c_salesordermanage_srv/srvd/sap/c_salesordermanage_sd/0001/');
        });

        it('joins query strings regardless of leading ? or & and existing queries', () => {
            expect(joinQuery('/a', '$top=1')).toBe('/a?$top=1');
            expect(joinQuery('/a', '?$top=1')).toBe('/a?$top=1');
            expect(joinQuery('/a?x=1', '$top=1')).toBe('/a?x=1&$top=1');
            expect(joinQuery('/a', '')).toBe('/a');
        });
    });

    describe('resolveDestination', () => {
        it('prefers explicit options.destination override when provided', async () => {
            const { client, getDestination } = makeClient();
            const customDest = { url: 'https://custom.s4:44300' };
            await expect(client.resolveDestination({ destination: customDest })).resolves.toBe(customDest);
            expect(getDestination).not.toHaveBeenCalled();
        });
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
                timeout: 30000,
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
                timeout: 30000,
                headers: { 'x-csrf-token': 'Fetch', Accept: 'application/json, */*', 'sap-client': '220' }
            });
            expect(probeOptions).toEqual({ fetchCsrfToken: false });

            const [, postConfig, postOptions] = executeHttpRequest.mock.calls[1];
            expect(postConfig).toEqual({
                method: 'post',
                url: "/sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY/PostGoodsReceipt?InboundDelivery='180000001'",
                data: {},
                timeout: 30000,
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

        it('sanitizes incoming headers so client x-csrf-token, cookie, or authorization never overwrite S/4HANA session tokens', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockResolvedValueOnce({ status: 200, data: {}, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            await client.post('/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE/Action', {
                data: {},
                headers: {
                    'x-csrf-token': 'browser-stale-csrf',
                    cookie: 'browser-session=123',
                    authorization: 'Bearer user-token',
                    'x-custom-header': 'safe-val'
                }
            });

            const [, postConfig] = executeHttpRequest.mock.calls[1];
            expect(postConfig.headers['x-csrf-token']).toBe('TOKEN-1');
            expect(postConfig.headers.Cookie).toBe('SAP_SESSIONID_DS4_220=abc; sap-usercontext=sap-client=220');
            expect(postConfig.headers.authorization).toBeUndefined();
            expect(postConfig.headers['x-custom-header']).toBe('safe-val');
        });

        it('normalizes and propagates ifMatch or etag to If-Match header', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockResolvedValueOnce({ status: 200, data: {}, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            await client.post('/sap/opu/odata/sap/SD_CUSTOMER_INVOICES_MANAGE/Action', {
                data: {},
                ifMatch: 'W/"datetimeoffset\'2026-10-28T10%3A00%3A00Z\'"'
            });

            const [, postConfig] = executeHttpRequest.mock.calls[1];
            expect(postConfig.headers['If-Match']).toBe('W/"datetimeoffset\'2026-10-28T10%3A00%3A00Z\'"');
            expect(postConfig.headers['if-match']).toBeUndefined();
        });

        it('uses an explicit csrfPath when the caller provides one', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockResolvedValueOnce({ status: 200, data: {}, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            await client.post('/sap/opu/odata4/sap/c_salesordermanage_srv/srvd/sap/c_salesordermanage_sd/0001/SalesOrder/ns.confirm', {
                data: { IssueQty: 1 },
                csrfPath: '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1'
            });

            expect(executeHttpRequest.mock.calls[0][1].url).toBe('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1');
            expect(executeHttpRequest.mock.calls[1][1].data).toEqual({ IssueQty: 1 });
        });

        it('fails closed when the CSRF probe fails: the POST is not sent and SAP\'s own 4xx status is kept', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const executeHttpRequest = jest.fn().mockRejectedValueOnce(wrappedSdkError(403, 'Forbidden'));
            const { client } = makeClient({ executeHttpRequest });

            await expect(client.post('/sap/opu/odata/sap/API_X_SRV/Set', { data: { a: 1 } })).rejects.toMatchObject({
                status: 403, code: 'S4_CSRF_TOKEN_UNAVAILABLE', message: expect.stringContaining('NOT sent')
            });
            expect(executeHttpRequest).toHaveBeenCalledTimes(1); // the probe only
            expect(warn).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        });

        it.each([
            ['a timeout', () => Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })],
            ['a gateway 502', () => wrappedSdkError(502, 'Bad Gateway')],
            ['a refused connection', () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })]
        ])('reports %s on the CSRF probe as 503 "not sent", never as an unconfirmed write', async (_label, makeErr) => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const executeHttpRequest = jest.fn().mockRejectedValueOnce(makeErr());
            const { client } = makeClient({ executeHttpRequest });

            const err = await client.post('/sap/opu/odata/sap/API_X_SRV/Set', { data: {} }).catch((e) => e);

            expect(err).toMatchObject({ status: 503, code: 'S4_CSRF_TOKEN_UNAVAILABLE' });
            expect(err.code).not.toBe('SAP_WRITE_NOT_CONFIRMED');
            expect(executeHttpRequest).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        });

        it('uses a token that SAP returns on an error answer of the probe', async () => {
            const probeError = wrappedSdkError(404, 'Not Found');
            probeError.cause.response.headers = { 'x-csrf-token': 'TOKEN-ON-ERROR' };
            const executeHttpRequest = jest.fn().mockRejectedValueOnce(probeError).mockResolvedValueOnce({ status: 201, data: {}, headers: {} });
            const { client } = makeClient({ executeHttpRequest });

            await client.post('/sap/opu/odata/sap/API_X_SRV/Set', { data: {} });

            expect(executeHttpRequest.mock.calls[1][1].headers['x-csrf-token']).toBe('TOKEN-ON-ERROR');
        });

        it('never re-sends a write: one failed POST is one request to SAP', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockRejectedValueOnce(wrappedSdkError(503, 'Service Unavailable'));
            const { client } = makeClient({ executeHttpRequest });

            await expect(client.post('/sap/opu/odata/sap/API_X_SRV/Set', { data: {} })).rejects.toBeDefined();

            expect(executeHttpRequest.mock.calls.filter(([, config]) => config.method === 'post')).toHaveLength(1);
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

        it('propagates caller userJwt to getDestination and executeHttpRequest for principal propagation', async () => {
            const executeHttpRequest = jest.fn()
                .mockResolvedValueOnce(csrfResponse)
                .mockResolvedValueOnce({ status: 200, data: { ok: true }, headers: {} });
            const getDestination = jest.fn().mockResolvedValue(DEST);
            const { client } = makeClient({ executeHttpRequest, getDestination });

            await client.post('/sap/opu/odata/sap/API_X_SRV/Set', {
                data: { test: 1 },
                userJwt: 'caller.jwt.token'
            });

            expect(getDestination).toHaveBeenCalledWith({
                destinationName: 'S4HANA_PO_API',
                userJwt: 'caller.jwt.token'
            });
            expect(executeHttpRequest.mock.calls[0][2]).toMatchObject({
                fetchCsrfToken: false,
                userJwt: 'caller.jwt.token'
            });
            expect(executeHttpRequest.mock.calls[1][2]).toMatchObject({
                fetchCsrfToken: false,
                userJwt: 'caller.jwt.token'
            });
        });
    });

    describe('request timeout', () => {
        afterEach(() => { delete process.env.S4_HTTP_TIMEOUT_MS; });

        test('defaults to 30000 ms and honours S4_HTTP_TIMEOUT_MS', () => {
            delete process.env.S4_HTTP_TIMEOUT_MS;
            expect(S4HttpClient.requestTimeoutMs()).toBe(30000);
            process.env.S4_HTTP_TIMEOUT_MS = '5000';
            expect(S4HttpClient.requestTimeoutMs()).toBe(5000);
            process.env.S4_HTTP_TIMEOUT_MS = 'abc';
            expect(S4HttpClient.requestTimeoutMs()).toBe(30000);
        });
    });
});

describe('unansweredWrite', () => {
  const { unansweredWrite } = require('../../srv/integration/s4hana/S4HttpClient');
  const coded = (code) => Object.assign(new Error('x'), { code });
  const answered = (status) => Object.assign(new Error('x'), { response: { status } });

  it.each([
    ['a timeout', coded('ECONNABORTED')],
    ['ETIMEDOUT', coded('ETIMEDOUT')],
    ['a reset', coded('ECONNRESET')],
    ['an error with no code', new Error('socket hang up')],
    ['a gateway 502', answered(502)],
    ['a gateway 504', answered(504)],
    ['a code wrapped by the Cloud SDK', Object.assign(new Error('x'), { cause: coded('ECONNABORTED') })],
    ['a response wrapped by the Cloud SDK', Object.assign(new Error('x'), { cause: answered(504) })]
  ])('reports %s as not confirmed', (_name, err) => {
    expect(unansweredWrite(err)).toMatchObject({ status: 504, code: 'SAP_WRITE_NOT_CONFIRMED', $sanitize: false, cause: err });
  });

  it.each([
    ['ECONNREFUSED', coded('ECONNREFUSED')],
    ['ENOTFOUND', coded('ENOTFOUND')],
    ['EAI_AGAIN', coded('EAI_AGAIN')],
    ['EHOSTUNREACH', coded('EHOSTUNREACH')],
    ['ENETUNREACH', coded('ENETUNREACH')],
    ['SAP refusing with 400', answered(400)],
    ['SAP answering 500', answered(500)],
    ['SAP answering 503', answered(503)]
  ])('does not report %s, which proves SAP did not save it or answered', (_name, err) => {
    expect(unansweredWrite(err)).toBeNull();
  });
});
