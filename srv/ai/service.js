'use strict';

const cds = require('@sap/cds');
const aiClient = require('../common/aiClient');
const getLogger = require('../common/logger');

const logger = getLogger('ai-service');
const MAX_QUESTION_LENGTH = aiClient.num('AI_MAX_QUESTION_LENGTH', 8000);
const MAX_HISTORY = aiClient.num('AI_MAX_HISTORY', 20);

module.exports = class AIService extends cds.ApplicationService {
  async init() {
    this.on('askAI', (req) => this._run(req, [{ role: 'user', content: (req.data.question || '').trim() }]));
    this.on('chat', (req) => {
      const msgs = (req.data.messages || [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content.trim() }))
        .slice(-MAX_HISTORY);
      return this._run(req, msgs);
    });
    return super.init();
  }

  async _run(req, messages) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user' || !last.content) return req.reject(400, 'a user message is required');
    if (last.content.length > MAX_QUESTION_LENGTH) {
      return req.reject(400, `question exceeds ${MAX_QUESTION_LENGTH} characters`);
    }
    const system = req.data.system || undefined;
    const all = system ? [{ role: 'system', content: system }, ...messages] : messages;
    try {
      const result = await aiClient.chat(all, { model: req.data.model || undefined });
      return {
        answer: result.content,
        model: result.model,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null
      };
    } catch (err) {
      if (err.code === 'AI_NOT_CONFIGURED') return req.reject(503, err.message);
      logger.error(`${req.event} failed: ${err.status || ''} ${err.message}`);
      const status = err.status === 429 ? 429 : 502;
      return req.reject(status, `AI provider error: ${err.message}`);
    }
  }
};
