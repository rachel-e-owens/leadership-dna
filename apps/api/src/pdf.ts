import { chromium } from 'playwright';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Render only the editor's supported nodes; never interpolate arbitrary HTML or URLs.
export function richText(value: unknown, depth = 0): string {
  if (!value || typeof value !== 'object' || depth > 100) return '';
  const node = value as { type?: string; text?: string; content?: unknown[]; marks?: { type?: string }[]; attrs?: { level?: number; start?: number } };
  if (node.type === 'text') {
    let text = escape(typeof node.text === 'string' ? node.text : '');
    for (const mark of Array.isArray(node.marks) ? node.marks : []) {
      const tag = ({ bold: 'strong', italic: 'em', strike: 's', code: 'code' } as Record<string, string>)[mark.type || ''];
      if (tag) text = `<${tag}>${text}</${tag}>`;
    }
    return text;
  }
  const content = Array.isArray(node.content) ? node.content.map(child => richText(child, depth + 1)).join('') : '';
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'horizontalRule') return '<hr>';
  if (node.type === 'heading') {
    const level = [1, 2, 3, 4, 5, 6].includes(node.attrs?.level || 0) ? node.attrs!.level : 2;
    return `<h${level}>${content}</h${level}>`;
  }
  if (node.type === 'orderedList') return `<ol start="${Number.isSafeInteger(node.attrs?.start) ? node.attrs!.start : 1}">${content}</ol>`;
  const tag = ({ paragraph: 'p', bulletList: 'ul', listItem: 'li', blockquote: 'blockquote', codeBlock: 'pre' } as Record<string, string>)[node.type || ''];
  return tag ? `<${tag}>${content || (tag === 'p' ? '<br>' : '')}</${tag}>` : content;
}

export type PdfReport = { title: string; intro?: unknown; blocks: { title: string; content: unknown }[] };
export function reportHtml(report: PdfReport) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(report.title)}</title><style>
    * { box-sizing: border-box; } body { font: 11pt/1.6 Arial, sans-serif; color: #27272a; }
    .brand { font-size: 9pt; letter-spacing: 2px; color: #71717a; } h1 { font-size: 28pt; line-height: 1.15; margin: 16px 0; }
    h1,h2,h3,h4,h5,h6 { break-after: avoid; overflow-wrap: anywhere; } h2 { font-size: 17pt; } p { orphans: 3; widows: 3; }
    article { border-top: 1px solid #d4d4d8; margin-top: 26px; padding-top: 12px; }
    p,li { overflow-wrap: anywhere; } blockquote { border-left: 3px solid #d4d4d8; padding-left: 16px; margin-left: 0; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f4f4f5; padding: 12px; } code { font-family: monospace; }
  </style></head><body><div class="brand">LEADERSHIP DNA REPORT</div><h1>${escape(report.title)}</h1>
    ${richText(report.intro)}
    ${report.blocks.map(block => `<article><h2>${escape(block.title)}</h2>${richText(block.content)}</article>`).join('')}
  </body></html>`;
}

export async function renderPdf(report: PdfReport) {
  const browser = await chromium.launch({ timeout: 30000 });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(reportHtml(report), { waitUntil: 'load', timeout: 15000 });
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '20mm', left: '18mm', right: '18mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial;color:#71717a"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  } finally { await browser.close(); }
}
