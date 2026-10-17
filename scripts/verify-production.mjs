/** Isolated production smoke test: temporary Appwrite-compatible test runner; no browser or real account. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const { readServerConfig } = require('../dist/src/config.js');
const { backendOrigin } = require('../dist/shared/backendOrigin.js');

assert.throws(() => backendOrigin(undefined, true));
for (const url of ['http://localhost:3001', 'https://api.example.com/auth', 'https://user:password@api.example.com', 'wss://api.example.com']) assert.throws(() => backendOrigin(url, true));
assert.equal(backendOrigin(' https://api.example.com/ ', true), 'https://api.example.com');

const env = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'test-only-secret-with-more-than-32-characters',
    APPWRITE_MOCK: 'true',
    APPWRITE_PROJECT_ID: 'test-project-id',
    APPWRITE_API_KEY: 'test-secret-api-key',
    FRONTEND_ORIGINS: 'https://frontend.example.com',
    PORT: '3198',
    HOST: '127.0.0.1',
};

assert.throws(() => readServerConfig({ ...env, APPWRITE_PROJECT_ID: '', APPWRITE_MOCK: 'false' }));
assert.throws(() => readServerConfig({ ...env, APPWRITE_API_KEY: '', APPWRITE_MOCK: 'false' }));
assert.throws(() => readServerConfig({ ...env, FRONTEND_ORIGINS: '*' }));
assert.throws(() => readServerConfig({ ...env, PORT: '-1' }));

const server = spawn(process.execPath, ['dist/src/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise(resolve => server.once('exit', resolve));
let logs = ''; server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
const base = `http://127.0.0.1:${env.PORT}`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = (path, body, origin = env.FRONTEND_ORIGINS) => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const socketResult = (origin, token) => new Promise((resolve, reject) => {
    const socket = io(base, { transports: ['websocket'], auth: { token }, extraHeaders: { Origin: origin }, reconnection: false, timeout: 2000 });
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('Socket timeout')); }, 3000);
    const done = value => { clearTimeout(timer); socket.disconnect(); resolve(value); };
    socket.on('connect', () => done('connected')); socket.on('connect_error', () => done('rejected'));
});
try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
        try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break; } } catch {}
        if (server.exitCode !== null) break;
        await wait(100);
    }
    assert.ok(ready, logs);
    assert.equal((await request('/readyz')).status, 200);
    assert.equal((await request('/healthz', undefined, 'https://evil.example.com')).status, 403);
    const valid = { username: 'smoketest', email: 'smoke@example.com', password: 'test-password-123' };
    assert.equal((await request('/auth/register', { username: {}, email: [], password: {} })).status, 400);
    const registration = await request('/auth/register', valid);
    assert.equal(registration.status, 201);
    assert.equal(registration.headers.get('access-control-allow-origin'), env.FRONTEND_ORIGINS);
    assert.equal(registration.headers.get('x-powered-by'), null);
    const { token } = await registration.json();
    assert.equal((await request('/auth/register', valid)).status, 409);
    assert.equal((await request('/auth/login', { username: valid.username, password: 'wrong-password' })).status, 401);
    assert.equal((await request('/auth/login', valid)).status, 200);
    assert.equal(await socketResult(env.FRONTEND_ORIGINS, token), 'connected');
    assert.equal(await socketResult('https://evil.example.com', token), 'rejected');
    assert.equal(await socketResult(env.FRONTEND_ORIGINS, 'invalid-token'), 'rejected');
    let response;
    for (let i = 0; i < 31; i++) response = await request('/auth/login', { username: valid.username, password: 'wrong-password' });
    assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0);
    console.log('PASS: production env validation, Appwrite database layer, readiness, auth, origin restrictions, authenticated WebSockets and login throttling.');
} finally {
    server.kill('SIGTERM');
    const killTimer = setTimeout(() => server.kill('SIGKILL'), 12000);
    const code = await exited; clearTimeout(killTimer);
    assert.equal(code, 0, 'graceful shutdown');
}
