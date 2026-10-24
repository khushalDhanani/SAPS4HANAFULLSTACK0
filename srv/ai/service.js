'use strict';

const cds = require('@sap/cds');
const aiClient = require('../common/aiClient');
const getLogger = require('../common/logger');

const logger = getLogger('ai-service');
const MAX_QUESTION_LENGTH = aiClient.num('AI_MAX_QUESTION_LENGTH', 8000);
const MAX_SYSTEM_LENGTH = aiClient.num('AI_MAX_SYSTEM_LENGTH', 96000);
const MAX_HISTORY = aiClient.num('AI_MAX_HISTORY', 20);
const CREDENTIAL_REGEX = /(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*)|(?:Basic\s+[A-Za-z0-9+/]+=*)|(?:nvapi-[A-Za-z0-9\-_]{20,})|(?:sk-[A-Za-z0-9\-_]{20,})/gi;
const SAFE_MODEL_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_\-.:]*(?:\/[a-zA-Z0-9_\-.:]+)*$/;

function scrub(str) {
  return String(str || '').replace(CREDENTIAL_REGEX, '[REDACTED_CREDENTIAL]');
}

/**
 * Validates chat input ({messages, system?, model?}) and returns the full message list for the provider.
 * Throws {status, message} on invalid input. Enforces untrusted input defense:
 * - Drops unauthorized roles (e.g. injected 'system' in messages history).
 * - Enforces character length limits on user messages and system prompt.
 * - Scrubs sensitive tokens/credentials.
 * - Validates model identifier against safe alphanumeric pattern.
 */
function prepareChat(data) {
  if (!data || typeof data !== 'object') {
    throw Object.assign(new Error('chat request body must be an object'), { status: 400 });
  }

  // Model validation
  let model;
  if (data.model !== undefined && data.model !== null && data.model !== '') {
    if (typeof data.model !== 'string' || !SAFE_MODEL_REGEX.test(data.model) || data.model.includes('..')) {
      throw Object.assign(new Error('invalid model name format'), { status: 400 });
    }
    model = data.model;
  }

  // System prompt validation and redaction
  let system = typeof data.system === 'string' && data.system.trim() ? data.system.trim() : null;
  if (system) {
    if (system.length > MAX_SYSTEM_LENGTH) {
      throw Object.assign(new Error(`system prompt exceeds ${MAX_SYSTEM_LENGTH} characters`), { status: 400 });
    }
    system = scrub(system);
  }

  // User and Assistant messages validation
  const msgs = (data.messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: scrub(m.content.trim()) }))
    .slice(-MAX_HISTORY);

  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user' || !last.content) {
    throw Object.assign(new Error('a user message is required'), { status: 400 });
  }

  if (last.content.length > MAX_QUESTION_LENGTH) {
    throw Object.assign(new Error(`question exceeds ${MAX_QUESTION_LENGTH} characters`), { status: 400 });
  }

  for (const m of msgs.slice(0, -1)) {
    if (m.content.length > MAX_QUESTION_LENGTH) {
      throw Object.assign(new Error(`message exceeds ${MAX_QUESTION_LENGTH} characters`), { status: 400 });
    }
  }

  return { messages: system ? [{ role: 'system', content: system }, ...msgs] : msgs, model };
}

/** Maps provider errors to HTTP status + message, ensuring credentials are never reflected. */
function mapError(err) {
  const safeMsg = scrub(err.message || 'unknown error');
  if (err.code === 'AI_NOT_CONFIGURED') return { status: 503, message: safeMsg };
  return { status: err.status === 429 ? 429 : 502, message: `AI provider error: ${safeMsg}` };
}

function isAuthenticated(user) {
  return Boolean(
    user &&
    user.id &&
    user.id !== 'anonymous' &&
    !user._is_anonymous &&
    typeof user.is === 'function' &&
    user.is('authenticated-user')
  );
}

/**
 * Express handler for POST /ai/chat/stream — Server-Sent Events with {delta} chunks, then {done, model}.
 * Mounted from server.js behind the CAP auth middlewares; strictly requires an authenticated user.
 */
async function streamHandler(req, res) {
  const user = (req && req.user) || (cds.context && cds.context.user);
  if (!isAuthenticated(user)) {
    logger.warn('streamHandler: rejected unauthenticated request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
    logger.error(`chat/stream failed: ${err.status || ''} ${m.message}`);
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
    if (!isAuthenticated(req && req.user)) {
      return req.reject(401, 'Unauthorized');
    }
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
      const m = mapError(err);
      logger.error(`${req.event} failed: ${err.status || ''} ${m.message}`);
      return req.reject(m.status, m.message);
    }
  }
};
module.exports.prepareChat = prepareChat;
module.exports.streamHandler = streamHandler;
