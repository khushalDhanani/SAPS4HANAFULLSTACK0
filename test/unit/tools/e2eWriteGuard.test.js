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
