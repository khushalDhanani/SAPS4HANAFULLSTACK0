'use strict';

/** The service must hand controllers arrays for `returns array of` functions (OData V4 wraps them in { value }). */
describe('Frontend CustomerReturnService collection functions', () => {
    let Service;
    beforeAll(() => {
        const origSap = global.sap;
        global.sap = { ui: { define: (deps, factory) => { Service = factory({ get: jest.fn() }, function Filter() {}, {}, {}); } } };
        require('../../../app/fiori-app/webapp/modules/sd/customer-return/service/CustomerReturnService');
        global.sap = origSap;
    });

    // A V4 model whose function binding returns what OData V4 serializes for `array of`
    const modelReturning = (result) => {
        const binding = { setParameter: jest.fn(), execute: jest.fn().mockResolvedValue(), getBoundContext: () => ({ getObject: () => result }) };
        return { bindContext: jest.fn(() => binding), binding };
    };

    it('getReferenceDocuments unwraps { value: [...] } to the rows', async () => {
        const rows = [{ ReferenceSDDocument: '5000527' }];
        const m = modelReturning({ '@odata.context': '$metadata#Collection', value: rows });
        await expect(Service.getReferenceDocuments('5000', 20, m)).resolves.toEqual(rows);
        expect(m.binding.setParameter).toHaveBeenCalledWith('search', '5000');
    });

    it('getReturnReasons unwraps { value: [...] } to the rows', async () => {
        const rows = [{ Reason: '101', Description: 'Damaged' }];
        await expect(Service.getReturnReasons(modelReturning({ value: rows }))).resolves.toEqual(rows);
    });

    it.each([[null], [undefined], [{}], [[{ a: 1 }]]])('returns an array for %p', async (result) => {
        const out = await Service.getReturnReasons(modelReturning(result));
        expect(Array.isArray(out)).toBe(true);
    });
});
