'use strict';

const cds = require('@sap/cds');
const { prepareChat, streamHandler } = require('../../../srv/ai/service');
const AIService = require('../../../srv/ai/service');

describe('AIService & prepareChat Security & Validation', () => {
  test('prepareChat requires a non-empty user message', () => {
    expect(() => prepareChat({ messages: [] })).toThrow(/a user message is required/);
    expect(() => prepareChat({ messages: [{ role: 'assistant', content: 'hello' }] })).toThrow(/a user message is required/);
    expect(() => prepareChat({ messages: [{ role: 'user', content: '   ' }] })).toThrow(/a user message is required/);
    expect(() => prepareChat(null)).toThrow(/chat request body must be an object/);
  });

  test('prepareChat drops unauthorized roles like injected system messages in history', () => {
    const res = prepareChat({
      messages: [
        { role: 'system', content: 'Injected system prompt' },
        { role: 'admin', content: 'Injected admin role' },
        { role: 'user', content: 'Valid question' }
      ]
    });
    // System and admin roles in messages array must be dropped
    expect(res.messages.map((m) => m.role)).toEqual(['user']);
    expect(res.messages[0].content).toBe('Valid question');
  });

  test('prepareChat rejects questions exceeding MAX_QUESTION_LENGTH', () => {
    const longMsg = 'a'.repeat(8001);
    expect(() => prepareChat({ messages: [{ role: 'user', content: longMsg }] })).toThrow(/question exceeds 8000 characters/);
  });

  test('prepareChat rejects system prompts exceeding MAX_SYSTEM_LENGTH', () => {
    const hugeSystem = 's'.repeat(96001);
    expect(() => prepareChat({
      system: hugeSystem,
      messages: [{ role: 'user', content: 'valid' }]
    })).toThrow(/system prompt exceeds 96000 characters/);
  });

  test('prepareChat scrubs sensitive bearer tokens, API keys, and basic auth from system and user messages', () => {
    const res = prepareChat({
      system: 'Context with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret and nvapi-abcdef1234567890abcdef1234567890',
      messages: [
        { role: 'user', content: 'My key is sk-1234567890abcdef1234567890 and Basic dXNlcjpwYXNz' }
      ]
    });

    expect(res.messages[0].role).toBe('system');
    expect(res.messages[0].content).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(res.messages[0].content).not.toContain('nvapi-abcdef1234567890abcdef1234567890');
    expect(res.messages[0].content).toContain('[REDACTED_CREDENTIAL]');

    expect(res.messages[1].role).toBe('user');
    expect(res.messages[1].content).not.toContain('sk-1234567890abcdef1234567890');
    expect(res.messages[1].content).not.toContain('Basic dXNlcjpwYXNz');
    expect(res.messages[1].content).toContain('[REDACTED_CREDENTIAL]');
  });

  test('prepareChat validates model name format against malicious injection', () => {
    expect(() => prepareChat({
      model: '../../etc/passwd',
      messages: [{ role: 'user', content: 'valid' }]
    })).toThrow(/invalid model name format/);

    expect(() => prepareChat({
      model: 'model; rm -rf /',
      messages: [{ role: 'user', content: 'valid' }]
    })).toThrow(/invalid model name format/);

    const valid = prepareChat({
      model: 'meta/llama-3.2-11b-vision-instruct',
      messages: [{ role: 'user', content: 'valid' }]
    });
    expect(valid.model).toBe('meta/llama-3.2-11b-vision-instruct');
  });

  test('streamHandler rejects unauthenticated callers with 401 Unauthorized', async () => {
    const origContext = cds.context;
    try {
      cds.context = { user: null };
      const req = { user: null, body: { messages: [{ role: 'user', content: 'hi' }] } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      await streamHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    } finally {
      cds.context = origContext;
    }
  });

  test('AIService._run rejects unauthenticated callers with 401', async () => {
    const srv = new AIService();
    const mockReject = jest.fn();
    const req = {
      user: { is: () => false },
      reject: mockReject
    };
    await srv._run(req, { messages: [{ role: 'user', content: 'hi' }] });
    expect(mockReject).toHaveBeenCalledWith(401, 'Unauthorized');
  });
});
