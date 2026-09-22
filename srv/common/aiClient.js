'use strict';

const getLogger = require('./logger');

const logger = getLogger('ai-client');

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const SAP_MODEL = 'gpt-4o';

let _nvidia = null;

/** Numeric env var with default; ignores blank/NaN. */
function num(name, fallback) {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && !Number.isNaN(v) ? v : fallback;
}

function flag(name) {
  return /^(1|true|yes)$/i.test((process.env[name] || '').trim());
}

/**
 * Provider selection (all from env, see .env.example):
 *   AI_PROVIDER = sap | nvidia   (default: sap when AICORE_SERVICE_KEY is set, else nvidia)
 * SAP AI Core (SAP Cloud SDK for AI, orchestration service):
 *   AICORE_SERVICE_KEY, AI_SAP_MODEL, AI_SAP_RESOURCE_GROUP, AI_SAP_MASK_PII
 * NVIDIA NIM (OpenAI-compatible):
 *   NVIDIA_API_KEY, NVIDIA_BASE_URL, NVIDIA_MODEL
 * Common: AI_TIMEOUT_MS, AI_MAX_RETRIES, AI_TEMPERATURE, AI_MAX_TOKENS
 */
/** True when AICORE_SERVICE_KEY is a real service key (valid JSON with https URLs), not a placeholder. */
function hasSapKey() {
  try {
    const k = JSON.parse(process.env.AICORE_SERVICE_KEY || '');
    return /^https:\/\//.test(k.url) && /^https:\/\//.test(k.serviceurls?.AI_API_URL) && !!k.clientid && !!k.clientsecret;
  } catch {
    return false;
  }
}

function getProvider() {
  const p = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (p) return p;
  return hasSapKey() ? 'sap' : 'nvidia';
}

function notConfigured(msg) {
  const err = new Error(`AI provider not configured: ${msg}`);
  err.code = 'AI_NOT_CONFIGURED';
  return err;
}

function getDefaultModel() {
  return getProvider() === 'sap'
    ? (process.env.AI_SAP_MODEL || SAP_MODEL).trim()
    : (process.env.NVIDIA_MODEL || NVIDIA_MODEL).trim();
}

// ---------------- SAP AI Core via @sap-ai-sdk/orchestration ----------------
async function chatSap(messages, options) {
  if (!hasSapKey()) throw notConfigured('AICORE_SERVICE_KEY is missing or not a valid service key JSON');
  const { OrchestrationClient, buildDpiMaskingProvider } = require('@sap-ai-sdk/orchestration');
  const model = options.model || getDefaultModel();
  const config = {
    promptTemplating: {
      model: {
        name: model,
        params: {
          temperature: options.temperature ?? num('AI_TEMPERATURE', 0.2),
          max_tokens: options.maxTokens ?? num('AI_MAX_TOKENS', 1024)
        }
      }
    }
  };
  if (flag('AI_SAP_MASK_PII')) {
    // SAP Data Privacy Integration: pseudonymize personal data before it reaches the LLM, restored in the answer.
    config.masking = {
      providers: [buildDpiMaskingProvider({
        method: 'pseudonymization',
        entities: ['profile-person', 'profile-email', 'profile-phone', 'profile-address']
      })]
    };
  }
  const deployment = {};
  if ((process.env.AI_SAP_RESOURCE_GROUP || '').trim()) deployment.resourceGroup = process.env.AI_SAP_RESOURCE_GROUP.trim();
  const client = new OrchestrationClient(config, deployment);
  const last = messages[messages.length - 1];
  const res = await client.chatCompletion(
    { messages: [last], messagesHistory: messages.slice(0, -1) },
    { timeout: num('AI_TIMEOUT_MS', 60000) }
  );
  const u = res.getTokenUsage?.() || {};
  return {
    content: res.getContent() ?? '',
    model,
    usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: u.total_tokens },
    finishReason: res.getFinishReason?.()
  };
}

// ---------------- NVIDIA NIM via openai ----------------
function getNvidia() {
  if (_nvidia) return _nvidia;
  const apiKey = (process.env.NVIDIA_API_KEY || '').trim();
  if (!apiKey) throw notConfigured('NVIDIA_API_KEY is missing');
  const OpenAI = require('openai');
  _nvidia = new OpenAI({
    apiKey,
    baseURL: (process.env.NVIDIA_BASE_URL || NVIDIA_BASE_URL).trim(),
    timeout: num('AI_TIMEOUT_MS', 60000),
    maxRetries: num('AI_MAX_RETRIES', 1)
  });
  return _nvidia;
}

async function chatNvidia(messages, options) {
  const model = options.model || getDefaultModel();
  const res = await getNvidia().chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? num('AI_TEMPERATURE', 0.2),
    max_tokens: options.maxTokens ?? num('AI_MAX_TOKENS', 1024)
  });
  return {
    content: res?.choices?.[0]?.message?.content ?? '',
    model: res?.model || model,
    usage: res?.usage || null,
    finishReason: res?.choices?.[0]?.finish_reason
  };
}

/**
 * Sends a chat completion request to the configured provider.
 * @param {Array<{role:'system'|'user'|'assistant', content:string}>} messages
 * @param {{model?:string, temperature?:number, maxTokens?:number}} [options]
 * @returns {Promise<{content:string, model:string, usage:object|null, finishReason?:string}>}
 */
async function chat(messages, options = {}) {
  const provider = getProvider();
  const started = Date.now();
  const out = provider === 'sap' ? await chatSap(messages, options) : await chatNvidia(messages, options);
  logger.info(`chat ok provider=${provider} model=${out.model} ms=${Date.now() - started} tokens=${out.usage?.total_tokens ?? 'n/a'}`);
  return out;
}

/** Convenience wrapper: single question in, answer out. */
async function askAI(question, options = {}) {
  const messages = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content: question });
  return chat(messages, options);
}

/** Test hook: reset cached clients (e.g. after changing env vars). */
function _reset() {
  _nvidia = null;
}

module.exports = { chat, askAI, getDefaultModel, getProvider, num, _reset };
