import React from 'react';
import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { blockContent, defaultDocumentStyle, reportDocument } from './report-document';
import type { DocumentStyle, Report, ReportBlock } from './report-document';

const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }, { style: 'text-decoration', consuming: false, getAttrs: value => String(value).includes('underline') ? {} : false }],
  renderHTML: ({ HTMLAttributes }) => ['u', mergeAttributes(HTMLAttributes), 0],
  addKeyboardShortcuts() { return { 'Mod-u': () => this.editor.commands.toggleMark(this.name) }; },
});
const Alignment = Extension.create({
  name: 'alignment',
  addGlobalAttributes: () => [{ types: ['heading', 'paragraph'], attributes: {
    textAlign: { default: null, parseHTML: element => ['left', 'center', 'right', 'justify'].includes(element.style.textAlign) ? element.style.textAlign : null,
      renderHTML: attributes => ['left', 'center', 'right', 'justify'].includes(attributes.textAlign) ? { style: `text-align: ${attributes.textAlign}` } : {} },
  } }],
});
export function ReportEditor({ report, library, onChange }: { report: Report; library: (ReportBlock & { id: string; category: string })[]; onChange: (change: Partial<Report>) => void }) {
  const style = report.documentStyle || defaultDocumentStyle;
  const editor = useEditor({
    extensions: [StarterKit, Underline, Alignment, Placeholder.configure({ placeholder: 'Write here, or insert content from the library…' })],
    content: reportDocument(report),
    editorProps: { attributes: { 'aria-label': 'Report document', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange({ document: editor.getJSON() }),
  });
  const setStyle = (change: Partial<DocumentStyle>) => onChange({ documentStyle: { ...style, ...change } });
  const insert = (content: JSONContent[]) => editor?.chain().focus().insertContent(content).run();
  const insertBlock = (block: ReportBlock) => {
    if (!editor) return;
    const { $from, empty } = editor.state.selection;
    const content = blockContent(block);
    // At document-level paragraph boundaries, insert beside the paragraph rather
    // than splitting off an empty heading/paragraph above or below the block.
    if (empty && $from.depth === 1 && $from.parent.isTextblock) {
      if ($from.parent.content.size === 0) {
        editor.chain().focus().insertContentAt({ from: $from.before(), to: $from.after() }, content).run(); return;
      }
      if ($from.parentOffset === 0 || $from.parentOffset === $from.parent.content.size) {
        editor.chain().focus().insertContentAt($from.parentOffset === 0 ? $from.before() : $from.after(), content).run(); return;
      }
    }
    insert(content);
  };
  const button = (label: string, action: () => unknown, active = false, disabled = false) => <button type="button" aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={action}>{label}</button>;
  return <div className="document-workspace">
    <aside className="library-panel" aria-label="Insert content">
      <h3>Content library</h3><p>Place your cursor in the report, then choose a block to insert an editable copy.</p>
      <button type="button" className="insert-paragraph" onMouseDown={event => event.preventDefault()} onClick={() => insert([{ type: 'paragraph' }])}>+ Blank paragraph</button>
      {library.map(block => <button type="button" className="library-block" key={block.id} onMouseDown={event => event.preventDefault()} onClick={() => insertBlock(block)}>
        <small>{block.category}</small><span>{block.title}</span><span aria-hidden="true"> ＋</span>
      </button>)}
      {!library.length && <p>Add reusable blocks in the Content library.</p>}
      <p>Editing this report keeps your library originals unchanged.</p>
    </aside>
    <section className="document-panel" aria-label="Continuous report editor">
      <div className="document-style" aria-label="Report styling">
        <label>Report font<select aria-label="Report font" value={style.fontFamily} onChange={event => setStyle({ fontFamily: event.target.value as DocumentStyle['fontFamily'] })}>{['Arial', 'Georgia', 'Verdana', 'Times New Roman'].map(font => <option key={font}>{font}</option>)}</select></label>
        <label>Text size<select aria-label="Report text size" value={style.fontSize} onChange={event => setStyle({ fontSize: Number(event.target.value) })}>{Array.from({ length: 16 }, (_, i) => i + 9).map(size => <option key={size} value={size}>{size} pt</option>)}</select></label>
        <label>Line spacing<select aria-label="Report line spacing" value={style.lineHeight} onChange={event => setStyle({ lineHeight: Number(event.target.value) })}>{[1, 1.15, 1.5, 1.6, 2, 2.5].map(height => <option key={height} value={height}>{height}</option>)}</select></label>
        <label>Text color<input aria-label="Report text color" type="color" value={style.color} onChange={event => setStyle({ color: event.target.value })} /></label>
      </div>
      {editor && <div className="document-toolbar" role="toolbar" aria-label="Text formatting">
        <select aria-label="Paragraph style" value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : 'paragraph'} onChange={event => event.target.value === 'paragraph' ? editor.chain().focus().setParagraph().run() : editor.chain().focus().setHeading({ level: Number(event.target.value) as 1 | 2 | 3 }).run()}>
          <option value="paragraph">Paragraph</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
        </select>
        {button('Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {button('Italic', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {button('Underline', () => editor.chain().focus().toggleMark('underline').run(), editor.isActive('underline'))}
        {button('Strike', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
        {button('Bullets', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {button('Numbered list', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {button('Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
        {['left', 'center', 'right', 'justify'].map(align => <React.Fragment key={align}>{button(align[0].toUpperCase() + align.slice(1), () => editor.chain().focus().updateAttributes('paragraph', { textAlign: align }).updateAttributes('heading', { textAlign: align }).run(), editor.isActive({ textAlign: align }))}</React.Fragment>)}
        {button('Divider', () => editor.chain().focus().setHorizontalRule().run())}
        {button('Clear formatting', () => editor.chain().focus().unsetAllMarks().clearNodes().resetAttributes('paragraph', ['textAlign']).run())}
        {button('Undo', () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {button('Redo', () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
      </div>}
      <div className="document-page" style={{ fontFamily: style.fontFamily, fontSize: `${style.fontSize}pt`, lineHeight: style.lineHeight, color: style.color }}><EditorContent editor={editor} /></div>
      {!!report.blocks?.length && <details className="facilitator-notes"><summary>Private facilitator notes · excluded from the report</summary>{report.blocks.map((block, index) => <label key={block.id || index}>{block.title}<textarea aria-label={`Private notes: ${block.title}`} value={block.notes || ''} onChange={event => onChange({ blocks: report.blocks!.map((item, i) => i === index ? { ...item, notes: event.target.value } : item) })} /></label>)}</details>}
    </section>
  </div>;
}
