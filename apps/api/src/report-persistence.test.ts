import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// Opt in with a test database. Every run uses and cleans up its own schema.
test('real API saves documents without changing library originals or legacy block records', { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const schema = `editor_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('schema', schema);
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  const env = { ...process.env, DATABASE_URL: url.toString(), JWT_SECRET: 'isolated-editor-test', PORT: '0' };
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy'], { cwd, env });
    server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const origin = await new Promise<string>((resolve, reject) => {
      let output = '';
      server!.stdout!.on('data', data => { output += data; const match = output.match(/http:\/\/localhost:\d+/); if (match) resolve(match[0]); });
      server!.on('error', reject);
      server!.on('exit', code => reject(new Error(`API exited before starting: ${code}`)));
    });
    const call = async (path: string, method = 'GET', body?: unknown, token?: string) => {
      const response = await fetch(`${origin}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const account = await call('/auth/register', 'POST', { name: 'Editor test', email: 'editor@example.test', password: 'editor-test-password' });
    const token = account.body.token;
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original reusable text' }] }] };
    const library = (await call('/blocks', 'POST', { title: 'Strengths', category: 'Profile', content }, token)).body;
    const report = (await call('/reports', 'POST', { title: 'Client report' }, token)).body;
    const legacy = await call(`/reports/${report.id}`, 'PUT', { title: 'Client report', intro: content, blocks: [{ contentBlockId: library.id, title: 'Strengths', content, notes: 'Original private note' }] }, token);
    assert.equal(legacy.status, 200);
    const block = legacy.body.blocks[0];
    const document = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Personalized report', marks: [{ type: 'underline' }] }] }] };
    const documentStyle = { fontFamily: 'Georgia', fontSize: 14, lineHeight: 2, color: '#123456' };
    const update = await call(`/reports/${report.id}`, 'PUT', { title: 'Client report', document, documentStyle, blockNotes: [{ id: block.id, notes: 'Updated private note' }] }, token);
    assert.equal(update.status, 200);
    const reopened = (await call(`/reports/${report.id}`, 'GET', undefined, token)).body;
    assert.deepEqual(reopened.document, document);
    assert.deepEqual(reopened.documentStyle, documentStyle);
    assert.deepEqual(reopened.blocks, [{ ...block, notes: 'Updated private note' }]);
    assert.deepEqual((await prisma.contentBlock.findUniqueOrThrow({ where: { id: library.id } })).content, content);
    assert.deepEqual(reopened.intro, content);
    // Stale clients cannot overwrite the continuous report with its old blocks.
    assert.equal((await call(`/reports/${report.id}`, 'PUT', { title: 'Stale', blocks: [] }, token)).status, 409);
    const other = (await call('/auth/register', 'POST', { name: 'Other user', email: 'other@example.test', password: 'other-test-password' })).body.token;
    assert.equal((await call(`/reports/${report.id}`, 'PUT', { title: 'Not mine', document }, other)).status, 404);
    const otherReport = (await call('/reports', 'POST', { title: 'Other report' }, other)).body;
    // A note ID alone cannot grant access to another report's private notes.
    assert.equal((await call(`/reports/${otherReport.id}`, 'PUT', { title: 'Other report', document, blockNotes: [{ id: block.id, notes: 'Intrusion' }] }, other)).status, 200);
    assert.equal((await prisma.reportBlock.findUniqueOrThrow({ where: { id: block.id } })).notes, 'Updated private note');
    const blank = { type: 'doc', content: [{ type: 'paragraph' }] };
    assert.equal((await call(`/reports/${report.id}`, 'PUT', { title: 'Client report', document: blank }, token)).status, 200);
    assert.deepEqual((await call(`/reports/${report.id}`, 'GET', undefined, token)).body.document, blank);
  } finally {
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  }
});
