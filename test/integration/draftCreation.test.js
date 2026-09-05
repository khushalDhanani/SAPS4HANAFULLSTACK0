const httpClient = require('@sap-cloud-sdk/http-client');
const purchaseOrderAdapter = require('../../srv/integration/s4hana/PurchaseOrderAdapter');
const { mapToS4Payload } = require('../../srv/integration/s4hana/PurchaseOrderMapper');
const validPayload = require('../fixtures/validPOPayload.json');
const draftResponseFixture = require('../fixtures/draftResponse.json');
const s4Errors = require('../fixtures/s4ErrorResponses.json');

describe('Integration: S/4 Draft Creation', () => {

    it('should create draft entity via C_PurchaseOrderTP and extract DraftUUID and session context', async () => {
        const mappedPayload = mapToS4Payload(validPayload.header, validPayload.items);

        const mockExecuteHttp = jest.fn().mockResolvedValue({
            status: 201,
            data: draftResponseFixture,
            request: {
                getHeader: (h) => {
                    if (h === 'cookie') return 'SAP_SESSIONID_DS4=xyz123';
                    if (h === 'x-csrf-token') return 'mock-csrf-token-abc';
                    return undefined;
                }
            }
        });

        const draftResult = await purchaseOrderAdapter.createDraft(mappedPayload, {
            destination: { url: 'http://mock-s4:8000' },
            executeHttpRequest: mockExecuteHttp
        });

        expect(mockExecuteHttp).toHaveBeenCalledTimes(1);
        const callArgs = mockExecuteHttp.mock.calls[0];
        expect(callArgs[0]).toEqual({ url: 'http://mock-s4:8000' });
        expect(callArgs[1].method).toBe('post');
        expect(callArgs[1].url).toContain('/C_PurchaseOrderTP');
        expect(callArgs[1].data).toEqual(mappedPayload);

        expect(draftResult).toHaveProperty('draftUUID', '0050569a-7c9b-1edb-8fa4-d01c06834abc');
        expect(draftResult.draftData).toHaveProperty('PurchaseOrder', '4500001001');
        expect(draftResult.cookie).toBe('SAP_SESSIONID_DS4=xyz123');
        expect(draftResult.token).toBe('mock-csrf-token-abc');
    });

    it('should throw an error if S/4 does not return a DraftUUID', async () => {
        const mockExecuteHttp = jest.fn().mockResolvedValue({
            status: 201,
            data: { d: { PurchaseOrder: '4500001001' } }, // Missing DraftUUID
            request: {}
        });

        await expect(purchaseOrderAdapter.createDraft({}, {
            destination: { url: 'http://mock-s4:8000' },
            executeHttpRequest: mockExecuteHttp
        })).rejects.toThrow('DraftUUID not returned from draft creation');
    });

    it('should throw and NOT swallow errors when S/4 Gateway rejects draft creation', async () => {
        const error = new Error('Request failed with status code 400');
        error.response = {
            status: 400,
            data: s4Errors.addressIncompleteError
        };

        const mockExecuteHttp = jest.fn().mockRejectedValue(error);

        await expect(purchaseOrderAdapter.createDraft({}, {
            destination: { url: 'http://mock-s4:8000' },
            executeHttpRequest: mockExecuteHttp
        })).rejects.toThrow('Request failed with status code 400');
    });

});
