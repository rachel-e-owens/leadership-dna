import type { JSONContent } from '@tiptap/core';

export type ReportBlock = { id?: string; contentBlockId?: string | null; title: string; content: JSONContent; notes?: string | null };
export type DocumentStyle = { fontFamily: 'Arial' | 'Georgia' | 'Verdana' | 'Times New Roman'; fontSize: number; lineHeight: number; color: string };
export type Report = { id: string; title: string; intro?: JSONContent | null; blocks?: ReportBlock[]; document?: JSONContent | null; documentStyle?: DocumentStyle | null };
export const defaultDocumentStyle: DocumentStyle = { fontFamily: 'Arial', fontSize: 11, lineHeight: 1.6, color: '#27272a' };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const children = (value?: JSONContent | null): JSONContent[] => !value ? [] : value.type === 'doc' ? copy(value.content || []) : value.type ? [copy(value)] : [];
export function blockContent(block: Pick<ReportBlock, 'title' | 'content'>): JSONContent[] {
  return [{ type: 'heading', attrs: { level: 2 }, content: block.title ? [{ type: 'text', text: block.title }] : [] }, ...children(block.content)];
}
export function reportDocument(report: Report): JSONContent {
  if (report.document) return copy(report.document);
  return { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: report.title ? [{ type: 'text', text: report.title }] : [] },
    ...children(report.intro),
    ...(report.blocks || []).flatMap(blockContent),
    { type: 'paragraph' },
  ] };
}
export function reportDraft(report: Report) {
  return { title: report.title, document: reportDocument(report), documentStyle: report.documentStyle || defaultDocumentStyle };
}
