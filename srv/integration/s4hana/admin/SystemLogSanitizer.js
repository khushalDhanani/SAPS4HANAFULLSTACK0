'use strict';

/**
 * SystemLogSanitizer
 *
 * Sanitization logic for raw SAP system log data (SLGDATA / SAL_DATA).
 *
 * Sanitization limitations:
 *   See sanitizeMessage() header below for explicit rules and what the sanitizer does NOT catch.
 */

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize a message string from SAP logs (SLGDATA or SAL_DATA).
 *
 * Explicit rules applied in sequence:
 *   1. Treat null / undefined as empty string.
 *   2. Strip null bytes (\x00).
 *   3. Trim leading and trailing whitespace.
 *   4. Replace runs of 4 or more '*' with '[redacted]' (star-masked passwords/keys).
 *   5. Replace IPv4 addresses (dotted-decimal) with '[ip]'.
 *   6. Replace IPv6 addresses (full, compressed, bracketed, or loopback) with '[ip]'.
 *   7. Replace SAP server hostnames and instance names with '[host]' / '[instance]'.
 *   8. If redactUserTokens=true: replace user tokens, SLGUSER match, and key patterns ('user=X', 'bname: X') with '[user]'.
 *   9. Truncate to 200 characters.
 *
 * What this sanitizer does NOT catch (LIMITATIONS):
 *   - Arbitrary personal names in unstructured prose (e.g. 'sent by John Smith').
 *   - ABAP program names or transaction codes that resemble usernames (e.g. 'ZFI_R_041', 'RSUSR300').
 *   - Hexadecimal hashes, internal UUIDs, or transaction IDs.
 *   - Obfuscated IP addresses (hex-encoded, decimal integer, or URL-encoded).
 *   - Non-standard terminals not matching IP or known patterns.
 *   - Passwords or sensitive values not masked with '****' in clear text.
 *
 * @param {string|null|undefined} raw
 * @param {object} [options]
 * @param {boolean} [options.redactUserTokens=false]
 * @param {string}  [options.userToken='']
 * @param {string[]} [options.knownUsers=[]]
 * @param {string[]} [options.knownInstances=[]]
 * @returns {string}
 */
function sanitizeMessage(raw, {
  redactUserTokens = false,
  userToken = '',
  knownUsers = [],
  knownInstances = [],
} = {}) {
  if (!raw) return '';
  let s = String(raw);

  // Rule 2: strip null bytes
  s = s.replace(/\x00/g, '');

  // Rule 3: trim
  s = s.trim();

  // Rule 4: redact runs of 4+ stars
  s = s.replace(/\*{4,}/g, '[redacted]');

  // Rule 5: redact IPv4
  s = s.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');

  // Rule 6: redact IPv6 (full, compressed, bracketed, and loopback)
  // Bracketed IPv6: [fe80::1]
  s = s.replace(/\[[0-9a-fA-F:]+\]/g, '[ip]');
  // Loopback ::1
  s = s.replace(/(^|[\s(,;])(::1)([\s),;]|$)/g, '$1[ip]$3');
  // Compressed IPv6 with :: (e.g. fe80::1ff:fe23:4567:890a or 2001:db8::1)
  s = s.replace(/\b[0-9a-fA-F]{1,4}::[0-9a-fA-F:]+\b/g, '[ip]');
  s = s.replace(/\b::[0-9a-fA-F:]+\b/g, '[ip]');
  // Full IPv6 (e.g. 2001:0db8:85a3:0000:0000:8a2e:0370:7334)
  s = s.replace(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, '[ip]');
  s = s.replace(/\b(?:[0-9a-fA-F]{1,4}:){2,6}[0-9a-fA-F]{1,4}\b/g, '[ip]');

  // Rule 7: redact server hostnames and instance names
  s = s.replace(/\b[a-zA-Z0-9_-]+_DS4_\d+\b/g, '[instance]');
  s = s.replace(/\bapp-server-\d+_[a-zA-Z0-9_-]+\b/g, '[instance]');
  s = s.replace(/\bvheudds4[a-zA-Z0-9_-]*\b/gi, '[host]');
  if (Array.isArray(knownInstances)) {
    for (const inst of knownInstances) {
      if (inst && typeof inst === 'string' && inst.trim().length >= 3) {
        s = s.replace(new RegExp(escapeRegExp(inst.trim()), 'gi'), '[instance]');
      }
    }
  }

  // Rule 8: optional user-token redaction
  if (redactUserTokens) {
    if (userToken && typeof userToken === 'string' && userToken.trim().length >= 3) {
      s = s.replace(new RegExp(`\\b${escapeRegExp(userToken.trim())}\\b`, 'gi'), '[user]');
    }
    if (Array.isArray(knownUsers)) {
      for (const u of knownUsers) {
        if (u && typeof u === 'string' && u.trim().length >= 3) {
          s = s.replace(new RegExp(`\\b${escapeRegExp(u.trim())}\\b`, 'gi'), '[user]');
        }
      }
    }
    s = s.replace(/\b(user|bname|usr)\s*[:=]\s*([a-zA-Z0-9_-]{3,16})\b/gi, '$1=[user]');
    s = s.replace(/\buser\s+([A-Z0-9_-]{3,12})\s+(log(?:ged|on|in)|lock|fail|auth)/gi, 'user [user] $2');
  }

  // Rule 9: truncate
  if (s.length > 200) s = s.slice(0, 200);

  return s;
}

/**
 * Sanitize raw SLGDATA for the 'message' field using a per-type slot map
 * for user-carrying types (e.g. AB1, Q04, AB6, etc.) and redacting hostnames/instances.
 *
 * @param {string} rawType
 * @param {string} rawData
 * @param {object} options
 * @param {boolean} [options.includeUser=false]
 * @param {string}  [options.userToken='']
 * @param {string[]} [options.knownUsers=[]]
 * @param {string[]} [options.knownInstances=[]]
 * @returns {string}
 */
function sanitizeSyslogData(rawType, rawData, {
  includeUser = false,
  userToken = '',
  knownUsers = [],
  knownInstances = [],
} = {}) {
  const typeStr = String(rawType || '').trim();
  const key = typeStr.length === 4 ? typeStr.substring(1) : typeStr;
  let d = String(rawData || '');

  if (!includeUser) {
    if (key === 'AB1' && d.length >= 44) {
      // AB1: date(6), time(6), host/instance(32), user(12+)
      // Slot 1 (user) is at char 44+. When includeUser=false, redact user and host/instance.
      const date = d.slice(0, 6).trim();
      const time = d.slice(6, 12).trim();
      d = `${date} ${time} [instance] [user]`;
    } else if (key === 'Q04') {
      // Q04: user/terminal in slot 0, logon ID in slot 1
      const m = d.match(/^\s*(.*?)\s+(\d{1,4})\s*$/);
      if (m) {
        d = `[user] ${m[2]}`;
      } else {
        d = '[user]';
      }
    } else if (key === 'AB6') {
      // AB6: slot 0 (chars 0-12) is user
      const remainder = d.slice(12).trim();
      d = remainder ? `[user] ${remainder}` : '[user]';
    } else if (['AU7', 'AU8', 'AU9', 'AUA', 'AUB'].includes(key)) {
      d = '[user]';
    }
  } else {
    if (key === 'AB1' && d.length >= 44) {
      const date = d.slice(0, 6).trim();
      const time = d.slice(6, 12).trim();
      const user = d.slice(44).trim();
      d = `${date} ${time} [instance] ${user}`;
    }
  }

  return sanitizeMessage(d, {
    redactUserTokens: !includeUser,
    userToken,
    knownUsers,
    knownInstances,
  });
}

module.exports = {
  escapeRegExp,
  sanitizeMessage,
  sanitizeSyslogData,
};
