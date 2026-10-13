'use client';

import { useState } from 'react';
import { rpc } from '@/lib/api';
import { addDays, dayEndTs, dayStartTs, today, tsToDate } from '@/lib/dates';
import { useHub } from '@/lib/hub';
import type { Member } from '@/lib/types';
import { useSubmit } from '@/lib/useSubmit';
import { ColorPick, DateRangeFields, FormError, MEMBER_COLORS, Modal, SegControl, toast } from './ui';

export const inviteLink = (code: string) => `${window.location.origin}/join?code=${code}`;

/** Native share sheet where available, otherwise clipboard. */
export async function shareInvite(link: string, household: string) {
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

export function InviteForm({ onClose }: { onClose: () => void }) {
  const { household, me, reload } = useHub();
  const [role, setRole] = useState<'adult' | 'child' | 'sitter'>(me.role === 'owner' ? 'adult' : 'sitter');
  const [name, setName] = useState('');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(addDays(today(), 3));
  const [made, setMade] = useState<string | null>(null);
  const { busy, error, setError, run } = useSubmit();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (role === 'sitter' && end < start) return setError('The end date is before the start date.');
    await run(async () => {
      const code = await rpc<string>('create_invite', {
        p_household: household.id,
        p_role: role,
        p_display_name: name,
        p_sitter_start: role === 'sitter' ? dayStartTs(start) : null,
        p_sitter_end: role === 'sitter' ? dayEndTs(end) : null,
      });
      setMade(code);
      await reload();
    });
  }

  if (made) {
    const link = inviteLink(made);
    return (
      <Modal title="Invite ready 🎉" onClose={onClose}>
        <p>Send this to {name}. It works once and expires in 7 days.</p>
        <div className="card flat" style={{ wordBreak: 'break-all' }}><code>{link}</code></div>
        <p className="muted small">They’ll create an account (or sign in), then join automatically. Code: <code>{made}</code></p>
        <button className="btn primary block" onClick={() => shareInvite(link, household.name)}>Share / copy link</button>
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
        {role === 'sitter' && <DateRangeFields start={start} end={end} onStart={setStart} onEnd={setEnd} />}
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Create invite</button>
      </form>
    </Modal>
  );
}

export function ChildForm({ onClose }: { onClose: () => void }) {
  const { household, reload } = useHub();
  const [name, setName] = useState('');
  const [color, setColor] = useState(MEMBER_COLORS[1]);
  const { busy, error, run } = useSubmit();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      await rpc('add_child_profile', { p_household: household.id, p_name: name, p_color: color });
      await reload();
    });
    if (ok) onClose();
  }
  return (
    <Modal title="Add a child profile" onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted small">For kids who don’t need their own login yet. A grown-up checks off their chores and the points still go to them.</p>
        <label>Name</label>
        <input required autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <label>Color</label>
        <ColorPick value={color} onChange={setColor} />
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Add</button>
      </form>
    </Modal>
  );
}

export function ProfileForm({ member, onClose }: { member: Member; onClose: () => void }) {
  const { reload } = useHub();
  const [name, setName] = useState(member.display_name);
  const [color, setColor] = useState(member.color);
  const { busy, error, run } = useSubmit();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      await rpc('update_member', { p_member: member.id, p_name: name, p_color: color });
      await reload();
    });
    if (ok) onClose();
  }
  return (
    <Modal title="Edit profile" onClose={onClose}>
      <form onSubmit={save}>
        <label>Name</label>
        <input required value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <label>Color</label>
        <ColorPick value={color} onChange={setColor} />
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Save</button>
      </form>
    </Modal>
  );
}

export function SitterDates({ member, onClose }: { member: Member; onClose: () => void }) {
  const { reload } = useHub();
  const [start, setStart] = useState(member.sitter_start ? tsToDate(member.sitter_start) : today());
  const [end, setEnd] = useState(member.sitter_end ? tsToDate(member.sitter_end) : addDays(today(), 3));
  const { busy, error, setError, run } = useSubmit();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (end < start) return setError('The end date is before the start date.');
    const ok = await run(async () => {
      await rpc('set_sitter_window', { p_member: member.id, p_start: dayStartTs(start), p_end: dayEndTs(end) });
      await reload();
    });
    if (ok) onClose();
  }
  return (
    <Modal title={`${member.display_name}'s access`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted small">They can only see the pet-care checklist between these dates (inclusive).</p>
        <DateRangeFields start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>Save dates</button>
      </form>
    </Modal>
  );
}

export function SettingsForm({ onClose }: { onClose: () => void }) {
  const { household, reload } = useHub();
  const [name, setName] = useState(household.name);
  const [pct, setPct] = useState(String(household.family_bonus_pct));
  const [info, setInfo] = useState(household.sitter_info);
  const { busy, error, run } = useSubmit();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      await rpc('update_household', {
        p_household: household.id,
        p_name: name,
        p_bonus_pct: Math.max(0, Math.min(100, Math.round(Number(pct) || 0))),
        p_sitter_info: info,
      });
      await reload();
    });
    if (ok) onClose();
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
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()}>Save</button>
      </form>
    </Modal>
  );
}
