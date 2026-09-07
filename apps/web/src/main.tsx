import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import './styles.css';
import { ReportEditor } from './ReportEditor';
import { reportDocument, reportDraft, defaultDocumentStyle } from './report-document';
import type { Report } from './report-document';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
type Dashboard = { reports: (Report & { _count: { blocks: number } })[]; blocks: { id: string; title: string; category: string; content: any }[] };
const doc = (text = '') => ({ type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [{ type: 'paragraph' }] });
async function request(path: string, token?: string, options: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  if (!r.headers.get('content-type')?.includes('application/json')) {
    throw new Error(r.status >= 500
      ? 'The server is temporarily unavailable. Please try again in a moment.'
      : 'The server returned an unexpected response. Please refresh and try again.');
  }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

async function fetchReportPdf(reportId: string, token: string, body: string, signal?: AbortSignal) {
  const response = await fetch(`${API}/reports/${reportId}/pdf`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body, signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || 'Unable to generate the PDF. Please try again.');
  }
  if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The server did not return a PDF. Please try again.');
  return response.blob();
}

function ReportPreview({ report, token }: { report: Report; token: string }) {
  const [url, setUrl] = useState(''), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  // Private notes and database IDs do not affect the exported document.
  const body = JSON.stringify({ draft: reportDraft(report) });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setBusy(true); setError(''); setUrl('');
    const timer = window.setTimeout(async () => {
      try {
        const pdf = await fetchReportPdf(report.id, token, body, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(pdf);
        setUrl(objectUrl);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 800);
    return () => { window.clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [report.id, token, body, retry]);
  return <aside aria-label="PDF preview" className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white lg:sticky lg:top-6">
    <div className="border-b border-zinc-200 p-4"><h2 className="text-base">PDF preview</h2><p className="mt-1">Read-only · Complete report · Updates as you edit</p></div>
    {busy && <p role="status" className="p-6">Preparing PDF preview…</p>}
    {error && <div className="p-6"><p role="alert" className="text-red-700">{error}</p><button type="button" className="mt-3 rounded-lg border border-zinc-300 px-3 py-2 text-sm" onClick={() => setRetry(value => value + 1)}>Retry preview</button></div>}
    {url && <><iframe title="Complete report PDF preview" src={`${url}#toolbar=0&navpanes=0&view=FitH`} className="h-[75vh] min-h-[480px] w-full border-0" /><p className="px-4 py-3">Preview not displaying? <a className="underline" href={url} target="_blank" rel="noreferrer">Open PDF in a new tab</a></p></>}
  </aside>;
}

function ExportButton({ report, token, draft = false }: { report: Report; token: string; draft?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function download() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const pdf = await fetchReportPdf(report.id, token, JSON.stringify(draft ? { draft: reportDraft(report) } : {}));
      const url = URL.createObjectURL(pdf);
      const link = document.createElement('a');
      link.href = url; link.download = `${report.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100) || 'report'}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy} aria-label={`Export ${report.title} to PDF`} className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-50" onClick={download}>{busy ? 'Exporting…' : 'Export PDF'}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}

function RichEditor({ value, onChange, placeholder }: { value: any; onChange: (value: any) => void; placeholder: string }) {
  const editor = useEditor({ extensions: [StarterKit, Placeholder.configure({ placeholder })], content: value || doc(), onUpdate: ({ editor }) => onChange(editor.getJSON()) });
  useEffect(() => { if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value)) editor.commands.setContent(value || doc(), false); }, [editor, value]);
  if (!editor) return null;
  return <div className="my-4 rounded-lg border border-zinc-200 bg-white"><div className="flex gap-1 border-b border-zinc-100 p-2 [&_button]:rounded [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs [&_button]:text-zinc-600 [&_button:hover]:bg-zinc-100"><button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'bg-zinc-200 font-semibold' : ''}>B</button><button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button><button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button></div><EditorContent editor={editor} /></div>;
}

function Auth({ onAuth }: { onAuth: (token: string) => void }) {
  const [isLogin, setIsLogin] = useState(true), [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); try { const data = await request(`/auth/${isLogin ? 'login' : 'register'}`, undefined, { method: 'POST', body: JSON.stringify({ name: f.get('name'), email: f.get('email'), password: f.get('password') }) }); localStorage.setItem('ld_token', data.token); onAuth(data.token); } catch (e) { setError((e as Error).message); } }
  return <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-12 px-6 py-16 md:grid-cols-2 md:gap-20 [&_h1]:text-4xl [&_h1]:leading-tight [&_section_p]:mt-5"><section><p className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">LEADERSHIP DNA</p><h1>Build reports that move people forward.</h1><p>Turn your proven Leadership DNA content into thoughtful, personalized client reports.</p></section><form onSubmit={submit} className="rounded-xl border border-zinc-200 bg-white p-6 sm:p-8"><h2>{isLogin ? 'Welcome back' : 'Create your workspace'}</h2>{!isLogin && <label>Name<input required name="name" /></label>}<label>Email<input required type="email" name="email" defaultValue={isLogin ? 'demo@leadershipdna.com' : ''} /></label><label>Password<input required type="password" name="password" defaultValue={isLogin ? 'welcome123' : ''} /></label>{error && <p className="my-3 text-sm text-red-700">{error}</p>}<button className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700">{isLogin ? 'Sign in' : 'Create account'}</button><button type="button" className="inline-flex py-2 text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline" onClick={() => setIsLogin(!isLogin)}>{isLogin ? 'Need an account?' : 'Already have an account?'}</button><small>Demo: demo@leadershipdna.com / welcome123 (after seeding)</small></form></main>;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('ld_token') || ''), [data, setData] = useState<Dashboard | null>(null), [view, setView] = useState<'reports' | 'library' | 'editor'>('reports'), [report, setReport] = useState<Report | null>(null), [notice, setNotice] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const editRevision = useRef(0);
  function editReport(change: Partial<Report>) { editRevision.current++; setReport(current => current ? { ...current, ...change } : current); setNotice('Unsaved changes'); }
  const [reportAction, setReportAction] = useState<'saving' | 'deleting' | null>(null);
  const load = async () => { if (!token) return; try { setData(await request('/dashboard', token)); } catch { localStorage.removeItem('ld_token'); setToken(''); } };
  useEffect(() => { load(); }, [token]);
  useEffect(() => { const refresh = () => { load(); }; window.addEventListener('content-library:changed', refresh); return () => window.removeEventListener('content-library:changed', refresh); }, [token]);
  async function newReport() { const title = window.prompt('Report title', 'Leadership DNA Report'); if (!title) return; const r = await request('/reports', token, { method: 'POST', body: JSON.stringify({ title }) }); await openReport(r.id); }
  async function openReport(id: string) { const loaded = await request(`/reports/${id}`, token); editRevision.current++; setReport({ ...loaded, document: reportDocument(loaded), documentStyle: loaded.documentStyle || defaultDocumentStyle }); setNotice(''); setView('editor'); }
  useEffect(() => { const open = (event: Event) => { openReport((event as CustomEvent<string>).detail); }; window.addEventListener('report:open', open); return () => window.removeEventListener('report:open', open); }, [token]);
  async function saveReport() {
    if (!report || reportAction) return;
    const revision = editRevision.current;
    setReportAction('saving');
    setNotice('');
    try {
      await request(`/reports/${report.id}`, token, { method: 'PUT', body: JSON.stringify({ ...reportDraft(report), blockNotes: (report.blocks || []).filter(block => block.id).map(block => ({ id: block.id, notes: block.notes || '' })) }) });
      setNotice(editRevision.current === revision ? 'Saved' : 'Unsaved changes');
      await load();
    } catch (e) { setNotice((e as Error).message); }
    finally { setReportAction(null); }
  }
  async function deleteReport() {
    if (!report || reportAction || !window.confirm(`Delete “${report.title}”? This cannot be undone.`)) return;
    setReportAction('deleting');
    setNotice('');
    try {
      await request(`/reports/${report.id}`, token, { method: 'DELETE' });
      setData(current => current ? { ...current, reports: current.reports.filter(item => item.id !== report.id) } : current);
      setReport(null);
      setView('reports');
    } catch (e) { setNotice((e as Error).message); }
    finally { setReportAction(null); }
  }
  function createBlock() { window.dispatchEvent(new Event('content-library:open-form')); }
  const nav = <nav aria-label="Main navigation" className="flex w-full items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-5 py-3 sm:px-8 [&>*]:shrink-0 [&_button]:whitespace-nowrap"><div className="mr-4 flex items-center gap-1 text-lg font-semibold tracking-tight text-zinc-950">LD<span>•</span></div><button className={view === 'reports' ? 'rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950' : 'rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950'} onClick={() => setView('reports')}>Reports</button><button className={view === 'library' ? 'rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950' : 'rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950'} onClick={() => setView('library')}>Content library</button><button className="ml-auto rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950" onClick={() => { localStorage.removeItem('ld_token'); setToken(''); }}>Sign out</button></nav>;
  if (!token) return <Auth onAuth={setToken} />; if (!data) return <p className="p-12 text-sm text-zinc-500">Loading your workspace…</p>;
  if (view === 'editor' && report) return <div className="min-h-screen">{nav}<main className="mx-auto w-full max-w-[1600px] px-5 py-8 sm:px-8 sm:py-12"><header className="mb-8 flex flex-wrap items-center justify-between gap-4"><button className="inline-flex py-2 text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline" onClick={() => { setView('reports'); load(); }}>← All reports</button><input className="min-w-0 w-full rounded-lg border-transparent bg-transparent px-0 text-2xl font-semibold tracking-tight sm:w-auto" aria-label="Report name" value={report.title} onChange={e => editReport({ title: e.target.value })}/><div className="flex flex-wrap gap-2"><ExportButton report={report} token={token} draft /><button type="button" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm" aria-pressed={showPreview} onClick={() => setShowPreview(value => !value)}>{showPreview ? 'Hide PDF preview' : 'Show PDF preview'}</button><button className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100" disabled={!!reportAction} onClick={saveReport}>{reportAction === 'saving' ? 'Saving…' : 'Save'}</button><button type="button" className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50" disabled={!!reportAction} onClick={deleteReport}>{reportAction === 'deleting' ? 'Deleting…' : 'Delete'}</button></div></header>{notice && <p className="mb-6 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">{notice}</p>}<ReportEditor key={report.id} report={report} library={data.blocks} onChange={editReport} />{showPreview && <div className="mx-auto mt-6 max-w-4xl"><ReportPreview key={report.id} report={report} token={token} /></div>}</main></div>;
  return <div className="min-h-screen">{nav}<main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-12"><header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">WORKSPACE</p><h1>{view === 'reports' ? 'Your reports' : 'Content library'}</h1></div>{view === 'reports' && <button className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700" onClick={newReport}>+ New report</button>}{view === 'library' && <button className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700" onClick={createBlock}>+ Add new content block</button>}</header>{view === 'reports' && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.reports.map(r => <article className="min-w-0" key={r.id}><button className="flex h-48 w-full min-w-0 flex-col items-start rounded-xl border border-zinc-200 bg-white p-6 text-left transition hover:border-zinc-400 hover:shadow-sm " key={r.id} onClick={() => openReport(r.id)}><h2 className="my-3 line-clamp-2 w-full break-words text-left" title={r.title}>{r.title}</h2><p className="mt-auto">Open report</p></button></article>)}{!data.reports.length && <div className="col-span-full rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center text-sm text-zinc-500">No reports yet. Create your first one to begin.</div>}</section>}{view === 'library' && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.blocks.map(b => <article className="content-card min-w-0 cursor-pointer rounded-xl border border-zinc-200 bg-white p-6 text-left transition hover:border-zinc-400 hover:shadow-sm [&_h2]:my-3 [&_h2]:break-words" data-block-id={b.id} key={b.id}><small>{b.category}</small><h2>{b.title}</h2><p>Reusable report content</p></article>)}</section>}</main></div>;
}

function ContentBlockModal() {
  const [open, setOpen] = useState(false), [id, setId] = useState<string | null>(null), [title, setTitle] = useState(''), [category, setCategory] = useState('Profile'), [content, setContent] = useState(doc()), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const close = () => { setOpen(false); setId(null); setError(''); };
  useEffect(() => { const show = () => { setId(null); setTitle(''); setCategory('Profile'); setContent(doc()); setOpen(true); }; window.addEventListener('content-library:open-form', show); return () => window.removeEventListener('content-library:open-form', show); }, []);
  useEffect(() => { const edit = async (event: MouseEvent) => { const card = (event.target as Element | null)?.closest('.content-card'); if (!card) return; const blockId = card.getAttribute('data-block-id'); if (!blockId) return; const dashboard = await request('/dashboard', localStorage.getItem('ld_token') || undefined); const block = dashboard.blocks.find((item: Dashboard['blocks'][number]) => item.id === blockId); if (block) { setId(block.id); setTitle(block.title); setCategory(block.category); setContent(block.content); setError(''); setOpen(true); } }; document.addEventListener('click', edit); return () => document.removeEventListener('click', edit); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); try { await request(id ? `/blocks/${id}` : '/blocks', localStorage.getItem('ld_token') || undefined, { method: id ? 'PUT' : 'POST', body: JSON.stringify({ title, category, content }) }); close(); window.dispatchEvent(new Event('content-library:changed')); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }
  async function deleteBlock() {
    if (!id || saving || !window.confirm(`Delete “${title}” from the content library? Existing reports will keep their content. This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    try {
      await request(`/blocks/${id}`, localStorage.getItem('ld_token') || undefined, { method: 'DELETE' });
      close();
      window.dispatchEvent(new Event('content-library:changed'));
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  if (!open) return null;
  return <><div className="fixed inset-0 z-30 grid place-items-center bg-zinc-950/40 p-4 backdrop-blur-sm" role="presentation"><form className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8" onSubmit={submit}><header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">CONTENT LIBRARY</p><h2>{id ? 'Edit content block' : 'Add new content block'}</h2></div><button type="button" className="rounded-lg px-3 py-1 text-2xl text-zinc-500 hover:bg-zinc-100" disabled={saving} onClick={close} aria-label="Close">×</button></header><label>Block title<input required autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Communication Style" /></label><label>Category<input required value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Profile" /></label><label>Reusable content<RichEditor value={content} onChange={setContent} placeholder="Write the reusable report content…" /></label>{error && <p className="my-3 text-sm text-red-700">{error}</p>}<footer className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-6">{id && <button type="button" className="mr-auto rounded-lg border border-red-200 px-3 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50" disabled={saving} onClick={deleteBlock}>Delete block</button>}<button type="button" className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100" disabled={saving} onClick={close}>Cancel</button><button className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700" disabled={saving}>{saving ? 'Saving…' : id ? 'Save changes' : 'Save content block'}</button></footer></form></div></>;
}
createRoot(document.getElementById('root')!).render(<><App /><ContentBlockModal /></>);
