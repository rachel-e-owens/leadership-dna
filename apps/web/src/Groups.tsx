import { useEffect, useState, type FormEvent } from 'react';
import { request } from './api';

type Member = { id: string; displayName: string; email: string; status: 'INVITED' | 'ACTIVE' | 'REMOVED'; invitationStatus: string; invitationExpiresAt: string | null };
type Group = { id: string; name: string; clientName: string | null; status: 'ACTIVE' | 'ARCHIVED'; members?: Member[] };
const button = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50';
const primary = 'rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50';

export function Groups({ token }: { token: string }) {
  const [groups, setGroups] = useState<Group[]>([]), [selected, setSelected] = useState<Group | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function refresh(id?: string) {
    const items = await request('/groups', token); setGroups(items);
    if (id) setSelected(await request(`/groups/${id}`, token));
  }
  useEffect(() => { refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [token]);
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) {
      setError((e as Error).message);
      // Failed email delivery still saves the member, allowing a visible retry.
      if (selected) await refresh(selected.id).catch(() => {});
    } finally { setBusy(false); }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, data = new FormData(form);
    await action(async () => {
      const group = await request('/groups', token, { method: 'POST', body: JSON.stringify({ name: data.get('name'), clientName: data.get('clientName') || null }) });
      form.reset(); await refresh(group.id);
    });
  }
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    await action(async () => { await request(`/groups/${selected!.id}`, token, { method: 'PATCH', body: JSON.stringify({ name: data.get('name'), clientName: data.get('clientName') || null }) }); await refresh(selected!.id); setNotice('Group updated.'); });
  }
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget, data = new FormData(form);
    await action(async () => {
      await request(`/groups/${selected!.id}/members`, token, { method: 'POST', body: JSON.stringify({ displayName: data.get('displayName'), email: data.get('email') }) });
      form.reset(); await refresh(selected!.id); setNotice('Invitation sent.');
    });
  }
  const memberAction = (member: Member, kind: 'resend' | 'revoke' | 'remove') => action(async () => {
    await request(`/groups/${selected!.id}/members/${member.id}${kind === 'remove' ? '' : '/invitations'}`, token, { method: kind === 'resend' ? 'POST' : 'DELETE' });
    await refresh(selected!.id); setNotice(kind === 'resend' ? 'Invitation sent. Previous links no longer work.' : kind === 'revoke' ? 'Invitation revoked.' : 'Member removed.');
  });
  return <main className="mx-auto max-w-6xl p-5 sm:p-8">
    <header className="mb-6"><p className="text-xs uppercase tracking-widest">Consultant workspace</p><h1>Groups</h1><p>Manage your client engagements and private member invitations.</p></header>
    {error && <p role="alert" className="my-4 text-red-700">{error}</p>}{notice && <p role="status" className="my-4">{notice}</p>}
    <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <aside><form onSubmit={create} className="rounded-xl border bg-white p-4"><h2>Create group</h2><label>Group name<input name="name" required maxLength={200} /></label><label>Client name (optional)<input name="clientName" maxLength={200} /></label><button className={primary} disabled={busy}>Create group</button></form>
        <section aria-label="Your groups" className="mt-5 grid gap-2">{loading ? <p>Loading groups…</p> : groups.length === 0 ? <p>No groups yet.</p> : groups.map(group => <button key={group.id} className={`${button} text-left break-words`} disabled={busy} aria-pressed={selected?.id === group.id} onClick={() => action(async () => { setSelected(await request(`/groups/${group.id}`, token)); })}>{group.name}{group.status === 'ARCHIVED' && ' · Archived'}</button>)}</section>
      </aside>
      {selected ? <section className="min-w-0" aria-label="Group details">
        <form key={`${selected.id}-${selected.name}-${selected.clientName}`} onSubmit={update} className="mb-6 rounded-xl border bg-white p-5"><h2>{selected.name}</h2><p>{selected.status === 'ARCHIVED' ? 'Archived · invitations and member access are paused.' : 'Active engagement'}</p><label>Engagement name<input name="name" required defaultValue={selected.name} maxLength={200} /></label><label>Client<input name="clientName" defaultValue={selected.clientName || ''} maxLength={200} /></label><div className="flex flex-wrap gap-2"><button className={button} disabled={busy}>Save group</button><button type="button" className={button} disabled={busy} onClick={() => {
          if (selected.status === 'ACTIVE' && !window.confirm('Archive this group? Pending invitations will be revoked and member access paused.')) return;
          void action(async () => { await request(`/groups/${selected.id}`, token, { method: 'PATCH', body: JSON.stringify({ status: selected.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }) }); await refresh(selected.id); });
        }}>{selected.status === 'ACTIVE' ? 'Archive group' : 'Restore group'}</button></div></form>
        {selected.status === 'ACTIVE' && <form onSubmit={invite} className="mb-6 rounded-xl border bg-white p-5"><h2>Invite a member</h2><label>Member name<input required name="displayName" maxLength={200} /></label><label>Member email<input required type="email" name="email" maxLength={254} /></label><button className={primary} disabled={busy}>{busy ? 'Working…' : 'Send invitation'}</button></form>}
        <h2>Members</h2><div className="mt-3 overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Member</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{selected.members?.map(member => <tr key={member.id} className="border-t"><td className="p-3"><strong>{member.displayName}</strong><div>{member.email}</div></td><td className="p-3">{member.status === 'INVITED' ? member.invitationStatus.toLowerCase() : member.status.toLowerCase()}{member.status === 'INVITED' && member.invitationStatus === 'PENDING' && member.invitationExpiresAt && <small className="block">Expires {new Date(member.invitationExpiresAt).toLocaleDateString()}</small>}</td><td className="p-3"><div className="flex flex-wrap gap-2">{selected.status === 'ACTIVE' && member.status !== 'REMOVED' && <>{member.status === 'INVITED' && <><button className={button} disabled={busy} onClick={() => memberAction(member, 'resend')}>Resend invitation</button>{member.invitationStatus === 'PENDING' && <button className={button} disabled={busy} onClick={() => memberAction(member, 'revoke')}>Revoke invitation</button>}</>}<button className={button} disabled={busy} onClick={() => { if (window.confirm(`Remove ${member.displayName} from this group?`)) void memberAction(member, 'remove'); }}>Remove member</button></>}</div></td></tr>)}</tbody></table>{!selected.members?.length && <p className="p-5">No members yet. Invite your first member above.</p>}</div>
      </section> : <p className="py-8">Create a group or select an engagement to manage its members.</p>}
    </div>
  </main>;
}

export function MemberDashboard({ token, name }: { token: string; name: string }) {
  const [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  useEffect(() => { setLoaded(false); setError(''); request('/me/dashboard', token).then(() => setLoaded(true)).catch(e => setError(e.message)); }, [token]);
  return <main className="mx-auto max-w-4xl p-5 sm:p-8"><h1>Welcome, {name}</h1><p>Your private member workspace.</p>{error ? <p role="alert">{error}</p> : !loaded ? <p>Loading your assignments…</p> : <div className="mt-8 grid gap-6 sm:grid-cols-2"><section className="rounded-xl border bg-white p-6"><h2>My forms</h2><p>No forms assigned yet.</p></section><section className="rounded-xl border bg-white p-6"><h2>My reports shared with me</h2><p>No reports have been shared with you yet.</p></section></div>}</main>;
}

export function InvitationAcceptance({ invitationToken, onJoined }: { invitationToken: string; onJoined: (token: string) => void }) {
  const [invite, setInvite] = useState<{ groupName: string; displayName: string; requiresSignIn: boolean } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [session, setSession] = useState(localStorage.getItem('ld_token') || '');
  useEffect(() => { setInvite(null); setError(''); request('/invitations/inspect', undefined, { method: 'POST', body: JSON.stringify({ token: invitationToken }) }).then(setInvite).catch(e => setError(e.message)); }, [invitationToken]);
  async function accept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const data = new FormData(e.currentTarget); setBusy(true); setError('');
    try {
      let token = session;
      if (invite!.requiresSignIn && !token) {
        const account = await request('/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
        token = account.token; setSession(token); localStorage.setItem('ld_token', token);
      }
      const accepted = await request('/invitations/accept', token || undefined, { method: 'POST', body: JSON.stringify({ token: invitationToken, ...(!invite!.requiresSignIn && !token ? { password: data.get('password') } : {}) }) });
      onJoined(accepted.token);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-lg px-5 py-16"><p className="mb-4 text-xs uppercase tracking-widest">Leadership DNA</p><h1>Join your group</h1>{error && <p role="alert" className="my-4 text-red-700">{error}</p>}{invite ? <form onSubmit={accept} className="mt-6 rounded-xl border bg-white p-6"><h2>{invite.groupName}</h2><p>Welcome, {invite.displayName}. Your forms and answers will be private to you and your consultant.</p>{session ? <div className="my-4"><p>You are signed in. Join with this account or use the account that received the invitation.</p><button className={button} type="button" disabled={busy} onClick={() => { localStorage.removeItem('ld_token'); setSession(''); }}>Use a different account</button></div> : invite.requiresSignIn ? <><p className="mt-4">Sign in with the email that received this invitation.</p><label>Invited email<input name="email" type="email" required autoComplete="username" /></label><label>Password<input name="password" type="password" required autoComplete="current-password" /></label></> : <label>Create password<input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /><small>At least 8 characters.</small></label>}<button className={primary} disabled={busy}>{busy ? 'Joining…' : 'Join group'}</button></form> : !error && <p>Checking invitation…</p>}<a className="mt-6 inline-block text-sm underline" href="/">Back to sign in</a></main>;
}
