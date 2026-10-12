'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { attempt, Avatar, Modal, roleLabel, SegControl, toast } from '@/components/ui';
import { addDays, dayEndTs, dayStartTs, fmtDateTime, today, tsToDateInput } from '@/lib/dates';
import { rpc, useHub } from '@/lib/hub';
import { supabase } from '@/lib/supabase';
import type { Member } from '@/lib/types';

type Invite = { id: string; code: string; role: string; display_name: string; sitter_start: string | null; sitter_end: string | null; expires_at: string; used_at: string | null };

const COLORS = ['#8BA888', '#C9A87C', '#9BB5C9', '#C99BA8', '#B0A1CC', '#D6B05E', '#7FB3A6'];

function sitterStatus(m: Member) {
  if (m.role !== 'sitter' || !m.sitter_start || !m.sitter_end) return null;
  const now = Date.now();
  if (now < new Date(m.sitter_start).getTime()) return { label: 'Scheduled', cls: 'clay' };
  if (now > new Date(m.sitter_end).getTime()) return { label: 'Expired', cls: 'gray' };
  return { label: 'Active now', cls: '' };
}

export default function FamilyPage() {
  const { me, members, household, memberships, isAdult, isSitter, switchHousehold, reload, rev } = useHub();
  const router = useRouter();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviting, setInviting] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [editSitter, setEditSitter] = useState<Member | null>(null);
  const [editMe, setEditMe] = useState<Member | null>(null);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    if (isSitter) router.replace('/');
  }, [isSitter, router]);

  useEffect(() => {
    if (!isAdult) return;
    let live = true;
    supabase()
      .from('invites')
      .select('id,code,role,display_name,sitter_start,sitter_end,expires_at,used_at')
      .eq('household_id', household.id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .then(({ data }) => live && setInvites((data as Invite[]) ?? []));
    return () => {
      live = false;
    };
  }, [household.id, isAdult, rev]);

  if (isSitter) return null;

  const canRemove = (m: Member) => m.role !== 'owner' && m.id !== me.id && (me.role === 'owner' || m.role === 'sitter' || m.role === 'child');

  async function remove(m: Member) {
    const msg = m.role === 'sitter' ? `End ${m.display_name}'s pet-sitter access now?` : `Remove ${m.display_name} from the household?`;
    if (!confirm(msg)) return;
    await attempt(() => rpc('revoke_member', { p_member: m.id }), 'Removed');
    await reload();
  }

  const linkFor = (code: string) => `${window.location.origin}/join?code=${code}`;

  return (
    <>
      <div className="topbar"><h1 className="page-title">Family 👪</h1></div>

      <div className="card">
        {members.map((m) => {
          const st = sitterStatus(m);
          return (
            <div key={m.id} className="list-item row">
              <Avatar member={m} large />
              <div className="grow">
                <b>{m.display_name}</b>{m.id === me.id && <span className="muted small"> (you)</span>}
                <div className="muted small">
                  {roleLabel(m.role)}{m.role !== 'sitter' && !m.user_id ? ' · no login' : ''}
                  {m.role === 'sitter' && m.sitter_start && m.sitter_end ? ` · ${fmtDateTime(m.sitter_start)} → ${fmtDateTime(m.sitter_end)}` : ''}
                </div>
              </div>
              {st && <span className={`pill ${st.cls}`}>{st.label}</span>}
              <div className="row" style={{ gap: 4 }}>
                {m.role === 'sitter' && isAdult && <button className="btn small" onClick={() => setEditSitter(m)}>Dates</button>}
                {(m.id === me.id || isAdult) && m.role !== 'sitter' && <button className="btn small ghost" onClick={() => setEditMe(m)}>Edit</button>}
                {isAdult && canRemove(m) && <button className="btn small danger" onClick={() => remove(m)}>{m.role === 'sitter' ? 'Revoke' : 'Remove'}</button>}
              </div>
            </div>
          );
        })}
      </div>

      {isAdult && (
        <>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary grow" onClick={() => setInviting(true)}>Invite someone</button>
            <button className="btn grow" onClick={() => setAddingChild(true)}>Add a child profile</button>
          </div>

          {invites.length > 0 && (
            <>
              <div className="section-title"><h2>Open invites</h2></div>
              {invites.map((i) => (
                <div className="card flat" key={i.id} style={{ marginBottom: 8 }}>
                  <div className="spread">
                    <div>
                      <b>{i.display_name}</b> <span className="pill gray">{i.role === 'sitter' ? 'Pet sitter' : i.role === 'child' ? 'Child' : 'Adult'}</span>
                      <div className="muted small">Code <code>{i.code}</code> · expires {fmtDateTime(i.expires_at)}</div>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn small" onClick={() => copyInvite(linkFor(i.code), household.name)}>Share link</button>
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        await attempt(async () => {
                          const { error } = await supabase().from('invites').delete().eq('id', i.id);
                          if (error) throw error;
                        }, 'Invite cancelled');
                        await reload();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="section-title"><h2>Household</h2></div>
          <div className="card flat">
            <div className="spread"><span>{household.name}</span><button className="btn small" onClick={() => setSettings(true)}>Settings</button></div>
          </div>
        </>
      )}

      {memberships.length > 1 && (
        <>
          <div className="section-title"><h2>Switch household</h2></div>
          <div className="chips">
            {memberships.map((m) => (
              <button key={m.household_id} className={`chip ${m.household_id === household.id ? 'on' : ''}`} onClick={() => switchHousehold(m.household_id)}>{m.name}</button>
            ))}
          </div>
        </>
      )}

      <div className="section-title"><h2>On your phone</h2></div>
      <div className="card flat small muted">
        <b>iPhone:</b> open this site in Safari → Share → “Add to Home Screen”.<br />
        <b>Android:</b> open in Chrome → ⋮ menu → “Install app” / “Add to Home screen”.
      </div>

      <button
        className="btn block"
        style={{ marginTop: 20 }}
        onClick={async () => {
          await supabase().auth.signOut();
          router.replace('/login');
        }}
      >
        Sign out
      </button>

      {inviting && <InviteForm onClose={() => setInviting(false)} />}
      {addingChild && <ChildForm onClose={() => setAddingChild(false)} />}
      {editSitter && <SitterDates member={editSitter} onClose={() => setEditSitter(null)} />}
      {editMe && <ProfileForm member={editMe} onClose={() => setEditMe(null)} />}
      {settings && <SettingsForm onClose={() => setSettings(false)} />}
    </>
  );
}

async function copyInvite(link: string, household: string) {
  try {
    if (navigator.share) {
      await navigator.share({ title: `Join ${household} on Bentley Home Hub`, url: link });
      return;
    }
  } catch {
    return; // user cancelled the share sheet
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied');
  } catch {
    window.prompt('Copy this invite link:', link);
  }
}

function InviteForm({ onClose }: { onClose: () => void }) {
  const { household, me, reload } = useHub();
  const [role, setRole] = useState<'adult' | 'child' | 'sitter'>(me.role === 'owner' ? 'adult' : 'sitter');
  const [name, setName] = useState('');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(addDays(today(), 3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (role === 'sitter' && end < start) return setError('The end date is before the start date.');
    setBusy(true);
    setError('');
    try {
      const code = await rpc<string>('create_invite', {
        p_household: household.id,
        p_role: role,
        p_display_name: name,
        p_sitter_start: role === 'sitter' ? dayStartTs(start) : null,
        p_sitter_end: role === 'sitter' ? dayEndTs(end) : null,
      });
      setMade(code);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  if (made) {
    const link = `${window.location.origin}/join?code=${made}`;
    return (
      <Modal title="Invite ready 🎉" onClose={onClose}>
        <p>Send this to {name}. It works once and expires in 7 days.</p>
        <div className="card flat" style={{ wordBreak: 'break-all' }}><code>{link}</code></div>
        <p className="muted small">They’ll create an account (or sign in), then join automatically. Code: <code>{made}</code></p>
        <button className="btn primary block" onClick={() => copyInvite(link, household.name)}>Share / copy link</button>
      </Modal>
    );
  }

  return (
    <Modal title="Invite someone" onClose={onClose}>
      <form onSubmit={create}>
        <label>They are a…</label>
        <SegControl
          value={role}
          onChange={setRole}
          options={[...(me.role === 'owner' ? [['adult', 'Adult'] as [typeof role, string]] : []), ['child', 'Child'], ['sitter', 'Pet sitter']]}
        />
        <p className="muted small">
          {role === 'adult' && 'Full access to tasks, calendar, rewards and settings.'}
          {role === 'child' && 'Sees tasks and calendar, completes their chores, earns and requests rewards.'}
          {role === 'sitter' && 'Sees only the pet-care checklist and animal info you share — and only on the dates you choose.'}
        </p>
        <label>Name</label>
        <input required autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        {role === 'sitter' && (
          <div className="two">
            <div><label>First day</label><input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label>Last day</label><input type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Create invite</button>
      </form>
    </Modal>
  );
}

function ChildForm({ onClose }: { onClose: () => void }) {
  const { household, reload } = useHub();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc('add_child_profile', { p_household: household.id, p_name: name, p_color: color });
      await reload();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a child profile" onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted small">For kids who don’t need their own login yet. A grown-up checks off their chores and the points still go to them.</p>
        <label>Name</label>
        <input required autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <label>Color</label>
        <ColorPick value={color} onChange={setColor} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Add</button>
      </form>
    </Modal>
  );
}

function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="row wrap">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          style={{ width: 34, height: 34, borderRadius: '50%', background: c, border: value === c ? '3px solid var(--ink)' : '3px solid transparent', cursor: 'pointer' }}
        />
      ))}
    </div>
  );
}

function ProfileForm({ member, onClose }: { member: Member; onClose: () => void }) {
  const { reload } = useHub();
  const [name, setName] = useState(member.display_name);
  const [color, setColor] = useState(member.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc('update_member', { p_member: member.id, p_name: name, p_color: color });
      await reload();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit profile" onClose={onClose}>
      <form onSubmit={save}>
        <label>Name</label>
        <input required value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <label>Color</label>
        <ColorPick value={color} onChange={setColor} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Save</button>
      </form>
    </Modal>
  );
}

function SitterDates({ member, onClose }: { member: Member; onClose: () => void }) {
  const { reload } = useHub();
  const [start, setStart] = useState(member.sitter_start ? tsToDateInput(member.sitter_start) : today());
  const [end, setEnd] = useState(member.sitter_end ? tsToDateInput(member.sitter_end) : addDays(today(), 3));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (end < start) return setError('The end date is before the start date.');
    setBusy(true);
    try {
      await rpc('set_sitter_window', { p_member: member.id, p_start: dayStartTs(start), p_end: dayEndTs(end) });
      await reload();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title={`${member.display_name}'s access`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted small">They can only see the pet-care checklist between these dates (inclusive).</p>
        <div className="two">
          <div><label>First day</label><input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label>Last day</label><input type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>Save dates</button>
      </form>
    </Modal>
  );
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const { household, reload } = useHub();
  const [name, setName] = useState(household.name);
  const [pct, setPct] = useState(String(household.family_bonus_pct));
  const [info, setInfo] = useState(household.sitter_info);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc('update_household', {
        p_household: household.id,
        p_name: name,
        p_bonus_pct: Math.max(0, Math.min(100, Math.round(Number(pct) || 0))),
        p_sitter_info: info,
      });
      await reload();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Household settings" onClose={onClose}>
      <form onSubmit={save}>
        <label>Household name</label>
        <input required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <label>Family jar bonus (%)</label>
        <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} />
        <p className="muted small">Each time someone earns points, this % is also added to the shared family jar. It never reduces their own points.</p>
        <label>Info for pet sitters</label>
        <textarea value={info} maxLength={2000} placeholder={'Vet: name & phone\nEmergency contact: …\nGate/door instructions: …'} onChange={(e) => setInfo(e.target.value)} />
        <p className="muted small">Sitters can see this while their access is active. Don’t put anything you wouldn’t tell a house sitter.</p>
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Save</button>
      </form>
    </Modal>
  );
}
