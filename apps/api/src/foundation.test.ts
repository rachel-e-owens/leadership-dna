import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { loadConfig } from './config.js';
import { ownerScope, type AuthedRequest } from './ownership.js';
import { authRateLimit, errorHandler, requestLogger, restrictedCors } from './http.js';

const production = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://app:long-random-db-pass@db/leadership',
  JWT_SECRET: 'a-strong-random-value-at-least-32-characters', APP_ORIGIN: 'https://leadership.company.com',
  RESEND_API_KEY: 're_live_key', EMAIL_FROM: 'reports@company.com', R2_ACCOUNT_ID: 'live-account',
  R2_ACCESS_KEY_ID: 'live-access', R2_SECRET_ACCESS_KEY: 'live-secret-key', R2_BUCKET: 'private-reports',
};
test('production requires every credential and rejects defaults without disclosing values', () => {
  assert.equal(loadConfig(production).production, true);
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'APP_ORIGIN', 'RESEND_API_KEY', 'EMAIL_FROM', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
    for (const value of ['', 'change-this-before-production', 'your-secret']) {
      assert.throws(() => loadConfig({ ...production, [key]: value }), new RegExp(key));
    }
  }
  for (const overrides of [{ JWT_SECRET: 'short' }, { DATABASE_URL: 'postgresql://postgres:postgres@db/app' }, { APP_ORIGIN: 'http://site.company.com' }, { APP_ORIGIN: 'https://site.company.com/path' }, { SEED_DEMO: 'true' }]) {
    assert.throws(() => loadConfig({ ...production, ...overrides }), /^Error: Invalid configuration:/);
  }
  assert.equal(loadConfig({ NODE_ENV: 'development' }).jwtSecret, 'development-only-secret');
});
test('owner scope fails closed instead of passing undefined to Prisma', () => {
  assert.throws(() => ownerScope({} as AuthedRequest));
  assert.deepEqual(ownerScope({ userId: 'owner' } as AuthedRequest), { ownerId: 'owner' });
});
test('HTTP protection covers logging, CORS, auth rate limits, and sanitized errors', async () => {
  const events: Record<string, unknown>[] = [];
  let time = 0;
  const app = express();
  app.use(requestLogger(event => events.push(event)));
  app.use(restrictedCors('https://app.company.com'));
  app.use('/api/auth', authRateLimit({ limit: 2, windowMs: 1000, now: () => time }));
  app.use(express.json({ limit: '100b' }));
  app.post('/api/auth/:action', (_req, res) => { res.json({ ok: true }); });
  app.get('/secret/:token', () => { throw new Error('private database password and stack'); });
  app.use(errorHandler(event => events.push(event)));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const allowed = await fetch(`${base}/api/auth/login`, { method: 'OPTIONS', headers: { Origin: 'https://app.company.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.company.com');
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: 'https://evil.company.com' } })).status, 403);
    for (const action of ['login', 'register', 'reset-password']) {
      const response = await fetch(`${base}/api/auth/${action}`, { method: 'POST', headers: { 'X-Forwarded-For': action } });
      assert.equal(response.status, action === 'reset-password' ? 429 : 200);
      if (response.status === 429) assert.equal(response.headers.get('retry-after'), '1');
    }
    time = 1001;
    assert.equal((await fetch(`${base}/api/auth/reset-password`, { method: 'POST' })).status, 200);
    const badJson = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(badJson.status, 400);
    assert.deepEqual(await badJson.json(), { error: 'Invalid JSON' });
    time = 2002;
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(200) }) })).status, 413);
    const failure = await fetch(`${base}/secret/raw-token?password=hidden`, { headers: { 'X-Request-ID': 'untrusted-id', Authorization: 'Bearer private-jwt' } });
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: 'Unexpected server error' });
    const requestId = failure.headers.get('x-request-id');
    assert.match(requestId!, /^[0-9a-f-]{36}$/);
    assert.ok(events.some(event => event.event === 'request_error' && event.requestId === requestId));
    assert.ok(events.some(event => event.route === '/secret/:token' && event.requestId === requestId));
    assert.doesNotMatch(JSON.stringify(events), /raw-token|hidden|untrusted-id|private-jwt|database password|stack/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
