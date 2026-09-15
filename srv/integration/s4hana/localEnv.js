const fs = require('fs');
const path = require('path');

const DEFAULT_FILES = ['.env.local', '.env'];
let loadedRoot = null;

/**
 * Parses dotenv-style content into [key, value] pairs. Blank lines and comments are skipped;
 * surrounding single or double quotes around a value are removed.
 *
 * @param {string} content
 * @returns {Array<[string, string]>}
 */
function parseEnvFile(content) {
    const entries = [];
    for (const rawLine of String(content || '').split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        entries.push([key, value]);
    }
    return entries;
}

/**
 * Loads local development configuration from .env.local and then .env (first file wins per key)
 * into process.env without overriding variables that are already set.
 *
 * Never runs in production: deployed environments take all configuration from BTP service
 * bindings and the platform environment. Idempotent per process for process.env.
 *
 * @param {Object} [options]
 * @param {string} [options.root] - Directory holding the env files (default: process.cwd())
 * @param {string[]} [options.files] - File names in priority order
 * @param {Object} [options.env] - Target environment object (default: process.env; used by tests)
 * @returns {boolean} true when at least one file was read
 */
function loadLocalEnv({ root = process.cwd(), files = DEFAULT_FILES, env = process.env } = {}) {
    if (env.NODE_ENV === 'production') return false;
    if (env === process.env) {
        if (loadedRoot) return false;
        loadedRoot = root;
    }

    let loadedAny = false;
    for (const file of files) {
        const fullPath = path.resolve(root, file);
        if (!fs.existsSync(fullPath)) continue;
        try {
            for (const [key, value] of parseEnvFile(fs.readFileSync(fullPath, 'utf8'))) {
                if (env[key] === undefined || env[key] === '') {
                    env[key] = value;
                }
            }
            loadedAny = true;
        } catch (_) {
            // An unreadable local file must never break startup; the variables simply stay unset.
        }
    }
    return loadedAny;
}

module.exports = { loadLocalEnv, parseEnvFile, DEFAULT_FILES };
