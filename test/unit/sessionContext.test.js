const SessionContext = require('../../srv/integration/s4hana/SessionContext');
const purchaseOrderAdapter = require('../../srv/integration/s4hana/PurchaseOrderAdapter');

describe('Unit: SessionContext & Thread-Safe Session Isolation', () => {

    it('should extract cookies and CSRF token from a standard HTTP response', () => {
        const mockResponse = {
            headers: {
                'set-cookie': [
                    'SAP_SESSIONID_DS4_220=session-abc-123; path=/; HttpOnly',
                    'sap-usercontext=sap-client=220; path=/'
                ],
                'x-csrf-token': 'token-xyz-789'
            },
            request: {
                getHeader: (h) => (h === 'cookie' ? 'MYSAPSSO2=sso-token' : undefined)
            }
        };

        const session = SessionContext.fromResponse(mockResponse, {
            draftUUID: 'uuid-123',
            draftData: { PurchaseOrder: '4500001001' }
        });

        expect(session.csrfToken).toBe('token-xyz-789');
        expect(session.token).toBe('token-xyz-789');
        expect(session.cookie).toContain('MYSAPSSO2=sso-token');
        expect(session.cookie).toContain('SAP_SESSIONID_DS4_220=session-abc-123');
        expect(session.cookie).toContain('sap-usercontext=sap-client=220');
        expect(session.draftUUID).toBe('uuid-123');
        expect(session.draftData.PurchaseOrder).toBe('4500001001');
    });

    it('should verify that PurchaseOrderAdapter singleton has NO mutable session properties', () => {
        expect(purchaseOrderAdapter._csrfToken).toBeUndefined();
        expect(purchaseOrderAdapter._csrfCookie).toBeUndefined();
        expect(purchaseOrderAdapter._sessionContext).toBeUndefined();
    });

    it('should isolate session context across concurrent requests without crosstalk', async () => {
        // Simulate two concurrent requests running in parallel with distinct sessions
        const mockExecuteHttp = jest.fn().mockImplementation((dest, config) => {
            if (config.url.includes('/C_PurchaseOrderTPActivation')) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        d: {
                            PurchaseOrder: config.params.PurchaseOrder.replace(/'/g, ''),
                            IsActiveEntity: true,
                            echoedCookie: config.headers?.Cookie,
                            echoedToken: config.headers?.['X-CSRF-Token']
                        }
                    }
                });
            }

            // Draft creation
            const isReq1 = config.data.Supplier === '10300001';
            return Promise.resolve({
                status: 201,
                data: {
                    d: {
                        PurchaseOrder: isReq1 ? '4500001001' : '4500001002',
                        DraftUUID: isReq1 ? 'uuid-req-1' : 'uuid-req-2'
                    }
                },
                headers: {
                    'set-cookie': [isReq1 ? 'SESSION_ID=user-1-session' : 'SESSION_ID=user-2-session'],
                    'x-csrf-token': isReq1 ? 'csrf-token-user-1' : 'csrf-token-user-2'
                }
            });
        });

        const req1Payload = {
            Supplier: '10300001',
            CompanyCode: '1010'
        };
        const req2Payload = {
            Supplier: '10300002',
            CompanyCode: '2020'
        };

        // Run both requests concurrently
        const [result1, result2] = await Promise.all([
            purchaseOrderAdapter.createPurchaseOrder(req1Payload, {
                destination: { url: 'http://mock-s4:8000' },
                executeHttpRequest: mockExecuteHttp
            }),
            purchaseOrderAdapter.createPurchaseOrder(req2Payload, {
                destination: { url: 'http://mock-s4:8000' },
                executeHttpRequest: mockExecuteHttp
            })
        ]);

        // Assert Request 1 activated with ONLY user 1's cookies & token
        expect(result1.PurchaseOrder).toBe('4500001001');
        expect(result1.echoedCookie).toBe('SESSION_ID=user-1-session');
        expect(result1.echoedToken).toBe('csrf-token-user-1');

        // Assert Request 2 activated with ONLY user 2's cookies & token
        expect(result2.PurchaseOrder).toBe('4500001002');
        expect(result2.echoedCookie).toBe('SESSION_ID=user-2-session');
        expect(result2.echoedToken).toBe('csrf-token-user-2');

        // Verify adapter singleton remains completely stateless
        expect(purchaseOrderAdapter._csrfToken).toBeUndefined();
        expect(purchaseOrderAdapter._csrfCookie).toBeUndefined();
    });

});
