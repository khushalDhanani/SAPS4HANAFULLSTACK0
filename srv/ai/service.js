'use strict';

const cds = require('@sap/cds');
const aiClient = require('../common/aiClient');
const getLogger = require('../common/logger');

const logger = getLogger('ai-service');
const MAX_QUESTION_LENGTH = aiClient.num('AI_MAX_QUESTION_LENGTH', 8000);
const MAX_HISTORY = aiClient.num('AI_MAX_HISTORY', 20);

/**
 * Validates chat input ({messages, system?, model?}) and returns the full message list for the provider.
 * Throws {status, message} on invalid input.
 */
function prepareChat(data) {
  const msgs = (data.messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .slice(-MAX_HISTORY);
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user' || !last.content) throw Object.assign(new Error('a user message is required'), { status: 400 });
  if (last.content.length > MAX_QUESTION_LENGTH) {
    throw Object.assign(new Error(`question exceeds ${MAX_QUESTION_LENGTH} characters`), { status: 400 });
  }
  const system = typeof data.system === 'string' && data.system.trim() ? data.system : null;
  return { messages: system ? [{ role: 'system', content: system }, ...msgs] : msgs, model: data.model || undefined };
}

/** Maps provider errors to HTTP status + message. */
function mapError(err) {
  if (err.code === 'AI_NOT_CONFIGURED') return { status: 503, message: err.message };
  return { status: err.status === 429 ? 429 : 502, message: `AI provider error: ${err.message}` };
}

/**
 * Express handler for POST /ai/chat/stream — Server-Sent Events with {delta} chunks, then {done, model}.
 * Mounted from server.js behind the CAP auth middlewares; requires an authenticated user.
 */
async function streamHandler(req, res) {
  const user = cds.context?.user;
  if (!user || !user.is || !user.is('authenticated-user')) return res.status(401).json({ error: 'Unauthorized' });
  let input;
  try { input = prepareChat(req.body || {}); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  try {
    const gen = aiClient.chatStream(input.messages, { model: input.model });
    let r;
    while (!(r = await gen.next()).done) send(typeof r.value === 'string' ? { delta: r.value } : r.value);
    send({ done: true, model: r.value?.model || aiClient.getDefaultModel(), finishReason: r.value?.finishReason || null });
  } catch (err) {
    const m = mapError(err);
    logger.error(`chat/stream failed: ${err.status || ''} ${err.message}`);
    send({ error: m.message, status: m.status });
  }
  res.end();
}

module.exports = class AIService extends cds.ApplicationService {
  async init() {
    this.on('askAI', (req) => this._run(req, { messages: [{ role: 'user', content: req.data.question || '' }], system: req.data.system, model: req.data.model }));
    this.on('chat', (req) => this._run(req, req.data));
    return super.init();
  }

  async _run(req, data) {
    let input;
    try { input = prepareChat(data); } catch (e) { return req.reject(e.status || 400, e.message); }
    try {
      const result = await aiClient.chat(input.messages, { model: input.model });
      return {
        answer: result.content,
        model: result.model,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null
      };
    } catch (err) {
      logger.error(`${req.event} failed: ${err.status || ''} ${err.message}`);
      const m = mapError(err);
      return req.reject(m.status, m.message);
    }
  }
};
module.exports.prepareChat = prepareChat;
module.exports.streamHandler = streamHandler;
