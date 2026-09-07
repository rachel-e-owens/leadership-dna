import { z } from 'zod';

// Restrict styles to values that can safely be shared by the editor and PDF.
export const documentStyleSchema = z.object({
  fontFamily: z.enum(['Arial', 'Georgia', 'Verdana', 'Times New Roman']),
  fontSize: z.number().int().min(9).max(24),
  lineHeight: z.number().min(1).max(2.5),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const defaultDocumentStyle = { fontFamily: 'Arial', fontSize: 11, lineHeight: 1.6, color: '#27272a' } as const;

// Validate structure and cap nesting before any recursive processing.
export const documentSchema = z.object({ type: z.literal('doc'), content: z.array(z.unknown()) }).passthrough().superRefine((document, ctx) => {
  const pending = document.content.map(node => ({ node, depth: 1 }));
  const types = new Set(['paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule']);
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > 50 || !node || typeof node !== 'object' || !('type' in node) || !types.has(String(node.type))) {
      ctx.addIssue({ code: 'custom', message: 'Unsupported or excessively nested document content' }); return;
    }
    const value = node as { type: string; text?: unknown; content?: unknown; marks?: unknown; attrs?: unknown };
    if ((value.type === 'text' && (typeof value.text !== 'string' || !value.text.length)) || (value.content !== undefined && !Array.isArray(value.content))) {
      ctx.addIssue({ code: 'custom', message: 'Invalid document node' }); return;
    }
    if (Array.isArray(value.content)) pending.push(...value.content.map(node => ({ node, depth: depth + 1 })));
    if (value.marks !== undefined && (!Array.isArray(value.marks) || value.marks.some(mark => !mark || !['bold', 'italic', 'strike', 'code', 'underline'].includes(mark.type)))) {
      ctx.addIssue({ code: 'custom', message: 'Unsupported text formatting' }); return;
    }
    if (value.attrs !== undefined && (!value.attrs || typeof value.attrs !== 'object' || Array.isArray(value.attrs))) {
      ctx.addIssue({ code: 'custom', message: 'Invalid document attributes' }); return;
    }
  }
});
const blockSchema = z.object({ id: z.string().optional(), contentBlockId: z.string().nullable().optional(), title: z.string().min(1), content: z.object({}).passthrough(), notes: z.string().nullable().optional() });
export const reportDraftSchema = z.object({
  title: z.string().trim().min(1),
  document: documentSchema.optional(),
  documentStyle: documentStyleSchema.optional(),
  blocks: z.array(blockSchema).optional(),
}).refine(input => input.document !== undefined || input.blocks !== undefined, 'Report content is required');
export const reportUpdateSchema = z.object({
  title: z.string().trim().min(1),
  document: documentSchema.optional(),
  documentStyle: documentStyleSchema.optional(),
  intro: z.object({}).passthrough().nullable().optional(),
  status: z.enum(['DRAFT', 'READY', 'SENT']).optional(),
  blocks: z.array(blockSchema).optional(),
  blockNotes: z.array(z.object({ id: z.string(), notes: z.string().nullable() })).optional(),
}).refine(input => input.document !== undefined || input.blocks !== undefined, 'Report content is required');
