'use strict';

/**
 * Starts a private CAP server for write-authorization E2E that cannot reach SAP:
 * - NODE_ENV=test, so server.js skips .env/.env.local and the cds [test] profile points every external S/4 OData
 *   service at http://127.0.0.1:1 with dummy credentials, uses an in-memory DB and the test mock users;
 * - every S4_* / AI / NVIDIA variable is removed from the child environment, so no OData or RFC connection can be built;
 * - assertSapUnreachable() must pass before any write is sent: a SAP-backed read has to fail without data.
 * A request that wrongly passes authorization therefore fails at the S/4 connection and never reaches SAP.
 */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const STRIPPED = /^(S4_|SAP_|AI_|AICORE_|NVIDIA_|CDS_REQUIRES_|VCAP_)/;

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

/** Child environment: current env minus every SAP/AI connectivity variable, forced to the test profile. */
function isolatedEnv(port, base = process.env) {
    const env = {};
    Object.keys(base).filter((k) => !STRIPPED.test(k)).forEach((k) => { env[k] = base[k]; });
    env.NODE_ENV = 'test';
    env.PORT = String(port);
    return env;
}

/** freePort() releases the port before the child binds it, so another process can take it in between: retry on EADDRINUSE. */
async function startIsolatedServer(options = {}, attempts = 3) {
    try {
        return await startOnce(options);
    } catch (err) {
        if (attempts > 1 && /EADDRINUSE/.test(err.message)) return startIsolatedServer(options, attempts - 1);
        throw err;
    }
}

async function startOnce({ timeoutMs = 60000 } = {}) {
    const port = await freePort();
    const env = isolatedEnv(port);
    const child = spawn(process.execPath, [require.resolve('@sap/cds/bin/serve', { paths: [ROOT] }), '--port', String(port)], {
        cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const baseUrl = `http://127.0.0.1:${port}`;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (child.exitCode !== null) throw new Error(`isolated server exited (${child.exitCode}): ${log.slice(-800)}`);
        const ok = await fetch(`${baseUrl}/health`).then((r) => r.ok, () => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 300));
    }
    if (!(await fetch(`${baseUrl}/health`).then((r) => r.ok, () => false))) {
        child.kill('SIGTERM');
        throw new Error(`isolated server not healthy after ${timeoutMs} ms: ${log.slice(-800)}`);
    }
    return {
        baseUrl,
        env,
        log: () => log,
        stop: () => new Promise((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once('exit', () => resolve());
            child.kill('SIGTERM');
        })
    };
}

/**
 * Proves the isolated server has no SAP: a SAP-backed read as an authorized user must fail and return no rows.
 * Throws otherwise, so callers never send writes to a server that might be connected.
 */
async function assertSapUnreachable(server) {
    if (Object.keys(server.env).some((k) => STRIPPED.test(k)) || server.env.NODE_ENV !== 'test') {
        throw new Error('isolated server environment still carries SAP connectivity variables');
    }
    const res = await fetch(`${server.baseUrl}/odata/v4/purchase-order/PurchaseOrders?$top=1`, {
        headers: { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') }
    });
    const body = await res.text();
    if (res.ok && /"value"\s*:\s*\[\s*\{/.test(body)) {
        throw new Error('isolated server returned SAP data; refusing to send writes');
    }
    return { status: res.status };
}

module.exports = { startIsolatedServer, assertSapUnreachable, isolatedEnv };
