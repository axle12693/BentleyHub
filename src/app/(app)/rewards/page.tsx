'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { attempt, Avatar, Modal, SegControl } from '@/components/ui';
import { fmtDateTime } from '@/lib/dates';
import { rpc, useHub } from '@/lib/hub';
import { supabase } from '@/lib/supabase';
import type { Reward } from '@/lib/types';

export default function RewardsPage() {
  const router = useRouter();
  const { me, members, rewards, redemptions, ledger, balances, household, isAdult, isSitter, memberById, reload } = useHub();
  const [editing, setEditing] = useState<Reward | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (isSitter) router.replace('/');
  }, [isSitter, router]);
  if (isSitter) return null;

  const family = members.filter((m) => m.role !== 'sitter');
  const myPoints = balances.member[me.id] ?? 0;
  const pending = redemptions.filter((r) => r.status === 'pending');
  const goal = rewards.filter((r) => r.kind === 'family').sort((a, b) => a.cost - b.cost);

  // Points already promised to pending requests aren't spendable twice.
  const held = (memberId: string | null) =>
    pending.filter((r) => r.member_id === memberId).reduce((s, r) => s + r.cost, 0);

  async function redeem(r: Reward) {
    setBusy(r.id);
    await attempt(
      () => rpc('request_redemption', { p_reward: r.id, p_member: r.kind === 'individual' ? me.id : null }),
      isAdult ? 'Requested — approve it below 🎁' : 'Requested! A grown-up will approve it 🎁',
    );
    await reload();
    setBusy(null);
  }
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    await attempt(() => rpc('decide_redemption', { p_redemption: id, p_approve: approve }), approve ? 'Approved 🎉' : 'Declined');
    await reload();
    setBusy(null);
  }

  return (
    <>
      <div className="topbar"><h1 className="page-title">Rewards 🎁</h1></div>

      <div className="section-title" style={{ marginTop: 0 }}><h2>Points</h2></div>
      <div className="card">
        {family.map((m) => (
          <div key={m.id} className="list-item row">
            <Avatar member={m} large />
            <div className="grow"><b>{m.display_name}</b>{m.id === me.id && <span className="muted small"> (you)</span>}</div>
            <span className="pill" style={{ fontSize: '1rem', padding: '4px 14px' }}>{balances.member[m.id] ?? 0} pts</span>
          </div>
        ))}
        {isAdult && (
          <div style={{ marginTop: 10 }}>
            <button className="btn small" onClick={() => setAdjusting(true)}>± Adjust points</button>
          </div>
        )}
      </div>

      <div className="section-title"><h2>🫙 Family reward jar</h2></div>
      <div className="card sage">
        <div className="spread"><b>Shared balance</b><b>{balances.family} pts</b></div>
        <p className="small muted">{household.family_bonus_pct}% of the points everyone earns is added to the jar — so teamwork pays.</p>
        {goal.length === 0 && <p className="muted small">No family rewards yet{isAdult ? ' — add one below.' : '.'}</p>}
        {goal.map((g) => {
          const pct = Math.min(100, (balances.family / g.cost) * 100);
          const can = balances.family - held(null) >= g.cost;
          return (
            <div key={g.id} style={{ marginTop: 12 }}>
              <div className="spread">
                <span className="reward"><span className="big-emoji">🍿</span><b>{g.title}</b></span>
                <span className="small">{Math.min(balances.family, g.cost)} / {g.cost}</span>
              </div>
              <div className="progress" style={{ margin: '6px 0' }}><i style={{ width: `${pct}%` }} /></div>
              <div className="row">
                <button className="btn small primary" disabled={!can || busy === g.id} onClick={() => redeem(g)}>
                  {can ? 'Redeem together' : `${Math.max(0, g.cost - balances.family)} more to go`}
                </button>
                {isAdult && <button className="btn small ghost" onClick={() => setEditing(g)}>Edit</button>}
              </div>
            </div>
          );
        })}
      </div>

      {pending.length > 0 && (
        <>
          <div className="section-title"><h2>Waiting for approval</h2></div>
          {pending.map((r) => {
            const who = r.member_id ? memberById(r.member_id)?.display_name : 'The family';
            return (
              <div className="card flat" key={r.id} style={{ marginBottom: 8 }}>
                <div className="spread">
                  <div><b>{r.reward_title}</b><div className="muted small">{who} · {r.cost} pts</div></div>
                  {isAdult ? (
                    <div className="row">
                      <button className="btn small primary" disabled={busy === r.id} onClick={() => decide(r.id, true)}>Approve</button>
                      <button className="btn small" disabled={busy === r.id} onClick={() => decide(r.id, false)}>Decline</button>
                    </div>
                  ) : (
                    <span className="pill clay">Pending</span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="section-title">
        <h2>My rewards</h2>
        {isAdult && <button className="btn small" onClick={() => setEditing('new')}>+ Add reward</button>}
      </div>
      {rewards.filter((r) => r.kind === 'individual').length === 0 && (
        <div className="card empty">No personal rewards yet.{isAdult && ' Add things like “Choose dinner” or “30 min of screen time”.'}</div>
      )}
      {rewards.filter((r) => r.kind === 'individual').map((r) => {
        const can = myPoints - held(me.id) >= r.cost;
        return (
          <div className="card flat" key={r.id} style={{ marginBottom: 8 }}>
            <div className="spread">
              <span className="reward"><span className="big-emoji">🎁</span><span><b>{r.title}</b><div className="muted small">{r.cost} points</div></span></span>
              <div className="row">
                {isAdult && <button className="btn small ghost" onClick={() => setEditing(r)}>Edit</button>}
                <button className="btn small primary" disabled={!can || busy === r.id} onClick={() => redeem(r)}>
                  {can ? 'Redeem' : `Need ${r.cost - myPoints}`}
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="section-title"><h2>Recent activity</h2></div>
      <div className="card">
        {ledger.length === 0 && <div className="empty">Points you earn will show up here.</div>}
        {ledger.slice(0, 25).map((l) => (
          <div key={l.id} className="list-item row">
            <div className="grow">
              <b>{l.scope === 'family' ? '🫙 Family jar' : memberById(l.member_id)?.display_name ?? 'Former member'}</b>
              <div className="muted small">{labelKind(l.kind)}{l.note ? ` · ${l.note}` : ''} · {fmtDateTime(l.created_at)}</div>
            </div>
            <span className={`pill ${l.delta < 0 ? 'red' : ''}`}>{l.delta > 0 ? '+' : ''}{l.delta}</span>
          </div>
        ))}
      </div>

      {editing && <RewardForm reward={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustForm onClose={() => setAdjusting(false)} />}
    </>
  );
}

const labelKind = (k: string) =>
  ({ earn: 'Earned', family_bonus: 'Team bonus', reverse: 'Reversed', redeem: 'Redeemed', adjust: 'Adjusted' } as Record<string, string>)[k] ?? k;

function RewardForm({ reward, onClose }: { reward?: Reward; onClose: () => void }) {
  const { household, reload } = useHub();
  const [title, setTitle] = useState(reward?.title ?? '');
  const [cost, setCost] = useState(String(reward?.cost ?? 50));
  const [kind, setKind] = useState<Reward['kind']>(reward?.kind ?? 'individual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const row = { title: title.trim(), cost: Math.max(1, Math.round(Number(cost) || 1)), kind };
    const sb = supabase();
    const { error: err } = reward ? await sb.from('rewards').update(row).eq('id', reward.id) : await sb.from('rewards').insert({ ...row, household_id: household.id });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    await reload();
    onClose();
  }
  async function remove() {
    if (!reward || !confirm(`Remove “${reward.title}”?`)) return;
    setBusy(true);
    const ok = await attempt(async () => {
      const { error: err } = await supabase().from('rewards').update({ active: false }).eq('id', reward.id);
      if (err) throw err;
    });
    if (ok) {
      await reload();
      onClose();
    } else setBusy(false);
  }

  return (
    <Modal title={reward ? 'Edit reward' : 'New reward'} onClose={onClose}>
      <form onSubmit={save}>
        <label>Reward</label>
        <input required autoFocus value={title} maxLength={80} placeholder="e.g. Family movie night" onChange={(e) => setTitle(e.target.value)} />
        <label>Cost (points)</label>
        <input type="number" min={1} required value={cost} onChange={(e) => setCost(e.target.value)} />
        <label>Who earns it?</label>
        <SegControl value={kind} onChange={setKind} options={[['individual', 'Individual'], ['family', 'Whole family']]} />
        <p className="muted small">
          {kind === 'individual' ? 'Spent from one person’s own points.' : 'Spent from the shared family jar, which fills as everyone completes tasks.'}
        </p>
        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary grow" disabled={busy || !title.trim()}>Save</button>
          {reward && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Remove</button>}
        </div>
      </form>
    </Modal>
  );
}

function AdjustForm({ onClose }: { onClose: () => void }) {
  const { members, household, reload } = useHub();
  const [who, setWho] = useState<string>(members.find((m) => m.role !== 'sitter')?.id ?? '');
  const [delta, setDelta] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await rpc('adjust_points', { p_household: household.id, p_member: who === 'family' ? null : who, p_delta: Math.round(Number(delta)), p_note: note });
      await reload();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Adjust points" onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted small">Bonus for a great week, or a correction. Every adjustment is recorded in the history.</p>
        <label>Who</label>
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          {members.filter((m) => m.role !== 'sitter').map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          <option value="family">Family jar</option>
        </select>
        <label>Points (use a minus to remove)</label>
        <input type="number" required value={delta} onChange={(e) => setDelta(e.target.value)} />
        <label>Reason</label>
        <input value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy || !Number(delta)}>Apply</button>
      </form>
    </Modal>
  );
}
