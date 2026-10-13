'use client';

import { useState } from 'react';
import { AdjustForm, RewardForm } from '@/components/RewardForms';
import { attempt, Avatar } from '@/components/ui';
import { rpc } from '@/lib/api';
import { fmtDateTime } from '@/lib/dates';
import { useBlockSitter } from '@/lib/guards';
import { useHub } from '@/lib/hub';
import type { Reward } from '@/lib/types';

export default function RewardsPage() {
  const blocked = useBlockSitter();
  const { me, family, rewards, redemptions, ledger, balances, household, isAdult, memberById, reload } = useHub();
  const [editing, setEditing] = useState<Reward | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (blocked) return null;

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
          const avail = balances.family - held(null);
          const can = avail >= g.cost;
          return (
            <div key={g.id} style={{ marginTop: 12 }}>
              <div className="spread">
                <span className="reward"><span className="big-emoji">🍿</span><b>{g.title}</b></span>
                <span className="small">{Math.min(balances.family, g.cost)} / {g.cost}</span>
              </div>
              <div className="progress" style={{ margin: '6px 0' }}><i style={{ width: `${pct}%` }} /></div>
              <div className="row">
                <button className="btn small primary" disabled={!can || busy === g.id} onClick={() => redeem(g)}>
                  {can ? 'Redeem together' : `${g.cost - avail} more to go`}
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
        const avail = myPoints - held(me.id);
        const can = avail >= r.cost;
        return (
          <div className="card flat" key={r.id} style={{ marginBottom: 8 }}>
            <div className="spread">
              <span className="reward"><span className="big-emoji">🎁</span><span><b>{r.title}</b><div className="muted small">{r.cost} points</div></span></span>
              <div className="row">
                {isAdult && <button className="btn small ghost" onClick={() => setEditing(r)}>Edit</button>}
                <button className="btn small primary" disabled={!can || busy === r.id} onClick={() => redeem(r)}>
                  {can ? 'Redeem' : `Need ${r.cost - avail}`}
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
