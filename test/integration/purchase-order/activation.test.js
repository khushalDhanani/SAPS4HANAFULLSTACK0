const httpClient = require('@sap-cloud-sdk/http-client');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const activationResponseFixture = require('../../fixtures/activationResponse.json');
const s4Errors = require('../../fixtures/s4ErrorResponses.json');

describe('Integration: S/4 Activation', () => {

    it('should activate draft via C_PurchaseOrderTPActivation passing DraftUUID and session credentials', async () => {
        const draftData = {
            PurchaseOrder: '4500001001',
            DraftUUID: '0050569a-7c9b-1edb-8fa4-d01c06834abc'
        };

        const sessionContext = {
            cookie: 'SAP_SESSIONID_DS4=xyz123',
            token: 'mock-csrf-token-abc'
        };

        const mockExecuteHttp = jest.fn().mockResolvedValue({
            status: 200,
            data: activationResponseFixture
        });

        const activationResult = await purchaseOrderAdapter.activateDraft(draftData, sessionContext, {
            destination: { url: 'http://mock-s4:8000' },
            executeHttpRequest: mockExecuteHttp
        });

        expect(mockExecuteHttp).toHaveBeenCalledTimes(1);
        const callArgs = mockExecuteHttp.mock.calls[0];
        expect(callArgs[0]).toEqual({ url: 'http://mock-s4:8000' });
        expect(callArgs[1].method).toBe('post');
        expect(callArgs[1].url).toContain('/C_PurchaseOrderTPActivation');
        expect(callArgs[1].params).toEqual({
            PurchaseOrder: "'4500001001'",
            DraftUUID: "guid'0050569a-7c9b-1edb-8fa4-d01c06834abc'",
            IsActiveEntity: 'false',
            '$format': 'json'
        });
        expect(callArgs[1].headers).toHaveProperty('Cookie', 'SAP_SESSIONID_DS4=xyz123');
        expect(callArgs[1].headers).toHaveProperty('X-CSRF-Token', 'mock-csrf-token-abc');

        expect(activationResult).toHaveProperty('PurchaseOrder', '4500001001');
        expect(activationResult).toHaveProperty('IsActiveEntity', true);
    });

    it('should throw an error if DraftUUID is missing from draftData', async () => {
        const draftData = {
            PurchaseOrder: '4500001001'
            // Missing DraftUUID
        };

        await expect(purchaseOrderAdapter.activateDraft(draftData, {}, {
            destination: { url: 'http://mock-s4:8000' }
        })).rejects.toThrow('DraftUUID is required for activation');
    });

    it('should throw and NOT swallow errors when S/4 Gateway activation fails', async () => {
        const draftData = {
            PurchaseOrder: '4500001001',
            DraftUUID: '0050569a-7c9b-1edb-8fa4-d01c06834abc'
        };

        const error = new Error('Activation failed in S/4');
        error.response = {
            status: 500,
            data: s4Errors.simpleError
        };

        const mockExecuteHttp = jest.fn().mockRejectedValue(error);

        await expect(purchaseOrderAdapter.activateDraft(draftData, {}, {
            destination: { url: 'http://mock-s4:8000' },
            executeHttpRequest: mockExecuteHttp
        })).rejects.toThrow('Activation failed in S/4');
    });

});
