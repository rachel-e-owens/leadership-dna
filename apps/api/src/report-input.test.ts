import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultDocumentStyle, documentSchema, documentStyleSchema, reportDraftSchema, reportUpdateSchema } from './report-input.js';
const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited report', marks: [{ type: 'underline' }] }] }] };
test('save and PDF endpoints accept the same continuous document and style', () => {
  const input = { title: 'Report', document, documentStyle: defaultDocumentStyle };
  assert.deepEqual(reportDraftSchema.parse(input), input);
  assert.deepEqual(reportUpdateSchema.parse({ ...input, blockNotes: [{ id: 'block', notes: 'private' }] }).document, document);
  assert.equal(reportUpdateSchema.parse(input).blocks, undefined);
  assert.ok(reportUpdateSchema.safeParse({ title: 'Old report', blocks: [] }).success);
});
test('reject malformed documents and unsupported styles instead of silently dropping content', () => {
  for (const value of [{}, { type: 'doc', content: 'oops' }, { type: 'doc', content: [{ type: 'image' }] }, { type: 'doc', content: [{ type: 'text', text: 123 }] }]) assert.ok(!documentSchema.safeParse(value).success);
  let node: any = { type: 'paragraph' };
  for (let i = 0; i < 60; i++) node = { type: 'blockquote', content: [node] };
  assert.ok(!documentSchema.safeParse({ type: 'doc', content: [node] }).success);
  assert.ok(!documentStyleSchema.safeParse({ ...defaultDocumentStyle, color: 'red; background: url(https://evil)' }).success);
  assert.ok(!documentStyleSchema.safeParse({ ...defaultDocumentStyle, fontSize: 100 }).success);
  assert.ok(!reportUpdateSchema.safeParse({ title: 'Report' }).success);
  assert.ok(!reportDraftSchema.safeParse({ title: ' ', document }).success);
});
