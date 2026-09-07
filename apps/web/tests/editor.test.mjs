import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('continuous editor inserts at cursor, preserves originals, formats, saves and reopens', { timeout: 60000 }, async () => {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const library = { id: 'library', title: 'Strengths', category: 'Profile', content: { type: 'doc', content: [paragraph('Original reusable text')] } };
    let saved = { id: 'report', title: 'Client report', intro: { type: 'doc', content: [paragraph('BeforeAfter')] }, blocks: [{ id: 'legacy', title: 'Legacy section', content: { type: 'doc', content: [paragraph('Existing report text')] }, notes: 'Private note' }] };
    const writes = [], exports = [];
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      let body;
      if (url.pathname === '/api/dashboard') body = { reports: [{ ...saved, _count: { blocks: saved.blocks.length } }], blocks: [library] };
      else if (url.pathname.endsWith('/pdf')) {
        exports.push(request.postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/pdf', headers, body: '%PDF-1.4\n%%EOF' });
      } else if (url.pathname === '/api/reports/report' && request.method() === 'PUT') {
        const update = request.postDataJSON();
        writes.push(update);
        saved = { ...saved, ...update, blocks: saved.blocks.map(block => ({ ...block, notes: update.blockNotes.find(note => note.id === block.id)?.notes ?? block.notes })) };
        body = saved;
      } else if (url.pathname === '/api/reports/report') body = saved;
      else throw new Error(`Unexpected API write: ${request.method()} ${url.pathname}`);
      return route.fulfill({ json: body, headers });
    });
    await page.addInitScript(() => localStorage.setItem('ld_token', 'test-token'));
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole('button', { name: /Client report/ }).click();
    const editor = page.getByRole('textbox', { name: 'Report document', exact: true });
    await editor.waitFor();
    assert.match(await editor.innerText(), /Client report[\s\S]*BeforeAfter[\s\S]*Legacy section[\s\S]*Existing report text/);
    assert.ok(!(await editor.innerText()).includes('Private note'));
    // Insert in the middle of an existing paragraph, not just between sections.
    await editor.locator('p').filter({ hasText: 'BeforeAfter' }).evaluate(element => {
      element.focus();
      const range = document.createRange(); range.setStart(element.firstChild, 6); range.collapse(true);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.getByRole('button', { name: /Profile Strengths/ }).click();
    assert.match(await editor.innerText(), /Before[\s\S]*Strengths[\s\S]*Original reusable text[\s\S]*After/);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.ok(!(await editor.innerText()).includes('Original reusable text'));
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await editor.locator('p').filter({ hasText: 'Original reusable text' }).evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.insertText('Personalized client text');
    await page.getByRole('button', { name: 'Center', exact: true }).click();
    assert.equal(await editor.locator('p').filter({ hasText: 'Personalized client text' }).evaluate(element => element.style.textAlign), 'center');
    await editor.locator('p').filter({ hasText: 'Personalized client text' }).evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.getByRole('button', { name: 'Underline', exact: true }).click();
    assert.equal(await editor.locator('u').innerText(), 'Personalized client text');
    await page.getByLabel('Report font', { exact: true }).selectOption('Georgia');
    await page.getByLabel('Report text size').selectOption('14');
    await page.getByLabel('Report line spacing').selectOption('2');
    await page.getByLabel('Report text color').fill('#123456');
    await page.getByText('Private facilitator notes · excluded from the report').click();
    await page.getByLabel('Private notes: Legacy section').fill('Updated private note');
    await page.getByRole('button', { name: 'Export Client report to PDF' }).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Export Client report to PDF"]')?.disabled);
    assert.equal(exports.length, 1);
    assert.ok(JSON.stringify(exports[0]).includes('Personalized client text'));
    assert.ok(!JSON.stringify(exports[0]).includes('private note'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].blocks, undefined);
    assert.deepEqual(writes[0].documentStyle, { fontFamily: 'Georgia', fontSize: 14, lineHeight: 2, color: '#123456' });
    assert.equal(library.content.content[0].content[0].text, 'Original reusable text');
    await page.getByRole('button', { name: '← All reports' }).click();
    await page.getByRole('button', { name: /Client report/ }).click();
    await editor.waitFor();
    assert.match(await editor.innerText(), /Personalized client text/);
    assert.equal(await page.getByLabel('Report font', { exact: true }).inputValue(), 'Georgia');
    await page.getByRole('button', { name: /Profile Strengths/ }).click();
    assert.match(await editor.innerText(), /Original reusable text/);
    assert.match(await editor.innerText(), /Personalized client text/);
    assert.equal(await editor.locator('h1').count(), 1);
    assert.equal(await editor.locator('h1').innerText(), 'Client report');
    if (process.env.EDITOR_TEST_SCREENSHOT) await page.screenshot({ path: process.env.EDITOR_TEST_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
