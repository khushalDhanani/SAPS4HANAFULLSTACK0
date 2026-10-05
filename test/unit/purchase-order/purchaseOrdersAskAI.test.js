'use strict';

let ControllerClass;
const mockPost = jest.fn();
const mockGet = jest.fn();
const mockFragmentLoad = jest.fn();
function MockFilter(a, op, v) { if (typeof a === 'object') { this.filters = a.filters; this.and = a.and; } else { this.path = a; this.op = op; this.v = v; } }

global.sap = {
    ui: {
        define: function (deps, factory) {
            function Base() {}
            Base.extend = function (sName, oMembers) {
                function Controller() {}
                Object.assign(Controller.prototype, oMembers);
                return Controller;
            };
            ControllerClass = factory(Base, function JSONModel(d) { this.d = d; }, MockFilter, { EQ: 'EQ' }, function Sorter(p, d) { this.p = p; this.d = d; }, { SortOrder: {} },
                { error: jest.fn() }, {}, { post: mockPost, get: mockGet, authHeaders: () => ({ Authorization: 'Bearer t' }) }, { load: mockFragmentLoad }, { statusCodeName: c => ({ '01': 'Draft', '02': 'In Approval', '03': 'Not Yet Sent', '04': 'Sent', '05': 'Follow-On Documents', '08': 'Released', '38': 'Rejected' })[c] });
        }
    }
};
require('../../../app/fiori-app/webapp/modules/mm/purchase-order/controller/PurchaseOrders.controller');

// No streaming in the default tests: the controller must fall back to the OData action.
beforeEach(() => { global.fetch = undefined; });

describe('PurchaseOrders Ask AI helpers', () => {
    test('_toAIRow keeps only compact business fields', () => {
        const row = ControllerClass._toAIRow({
            PurchaseOrder: '4500000001', PurchaseOrderType: 'NB', Supplier: '100001', SupplierName: 'ACME',
            CompanyCode: '1000', PurchasingOrganization: '1000', PurchasingGroup: '001',
            CreationDate: '2026-09-20T00:00:00Z', CreatedByUser: 'KHUSHAL', PurchaseOrderNetAmount: '1200.50',
            DocumentCurrency: 'INR', PurchasingDocumentStatusName: 'Released', PurchasingDocumentDeletionCode: 'L',
            Secret: 'x'
        });
        expect(row).toEqual({
            po: '4500000001', type: 'NB', supplier: '100001', supplierName: 'ACME', company: '1000',
            purchOrg: '1000', purchGroup: '001', created: '2026-09-20', createdBy: 'KHUSHAL',
            netAmount: '1200.50', currency: 'INR', status: 'Released', deleted: true
        });
        expect(row.Secret).toBeUndefined();
    });

    test('_buildAISystemPrompt embeds rows as JSON and the real scope totals', () => {
        const p = ControllerClass._buildAISystemPrompt([{ po: '1' }]);
        expect(p).toContain('PURCHASE_ORDERS = [{"po":"1"}]');
        expect(p).toContain('SCOPE: 1 purchase orders are included below');
        const q = ControllerClass._buildAISystemPrompt([{ po: '1' }], [], { shown: 40, total: 1234, supplierTotal: 57, filtered: true });
        expect(q).toContain("with the user's current filters contains 1234 purchase orders in total from 57 suppliers; the 40 most recent ones are included below");
        expect(q).toContain('never count the rows below');
        const t = ControllerClass._buildAISystemPrompt([{ po: '1' }], [], { shown: 1, total: 9, filtered: true, topPOsByNet: [{ po: '7', netAmount: '99' }] });
        expect(t).toContain('TOP_PURCHASE_ORDERS_BY_NET_AMOUNT across the WHOLE list (current filters), sorted by the server');
        expect(t).toContain('[{"po":"7","netAmount":"99"}]');
        expect(t).toContain('NEVER enumerate or scan the rows');
        const r = ControllerClass._buildAISystemPrompt([{ po: '1' }], [], { shown: 150, total: 150 });
        expect(r).toContain('ALL of them are included below');
        expect(r).not.toContain('never count the rows below');
    });

    test('onAIAsk fetches up to AI_CONTEXT_ROWS from the server and passes count + filter state', async () => {
        const { c } = mkController('how many POs?');
        mockPost.mockResolvedValue({ answer: '1234', model: 'm' });
        await c.onAIAsk();
        expect(c._requested).toContain(ControllerClass.AI_CONTEXT_ROWS);
        expect(mockPost.mock.calls[0][1].system).toContain('contains 1234 purchase orders in total from 57 suppliers; the 1 most recent ones are included below');
    });

    test('falls back to loaded table rows when the server read fails', async () => {
        const { c } = mkController('q');
        const orig = c.byId;
        c.byId = id => id === 'purchaseOrdersTable' ? Object.assign({}, orig(id), { getModel: () => ({ bindList: () => ({ requestContexts: () => Promise.reject(new Error('x')), destroy: jest.fn() }) }) }) : null;
        mockPost.mockResolvedValue({ answer: 'ok', model: 'm' });
        await c.onAIAsk();
        expect(mockPost.mock.calls[0][1].system).toContain('"po":"1"');
    });

    test('_toHtml escapes HTML and renders bullets/bold', () => {
        const html = ControllerClass._toHtml('Total: **3** POs\n- A <b>x</b>\n- B\nDone');
        expect(html).toBe('<p>Total: <strong>3</strong> POs</p><ul><li>A &lt;b&gt;x&lt;/b&gt;</li><li>B</li></ul><p>Done</p>');
        expect(ControllerClass._toHtml('')).toBe('');
    });

    test('_toHtml renders headings, numbered lists, tables, code, italics and links', () => {
        const md = '## Top suppliers\n\n| Supplier | POs | Net |\n|---|---|---|\n| Alpha | 42 | 1,200.50 |\n\n1. first\n2. second\n\nUse `ME23N` and *see* [docs](https://help.sap.com/x)\n\n```\nraw <x>\n```\n---';
        const html = ControllerClass._toHtml(md);
        expect(html).toContain('<h4>Top suppliers</h4>');
        expect(html).toContain('<table><thead><tr><th>Supplier</th><th>POs</th><th>Net</th></tr></thead><tbody><tr><td>Alpha</td><td class="num">42</td><td class="num">1,200.50</td></tr></tbody></table>');
        expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
        expect(html).toContain('<code>ME23N</code>');
        expect(html).toContain('<em>see</em>');
        expect(html).toContain('<a href="https://help.sap.com/x" target="_blank" rel="noopener">docs</a>');
        expect(html).toContain('<pre><code>raw &lt;x&gt;\n</code></pre>');
        expect(html).toContain('<hr/>');
        expect(ControllerClass._toHtml('[x](javascript:alert(1))')).not.toContain('<a');
    });

    test('top POs by net are fetched server-sorted for every question', async () => {
        const { c } = mkController('top 5 po');
        const calls = [];
        c.byId = id => id === 'purchaseOrdersTable' ? {
            getBinding: () => ({ getCurrentContexts: () => [], getCount: () => 5, getFilters: () => [] }),
            getModel: () => ({ bindList: (path, ctx, sorters) => { calls.push(sorters && sorters[0] && sorters[0].p);
                return { requestContexts: () => Promise.resolve([{ getObject: () => ({ PurchaseOrder: '9', PurchaseOrderNetAmount: '5' }) }]), getCount: () => 5, destroy: jest.fn() }; } })
        } : null;
        mockPost.mockResolvedValue({ answer: 'ok', model: 'm' });
        await c.onAIAsk();
        expect(calls).toContain('PurchaseOrderNetAmount');
        expect(mockPost.mock.calls[0][1].system).toContain('TOP_PURCHASE_ORDERS_BY_NET_AMOUNT');
    });

    test('truncated stream (finish_reason=length) appends a hint; thinking heartbeats are ignored', async () => {
        const { c, data } = mkController('q');
        const chunks = ['data: {"thinking":true}\n\ndata: {"delta":"partial"}\n\ndata: {"done":true,"model":"m","finishReason":"length"}\n\n'];
        let i = 0;
        global.fetch = jest.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read: () => Promise.resolve(i < chunks.length ? { value: new TextEncoder().encode(chunks[i++]), done: false } : { done: true }) }) } });
        await c.onAIAsk();
        expect(data.messages[1].content).toBe('partial\n\n_aiTruncated_');
    });

    test('_parseSSE splits complete events and keeps the unterminated tail', () => {
        const r = ControllerClass._parseSSE('data: {"delta":"He"}\n\ndata: {"delta":"llo"}\n\ndata: {"do');
        expect(r.events).toEqual([{ delta: 'He' }, { delta: 'llo' }]);
        expect(r.rest).toBe('data: {"do');
    });

    test('streams the answer progressively and finishes with model + caption', async () => {
        const { c, data } = mkController('stream me');
        const chunks = ['data: {"delta":"Hel"}\n\n', 'data: {"delta":"lo **x**"}\n\ndata: {"done":true,"model":"m-s"}\n\n'];
        let i = 0;
        const enc = new TextEncoder();
        global.fetch = jest.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read: () => Promise.resolve(i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { done: true }) }) } });
        const seen = [];
        const origRefresh = c._refreshAIMessages;
        c._refreshAIMessages = function (a, now) { seen.push(a[a.length - 1].content); return origRefresh.call(this, a, now); };
        await c.onAIAsk();
        expect(global.fetch).toHaveBeenCalledWith('/ai/chat/stream', expect.objectContaining({ method: 'POST' }));
        expect(mockPost).not.toHaveBeenCalled();
        expect(seen).toContain('Hel');
        expect(data.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello **x**', html: '<p>Hello <strong>x</strong></p>' });
        expect(data.messages[1].meta).toContain('aiMetaModel:m-s');
        expect(data.busy).toBe(false);
    });

    test('falls back to the OData action when the stream cannot start, and errors after first chunk are shown', async () => {
        const { c, data } = mkController('q');
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
        mockPost.mockResolvedValue({ answer: 'via odata', model: 'm' });
        await c.onAIAsk();
        expect(data.messages[1].content).toBe('via odata');

        data.question = 'again';
        const chunks = ['data: {"delta":"part"}\n\ndata: {"error":"AI provider error: boom","status":502}\n\n'];
        let i = 0;
        global.fetch = jest.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read: () => Promise.resolve(i < chunks.length ? { value: new TextEncoder().encode(chunks[i++]), done: false } : { done: true }) }) } });
        mockPost.mockClear();
        await c.onAIAsk();
        expect(mockPost).not.toHaveBeenCalled();
        expect(data.messages[data.messages.length - 1]).toMatchObject({ role: 'assistant', error: true, content: 'AI provider error: boom' });
    });

    function mkController(question) {
        const c = new ControllerClass();
        const data = { question, messages: [], busy: false };
        const model = { getProperty: p => data[p.slice(1)], setProperty: (p, v) => { data[p.slice(1)] = v; } };
        const vm = { getProperty: p => ({ '/totalCount': 1234, '/supplierCount': 57 })[p] };
        c.getView = () => ({ getModel: n => n === 'viewModel' ? vm : model });
        c._buildFilterCriteria = () => [];
        c.byId = id => id === 'purchaseOrdersTable'
            ? { getBinding: () => ({ getCurrentContexts: () => [{ getObject: () => ({ PurchaseOrder: '1' }) }],
                getCount: () => 1234, getFilters: () => [{}] }),
                getModel: () => ({ bindList: () => ({ requestContexts: (i, n) => { c._requested = (c._requested || []).concat([n]); return Promise.resolve([{ getObject: () => ({ PurchaseOrder: '1' }) }]); }, destroy: jest.fn() }) }) }
            : null;
        c.getText = (k, a) => a ? `${k}:${a.join(",")}` : k;
        return { c, data };
    }

    beforeEach(() => { mockPost.mockReset(); mockGet.mockReset(); mockGet.mockRejectedValue(new Error('no')); });

    test('onAIAsk sends history + system prompt and appends assistant bubble', async () => {
        const { c, data } = mkController(' hi ');
        mockPost.mockResolvedValue({ answer: 'One PO', model: 'm' });
        await c.onAIAsk();
        expect(mockPost).toHaveBeenCalledWith('/odata/v4/ai/chat', {
            messages: [{ role: 'user', content: 'hi' }], system: expect.stringContaining('"po":"1"')
        });
        expect(data.messages.map(m => m.role)).toEqual(['user', 'assistant']);
        expect(data.messages[1].html).toContain('<p>One PO</p>');
        expect(data.messages[1].meta).toBe('aiMetaTotal:1234 · aiMetaRows:1 · aiMetaModel:m');
        expect(data.messages[1].metaTooltip).toContain('1234 purchase orders in the filtered list');
        expect(data.question).toBe('');
        expect(data.busy).toBe(false);

        // second turn carries the history, error bubbles excluded
        data.question = 'more';
        data.messages.push({ role: 'assistant', error: true, content: 'boom' });
        await c.onAIAsk();
        expect(mockPost.mock.calls[1][1].messages).toEqual([
            { role: 'user', content: 'hi' }, { role: 'assistant', content: 'One PO' }, { role: 'user', content: 'more' }
        ]);
    });

    test('onAIAsk shows provider error as error bubble and ignores empty/busy', async () => {
        const { c, data } = mkController('q');
        mockPost.mockRejectedValue(new Error('AI provider error: 429'));
        await c.onAIAsk();
        expect(data.messages[1]).toMatchObject({ role: 'assistant', error: true, content: 'AI provider error: 429' });
        expect(data.busy).toBe(false);
        mockPost.mockClear();
        data.question = '';
        expect(c.onAIAsk()).toBeUndefined();
        expect(mockPost).not.toHaveBeenCalled();
    });

    test('_extractPONumbers finds 10-digit numbers only, deduped', () => {
        expect(ControllerClass._extractPONumbers('PO 6100000059 and 6100000059, item 10, qty 12345678901'))
            .toEqual(['6100000059']);
        expect(ControllerClass._extractPONumbers('')).toEqual([]);
    });

    test('PO number in question is fetched with items and replaces the table row', async () => {
        const { c, data } = mkController('status of 6100000059?');
        mockGet.mockResolvedValue({ PurchaseOrder: '6100000059', SupplierName: 'Zed', PurchasingDocumentStatusName: 'Open',
            to_PurchaseOrderItem: [{ PurchaseOrderItem: '10', Material: 'M1', OrderQuantity: '5', NetAmount: '50', FirstDeliveryDate: '2026-10-01T00:00:00Z' }] });
        mockPost.mockResolvedValue({ answer: 'Open', model: 'm' });
        await c.onAIAsk();
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining("/PurchaseOrders('6100000059')?$expand=to_PurchaseOrderItem"));
        const sys = mockPost.mock.calls[0][1].system;
        expect(sys).toContain('"po":"6100000059"');
        expect(sys).toContain('"items":[{"item":"10","material":"M1"');
        expect(sys).not.toContain('do NOT exist');
        expect(data.messages[1].content).toBe('Open');
    });

    test('unknown PO number is reported as not found in the prompt', async () => {
        const { c } = mkController('what about 9999999999');
        mockPost.mockResolvedValue({ answer: 'n/a', model: 'm' });
        await c.onAIAsk();
        expect(mockPost.mock.calls[0][1].system).toContain('do NOT exist or are not accessible: 9999999999');
    });

    test('widget mounts once into the page and opens/closes via the model', async () => {
        const c = new ControllerClass();
        const data = {};
        const model = { getProperty: p => data[p.slice(1)], setProperty: (p, v) => { data[p.slice(1)] = v; } };
        const page = { addContent: jest.fn() };
        c.getView = () => ({ getId: () => 'v', setModel: (m) => { Object.assign(data, m.d); }, getModel: () => model });
        c.byId = id => id === 'purchaseOrdersPage' ? page : null;
        mockFragmentLoad.mockResolvedValue([{ id: 'fab' }, { id: 'widget' }]);
        await c._initAIWidget();
        await c._initAIWidget();
        expect(mockFragmentLoad).toHaveBeenCalledTimes(1);
        expect(page.addContent).toHaveBeenCalledTimes(2);
        expect(data.open).toBe(false);
        await c.onAskAI();
        expect(data.open).toBe(true);
        c.onAIClose();
        expect(data.open).toBe(false);
    });

    test('_statusFilter mirrors the filter bar rules and _asksAboutStatus detects status questions', () => {
        const f = ControllerClass._statusFilter('Approved');
        expect(f.and).toBe(false);
        expect(f.filters.map(x => [x.path, x.v])).toEqual([['PurchasingDocumentStatus', '04'], ['PurchasingDocumentStatus', '05'], ['PurchasingCompletenessStatus', true]]);
        expect(ControllerClass._statusFilter('true').filters.length).toBe(3);
        expect(ControllerClass._statusFilter('')).toBeNull();
        expect(ControllerClass._asksAboutStatus('How many open POs?')).toBe(true);
        expect(ControllerClass._asksAboutStatus('Which supplier appears most often?')).toBe(false);
    });

    test('status question adds exact server-side status counts by SAP status code to the prompt', async () => {
        const { c } = mkController('how many open POs?');
        const counts = { all: 2800, '01': 38, '02': 149, '04': 1441 };
        c.byId = id => id === 'purchaseOrdersTable' ? {
            getBinding: () => ({ getCurrentContexts: () => [], getCount: () => 2800, getFilters: () => [] }),
            getModel: () => ({ bindList: (path, ctx, sorters, filters) => {
                const code = filters && filters.length ? filters[0].v : 'all';
                return { requestContexts: () => Promise.resolve([]), getCount: () => counts[code] ?? 0, destroy: jest.fn() };
            } })
        } : null;
        mockPost.mockResolvedValue({ answer: '187', model: 'm' });
        await c.onAIAsk();
        const sys = mockPost.mock.calls[0][1].system;
        expect(sys).toContain('STATUS COUNTS for the whole list by SAP status (server-side, exact): 01 Draft = 38, 02 In Approval = 149, 03 Not Yet Sent = 0, 04 Sent = 1441, 05 Follow-On Documents = 0, 08 Released = 0, 38 Rejected = 0, Other = 1172');
    });

    test('_aggregateRows computes exact per-supplier / status / month figures', () => {
        const rows = [
            { po: '1', supplier: 'S1', supplierName: 'Alpha', netAmount: '100.5', currency: 'INR', status: 'Sent', company: '1000', type: 'NB', purchOrg: '1000', purchGroup: '001', createdBy: 'A', created: '2026-09-01' },
            { po: '2', supplier: 'S1', supplierName: 'Alpha', netAmount: '50', currency: 'INR', status: 'Draft', company: '1000', type: 'NB', purchOrg: '1000', purchGroup: '002', createdBy: 'A', created: '2026-09-15' },
            { po: '3', supplier: 'S2', supplierName: 'Beta', netAmount: '900', currency: 'USD', status: 'Sent', company: '1140', type: 'ZINT', purchOrg: '1140', purchGroup: '001', createdBy: 'B', created: '2026-08-20' }
        ];
        const a = ControllerClass._aggregateRows(rows);
        expect(a.rows).toBe(3);
        expect(a.netByCurrency).toEqual({ INR: 150.5, USD: 900 });
        expect(a.topSuppliersByCount[0]).toEqual({ supplier: 'S1 Alpha', count: 2, net: { INR: 150.5 } });
        expect(a.topSuppliersByNet[0].supplier).toBe('S2 Beta');
        expect(a.byStatus).toEqual([{ key: 'Sent', count: 2, net: { INR: 100.5, USD: 900 } }, { key: 'Draft', count: 1, net: { INR: 50 } }]);
        expect(a.byMonth.map(e => e.key + ':' + e.count)).toEqual(['2026-09:2', '2026-08:1']);
        expect(a.byPurchGroup).toEqual([{ key: '001', count: 2, net: { INR: 100.5, USD: 900 } }, { key: '002', count: 1, net: { INR: 50 } }]);
        expect(a.byPurchOrg.map(e => e.key)).toEqual(['1000', '1140']);
        expect(a.byCreatedBy[0]).toEqual({ key: 'A', count: 2, net: { INR: 150.5 } });
        expect(a.byCurrency.map(e => e.key)).toEqual(['INR', 'USD']);
        expect(ControllerClass._buildAISystemPrompt(rows)).toContain('AGGREGATES over the included purchase orders');
    });

    test('item questions fetch line items in PO batches and add item aggregates to the prompt', async () => {
        const { c } = mkController('Which material is ordered most and in which plant?');
        expect(ControllerClass._asksAboutItems('how many POs per group')).toBe(false);
        const pos = Array.from({ length: 90 }, (_, i) => 'P' + i);
        const bindCalls = [];
        c.byId = id => id === 'purchaseOrdersTable' ? {
            getBinding: () => ({ getCurrentContexts: () => [], getCount: () => 90, getFilters: () => [] }),
            getModel: () => ({ bindList: (path, ctx, sorters, filters) => {
                bindCalls.push({ path, n: filters && filters[0] && filters[0].filters ? filters[0].filters.length : 0 });
                if (path === '/PurchaseOrderItems') {
                    const k = filters[0].filters.length;
                    return { requestContexts: () => Promise.resolve(Array.from({ length: k }, (_, i) => ({ getObject: () => ({ PurchaseOrder: filters[0].filters[i].v, PurchaseOrderItem: '00010', Material: i % 2 ? 'M1' : 'M2', PurchaseOrderItemText: 'T', Plant: '1120', OrderQuantity: '2.5', PurchaseOrderQuantityUnit: 'KG', NetAmount: '10', DocumentCurrency: 'INR' }) }))), destroy: jest.fn() };
                }
                return { requestContexts: () => Promise.resolve(pos.map(po => ({ getObject: () => ({ PurchaseOrder: po }) }))), getCount: () => 90, destroy: jest.fn() };
            } })
        } : null;
        mockPost.mockResolvedValue({ answer: 'M2', model: 'm' });
        await c.onAIAsk();
        const itemCalls = bindCalls.filter(b => b.path === '/PurchaseOrderItems');
        expect(itemCalls.map(b => b.n)).toEqual([40, 40, 10]);
        const sys = mockPost.mock.calls[0][1].system;
        expect(sys).toContain('ITEM_AGGREGATES');
        expect(sys).toContain('"byMaterial":[{"key":"M2 T","items":45,"qty":{"KG":112.5},"net":{"INR":450}}');
        expect(sys).toContain('"purchaseOrders":90');
        expect(sys).toContain('PURCHASE_ORDER_ITEMS');
    });

    test('_extractSearchTerms keeps product words and drops stop words / PO numbers', () => {
        expect(ControllerClass._extractSearchTerms('Do we have any purchase orders for Apple Macbook pro?')).toEqual(['Apple', 'Macbook', 'pro']);
        expect(ControllerClass._extractSearchTerms('How many POs per purchasing group?')).toEqual([]);
        expect(ControllerClass._extractSearchTerms('status of 6100000059')).toEqual([]);
    });

    test('search terms trigger a whole-list item search and matching PO headers join the context', async () => {
        const { c } = mkController('Any POs for Macbook?');
        const paths = [];
        c.byId = id => id === 'purchaseOrdersTable' ? {
            getBinding: () => ({ getCurrentContexts: () => [], getCount: () => 3, getFilters: () => [] }),
            getModel: () => ({ bindList: (path, ctx, sorters, filters) => {
                paths.push(path + (filters && filters[0] && filters[0].filters ? ':' + filters[0].filters.length : ''));
                if (path === '/PurchaseOrderItems') {
                    return { requestContexts: () => Promise.resolve([{ getObject: () => ({ PurchaseOrder: '8000000052', PurchaseOrderItem: '00010', Material: '8000009753', PurchaseOrderItemText: 'Apple Macbook Pro 14", M5', OrderQuantity: '2', PurchaseOrderQuantityUnit: 'NOS', NetAmount: '400000', DocumentCurrency: 'INR' }) }]), getCount: () => 37, destroy: jest.fn() };
                }
                if (filters && filters[0] && filters[0].filters && filters[0].filters[0].path === 'PurchaseOrder') {
                    return { requestContexts: () => Promise.resolve([{ getObject: () => ({ PurchaseOrder: '8000000052', SupplierName: 'iStore' }) }]), destroy: jest.fn() };
                }
                return { requestContexts: () => Promise.resolve([{ getObject: () => ({ PurchaseOrder: '1' }) }]), getCount: () => 3, destroy: jest.fn() };
            } })
        } : null;
        mockPost.mockResolvedValue({ answer: 'yes', model: 'm' });
        await c.onAIAsk();
        expect(paths).toContain('/PurchaseOrderItems:1');
        const sys = mockPost.mock.calls[0][1].system;
        expect(sys).toContain('ITEM_SEARCH: a server-side search over ALL purchase order items');
        expect(sys).toContain('ALL the terms ["Macbook"] found 37 matching line items');
        expect(sys).toContain('"bySupplier":[{"key":"? iStore","items":1');
        expect(sys).toContain('Apple Macbook Pro 14');
        expect(sys).toContain('"supplierName":"iStore"');
    });

    test('search falls back from ALL terms to ANY term when nothing matches', async () => {
        const { c } = mkController('Macbook or laptop');
        const modes = [];
        c.byId = id => id === 'purchaseOrdersTable' ? {
            getBinding: () => ({ getCurrentContexts: () => [], getCount: () => 0, getFilters: () => [] }),
            getModel: () => ({ bindList: (path, ctx, sorters, filters) => {
                if (path === '/PurchaseOrderItems') {
                    modes.push(filters[0].and);
                    const hit = filters[0].and === false;
                    return { requestContexts: () => Promise.resolve(hit ? [{ getObject: () => ({ PurchaseOrder: '1', PurchaseOrderItemText: 'Laptop' }) }] : []), getCount: () => hit ? 8 : 0, destroy: jest.fn() };
                }
                return { requestContexts: () => Promise.resolve([]), getCount: () => 0, destroy: jest.fn() };
            } })
        } : null;
        mockPost.mockResolvedValue({ answer: 'x', model: 'm' });
        await c.onAIAsk();
        expect(modes).toEqual([true, false]);
        expect(mockPost.mock.calls[0][1].system).toContain('ANY of the terms ["Macbook","laptop"] found 8');
    });

    test('onAIClear resets the conversation', () => {
        const { c, data } = mkController('x');
        data.messages = [{ role: 'user' }];
        c.onAIClear();
        expect(data.messages).toEqual([]);
        expect(data.question).toBe('');
    });
});
