const masterData = require('../../../srv/integration/s4hana/sd/sales-inquiry/salesInquiryMasterData');

describe('Unit: getContactPersons validates the Customer filter before it reaches RFC_READ_TABLE', () => {
    const adapter = (readTable) => Object.assign({ masterDataCache: { get() {}, set() {} }, rfc: { readTable } }, masterData);
    const query = (val) => ({ SELECT: { where: [{ ref: ['Customer'] }, '=', { val }] } });

    it.each(["1' OR KUNNR LIKE '%", "1'--", '10 OR 1', 'ABC*'])('refuses %s with 400 and sends nothing to SAP', async (value) => {
        const readTable = jest.fn().mockResolvedValue([]);
        await expect(adapter(readTable).getContactPersons(query(value))).rejects.toMatchObject({ status: 400 });
        expect(readTable).not.toHaveBeenCalled();
    });

    it('pads a valid customer number and pushes it to SAP', async () => {
        const readTable = jest.fn().mockResolvedValue([]);
        await adapter(readTable).getContactPersons(query('1000123'));
        expect(readTable).toHaveBeenCalledWith('KNVK', expect.any(Array), ["KUNNR = '0001000123'"], 0);
    });
});
