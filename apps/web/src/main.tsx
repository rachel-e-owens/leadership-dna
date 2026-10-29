import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import './styles.css';
import { ReportEditor } from './ReportEditor';
import { reportDocument, reportDraft, defaultDocumentStyle } from './report-document';
import type { Report } from './report-document';
import { request } from './api';
import { Groups, InvitationAcceptance, MemberDashboard } from './Groups';

type Dashboard = { reports: (Report & { _count: { blocks: number } })[]; blocks: { id: string; title: string; category: string; content: any }[] };
const doc = (text = '') => ({ type: 'doc', content: text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [{ type: 'paragraph' }] });
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
  const [token, setToken] = useState(localStorage.getItem('ld_token') || ''), [data, setData] = useState<Dashboard | null>(null), [view, setView] = useState<'reports' | 'library' | 'editor' | 'groups' | 'member'>('reports'), [report, setReport] = useState<Report | null>(null), [notice, setNotice] = useState('');
  const [user, setUser] = useState<{ name: string; role: 'CONSULTANT' | 'MEMBER' } | null>(null);
  const [invite, setInvite] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invite') || '');
  useEffect(() => { const change = () => setInvite(new URLSearchParams(location.hash.slice(1)).get('invite') || ''); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  function signOut() { localStorage.removeItem('ld_token'); setToken(''); setUser(null); setData(null); setReport(null); setView('reports'); }
  const editRevision = useRef(0);
  function editReport(change: Partial<Report>) { editRevision.current++; setReport(current => current ? { ...current, ...change } : current); setNotice('Unsaved changes'); }
  const [reportAction, setReportAction] = useState<'saving' | 'deleting' | null>(null);
  const load = async () => { if (!token || invite) return; try { const result = await request('/me', token); setUser(result.user); if (result.user.role === 'CONSULTANT') setData(await request('/dashboard', token)); } catch (error) { setNotice((error as Error).message); } };
  useEffect(() => { load(); }, [token, invite]);
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
  const nav = <nav aria-label="Main navigation" className="flex w-full items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-5 py-3 sm:px-8 [&>*]:shrink-0 [&_button]:whitespace-nowrap"><div className="mr-4 flex items-center gap-1 text-lg font-semibold tracking-tight text-zinc-950">LD<span>•</span></div><button className="rounded-lg px-3 py-2 text-sm" aria-current={view === 'groups' ? 'page' : undefined} onClick={() => setView('groups')}>Groups</button><button className="rounded-lg px-3 py-2 text-sm" onClick={() => setView('member')}>My forms &amp; shared reports</button><button className={view === 'reports' ? 'rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950' : 'rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950'} onClick={() => setView('reports')}>Reports</button><button className={view === 'library' ? 'rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950' : 'rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950'} onClick={() => setView('library')}>Content library</button><button className="ml-auto rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950" onClick={signOut}>Sign out</button></nav>;
  if (invite) return <InvitationAcceptance invitationToken={invite} onJoined={newToken => { localStorage.setItem('ld_token', newToken); setToken(newToken); setData(null); setUser(null); history.replaceState(null, '', location.pathname + location.search); setInvite(''); setView('member'); }} />;
  if (!token) return <Auth onAuth={setToken} />;
  if (!user || (user.role === 'CONSULTANT' && !data)) return <main className="p-12"><p>{notice || 'Loading your workspace…'}</p><button onClick={signOut}>Return to sign in</button></main>;
  if (user.role === 'MEMBER') return <><nav aria-label="Main navigation" className="flex justify-between border-b p-5"><strong>Leadership DNA</strong><button onClick={signOut}>Sign out</button></nav><MemberDashboard token={token} name={user.name} /></>;
  if (view === 'groups') return <>{nav}<Groups token={token} /></>;
  if (view === 'member') return <>{nav}<MemberDashboard token={token} name={user.name} /></>;
  if (!data) return null;
  if (view === 'editor' && report) return <div className="min-h-screen">{nav}<main className="mx-auto w-full max-w-[1600px] px-5 py-8 sm:px-8 sm:py-12"><header className="mb-8 flex flex-wrap items-center justify-between gap-4"><button className="inline-flex py-2 text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline" onClick={() => { setView('reports'); load(); }}>← All reports</button><input className="min-w-0 w-full rounded-lg border-transparent bg-transparent px-0 text-2xl font-semibold tracking-tight sm:w-auto" aria-label="Report name" value={report.title} onChange={e => editReport({ title: e.target.value })}/><div className="flex flex-wrap gap-2"><button className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100" disabled={!!reportAction} onClick={saveReport}>{reportAction === 'saving' ? 'Saving…' : 'Save'}</button><button type="button" className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50" disabled={!!reportAction} onClick={deleteReport}>{reportAction === 'deleting' ? 'Deleting…' : 'Delete'}</button></div></header>{notice && <p className="mb-6 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">{notice}</p>}<ReportEditor key={report.id} report={report} library={data.blocks} onChange={editReport} /></main></div>;
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
