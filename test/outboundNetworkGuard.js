'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');

const BLOCKED_CODE = 'JEST_OUTBOUND_NETWORK_BLOCKED';

function hostnameOf(value) {
  if (value instanceof URL) return value.hostname;
  if (typeof value === 'string') {
    try { return new URL(value).hostname; } catch (_) { return ''; }
  }
  if (value && typeof value === 'object') {
    if (typeof value.url === 'string') return hostnameOf(value.url);
    return value.hostname || value.host || '';
  }
  return '';
}

function isLoopback(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (host.startsWith('::ffff:127.')) return true;
  const ipVersion = net.isIP(host);
  return ipVersion === 4 && Number(host.split('.')[0]) === 127;
}

function deniedError(hostname) {
  return Object.assign(new Error(`Jest blocked outbound network access to ${hostname}`), { code: BLOCKED_CODE });
}

function assertLocalHost(hostname) {
  if (!isLoopback(hostname)) throw deniedError(hostname);
}

function assertLocalTarget(args, optionsIndex = 0) {
  const first = args[optionsIndex];
  const second = args[optionsIndex + 1];
  const host = hostnameOf(first) || hostnameOf(second) || 'localhost';
  if (!isLoopback(host)) throw deniedError(host);
}

for (const protocol of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = protocol[method];
    protocol[method] = function guardedRequest(...args) {
      assertLocalTarget(args);
      return original.apply(this, args);
    };
  }
}

function socketHost(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === 'string') return ''; // Unix-domain socket path.
  if (first && typeof first === 'object') {
    if (first.path) return '';
    return first.hostname || first.host || 'localhost';
  }
  if (typeof first === 'number') {
    const hostArg = args.slice(1).find((arg) => typeof arg === 'string');
    return hostArg || 'localhost';
  }
  return 'localhost';
}

function preferIpv4Loopback(args) {
  const normalized = Array.isArray(args[0]) ? args[0] : null;
  const options = normalized ? normalized[0] : args[0];
  if (options && typeof options === 'object' && !options.path) {
    const rewritten = { ...options };
    if (rewritten.host === 'localhost') rewritten.host = '127.0.0.1';
    if (rewritten.hostname === 'localhost') rewritten.hostname = '127.0.0.1';
    if (normalized) normalized[0] = rewritten; // Preserve Node's internal normalized-args marker.
    else args[0] = rewritten;
  } else if (typeof args[0] === 'number') {
    const hostIndex = args.findIndex((arg, index) => index > 0 && typeof arg === 'string');
    if (hostIndex >= 0 && args[hostIndex] === 'localhost') args[hostIndex] = '127.0.0.1';
  }
  return args;
}

const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  args = preferIpv4Loopback(args);
  const host = socketHost(args);
  if (!isLoopback(host)) {
    const error = deniedError(host);
    process.nextTick(() => this.destroy(error));
    return this;
  }
  return originalSocketConnect.apply(this, args);
};

// CAP integration tests bind ephemeral local servers. Keep those listeners on loopback so they
// work in restricted runners and are never exposed on every interface.
const originalServerListen = net.Server.prototype.listen;
net.Server.prototype.listen = function guardedServerListen(...args) {
  if (args[0] && typeof args[0] === 'object') {
    const options = { ...args[0] };
    if (!options.path) {
      if (!options.host || ['0.0.0.0', '::', ''].includes(options.host)) options.host = '127.0.0.1';
      if (options.host === 'localhost') options.host = '127.0.0.1';
      if (!isLoopback(options.host)) throw deniedError(options.host);
    }
    args[0] = options;
  } else if (typeof args[0] === 'number') {
    const hostIndex = args.findIndex((arg, index) => index > 0 && typeof arg === 'string');
    if (hostIndex < 0) args.splice(1, 0, '127.0.0.1');
    else if (['0.0.0.0', '::', ''].includes(args[hostIndex]) || args[hostIndex] === 'localhost') args[hostIndex] = '127.0.0.1';
    else if (!isLoopback(args[hostIndex])) throw deniedError(args[hostIndex]);
  } else if (typeof args[0] === 'string' && /^\d+$/.test(args[0])) {
    args[0] = Number(args[0]);
    const hostIndex = args.findIndex((arg, index) => index > 0 && typeof arg === 'string');
    if (hostIndex < 0) args.splice(1, 0, '127.0.0.1');
    else if (['0.0.0.0', '::', ''].includes(args[hostIndex]) || args[hostIndex] === 'localhost') args[hostIndex] = '127.0.0.1';
    else if (!isLoopback(args[hostIndex])) throw deniedError(args[hostIndex]);
  }
  return originalServerListen.apply(this, args);
};

const originalTlsConnect = tls.connect;
tls.connect = function guardedTlsConnect(...args) {
  const options = args[0];
  const host = hostnameOf(options) || (options && options.servername) || 'localhost';
  if (!isLoopback(host)) throw deniedError(host);
  return originalTlsConnect.apply(this, args);
};

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, ...args) {
    const host = hostnameOf(input);
    if (host && !isLoopback(host)) return Promise.reject(deniedError(host));
    return originalFetch.call(this, input, ...args);
  };
}

// Block DNS queries before they can resolve public names. This is separate from socket guards:
// otherwise a test could still perform external DNS lookups without opening a socket.
const originalDnsLookup = dns.lookup;
dns.lookup = function guardedDnsLookup(hostname, options, callback) {
  if (typeof options === 'function') callback = options;
  try {
    assertLocalHost(hostname);
  } catch (error) {
    if (typeof callback !== 'function') throw error;
    process.nextTick(() => callback(error));
    return undefined;
  }
  return originalDnsLookup.apply(this, arguments);
};

for (const method of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt']) {
  const original = dns[method];
  if (typeof original !== 'function') continue;
  dns[method] = function guardedDnsResolve(hostname, ...args) {
    assertLocalHost(hostname);
    return original.call(this, hostname, ...args);
  };
}

for (const method of Object.keys(dns.promises)) {
  const original = dns.promises[method];
  if (typeof original !== 'function' || method === 'lookupService') continue;
  dns.promises[method] = function guardedDnsPromise(hostname, ...args) {
    assertLocalHost(hostname);
    return original.call(this, hostname, ...args);
  };
}

module.exports = { BLOCKED_CODE, isLoopback };
