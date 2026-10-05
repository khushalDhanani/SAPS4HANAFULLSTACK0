const path = require('path');
const fs = require('fs');
const cds = require('@sap/cds');
const JournalEntryService = require('../../../srv/fi/journal-entry/service');

describe('JournalEntryService Configuration & Fail Loudly Validation', () => {
    it('package.json must not declare non-production default localhost URL for FAC_GL_JOURNALENTRY_VER_SRV', () => {
        const pkgPath = path.resolve(__dirname, '../../../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const fiConfig = pkg.cds?.requires?.FAC_GL_JOURNALENTRY_VER_SRV;

        expect(fiConfig).toBeDefined();
        expect(fiConfig.kind).toBe('odata-v2');
        expect(fiConfig.credentials?.url).toBeUndefined();
        expect(JSON.stringify(fiConfig)).not.toContain('localhost:5000');
    });

    it('fails loudly when credentials are unset and connection is attempted', async () => {
        // Without credentials configured, cds.connect.to throws immediately during service init
        await expect(cds.connect.to('FAC_GL_JOURNALENTRY_VER_SRV')).rejects.toThrow(
            /No credentials configured for "FAC_GL_JOURNALENTRY_VER_SRV"/
        );
    });

    it('JournalEntryService.READ handler forwards error and fails loudly', async () => {
        const srv = new JournalEntryService();
        const mockError = new Error('Remote service error');
        mockError.status = 502;
        
        let handler;
        srv.on = jest.fn((event, entity, fn) => {
            if (event === 'READ' && entity === 'JournalEntryItems') {
                handler = fn;
            }
        });

        const mockExternal = {
            run: jest.fn().mockRejectedValue(mockError)
        };
        const connectToSpy = jest.spyOn(cds.connect, 'to').mockResolvedValue(mockExternal);

        await srv.init();
        expect(handler).toBeDefined();

        const mockReq = {
            query: SELECT.from('JournalEntryItems'),
            error: jest.fn()
        };

        await handler(mockReq);

        expect(mockReq.error).toHaveBeenCalledWith(502, 'Remote service error');

        connectToSpy.mockRestore();
    });
});
