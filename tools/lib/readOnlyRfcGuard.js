'use strict';

const fs = require('fs');

// The evidence collector needs table reads only. DD03L metadata is also read
// through RFC_READ_TABLE, so no second RFC function is required.
const ALLOWED_RFC_FUNCTIONS = Object.freeze(['RFC_READ_TABLE']);

function assertRfcFunctionAllowed(functionName) {
  const normalized = String(functionName || '').trim().toUpperCase();
  if (!ALLOWED_RFC_FUNCTIONS.includes(normalized)) {
    throw Object.assign(new Error(`RFC function is not allowed for read-only evidence collection: ${normalized || '(missing)'}`), {
      code: 'RFC_FUNCTION_NOT_ALLOWED'
    });
  }
  return normalized;
}

function createReadOnlyRfcClient(client, { onCall = () => {} } = {}) {
  if (!client || typeof client.call !== 'function' || typeof client.readTable !== 'function') {
    throw new TypeError('A compatible RFC client is required.');
  }

  const called = new Set();
  const guarded = {
    call(functionName, ...args) {
      const normalized = assertRfcFunctionAllowed(functionName);
      called.add(normalized);
      onCall(normalized);
      return client.call(normalized, ...args);
    },
    readTable(...args) {
      // RfcClient.readTable calls `this.call`, so binding it to this wrapper
      // routes the actual RFC invocation through the allow-list above.
      return client.readTable.apply(guarded, args);
    },
    session() {
      throw Object.assign(new Error('RFC sessions are disabled for the read-only evidence collector.'), {
        code: 'RFC_SESSION_NOT_ALLOWED'
      });
    },
    getCalledFunctions() {
      return [...called].sort();
    }
  };
  return guarded;
}

const SENSITIVE_ENV_KEY = /(?:USER(?:NAME)?|HOST|SYSNR|SYSTEM_NUMBER|PASSWORD|PASSWD|CREDENTIAL|SECRET|TOKEN|DESTINATION_URL|VCAP_SERVICES)/i;

function sensitiveEnvironmentValues(env = process.env) {
  const found = [];
  const visitCredentialObject = (value, prefix = 'VCAP_SERVICES') => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visitCredentialObject(item, `${prefix}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        const childPath = `${prefix}.${childKey}`;
        if (typeof childValue === 'string' && /(?:USER(?:NAME)?|HOST|SYSNR|PASSWORD|PASSWD|CREDENTIAL|SECRET|TOKEN|AUTH|URL)$/i.test(childKey)) {
          found.push({ key: childPath, value: childValue });
        }
        visitCredentialObject(childValue, childPath);
      }
    }
  };
  for (const [key, rawValue] of Object.entries(env || {})) {
    if (!SENSITIVE_ENV_KEY.test(key) || rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue);
    // Short numeric system numbers are checked by schema/key exclusion below;
    // substring matching them would collide with ordinary quantities in rows.
    if (key.toUpperCase().includes('SYSNR') && /^\d{1,4}$/.test(value)) continue;
    // Low-entropy values (booleans, tiny numbers, 1-3 chars) collide with ordinary
    // JSON (e.g. ENABLE_DEV_TOKEN_ISSUER=true vs. a boolean field) and cannot be
    // substring-scanned; forbidden-key checks below still cover such fields.
    if (/^(?:true|false|yes|no|on|off)$/i.test(value) || /^\d{1,4}$/.test(value) || value.length < 4) continue;
    if (value) found.push({ key, value });

    if (/DESTINATION_URL/i.test(key)) {
      try {
        const parsed = new URL(value);
        for (const [part, partValue] of [['host', parsed.hostname], ['username', parsed.username], ['password', parsed.password]]) {
          if (partValue) found.push({ key: `${key}:${part}`, value: decodeURIComponent(partValue) });
        }
      } catch (_) {
        // The complete value above is still checked if it is not a valid URL.
      }
    }
    if (key.toUpperCase() === 'VCAP_SERVICES') {
      try {
        visitCredentialObject(JSON.parse(value), key);
      } catch (_) {
        // The complete environment value is still scanned if it is not JSON.
      }
    }
  }
  return found;
}

function assertNoSensitiveEnvironmentValues(content, env = process.env) {
  const text = String(content);
  const leaked = sensitiveEnvironmentValues(env).filter(({ value }) => text.includes(value));
  if (leaked.length) {
    const keys = [...new Set(leaked.map(({ key }) => key))].join(', ');
    throw Object.assign(new Error(`Evidence output contains a sensitive environment value (${keys}).`), {
      code: 'EVIDENCE_REDACTION_FAILED',
      keys: [...new Set(leaked.map(({ key }) => key))]
    });
  }

  // Do not serialize connection identifiers as JSON properties, including
  // low-entropy numeric system numbers that cannot be safely substring-scanned.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return;
  }
  const forbiddenKey = (value) => /^(?:user|username|host|ashost|sysnr|systemnumber|password|passwd|credential|secret|token|bname|usnam|uname)$/i.test(value);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey(key)) {
        throw Object.assign(new Error(`Evidence output contains forbidden connection metadata field '${key}'.`), {
          code: 'EVIDENCE_REDACTION_FAILED',
          keys: [`field:${key}`]
        });
      }
      visit(child);
    }
  };
  visit(parsed);
}

function assertNoSensitiveEnvironmentValuesInFile(filePath, env = process.env) {
  assertNoSensitiveEnvironmentValues(fs.readFileSync(filePath, 'utf8'), env);
}

module.exports = {
  ALLOWED_RFC_FUNCTIONS,
  assertRfcFunctionAllowed,
  createReadOnlyRfcClient,
  assertNoSensitiveEnvironmentValues,
  assertNoSensitiveEnvironmentValuesInFile
};
