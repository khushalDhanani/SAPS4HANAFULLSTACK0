const { sdValueHelpConfig } = require('../../../srv/sd/sales-inquiry/handlers/valueHelp.config');
const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');

const configOf = (entity) => sdValueHelpConfig.find((cfg) => cfg.entities.includes(entity));

// The adapters are real; only the SAP service clients behind them are faked. Row values are hand-written, not a proven SAP shape.
describe('Unit: Sales Inquiry Value Help readers', () => {
    let services;

    beforeEach(() => {
        services = {
            wl: { run: jest.fn().mockResolvedValue([{ SalesOrganization: '1000' }]) },
            fs: { run: jest.fn().mockResolvedValue([{ SalesDocumentType: 'ZIN', SalesDocumentType_Text: 'Inquiry' }]) },
            poFs: { run: jest.fn().mockResolvedValue([{ UnitOfMeasure: 'KG' }]) },
            poMaint: { run: jest.fn().mockResolvedValue([{ Plant: '1120' }]) }
        };
        salesInquiryAdapter.s4hanaWL = services.wl;
        salesInquiryAdapter.s4hanaFS = services.fs;
        purchaseOrderAdapter.s4hana = services.poFs;
        purchaseOrderAdapter.s4hanaMaint = services.poMaint;
        salesInquiryAdapter.clearCache();
    });

    test('ContactPersonVH reads KNVK over RFC for the requested customer', async () => {
        const calls = [];
        salesInquiryAdapter.rfc = {
            readTable: async (table, fields, where) => {
                calls.push({ table, where });
                return [{ PARNR: '0000025799', KUNNR: '0000010514', NAME1: 'Suthar', NAMEV: 'Pradip', TELF1: '' }];
            }
        };
        const query = { SELECT: { where: [{ ref: ['Customer'] }, '=', { val: '10514' }] } };

        const rows = await configOf('ContactPersonVH').read(query);

        expect(calls).toEqual([{ table: 'KNVK', where: ["KUNNR = '0000010514'"] }]);
        expect(rows[0].ContactPerson).toBe('0000025799');
    });

    test('ContactPersonVH is filtered in memory and deduplicated by ContactPerson', () => {
        const cfg = configOf('ContactPersonVH');
        expect(cfg.filterInMemory).toBe(true);
        expect(cfg.entityDeduplicateBy).toEqual({ ContactPersonVH: 'ContactPerson' });
    });

    test('UnitOfMeasureVH reads the purchase order FS service, not the maintenance service', async () => {
        const query = { SELECT: {} };

        const rows = await configOf('UnitOfMeasureVH').read(query);

        expect(services.poFs.run).toHaveBeenCalledWith(query);
        expect(services.poMaint.run).not.toHaveBeenCalled();
        expect(rows).toEqual([{ UnitOfMeasure: 'KG' }]);
    });

    test('PlantVH reads the purchase order maintenance service, not the FS service', async () => {
        const query = { SELECT: {} };

        const rows = await configOf('PlantVH').read(query);

        expect(services.poMaint.run).toHaveBeenCalledWith(query);
        expect(services.poFs.run).not.toHaveBeenCalled();
        expect(rows).toEqual([{ Plant: '1120' }]);
    });

    test('PlantVH is deduplicated by Plant', () => {
        expect(configOf('PlantVH').entityDeduplicateBy).toEqual({ PlantVH: 'Plant' });
    });

    test('SalesOrganizationVH reads the inquiry worklist service, not the factsheet service', async () => {
        const query = { SELECT: {} };

        const rows = await configOf('SalesOrganizationVH').read(query);

        expect(services.wl.run).toHaveBeenCalledWith(query);
        expect(services.fs.run).not.toHaveBeenCalled();
        expect(rows).toEqual([{ SalesOrganization: '1000' }]);
    });

    test('SalesInquiryTypeVH reads I_SalesDocumentType from the factsheet service and maps it', async () => {
        const rows = await configOf('SalesInquiryTypeVH').read();

        expect(services.fs.run.mock.calls[0][0].SELECT.from.ref[0]).toBe('SD_F2369_INQY_FS_SRV.I_SalesDocumentType');
        expect(services.wl.run).not.toHaveBeenCalled();
        expect(rows[0].SalesDocumentType).toBe('ZIN');
        expect(rows[0].SalesDocumentTypeName).toBe('Inquiry');
    });

    test('SalesInquiryTypeVH is deduplicated by SalesDocumentType', () => {
        expect(configOf('SalesInquiryTypeVH').entityDeduplicateBy).toEqual({ SalesInquiryTypeVH: 'SalesDocumentType' });
    });
});
