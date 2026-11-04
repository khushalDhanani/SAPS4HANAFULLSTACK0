'use strict';

const cds = require('@sap/cds');
const aiClient = require('../../srv/common/aiClient');

const { axios } = cds.test(__dirname + '/../../');

describe('Integration: POST /ai/chat/stream over real HTTP', () => {
    afterEach(() => jest.restoreAllMocks());

    it('answers 401 to a caller without credentials and sends nothing to the AI provider', async () => {
        const stream = jest.spyOn(aiClient, 'chatStream');

        const res = await axios.post('/ai/chat/stream', { messages: [{ role: 'user', content: 'hi' }] }, { validateStatus: () => true });

        expect(res.status).toBe(401);
        expect(stream).not.toHaveBeenCalled();
    });
});
