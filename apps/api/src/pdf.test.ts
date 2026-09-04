import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { renderPdf, reportHtml, richText } from './pdf.js';

test('rich text preserves editor formatting and escapes HTML', () => {
  assert.equal(richText({ type: 'paragraph', content: [{ type: 'text', text: '<script>&', marks: [{ type: 'bold' }, { type: 'italic' }] }] }), '<p><em><strong>&lt;script&gt;&amp;</strong></em></p>');
  assert.equal(richText({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] }), '<h2>Heading</h2>');
  assert.equal(richText({ type: 'image', attrs: { src: 'http://localhost/private' } }), '');
  assert.equal(richText({ type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] }), '<ol start="3"><li><p>Item</p></li></ol>');
});

test('report preserves order and omits private notes and member emails', () => {
  const report = { title: '<Report>', group: { name: 'Team', members: [{ email: 'private@example.com' }] }, blocks: [{ title: 'First', content: {}, notes: 'SECRET' }, { title: 'Second', content: {} }] };
  const html = reportHtml(report);
  assert.ok(html.includes('&lt;Report&gt;'));
  assert.ok(html.indexOf('First') < html.indexOf('Second'));
  assert.ok(!html.includes('SECRET'));
  assert.ok(!html.includes('private@example.com'));
});

test('Chromium generates a PDF', async () => {
  const pdf = await renderPdf({ title: 'Test report', blocks: [{ title: 'Strengths', content: { type: 'paragraph', content: [{ type: 'text', text: 'Clear communication' }] } }] });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  if (process.env.PDF_TEST_OUTPUT) {
    const sample = await renderPdf({ title: 'Leadership DNA: Executive Team', group: { name: 'Development report' }, blocks: Array.from({ length: 8 }, (_, index) => ({ title: `${index + 1}. Communication and leadership`, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Build trust through clear communication. ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'Listen carefully, share expectations, and make space for reflection. '.repeat(12) }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Agree on one practical next step.' }] }] }] }
    ] } })) });
    await writeFile(process.env.PDF_TEST_OUTPUT, sample);
  }
});
