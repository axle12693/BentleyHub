'use client';

import { useState } from 'react';
import { patchRow, rpc, saveRow } from '@/lib/api';
import { useHub } from '@/lib/hub';
import type { Reward } from '@/lib/types';
import { useSubmit } from '@/lib/useSubmit';
import { FormError, Modal, SegControl } from './ui';

export function RewardForm({ reward, onClose }: { reward?: Reward; onClose: () => void }) {
  const { household, reload } = useHub();
  const [title, setTitle] = useState(reward?.title ?? '');
  const [cost, setCost] = useState(String(reward?.cost ?? 50));
  const [kind, setKind] = useState<Reward['kind']>(reward?.kind ?? 'individual');
  const { busy, error, run } = useSubmit();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const row = { title: title.trim(), cost: Math.max(1, Math.round(Number(cost) || 1)), kind };
    const ok = await run(async () => {
      await saveRow('rewards', row, { id: reward?.id, household: household.id });
      await reload();
    });
    if (ok) onClose();
  }
  async function remove() {
    if (!reward || !confirm(`Remove “${reward.title}”?`)) return;
    const ok = await run(async () => {
      await patchRow('rewards', reward.id, { active: false });
      await reload();
    });
    if (ok) onClose();
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
        <FormError error={error} />
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary grow" disabled={busy || !title.trim()}>Save</button>
          {reward && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Remove</button>}
        </div>
      </form>
    </Modal>
  );
}

export function AdjustForm({ onClose }: { onClose: () => void }) {
  const { family, household, reload } = useHub();
  const [who, setWho] = useState<string>(family[0]?.id ?? '');
  const [delta, setDelta] = useState('10');
  const [note, setNote] = useState('');
  const { busy, error, run } = useSubmit();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      await rpc('adjust_points', { p_household: household.id, p_member: who === 'family' ? null : who, p_delta: Math.round(Number(delta)), p_note: note });
      await reload();
    });
    if (ok) onClose();
  }
  return (
    <Modal title="Adjust points" onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted small">Bonus for a great week, or a correction. Every adjustment is recorded in the history.</p>
        <label>Who</label>
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          {family.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          <option value="family">Family jar</option>
        </select>
        <label>Points (use a minus to remove)</label>
        <input type="number" required value={delta} onChange={(e) => setDelta(e.target.value)} />
        <label>Reason</label>
        <input value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} />
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy || !Number(delta)}>Apply</button>
      </form>
    </Modal>
  );
}
