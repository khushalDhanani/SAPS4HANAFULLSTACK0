'use strict';

let ControllerClass;
const mockPost = jest.fn();
const mockGet = jest.fn();

global.sap = {
    ui: {
        define: function (deps, factory) {
            function Base() {}
            Base.extend = function (sName, oMembers) {
                function Controller() {}
                Object.assign(Controller.prototype, oMembers);
                return Controller;
            };
            ControllerClass = factory(Base, function JSONModel(d) { this.d = d; }, null, {}, null, { SortOrder: {} },
                { error: jest.fn() }, {}, { post: mockPost, get: mockGet }, { load: jest.fn() });
        }
    }
};
require('../../../app/fiori-app/webapp/modules/mm/purchase-order/controller/PurchaseOrders.controller');

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
        expect(p).toContain('only the 1 rows loaded on screen');
        const q = ControllerClass._buildAISystemPrompt([{ po: '1' }], [], { shown: 40, total: 1234, supplierTotal: 57, filtered: true });
        expect(q).toContain("with the user's current filters contains 1234 purchase orders in total from 57 suppliers; only the 40 rows loaded");
        expect(q).toContain('never count the rows below');
    });

    test('onAIAsk passes server count and filter state into the prompt', async () => {
        const { c } = mkController('how many POs?');
        mockPost.mockResolvedValue({ answer: '1234', model: 'm' });
        await c.onAIAsk();
        expect(mockPost.mock.calls[0][1].system).toContain('contains 1234 purchase orders in total from 57 suppliers; only the 1 rows loaded');
    });

    test('_toHtml escapes HTML and renders bullets/bold', () => {
        const html = ControllerClass._toHtml('Total: **3** POs\n- A <b>x</b>\n- B\nDone');
        expect(html).toBe('<p>Total: <strong>3</strong> POs</p><ul><li>A &lt;b&gt;x&lt;/b&gt;</li><li>B</li></ul><p>Done</p>');
        expect(ControllerClass._toHtml('')).toBe('');
    });

    function mkController(question) {
        const c = new ControllerClass();
        const data = { question, messages: [], busy: false };
        const model = { getProperty: p => data[p.slice(1)], setProperty: (p, v) => { data[p.slice(1)] = v; } };
        const vm = { getProperty: p => ({ '/totalCount': 1234, '/supplierCount': 57 })[p] };
        c.getView = () => ({ getModel: n => n === 'viewModel' ? vm : model });
        c.byId = id => id === 'purchaseOrdersTable'
            ? { getBinding: () => ({ getCurrentContexts: () => [{ getObject: () => ({ PurchaseOrder: '1' }) }],
                getCount: () => 1234, getFilters: () => [{}] }) }
            : null;
        c.getText = (k, a) => `${k}:${a.join(",")}`;
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
        expect(data.messages[1].html).toContain('aiMeta:1,m');
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

    test('onAIClear resets the conversation', () => {
        const { c, data } = mkController('x');
        data.messages = [{ role: 'user' }];
        c.onAIClear();
        expect(data.messages).toEqual([]);
        expect(data.question).toBe('');
    });
});
