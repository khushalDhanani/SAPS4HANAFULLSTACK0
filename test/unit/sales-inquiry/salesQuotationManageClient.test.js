const {
    SalesQuotationManageClient,
    OUTCOME,
    buildHeaderChanges,
    SERVICE_PATH,
    NAMESPACE
} = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesQuotationManageClient');

const DESTINATION = { url: 'http://s4', username: 'QTN_TECH', headers: { 'sap-client': '220' } };
const CONTEXT_ID = 'SID:ANON:vheudds4ap01_DS4_00:ctx-1';
const CREATE_URL = `${SERVICE_PATH}/SalesQuotationManage/${NAMESPACE}.CreateWithRefFromSlsInquiry`;
const NEW_KEY_URL = `${SERVICE_PATH}/SalesQuotationManage(SalesQuotation='')`;
const SAVE_URL = `${NEW_KEY_URL}/${NAMESPACE}.SaveChanges`;

/** Rejects the way axios / the SAP Cloud SDK does for a non-2xx response. */
function httpError(status, data) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status, headers: {}, data };
    return err;
}
const odataError = (status, code, message) => httpError(status, { error: { code, message } });
const sessionNotFound = () => httpError(400, '<html><title>Service cannot be reached</title> 400 Session not found </html>');
const networkError = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

/** Scripted SAP: answers requests in order and records what was sent. */
function fakeSap(responders) {
    const calls = [];
    const execute = jest.fn(async (destination, request, options) => {
        calls.push({ destination, request, options });
        const responder = responders[calls.length - 1];
        if (!responder) throw new Error(`unexpected request ${request.method} ${request.url}`);
        return responder(request);
    });
    return { execute, calls };
}

const csrfOk = () => ({ status: 200, headers: { 'x-csrf-token': 'TOKEN-1', 'set-cookie': ['sap-usercontext=sap-client=220; path=/', 'sap-XSRF_DS4_220=xsrf1; path=/sap/opu/odata4/'] }, data: {} });
const createdOk = () => ({ status: 201, headers: { 'sap-contextid': CONTEXT_ID }, data: { SalesQuotation: '', '@odata.etag': 'W/"created"' } });
const sessionCheckOk = () => ({ status: 200, headers: {}, data: { SalesQuotation: '', '@odata.etag': 'W/"checked"' } });
const CHECK_URL = `${SERVICE_PATH}/SalesQuotationManage(SalesQuotation='')?$select=SalesQuotation`;
const patchedOk = () => ({ status: 200, headers: {}, data: { SalesQuotation: '', '@odata.etag': 'W/"after-patch"' } });
const savedOk = (number = '0020000512') => () => ({ status: 200, headers: {}, data: { SalesQuotation: number } });
const readBackOk = (number = '0020000512') => () => ({ status: 200, headers: {}, data: { SalesQuotation: number, SalesQuotationType: 'ZQT' } });
const discardOk = () => ({ status: 204, headers: {}, data: '' });

const client = (execute) => new SalesQuotationManageClient({ destination: DESTINATION, executeHttpRequest: execute });
const run = (execute, overrides = {}) => client(execute).createFromInquiry({
    salesInquiry: '1000536', salesQuotationType: 'ZQT', header: { BindingPeriodValidityEndDate: '2026-10-14', PurchaseOrderByCustomer: 'PO-77' }, ...overrides
});

beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('Unit: SalesQuotationManageClient - successful flow', () => {
    test('(9, 10) SaveChanges success returns the SAP number only after reading the quotation back from SAP', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);

        await expect(run(execute)).resolves.toEqual({ SalesQuotation: '0020000512', verified: true });

        expect(calls.map(c => `${c.request.method} ${c.request.url}`)).toEqual([
            `get ${SERVICE_PATH}/`,
            `post ${CREATE_URL}`,
            `get ${CHECK_URL}`,
            `patch ${NEW_KEY_URL}`,
            `post ${SAVE_URL}`,
            `get ${SERVICE_PATH}/SalesQuotationManage('0020000512')?$select=SalesQuotation,SalesQuotationType,SoldToParty`
        ]);
        // The read-back is stateless: it must not join the (already saved) sticky session.
        expect(calls[5].request.headers['SAP-ContextId']).toBeUndefined();
        expect(calls[5].request.httpAgent).not.toBe(calls[4].request.httpAgent);
    });

    test('(5) SAP-ContextId is requested on create and sent unchanged on every later session request', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute);
        const [csrf, create, check, patch, save] = calls.map(c => c.request.headers);

        expect(csrf['SAP-ContextId']).toBeUndefined();
        expect(create['SAP-ContextId-Accept']).toBe('header');
        expect(create['SAP-ContextId']).toBeUndefined();
        expect(check['SAP-ContextId']).toBe(CONTEXT_ID);
        expect(patch['SAP-ContextId']).toBe(CONTEXT_ID);
        expect(save['SAP-ContextId']).toBe(CONTEXT_ID);
    });

    test('(6) cookies returned by SAP are combined into one Cookie header on later requests', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute);
        const expected = 'sap-usercontext=sap-client=220; sap-XSRF_DS4_220=xsrf1';
        [1, 2, 3, 4].forEach(i => expect(calls[i].request.headers.Cookie).toBe(expected));
    });

    test('(7) the CSRF token is fetched once and sent on create, PATCH and SaveChanges', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute);
        expect(calls[0].request.headers['x-csrf-token']).toBe('Fetch');
        [1, 3, 4].forEach(i => expect(calls[i].request.headers['x-csrf-token']).toBe('TOKEN-1'));
        calls.forEach(c => expect(c.options).toEqual({ fetchCsrfToken: false }));
    });

    test('(8) PATCH uses the latest ETag (from the session check); SaveChanges uses the ETag from PATCH', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute);
        expect(calls[3].request.headers['If-Match']).toBe('W/"checked"');
        expect(calls[4].request.headers['If-Match']).toBe('W/"after-patch"');
    });

    test('only verified header fields are changed; no business values are invented', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute, { header: { BindingPeriodValidityEndDate: '2026-10-14', Plant: '1120', ContactPerson: '24789' } });
        expect(calls[3].request.data).toEqual({ BindingPeriodValidityEndDate: '2026-10-14' });
    });

    test('without header values there is no PATCH', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, savedOk(), readBackOk()]);
        await run(execute, { header: {} });
        expect(calls.some(c => c.request.method === 'patch')).toBe(false);
    });

    test('one dedicated single-socket agent per session, no redirects, no $batch', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute);
        const sessionCalls = calls.slice(0, 5);
        sessionCalls.forEach(c => {
            expect(c.request.httpAgent).toBe(sessionCalls[0].request.httpAgent);
            expect(c.request.httpAgent.maxSockets).toBe(1);
        });
        calls.forEach(c => {
            expect(c.request.maxRedirects).toBe(0);
            expect(c.request.url).not.toContain('$batch');
        });
    });
});

describe('Unit: SalesQuotationManageClient - business errors', () => {
    test('(2) SLS_LORD/166 shows the incompletion message and opens no session', async () => {
        const { execute, calls } = fakeSap([csrfOk, () => { throw odataError(400, 'SLS_LORD/166', 'Reference doc. 1000539 is incomplete and cannot be referenced'); }]);

        const err = await run(execute, { salesInquiry: '1000539' }).catch(e => e);

        expect(err.message).toBe('Inquiry 1000539 is incomplete in SAP and cannot be converted to a Sales Quotation. Complete the inquiry in VA22 before creating the quotation.');
        expect(err).toMatchObject({ status: 400, sapCode: 'SLS_LORD/166' });
        expect(calls).toHaveLength(2);
    });

    test('(2b) SLS_LORD/009 at CREATE step shows the incompletion message and opens no session', async () => {
        const { execute, calls } = fakeSap([csrfOk, () => { throw odataError(400, 'SLS_LORD/009', 'Document is incomplete'); }]);

        const err = await run(execute, { salesInquiry: '1000540' }).catch(e => e);

        expect(err.message).toBe('Inquiry 1000540 is incomplete in SAP and cannot be converted to a Sales Quotation. Complete the inquiry in VA22 before creating the quotation.');
        expect(err).toMatchObject({ status: 400, sapCode: 'SLS_LORD/009' });
        expect(calls).toHaveLength(2);
    });

    test('an explicit SAP rejection of SaveChanges is reported with the SAP code and releases the lock', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, () => { throw odataError(400, 'SLS_LORD/009', 'Document is incomplete'); }, discardOk]);

        await expect(run(execute)).rejects.toMatchObject({ message: 'Document is incomplete (SAP SLS_LORD/009)', status: 400, sapCode: 'SLS_LORD/009' });
        expect(calls[5].request).toMatchObject({ method: 'post', url: `${SERVICE_PATH}/DiscardChanges` });
    });
});

describe('Unit: SalesQuotationManageClient - no automatic retry', () => {
    const countCreates = calls => calls.filter(c => c.request.url === CREATE_URL).length;

    test('(3) session lost after create: stop, no retry, no SaveChanges, user told to verify SAP', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, () => { throw sessionNotFound(); }, discardOk]);

        const err = await run(execute).catch(e => e);

        expect(err.sapCode).toBe(OUTCOME.SESSION_LOST);
        expect(err.message).toMatch(/^SAP did not confirm the result\. Do not retry; check SAP\./);
        expect(err.message).toContain('Session not found');
        expect(countCreates(calls)).toBe(1);
        expect(calls.some(c => c.request.url === SAVE_URL)).toBe(false);
    });

    test('(4) create sent but no response (network error): outcome unknown, no retry', async () => {
        const { execute, calls } = fakeSap([csrfOk, () => { throw networkError(); }]);

        const err = await run(execute).catch(e => e);

        expect(err.sapCode).toBe(OUTCOME.UNKNOWN);
        expect(err.message).toMatch(/^SAP did not confirm the result\. Do not retry; check SAP\./);
        expect(err.message).toContain("step 'CreateWithRefFromSlsInquiry'");
        expect(countCreates(calls)).toBe(1);
        expect(calls).toHaveLength(2);
    });

    test('(4) create answered with a non-OData 5xx: outcome unknown, no retry', async () => {
        const { execute, calls } = fakeSap([csrfOk, () => { throw httpError(503, '<html>Service unavailable</html>'); }]);

        await expect(run(execute)).rejects.toMatchObject({ sapCode: OUTCOME.UNKNOWN, status: 502 });
        expect(countCreates(calls)).toBe(1);
    });

    test('SaveChanges without a response: outcome unknown, reported as "may exist", no retry', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, () => { throw networkError(); }, discardOk]);

        const err = await run(execute).catch(e => e);

        expect(err.sapCode).toBe(OUTCOME.UNKNOWN);
        expect(err.message).toMatch(/^SAP did not confirm the result\. Do not retry; check SAP\./);
        expect(err.message).toContain("step 'SaveChanges'");
        expect(calls.filter(c => c.request.url === SAVE_URL)).toHaveLength(1);
        expect(countCreates(calls)).toBe(1);
    });

    test('saved but the read-back fails: number reported as unverified, never created again', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk('0020000600'), () => { throw networkError(); }]);

        const err = await run(execute).catch(e => e);

        expect(err).toMatchObject({ sapCode: OUTCOME.SAVED_NOT_VERIFIED, salesQuotation: '0020000600' });
        expect(err.message).toMatch(/^Do not create it again\. Check quotation 0020000600 in VA23\./);
        expect(countCreates(calls)).toBe(1);
        expect(calls.some(c => c.request.url.endsWith('/DiscardChanges'))).toBe(false);
    });

    test('a second creation for the same inquiry while one is in flight is refused without calling SAP', async () => {
        let releaseCreate;
        const blockedCreate = new Promise(resolve => { releaseCreate = resolve; });
        const first = fakeSap([csrfOk, async () => { await blockedCreate; return createdOk(); }, sessionCheckOk, savedOk(), readBackOk()]);
        const second = fakeSap([]);

        const firstRun = client(first.execute).createFromInquiry({ salesInquiry: '1000536', salesQuotationType: 'ZQT' });
        await new Promise(r => setImmediate(r));

        await expect(client(second.execute).createFromInquiry({ salesInquiry: '1000536', salesQuotationType: 'ZQT' }))
            .rejects.toMatchObject({ status: 409, sapCode: OUTCOME.IN_PROGRESS });
        expect(second.calls).toHaveLength(0);

        releaseCreate();
        await expect(firstRun).resolves.toMatchObject({ verified: true });
    });

    test('a CSRF failure sends no create request and says nothing was created', async () => {
        const { execute, calls } = fakeSap([() => { throw networkError(); }]);

        const err = await run(execute).catch(e => e);

        expect(err.message).toContain('Nothing was sent to create a quotation');
        expect(calls).toHaveLength(1);
    });

    test('refuses to continue when SAP does not return an SAP-ContextId', async () => {
        const { execute, calls } = fakeSap([csrfOk, () => ({ status: 201, headers: {}, data: {} })]);

        await expect(run(execute)).rejects.toThrow('SAP did not open a sticky session (no SAP-ContextId returned).');
        expect(countCreates(calls)).toBe(1);
    });
});

describe('Unit: SalesQuotationManageClient - post-create session check', () => {
    const urls = calls => calls.map(c => `${c.request.method} ${c.request.url}`);

    test('(1) exactly one read-only GET immediately follows a successful create, in the same session', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute);

        expect(urls(calls).slice(1, 3)).toEqual([`post ${CREATE_URL}`, `get ${CHECK_URL}`]);
        const check = calls[2].request;
        expect(check.method).toBe('get');
        expect(check.data).toBeUndefined();
        expect(check.headers['SAP-ContextId']).toBe(CONTEXT_ID);
        expect(check.headers.Cookie).toBe('sap-usercontext=sap-client=220; sap-XSRF_DS4_220=xsrf1');
        expect(check.headers['x-csrf-token']).toBe('TOKEN-1');
        expect(check.httpAgent).toBe(calls[1].request.httpAgent);
        expect(calls.filter(c => c.request.url === CHECK_URL)).toHaveLength(1);
    });

    test('(2, 3) Session not found on the check: no PATCH, no SaveChanges, no second create, no second check', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, () => { throw sessionNotFound(); }, discardOk]);

        const err = await run(execute).catch(e => e);

        expect(err.sapCode).toBe(OUTCOME.SESSION_LOST);
        expect(err.message).toMatch(/^SAP did not confirm the result\. Do not retry; check SAP\./);
        expect(err.message).toContain("step 'post-create session check'");
        expect(calls.some(c => c.request.method === 'patch')).toBe(false);
        expect(calls.some(c => c.request.url === SAVE_URL)).toBe(false);
        expect(calls.filter(c => c.request.url === CREATE_URL)).toHaveLength(1);
        expect(calls.filter(c => c.request.url === CHECK_URL)).toHaveLength(1);
        expect(console.info.mock.calls.map(c => c[0]).join('\n'))
            .toMatch(/quotation-flow: post-create session check flow=\w+ inquiry=1000536 quotation='' status=400 context=present#[0-9a-f]{12} result=SESSION_NOT_FOUND/);
    });

    test('(3) a check without any response stops the flow as unconfirmed, without retry or PATCH', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, () => { throw networkError(); }, discardOk]);

        await expect(run(execute)).rejects.toMatchObject({ sapCode: OUTCOME.UNKNOWN });
        expect(calls.filter(c => c.request.url === CHECK_URL)).toHaveLength(1);
        expect(calls.some(c => c.request.method === 'patch')).toBe(false);
    });

    test('(4) a successful check lets the existing PATCH -> SaveChanges -> read-back flow continue', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk('0020000777'), readBackOk('0020000777')]);

        await expect(run(execute)).resolves.toEqual({ SalesQuotation: '0020000777', verified: true });
        expect(urls(calls).slice(2)).toEqual([
            `get ${CHECK_URL}`,
            `patch ${NEW_KEY_URL}`,
            `post ${SAVE_URL}`,
            `get ${SERVICE_PATH}/SalesQuotationManage('0020000777')?$select=SalesQuotation,SalesQuotationType,SoldToParty`
        ]);
        const log = console.info.mock.calls.map(c => c[0]).join('\n');
        expect(log).toMatch(/quotation-flow: post-create session check flow=\w+ inquiry=1000536 quotation='' status=200 context=present#[0-9a-f]{12} result=SESSION_VALID/);
        expect(log).not.toContain(CONTEXT_ID);
    });

    test('(5) the flow sends no $batch request at any step', async () => {
        const { execute, calls } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await run(execute);
        calls.forEach(c => expect(c.request.url).not.toMatch(/\$batch/));
    });
});

describe('Unit: SalesQuotationManageClient - diagnostic logging', () => {
    const DESTINATION_WITH_PASSWORD = { ...DESTINATION, password: 'SuperSecret#1' };
    const logged = () => [...console.info.mock.calls, ...console.error.mock.calls, ...console.warn.mock.calls].map(c => c.join(' ')).join('\n');

    test('one correlated line per SAP request with operation, status, timing and session-state flags', async () => {
        const { execute } = fakeSap([csrfOk, createdOk, sessionCheckOk, patchedOk, savedOk(), readBackOk()]);
        await new SalesQuotationManageClient({ destination: DESTINATION_WITH_PASSWORD, executeHttpRequest: execute })
            .createFromInquiry({ salesInquiry: '1000536', salesQuotationType: 'ZQT', header: { PurchaseOrderByCustomer: 'PO' } });

        const lines = console.info.mock.calls.map(c => c[0]).filter(l => /quotation-flow \w+ (GET-CSRF|CREATE|SESSION-CHECK|PATCH|SAVE|READ-BACK) /.test(l));
        expect(lines).toHaveLength(6);
        const flowIds = new Set(lines.map(l => l.match(/quotation-flow (\w+)/)[1]));
        expect(flowIds.size).toBe(1);
        expect(lines[0]).toMatch(/GET-CSRF .* status=200 ms=\d+ context=none cookies=present\(2\) csrf=present etag=none/);
        expect(lines[1]).toMatch(/CREATE .* status=201 ms=\d+ context=present#[0-9a-f]{12} .* etag=present/);
        expect(lines[2]).toMatch(/SESSION-CHECK .* status=200 .* context=present#[0-9a-f]{12}/);
        expect(lines[3]).toMatch(/PATCH .* status=200 .* context=present#[0-9a-f]{12}/);
        expect(lines[4]).toMatch(/SAVE .* status=200 .* context=present#[0-9a-f]{12}/);
        expect(lines[5]).toMatch(/READ-BACK .* status=200 .* context=none/);
        // Same session, same context hash on CREATE, SESSION-CHECK, PATCH and SAVE.
        const hashes = lines.slice(1, 5).map(l => l.match(/context=present#(\w+)/)[1]);
        expect(new Set(hashes).size).toBe(1);
    });

    test('logs the SAP code and SESSION_NOT_FOUND, never passwords, tokens, cookie values or the raw context ID', async () => {
        const { execute } = fakeSap([csrfOk, createdOk, sessionCheckOk, () => { throw sessionNotFound(); }, discardOk]);
        await new SalesQuotationManageClient({ destination: DESTINATION_WITH_PASSWORD, executeHttpRequest: execute })
            .createFromInquiry({ salesInquiry: '1000536', salesQuotationType: 'ZQT', header: { PurchaseOrderByCustomer: 'PO' } })
            .catch(() => {});

        const text = logged();
        expect(text).toMatch(/quotation-flow \w+ PATCH .* status=400 .* sap=SESSION_NOT_FOUND/);
        expect(text).not.toContain('SuperSecret#1');
        expect(text).not.toContain('TOKEN-1');
        expect(text).not.toContain('xsrf1');
        expect(text).not.toContain(CONTEXT_ID);
        expect(text).not.toMatch(/authorization/i);
        expect(text).not.toContain('<html>');
    });

    test('logs a business rejection with its SAP code', async () => {
        const { execute } = fakeSap([csrfOk, () => { throw odataError(400, 'SLS_LORD/166', 'Reference doc. 1000540 is incomplete and cannot be referenced'); }]);
        await run(execute, { salesInquiry: '1000540' }).catch(() => {});
        expect(logged()).toMatch(/CREATE .* status=400 .* sap=SLS_LORD\/166/);
    });
});

describe('Unit: buildHeaderChanges', () => {
    test('keeps only verified updatable fields, formatted for OData V4', () => {
        expect(buildHeaderChanges({
            SalesQuotationDate: '2026-09-14T10:00:00Z',
            BindingPeriodValidityEndDate: '2026-10-14',
            PurchaseOrderByCustomer: '  PO  ',
            CustomerPurchaseOrderDate: '2026-09-14',
            ContactPerson: '24789',
            BindingPeriodValidityStartDate: ''
        })).toEqual({
            SalesQuotationDate: '2026-09-14',
            BindingPeriodValidityEndDate: '2026-10-14',
            PurchaseOrderByCustomer: 'PO'
        });
    });
});
