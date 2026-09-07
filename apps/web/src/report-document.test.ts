import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockContent, reportDocument, reportDraft } from './report-document';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const original = { id: 'report', title: 'Report title', intro: { type: 'doc', content: [paragraph('Introduction')] }, blocks: [
  { id: 'one', title: 'First', content: { type: 'doc', content: [paragraph('Original text')] }, notes: 'PRIVATE NOTE' },
  { id: 'two', title: 'Second', content: { type: 'doc', content: [paragraph('Last text')] } },
] };
test('legacy conversion includes title, intro and blocks in order without private notes', () => {
  const result = reportDocument(original);
  assert.deepEqual(result.content!.map(node => node.content?.[0]?.text || ''), ['Report title', 'Introduction', 'First', 'Original text', 'Second', 'Last text', '']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE NOTE'));
  result.content![3].content![0].text = 'Changed';
  assert.equal(original.blocks[0].content.content[0].content[0].text, 'Original text');
});
test('each library insertion is an independent editable copy', () => {
  const first = blockContent(original.blocks[0]);
  const second = blockContent(original.blocks[0]);
  first[1].content![0].text = 'Personalized';
  assert.equal(second[1].content![0].text, 'Original text');
  assert.equal(original.blocks[0].content.content[0].content[0].text, 'Original text');
});
test('saved document is authoritative, including intentional deletion of all text', () => {
  const document = { type: 'doc', content: [paragraph('')] };
  assert.deepEqual(reportDocument({ ...original, document }), document);
  const blank = { type: 'doc', content: [] };
  assert.deepEqual(reportDocument({ ...original, document: blank }), blank);
});
test('export drafts include current text and styling but exclude legacy snapshots and notes', () => {
  const documentStyle = { fontFamily: 'Georgia' as const, fontSize: 14, lineHeight: 2, color: '#123456' };
  const draft = reportDraft({ ...original, document: { type: 'doc', content: [paragraph('Unsaved edit')] }, documentStyle });
  assert.equal(draft.document.content![0].content![0].text, 'Unsaved edit');
  assert.deepEqual(draft.documentStyle, documentStyle);
  assert.ok(!JSON.stringify(draft).includes('PRIVATE NOTE'));
  assert.ok(!('blocks' in draft));
});
