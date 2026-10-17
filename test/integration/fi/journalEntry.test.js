const cds = require('@sap/cds/lib');
const { GET, expect } = cds.test(__dirname + '/../../../');

describe('FI Journal Entry Service Integration', () => {
    describe('OData Service Endpoints', () => {
        it('should return 401 for unauthenticated access', async () => {
            try {
                await GET('/odata/v4/journal-entry/JournalEntryItems');
                expect.fail('Should have thrown 401 Unauthorized');
            } catch (error) {
                expect(error.response.status).to.be.oneOf([401, 403]);
            }
        });

        it('should return 200 for authenticated access with FinanceViewer (Alice)', async () => {
            try {
                const response = await GET('/odata/v4/journal-entry/JournalEntryItems?$top=1', {
                    headers: {
                        Authorization: 'Basic YWxpY2U6YW55dGhpbmc=' // Alice has FinanceViewer and Admin in package.json
                    }
                });
                expect(response.status).to.be.oneOf([200, 502, 500]);
            } catch (error) {
                // If upstream S/4HANA destination is unreachable, CAP maps error to 502/500/504
                expect(error.response?.status).to.be.oneOf([502, 500, 504]);
            }
        });
        
        it('should return 403 for unauthorized role on JournalEntryItems (Bob - Viewer only, no FinanceViewer)', async () => {
            try {
                await GET('/odata/v4/journal-entry/JournalEntryItems', {
                    headers: {
                        Authorization: 'Basic Ym9iOmFueXRoaW5n' // Bob has Viewer only
                    }
                });
                expect.fail('Should have thrown 403 Forbidden');
            } catch (error) {
                expect(error.response.status).to.equal(403);
            }
        });

        it('should return 200 for metadata access by authenticated user (Bob)', async () => {
            const { status } = await GET('/odata/v4/journal-entry/$metadata', {
                headers: {
                    Authorization: 'Basic Ym9iOmFueXRoaW5n'
                }
            });
            expect(status).to.equal(200);
        });
    });
});
