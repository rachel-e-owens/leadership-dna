import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { apiFixture } from '../../api/test-support/fixture.ts';

test('real browser flow: consultant manages group; two invited members join and see only their private empty dashboards', { skip: !process.env.TEST_DATABASE_URL, timeout: 90000 }, async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  const f = await apiFixture(origin);
  const browser = await chromium.launch();
  const errors = [];
  const apiUrls = [];
  const password = 'browser-member-password';
  async function session() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    // Forward every UI request to the real isolated API; no fabricated API responses.
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      apiUrls.push(url.toString());
      const response = await route.fetch({ url: f.base + url.pathname.slice('/api'.length) + url.search });
      await route.fulfill({ response });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    return page;
  }
  try {
    const owner = (await f.call('/auth/register', 'POST', { name: 'Consultant', email: 'consultant@example.test', password })).body;
    const consultant = await session();
    await consultant.goto(origin);
    await consultant.getByLabel('Email', { exact: true }).fill('consultant@example.test');
    await consultant.getByLabel('Password', { exact: true }).fill(password);
    await consultant.getByRole('button', { name: 'Sign in', exact: true }).click();
    await consultant.getByRole('button', { name: 'Groups', exact: true }).click();
    await consultant.getByLabel('Group name', { exact: true }).fill('Leadership cohort');
    await consultant.getByLabel('Client name (optional)').fill('Acme');
    await consultant.getByRole('button', { name: 'Create group', exact: true }).click();
    await consultant.getByRole('heading', { name: 'Leadership cohort', exact: true }).waitFor();
    await consultant.getByLabel('Engagement name').fill('Spring leadership');
    await consultant.getByRole('button', { name: 'Save group', exact: true }).click();
    await consultant.getByRole('status').filter({ hasText: 'Group updated.' }).waitFor();
    const tokens = [];
    const memberPages = [];
    for (const name of ['Alice', 'Bob']) {
      await consultant.getByLabel('Member name', { exact: true }).fill(name);
      await consultant.getByLabel('Member email', { exact: true }).fill(`${name.toLowerCase()}@example.test`);
      await consultant.getByRole('button', { name: 'Send invitation', exact: true }).click();
      await consultant.getByRole('status').filter({ hasText: 'Invitation sent.' }).waitFor();
      const message = f.messages.at(-1);
      assert.equal(message.to, `${name.toLowerCase()}@example.test`);
      const page = await session(); memberPages.push(page);
      await page.goto(message.url);
      await page.getByLabel('Create password').fill(password);
      await page.getByRole('button', { name: 'Join group', exact: true }).click();
      await page.getByRole('heading', { name: `Welcome, ${name}`, exact: true }).waitFor();
      await page.getByText('No forms assigned yet.').waitFor();
      await page.getByText('No reports have been shared with you yet.').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Groups', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Content library', exact: true }).count(), 0);
      assert.ok(!page.url().includes('invite='));
      tokens.push(await page.evaluate(() => localStorage.getItem('ld_token')));
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByLabel('Email', { exact: true }).fill(`${name.toLowerCase()}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: `Welcome, ${name}`, exact: true }).waitFor();
      await page.getByText('No forms assigned yet.').waitFor();
    }
    const group = (await f.call('/groups', 'GET', undefined, owner.token)).body[0];
    const detail = (await f.call(`/groups/${group.id}`, 'GET', undefined, owner.token)).body;
    assert.ok(detail.members.every(member => member.status === 'ACTIVE'));
    for (const [index, page] of memberPages.entries()) {
      const result = await page.evaluate(async ({ groupId, memberId, token }) => {
        const statuses = [];
        for (const path of [`/groups/${groupId}`, `/groups/${groupId}/members/${memberId}/invitations`, '/dashboard']) {
          statuses.push((await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } })).status);
        }
        return statuses;
      }, { groupId: group.id, memberId: detail.members[1 - index].id, token: tokens[index] });
      assert.deepEqual(result, [404, 404, 404]);
      assert.ok(!(await page.locator('body').innerText()).includes(index === 0 ? 'Bob' : 'Alice'));
    }
    // Refresh roster, then exercise revoke/resend and the invalid-link page.
    await consultant.getByRole('button', { name: 'Spring leadership', exact: true }).click();
    await consultant.getByRole('cell', { name: 'active', exact: true }).first().waitFor();
    await consultant.getByLabel('Member name', { exact: true }).fill('Pending');
    await consultant.getByLabel('Member email', { exact: true }).fill('pending@example.test');
    await consultant.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await consultant.getByRole('status').filter({ hasText: 'Invitation sent.' }).waitFor();
    const revokedUrl = f.messages.at(-1).url;
    const pendingRow = consultant.getByRole('row').filter({ hasText: 'pending@example.test' });
    await pendingRow.getByRole('button', { name: 'Revoke invitation', exact: true }).click();
    await consultant.getByRole('status').filter({ hasText: 'Invitation revoked.' }).waitFor();
    const invalid = await session(); await invalid.goto(revokedUrl);
    await invalid.getByRole('alert').filter({ hasText: 'Invitation unavailable' }).waitFor();
    await pendingRow.getByRole('button', { name: 'Resend invitation', exact: true }).click();
    await consultant.getByRole('status').filter({ hasText: 'Previous links no longer work.' }).waitFor();
    assert.notEqual(f.messages.at(-1).url, revokedUrl);
    if (process.env.GROUP_TEST_SCREENSHOT) await consultant.screenshot({ path: process.env.GROUP_TEST_SCREENSHOT, fullPage: true });
    consultant.on('dialog', dialog => dialog.accept());
    await consultant.getByRole('button', { name: 'Archive group', exact: true }).click();
    await consultant.getByRole('button', { name: 'Restore group', exact: true }).waitFor();
    await consultant.setViewportSize({ width: 390, height: 844 });
    assert.ok(await consultant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await memberPages[0].setViewportSize({ width: 390, height: 844 });
    assert.ok(await memberPages[0].evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (process.env.MEMBER_TEST_SCREENSHOT) await memberPages[0].screenshot({ path: process.env.MEMBER_TEST_SCREENSHOT, fullPage: true });
    for (const message of f.messages) assert.ok(apiUrls.every(url => !url.includes(new URL(message.url).hash.slice(8))));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await f.close(); await vite.close(); }
});
