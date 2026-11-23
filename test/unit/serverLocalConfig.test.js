// Loads the real server.js with fake connection values. .env files are not read and nothing connects to SAP.
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('@sap-cloud-sdk/connectivity', () => ({
    ...jest.requireActual('@sap-cloud-sdk/connectivity'),
    registerDestination: jest.fn()
}));

const SERVICES = [
    'C_PURCHASEORDER_FS_SRV',
    'MM_PUR_PO_MAINT_V2_SRV',
    'SD_F2370_INQY_WL_SRV',
    'SD_F2369_INQY_FS_SRV',
    'SD_F1873_SO_WL_SRV'
];

describe('Unit: server.js local S/4 connection setup', () => {
    const originalEnv = { ...process.env };
    let cds;
    let registerDestination;

    beforeAll(() => {
        Object.assign(process.env, {
            NODE_ENV: 'development',
            S4_DESTINATION_URL: 'https://sap-host.invalid:44300',
            S4_DESTINATION_NAME: 'TEST_DESTINATION',
            S4_USERNAME: 'test-user',
            S4_PASSWORD: 'test-password',
            S4_CLIENT: '999'
        });
        cds = require('@sap/cds');
        ({ registerDestination } = require('@sap-cloud-sdk/connectivity'));
        require('../../server');
    });

    afterAll(() => {
        process.env = { ...originalEnv };
    });

    it.each(SERVICES)('gives %s its own URL and the shared logon', (service) => {
        const required = cds.env.requires[service];

        expect(required.credentials).toEqual({
            url: `https://sap-host.invalid:44300/sap/opu/odata/sap/${service}`,
            authentication: 'BasicAuthentication',
            username: 'test-user',
            password: 'test-password',
            headers: { 'sap-client': '999' }
        });
        expect(required.kind).toBe('odata-v2');
        expect(required.model).toBe(`srv/external/${service}`);
        expect(cds.requires[service].credentials).toEqual(required.credentials);
    });

    it('registers the one local destination', () => {
        expect(registerDestination).toHaveBeenCalledTimes(1);
        expect(registerDestination).toHaveBeenCalledWith({
            name: 'TEST_DESTINATION',
            url: 'https://sap-host.invalid:44300',
            username: 'test-user',
            password: 'test-password',
            authentication: 'BasicAuthentication',
            headers: { 'sap-client': '999' }
        });
    });
});
