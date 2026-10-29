import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiFixture } from '../test-support/fixture.js';
import { hashToken } from './groups.js';

const options = { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 };
const password = 'member-password-2026';
const inspect = (f: Awaited<ReturnType<typeof apiFixture>>, token: string, session?: string) => f.call('/invitations/inspect', 'POST', { token }, session);
const accept = (f: Awaited<ReturnType<typeof apiFixture>>, token: string, body: Record<string, unknown> = {}, session?: string) => f.call('/invitations/accept', 'POST', { ...body, token }, session);

test('consultant invites two members; their accounts, dashboards and all consultant data remain isolated', options, async () => {
  const f = await apiFixture();
  try {
    const owner = (await f.call('/auth/register', 'POST', { name: 'Consultant', email: 'owner@example.test', password })).body;
    const other = (await f.call('/auth/register', 'POST', { name: 'Other consultant', email: 'other@example.test', password })).body;
    const group = (await f.call('/groups', 'POST', { name: 'Leadership cohort', clientName: 'Client' }, owner.token)).body;
    const foreignGroup = (await f.call('/groups', 'POST', { name: 'Other cohort' }, other.token)).body;
    const library = (await f.call('/blocks', 'POST', { title: 'Private library', category: 'Profile', content: {} }, owner.token)).body;
    const report = (await f.call('/reports', 'POST', { title: 'Private report' }, owner.token)).body;
    const members = [];
    for (const [index, name] of ['Alice', 'Bob'].entries()) {
      const invited = await f.call(`/groups/${group.id}/members`, 'POST', { displayName: name, email: ` ${name.toUpperCase()}@EXAMPLE.TEST ` }, owner.token);
      assert.equal(invited.status, 201); members.push(invited.body.member);
      const raw = f.raw();
      assert.equal((await f.prisma.inviteToken.findUniqueOrThrow({ where: { id: invited.body.invitation.id } })).tokenHash, hashToken(raw));
      assert.ok(!JSON.stringify(invited.body).includes(raw));
      assert.equal((await inspect(f, raw)).status, 200);
      const accepted = await accept(f, raw, { password });
      assert.equal(accepted.status, 200); assert.equal(accepted.body.user.role, 'MEMBER');
      const login = await f.call('/auth/login', 'POST', { email: `${name}@Example.Test`, password });
      assert.equal(login.status, 200);
      const token = login.body.token;
      assert.deepEqual((await f.call('/me/dashboard', 'GET', undefined, token)).body, { forms: [], reports: [], activeMembershipCount: 1 });
      assert.equal((await f.call('/me', 'GET', undefined, token)).body.user.name, name);
      for (const path of ['/dashboard', '/groups', `/groups/${group.id}`, `/groups/${group.id}/members/${members[0].id}`, `/reports/${report.id}`]) {
        assert.equal((await f.call(path, 'GET', undefined, token)).status, 404, path);
      }
      for (const [path, method, body] of [
        ['/groups', 'POST', { name: 'Intrusion' }], ['/reports', 'POST', { title: 'Intrusion' }],
        ['/blocks', 'POST', { title: 'Intrusion', category: 'Profile', content: {} }],
        [`/blocks/${library.id}`, 'PUT', { title: 'Intrusion', category: 'Profile', content: {} }],
        [`/blocks/${library.id}`, 'DELETE', undefined], [`/reports/${report.id}`, 'DELETE', undefined],
        [`/groups/${group.id}/members/${members[0].id}/invitations`, 'POST', undefined],
      ] as const) assert.equal((await f.call(path, method, body, token)).status, 404, path);
      assert.equal((await accept(f, raw, { password })).status, 404);
      assert.equal((await inspect(f, invited.body.invitation.id, token)).status, 404);
      if (index === 1) assert.ok(!JSON.stringify((await f.call('/me/dashboard', 'GET', undefined, token)).body).includes('Alice'));
    }
    assert.equal((await f.call(`/groups/${group.id}`, 'GET', undefined, other.token)).status, 404);
    assert.equal((await f.call(`/groups/${group.id}`, 'PATCH', { name: 'Intrusion' }, other.token)).status, 404);
    assert.equal((await f.call(`/groups/${group.id}/members`, 'POST', { displayName: 'X', email: 'x@example.test' }, other.token)).status, 404);
    assert.equal((await f.call(`/groups/${foreignGroup.id}/members/${members[0].id}`, 'DELETE', undefined, other.token)).status, 404);
    const detail = (await f.call(`/groups/${group.id}`, 'GET', undefined, owner.token)).body;
    assert.equal(detail.members.length, 2); assert.ok(detail.members.every((member: { status: string }) => member.status === 'ACTIVE'));
    assert.doesNotMatch(JSON.stringify(detail), /passwordHash|tokenHash/);
    assert.equal((await f.call(`/groups/${group.id}`, 'PATCH', { name: 'Renamed group' }, owner.token)).body.name, 'Renamed group');
    assert.equal((await f.call(`/groups/${group.id}/members/${members[0].id}`, 'DELETE', undefined, owner.token)).status, 200);
    const alice = (await f.call('/auth/login', 'POST', { email: 'alice@example.test', password })).body;
    assert.equal((await f.call('/me/dashboard', 'GET', undefined, alice.token)).body.activeMembershipCount, 0);
    assert.doesNotMatch(JSON.stringify(f.logs), /tokenHash|password|alice@example/);
    for (const message of f.messages) assert.ok(!JSON.stringify(f.logs).includes(new URL(message.url).hash.slice(8)));
  } finally { await f.close(); }
});

test('resend, revoke, expiry and archive invalidate links; existing accounts require matching sign-in', options, async () => {
  const f = await apiFixture();
  try {
    const owner = (await f.call('/auth/register', 'POST', { name: 'Owner', email: 'owner@example.test', password })).body;
    const existing = (await f.call('/auth/register', 'POST', { name: 'Existing user', email: 'Existing@Example.Test', password })).body;
    const group = (await f.call('/groups', 'POST', { name: 'Lifecycle' }, owner.token)).body;
    const member = (await f.call(`/groups/${group.id}/members`, 'POST', { displayName: 'Existing', email: 'existing@example.test' }, owner.token)).body.member;
    const first = f.raw();
    assert.equal((await inspect(f, first)).body.requiresSignIn, true);
    assert.equal((await accept(f, first, { password: 'takeover-attempt' })).status, 401);
    assert.equal((await inspect(f, first, owner.token)).status, 404);
    assert.equal((await accept(f, first, {}, owner.token)).status, 404);
    await f.call(`/groups/${group.id}/members/${member.id}/invitations`, 'POST', {}, owner.token);
    const second = f.raw(); assert.notEqual(first, second);
    assert.equal((await inspect(f, first)).status, 404);
    await f.call(`/groups/${group.id}/members/${member.id}/invitations`, 'DELETE', undefined, owner.token);
    assert.equal((await accept(f, second, {}, existing.token)).status, 404);
    await f.call(`/groups/${group.id}/members/${member.id}/invitations`, 'POST', {}, owner.token);
    const third = f.raw();
    await f.prisma.inviteToken.update({ where: { tokenHash: hashToken(third) }, data: { expiresAt: new Date(0) } });
    assert.equal((await accept(f, third, {}, existing.token)).status, 404);
    await f.call(`/groups/${group.id}/members/${member.id}/invitations`, 'POST', {}, owner.token);
    const fourth = f.raw();
    const responses = await Promise.all([1, 2].map(() => accept(f, fourth, {}, existing.token)));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 404]);
    assert.equal((await f.call('/auth/login', 'POST', { email: 'existing@example.test', password })).status, 200);
    assert.equal(await f.prisma.user.count({ where: { email: 'existing@example.test' } }), 1);
    assert.equal((await f.prisma.groupMember.findUniqueOrThrow({ where: { id: member.id } })).userId, existing.user.id);
    await f.call(`/groups/${group.id}/members`, 'POST', { displayName: 'Pending', email: 'pending@example.test' }, owner.token);
    const pending = f.raw();
    await f.call(`/groups/${group.id}`, 'PATCH', { status: 'ARCHIVED' }, owner.token);
    assert.equal((await inspect(f, pending)).status, 404);
    assert.equal((await f.call('/me/dashboard', 'GET', undefined, existing.token)).body.activeMembershipCount, 0);
    assert.equal((await f.call(`/groups/${group.id}/members`, 'POST', { displayName: 'Blocked', email: 'blocked@example.test' }, owner.token)).status, 404);
    await f.call(`/groups/${group.id}`, 'PATCH', { status: 'ACTIVE' }, owner.token);
    assert.equal((await inspect(f, pending)).status, 404);
    assert.equal((await inspect(f, '0'.repeat(64))).status, 404);
    assert.equal((await f.call('/me/dashboard', 'GET', undefined, existing.token)).body.activeMembershipCount, 1);
  } finally { await f.close(); }
});

test('delivery failures revoke tokens, preserve retryable members, and activation is rate limited', options, async () => {
  const f = await apiFixture();
  try {
    const owner = (await f.call('/auth/register', 'POST', { name: 'Owner', email: 'owner@example.test', password })).body;
    const group = (await f.call('/groups', 'POST', { name: 'Delivery' }, owner.token)).body;
    f.failEmail(true);
    const failed = await f.call(`/groups/${group.id}/members`, 'POST', { displayName: 'Retry', email: 'retry@example.test' }, owner.token);
    assert.equal(failed.status, 502); assert.doesNotMatch(JSON.stringify(failed.body), /credentials|stack/);
    const member = (await f.call(`/groups/${group.id}`, 'GET', undefined, owner.token)).body.members[0];
    assert.equal(member.invitationStatus, 'REVOKED');
    f.failEmail(false);
    assert.equal((await f.call(`/groups/${group.id}/members/${member.id}/invitations`, 'POST', {}, owner.token)).status, 201);
    assert.equal((await accept(f, f.raw(), { password })).status, 200);
    for (let i = 0; i < 19; i++) assert.equal((await inspect(f, '0'.repeat(64))).status, 404);
    assert.equal((await accept(f, '0'.repeat(64), { password })).status, 429);
  } finally { await f.close(); }
});
