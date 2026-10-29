import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResendEmailProvider } from './email.js';

test('production email sends a private plain-text invitation and surfaces safe delivery failure', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  try {
    globalThis.fetch = async (url, init) => { request = { url: String(url), init }; return new Response('{"id":"mail"}', { status: 200 }); };
    const provider = new ResendEmailProvider('private-api-key', 'reports@company.test');
    await provider.sendInvitation({ to: 'member@company.test', groupName: '<Client name>', url: 'https://app.company.test/#invite=private-token' });
    assert.equal(request?.url, 'https://api.resend.com/emails');
    const message = JSON.parse(request!.init!.body as string);
    assert.deepEqual(message.to, ['member@company.test']);
    assert.match(message.text, /#invite=private-token/);
    assert.equal(message.html, undefined);
    assert.ok(request!.init!.signal);
    globalThis.fetch = async () => new Response('provider debug text containing secrets', { status: 500 });
    await assert.rejects(provider.sendInvitation({ to: 'member@company.test', groupName: 'Group', url: 'https://app.company.test/#invite=private-token' }), { message: 'Invitation delivery failed' });
  } finally { globalThis.fetch = originalFetch; }
});
