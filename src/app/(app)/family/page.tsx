'use client';

import { useEffect, useState } from 'react';
import { ChildForm, InviteForm, inviteLink, ProfileForm, SettingsForm, shareInvite, SitterDates } from '@/components/FamilyForms';
import { attempt, Avatar } from '@/components/ui';
import { deleteRow, listInvites, rpc, type Invite } from '@/lib/api';
import { useSignOut } from '@/lib/auth';
import { fmtDateTime } from '@/lib/dates';
import { useBlockSitter } from '@/lib/guards';
import { useHub } from '@/lib/hub';
import { roleLabel, type Member } from '@/lib/types';

function sitterStatus(m: Member) {
  if (m.role !== 'sitter' || !m.sitter_start || !m.sitter_end) return null;
  const now = Date.now();
  if (now < new Date(m.sitter_start).getTime()) return { label: 'Scheduled', cls: 'clay' };
  if (now > new Date(m.sitter_end).getTime()) return { label: 'Expired', cls: 'gray' };
  return { label: 'Active now', cls: '' };
}

export default function FamilyPage() {
  const { me, members, household, memberships, isAdult, switchHousehold, reload, rev } = useHub();
  const blocked = useBlockSitter();
  const signOut = useSignOut();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviting, setInviting] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [editSitter, setEditSitter] = useState<Member | null>(null);
  const [editMe, setEditMe] = useState<Member | null>(null);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    if (!isAdult) return;
    let live = true;
    listInvites(household.id)
      .then((rows) => live && setInvites(rows))
      .catch(() => { /* invites are secondary; the list just stays as it was */ });
    return () => {
      live = false;
    };
  }, [household.id, isAdult, rev]);

  if (blocked) return null;

  const canRemove = (m: Member) => m.role !== 'owner' && m.id !== me.id && (me.role === 'owner' || m.role === 'sitter' || m.role === 'child');

  async function remove(m: Member) {
    const msg = m.role === 'sitter' ? `End ${m.display_name}'s pet-sitter access now?` : `Remove ${m.display_name} from the household?`;
    if (!confirm(msg)) return;
    await attempt(() => rpc('revoke_member', { p_member: m.id }), 'Removed');
    await reload();
  }

  async function cancelInvite(id: string) {
    await attempt(() => deleteRow('invites', id), 'Invite cancelled');
    await reload();
  }

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
                  <div>
                    <b>{i.display_name}</b> <span className="pill gray">{roleLabel(i.role as Member['role'])}</span>
                    <div className="muted small">Code <code>{i.code}</code> · expires {fmtDateTime(i.expires_at)}</div>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn small" onClick={() => shareInvite(inviteLink(i.code), household.name)}>Share link</button>
                    <button className="btn small danger" onClick={() => cancelInvite(i.id)}>Cancel</button>
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

      <button className="btn block" style={{ marginTop: 20 }} onClick={signOut}>Sign out</button>

      {inviting && <InviteForm onClose={() => setInviting(false)} />}
      {addingChild && <ChildForm onClose={() => setAddingChild(false)} />}
      {editSitter && <SitterDates member={editSitter} onClose={() => setEditSitter(null)} />}
      {editMe && <ProfileForm member={editMe} onClose={() => setEditMe(null)} />}
      {settings && <SettingsForm onClose={() => setSettings(false)} />}
    </>
  );
}
