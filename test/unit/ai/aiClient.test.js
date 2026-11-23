'use strict';

const mockCreate = jest.fn();
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } }
})));

const mockChatCompletion = jest.fn();
const mockStream = jest.fn();
const mockOrchestrationClient = jest.fn().mockImplementation(() => ({ chatCompletion: mockChatCompletion, stream: mockStream }));
jest.mock('@sap-ai-sdk/orchestration', () => ({
  OrchestrationClient: mockOrchestrationClient,
  buildDpiMaskingProvider: (cfg) => ({ type: 'sap_data_privacy_integration', ...cfg })
}));

const aiClient = require('../../../srv/common/aiClient');
const VALID_KEY = '{"clientid":"c","clientsecret":"s","url":"https://auth.example","serviceurls":{"AI_API_URL":"https://api.example"}}';

describe('aiClient', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.AICORE_SERVICE_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.AI_PROVIDER;
    aiClient._reset();
    mockCreate.mockReset();
    mockChatCompletion.mockReset();
    mockStream.mockReset();
    mockOrchestrationClient.mockClear();
  });
  afterAll(() => { process.env = origEnv; });

  describe('no silent provider: business data only leaves on an explicit choice', () => {
    const drain = async (gen) => { let r; while (!(r = await gen.next()).done); return r.value; };

    test.each([
      ['unset', undefined],
      ['blank', '  '],
      ['an unknown value', 'nvida']
    ])('refuses when AI_PROVIDER is %s, even with keys present', async (_name, value) => {
      if (value !== undefined) process.env.AI_PROVIDER = value;
      process.env.NVIDIA_API_KEY = 'test-key';
      process.env.AICORE_SERVICE_KEY = VALID_KEY;
      aiClient._reset();

      await expect(aiClient.askAI('hi')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', message: expect.stringContaining('AI_PROVIDER') });
      await expect(drain(aiClient.chatStream([{ role: 'user', content: 'hi' }]))).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockOrchestrationClient).not.toHaveBeenCalled();
    });

    test('uses exactly the provider that was chosen', () => {
      expect(aiClient.getProvider()).toBe('');
      process.env.AICORE_SERVICE_KEY = VALID_KEY;
      expect(aiClient.getProvider()).toBe('');
      process.env.AI_PROVIDER = 'NVIDIA';
      expect(aiClient.getProvider()).toBe('nvidia');
      process.env.AI_PROVIDER = 'sap';
      expect(aiClient.getProvider()).toBe('sap');
    });
  });

  test('sap: streaming applies the same masking and resource group as chat', async () => {
    process.env.AI_PROVIDER = 'sap';
    process.env.AICORE_SERVICE_KEY = VALID_KEY;
    process.env.AI_SAP_RESOURCE_GROUP = 'rg1';
    process.env.AI_SAP_MASK_PII = 'true';
    mockStream.mockResolvedValue({ stream: { toContentStream: async function* () { yield 'Hi'; } } });

    const gen = aiClient.chatStream([{ role: 'user', content: 'x' }]);
    const out = []; let r;
    while (!(r = await gen.next()).done) out.push(r.value);

    expect(out).toEqual(['Hi']);
    const [config, deployment] = mockOrchestrationClient.mock.calls[0];
    expect(config.masking.providers[0]).toMatchObject({ method: 'pseudonymization', entities: expect.arrayContaining(['profile-person']) });
    expect(deployment).toEqual({ resourceGroup: 'rg1' });
  });

  test('nvidia: throws AI_NOT_CONFIGURED when key missing', async () => {
    process.env.AI_PROVIDER = 'nvidia';
    await expect(aiClient.askAI('hi')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  test('nvidia: sends question and returns content, model and usage', async () => {
    process.env.AI_PROVIDER = 'nvidia';
    process.env.NVIDIA_API_KEY = 'test-key';
    process.env.NVIDIA_MODEL = 'test/model';
    mockCreate.mockResolvedValue({
      model: 'test/model',
      choices: [{ message: { content: 'Hello back' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
    });
    const res = await aiClient.askAI('Hello', { system: 'Be brief' });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'test/model',
      messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hello' }]
    }));
    expect(res).toMatchObject({ content: 'Hello back', model: 'test/model', finishReason: 'stop', usage: { total_tokens: 5 } });
  });

  test('nvidia: falls back to active default model if configured model is deprecated', async () => {
    process.env.AI_PROVIDER = 'nvidia';
    process.env.NVIDIA_API_KEY = 'test-key';
    delete process.env.NVIDIA_MODEL;
    expect(aiClient.getDefaultModel()).toBe('meta/llama-3.2-11b-vision-instruct');

    process.env.NVIDIA_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
    expect(aiClient.getDefaultModel()).toBe('meta/llama-3.2-11b-vision-instruct');

    mockCreate.mockResolvedValue({
      model: 'meta/llama-3.2-11b-vision-instruct',
      choices: [{ message: { content: 'OK' } }]
    });
    // Explicit deprecated model in options is also intercepted and routed to the active model
    await aiClient.askAI('test', { model: 'nvidia/nemotron-3-super-120b-a12b' });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'meta/llama-3.2-11b-vision-instruct'
    }));
  });

  test('sap: throws AI_NOT_CONFIGURED when forced without service key', async () => {
    process.env.AI_PROVIDER = 'sap';
    await expect(aiClient.askAI('hi')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  test('sap: uses OrchestrationClient with history split, model params and masking flag', async () => {
    process.env.AI_PROVIDER = 'sap';
    process.env.AICORE_SERVICE_KEY = VALID_KEY;
    process.env.AI_SAP_MODEL = 'gpt-4.1';
    process.env.AI_SAP_RESOURCE_GROUP = 'rg1';
    process.env.AI_SAP_MASK_PII = 'true';
    process.env.AI_MAX_TOKENS = '333';
    mockChatCompletion.mockResolvedValue({
      getContent: () => 'SAP says hi',
      getTokenUsage: () => ({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }),
      getFinishReason: () => 'stop'
    });
    const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
    const res = await aiClient.chat(msgs);
    const [config, deployment] = mockOrchestrationClient.mock.calls[0];
    expect(config.promptTemplating.model).toEqual({ name: 'gpt-4.1', params: { temperature: 0.2, max_tokens: 333 } });
    expect(config.masking.providers[0]).toMatchObject({ method: 'pseudonymization', entities: expect.arrayContaining(['profile-person']) });
    expect(deployment).toEqual({ resourceGroup: 'rg1' });
    expect(mockChatCompletion).toHaveBeenCalledWith(
      { messages: [msgs[3]], messagesHistory: msgs.slice(0, 3) }, { timeout: 60000 });
    expect(res).toEqual({ content: 'SAP says hi', model: 'gpt-4.1', finishReason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } });
    expect(aiClient.getDefaultModel()).toBe('gpt-4.1');
  });

  test('sap: no masking / no resource group by default', async () => {
    process.env.AI_PROVIDER = 'sap';
    process.env.AICORE_SERVICE_KEY = VALID_KEY;
    mockChatCompletion.mockResolvedValue({ getContent: () => '', getTokenUsage: () => ({}), getFinishReason: () => undefined });
    await aiClient.askAI('q');
    const [config, deployment] = mockOrchestrationClient.mock.calls[0];
    expect(config.masking).toBeUndefined();
    expect(deployment).toEqual({});
  });

  test('nvidia chatStream yields content deltas, thinking heartbeats and the finish reason', async () => {
    process.env.AI_PROVIDER = 'nvidia';
    process.env.NVIDIA_API_KEY = 'k';
    async function* fake() {
      yield { model: 'm', choices: [{ delta: { reasoning_content: 'hmm' } }] };
      yield { model: 'm', choices: [{ delta: { content: 'Hel' } }] };
      yield { model: 'm', choices: [{ delta: { content: 'lo' }, finish_reason: 'length' }] };
    }
    mockCreate.mockResolvedValue(fake());
    const gen = aiClient.chatStream([{ role: 'user', content: 'x' }]);
    const out = []; let r;
    while (!(r = await gen.next()).done) out.push(r.value);
    expect(out).toEqual([{ thinking: true }, 'Hel', 'lo']);
    expect(r.value).toEqual({ model: 'm', finishReason: 'length' });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ stream: true });
  });

  test('num() reads numeric env with fallback', () => {
    process.env.AI_MAX_TOKENS = '256';
    process.env.AI_TEMPERATURE = '';
    expect(aiClient.num('AI_MAX_TOKENS', 1024)).toBe(256);
    expect(aiClient.num('AI_TEMPERATURE', 0.2)).toBe(0.2);
    expect(aiClient.num('AI_NOPE', 7)).toBe(7);
  });
});
