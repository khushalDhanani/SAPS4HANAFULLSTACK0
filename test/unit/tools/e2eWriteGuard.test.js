'use strict';

const { classifyRequest } = require('../../e2e/support/writeGuard');

const BASE = 'http://localhost:4004';
const batch = (...lines) => ['--batch_1', 'Content-Type:application/http', '', ...lines.map((l) => `${l} HTTP/1.1\r`), '', '--batch_1--'].join('\n');

describe('E2E write guard', () => {
    it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('allows %s', (method) => {
        expect(classifyRequest({ method, url: `${BASE}/odata/v4/purchase-order/PurchaseOrders` }).allow).toBe(true);
    });

    it('allows a $batch made only of GET requests', () => {
        const r = classifyRequest({ method: 'POST', url: `${BASE}/odata/v4/sales-order/$batch`, postData: batch('GET SalesOrders?$top=20', 'GET SalesOrders/$count') });
        expect(r).toEqual({ allow: true, reason: '$batch of 2 GET' });
    });

    it.each([
        ['an action POST', { method: 'POST', url: `${BASE}/odata/v4/purchase-order/createPurchaseOrder` }],
        ['a PATCH', { method: 'PATCH', url: `${BASE}/odata/v4/reservation-entry/Reservations('1')` }],
        ['a DELETE', { method: 'DELETE', url: `${BASE}/odata/v4/handling-unit/HandlingUnits('1')` }],
        ['a $batch with a POST', { method: 'POST', url: `${BASE}/odata/v4/goods-issue/$batch`, postData: batch('GET Items', 'POST postGoodsIssue201') }],
        ['a $batch with a PATCH', { method: 'POST', url: `${BASE}/odata/v4/sales-order/$batch`, postData: batch('PATCH SalesOrders(1)') }],
        ['a $batch with no readable lines', { method: 'POST', url: `${BASE}/odata/v4/sales-order/$batch`, postData: 'garbage' }],
        ['a $batch with no body', { method: 'POST', url: `${BASE}/odata/v4/sales-order/$batch` }],
        ['the AI stream', { method: 'POST', url: `${BASE}/ai/chat/stream` }],
        ['a POST to a path merely containing $batch', { method: 'POST', url: `${BASE}/odata/v4/x/$batchX`, postData: batch('GET A') }]
    ])('blocks %s', (_label, req) => {
        expect(classifyRequest(req).allow).toBe(false);
    });
});

describe('E2E write guard: $batch payload shapes', () => {
    const URL = `${BASE}/odata/v4/purchase-order/$batch`;
    const post = (postData) => classifyRequest({ method: 'POST', url: URL, postData });
    // Multipart bodies as the SAPUI5 OData V4 model sends them: CRLF line endings, one application/http part per request
    const part = (request, headers = []) => ['--batch_0', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `${request} HTTP/1.1`, 'Accept: application/json;odata.metadata=minimal;IEEE754Compatible=true', ...headers, '', ''].join('\r\n');
    const changeset = (id, ...requests) => [
        '--batch_0', `Content-Type: multipart/mixed;boundary=changeset_${id}`, '',
        ...requests.flatMap(([request, json], i) => [`--changeset_${id}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${i}`, '', `${request} HTTP/1.1`, 'Content-Type: application/json;charset=UTF-8;IEEE754Compatible=true', '', json || '', '']),
        `--changeset_${id}--`, ''
    ].join('\r\n');
    const close = '--batch_0--\r\n';

    describe('allowed: reads only', () => {
        it('one GET with CRLF line endings', () => {
            expect(post(part('GET PurchaseOrders?$count=true&$orderby=CreationDate%20desc&$skip=0&$top=20') + close).allow).toBe(true);
        });

        it('several GETs, including a function call and an absolute URL', () => {
            const body = part('GET PurchaseOrders?$top=20') + part('GET getDashboardMetrics()') + part('GET http://localhost:4004/odata/v4/purchase-order/PurchaseOrders/$count') + close;
            expect(post(body)).toEqual({ allow: true, reason: '$batch of 3 GET' });
        });

        it('GETs with LF-only line endings', () => {
            expect(post(part('GET A') .replace(/\r\n/g, '\n') + close.replace(/\r\n/g, '\n')).allow).toBe(true);
        });

        it('a GET whose response URL carries a text that merely looks like a write verb', () => {
            expect(post(part("GET PurchaseOrders?$filter=Supplier%20eq%20'POSTMAN'") + close).allow).toBe(true);
        });
    });

    describe('blocked: any write', () => {
        it.each([
            ['a POST in a changeset', changeset('1', ['POST PurchaseOrders', '{"Supplier":"1"}'])],
            ['a PATCH in a changeset', changeset('1', ["PATCH PurchaseOrders('1')", '{"Note":"x"}'])],
            ['a DELETE in a changeset', changeset('1', ["DELETE PurchaseOrders('1')"])],
            ['a PUT in a changeset', changeset('1', ["PUT PurchaseOrders('1')", '{}'])],
            ['a MERGE in a changeset', changeset('1', ["MERGE PurchaseOrders('1')", '{}'])],
            ['an action POST outside a changeset', part('POST createPurchaseOrder')],
            ['a POST addressed by Content-ID', changeset('1', ['POST PurchaseOrders', '{}'], ['POST $0/Items', '{}'])],
            ['two changesets', changeset('1', ['POST A', '{}']) + changeset('2', ['PATCH B(1)', '{}'])]
        ])('%s', (_label, writeParts) => {
            expect(post(writeParts + close).allow).toBe(false);
        });

        it('a write hidden after several reads', () => {
            expect(post(part('GET A') + part('GET B') + changeset('1', ['POST C', '{}']) + part('GET D') + close).allow).toBe(false);
        });

        it('a write that follows a GET-looking line inside a JSON payload', () => {
            const payload = '{"Note":"line one\\nGET Z HTTP/1.1"}';
            expect(post(part('GET A') + changeset('1', ['POST C', payload]) + close).allow).toBe(false);
        });

        it('a write batch with LF-only line endings', () => {
            expect(post((part('GET A') + changeset('1', ['POST C', '{}']) + close).replace(/\r\n/g, '\n')).allow).toBe(false);
        });

        it('a lower-case method next to a GET', () => {
            expect(post(part('GET A') + part('post createPurchaseOrder') + close).allow).toBe(false);
        });

        it('a mixed-case method', () => {
            expect(post(part('GET A') + part('Delete PurchaseOrders(1)') + close).allow).toBe(false);
        });

        it('an indented request line', () => {
            expect(post(part('GET A') + part('  POST createPurchaseOrder') + close).allow).toBe(false);
        });

        it('a tab-separated request line', () => {
            expect(post(part('GET A') + part('POST\tcreatePurchaseOrder') + close).allow).toBe(false);
        });

        it('a write verb line without an HTTP version', () => {
            expect(post(part('GET A') + '--batch_0\r\nContent-Type: application/http\r\n\r\nPOST createPurchaseOrder\r\n\r\n' + close).allow).toBe(false);
        });

        it('an unknown method token next to a GET', () => {
            expect(post(part('GET A') + part('PURGE Cache') + close).allow).toBe(false);
        });

        it('a method override header inside a part', () => {
            expect(post(part('GET PurchaseOrders(1)', ['X-HTTP-Method: DELETE']) + close).allow).toBe(false);
            expect(post(part('GET PurchaseOrders(1)', ['x-http-method-override: PATCH']) + close).allow).toBe(false);
        });
    });

    describe('blocked: unclassified payloads', () => {
        it.each([
            ['an empty body', ''],
            ['a missing body', undefined],
            ['a JSON batch', JSON.stringify({ requests: [{ id: '0', method: 'POST', url: 'createPurchaseOrder', body: {} }] })],
            ['a JSON batch of GETs only', JSON.stringify({ requests: [{ id: '0', method: 'GET', url: 'PurchaseOrders' }] })],
            ['multipart boundaries without any request line', '--batch_0\r\nContent-Type: application/http\r\n\r\n--batch_0--\r\n'],
            ['a binary-looking body', '\u0000\u0001\u0002 not a batch'],
            ['a request line cut off before the version', '--batch_0\r\nContent-Type: application/http\r\n\r\nGET PurchaseOrders\r\n']
        ])('%s', (_label, postData) => {
            expect(post(postData).allow).toBe(false);
        });
    });

    describe('outer request', () => {
        it('blocks a method override header on any request', () => {
            const r = classifyRequest({ method: 'GET', url: `${BASE}/odata/v4/x/Items(1)`, headers: { 'x-http-method-override': 'DELETE' } });
            expect(r.allow).toBe(false);
        });

        it('blocks a batch addressed through a non-$batch URL', () => {
            expect(classifyRequest({ method: 'POST', url: `${BASE}/odata/v4/purchase-order/`, postData: part('GET A') + close }).allow).toBe(false);
        });

        it('a live-write allowlist only lifts the listed POST paths', () => {
            const re = [/\/createPurchaseOrder$/];
            expect(classifyRequest({ method: 'POST', url: `${BASE}/odata/v4/purchase-order/createPurchaseOrder` }, re).allow).toBe(true);
            expect(classifyRequest({ method: 'POST', url: `${BASE}/odata/v4/purchase-order/other` }, re).allow).toBe(false);
            expect(classifyRequest({ method: 'PATCH', url: `${BASE}/odata/v4/purchase-order/createPurchaseOrder` }, re).allow).toBe(false);
        });
    });
});
