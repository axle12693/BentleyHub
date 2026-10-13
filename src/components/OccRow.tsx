'use client';

import { useState } from 'react';
import { rpc } from '@/lib/api';
import { fmtDateTime, fmtTime, hhmm, today } from '@/lib/dates';
import { useHub } from '@/lib/hub';
import type { OccWithTask } from '@/lib/types';
import { attempt, Avatar, Modal, toast } from './ui';

/** One scheduled task occurrence with a check button. */
export function OccRow({ occ, showDate }: { occ: OccWithTask; showDate?: boolean }) {
  const { me, isAdult, isSitter, pets, memberById, reload } = useHub();
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const t = occ.task;
  const done = occ.status === 'done';
  const assignee = memberById(t.assignee_member_id);
  const pet = pets.find((p) => p.id === t.pet_id);
  const completer = memberById(occ.completed_by);
  const overdue = !done && (occ.due_date < today() || (occ.due_date === today() && !!t.due_time && t.due_time.slice(0, 5) < hhmm(new Date())));
  const lockedForMe = me.role === 'child' && !!t.assignee_member_id && t.assignee_member_id !== me.id;
  const canToggle = !busy && (done ? isAdult : !lockedForMe);

  async function complete(withNote?: string) {
    setBusy(true);
    const ok = await attempt(async () => {
      const r = await rpc<{ points: number; family_bonus: number }>('complete_occurrence', {
        p_occurrence: occ.id,
        p_note: withNote ?? null,
      });
      toast(r.points > 0 ? `+${r.points} points! 🎉` : 'Done ✓');
    });
    await reload(); // refresh either way (e.g. someone else got there first)
    setBusy(false);
    return ok;
  }

  async function undo() {
    if (!confirm('Mark this as not done? Any points awarded will be reversed.')) return;
    setBusy(true);
    await attempt(() => rpc('uncomplete_occurrence', { p_occurrence: occ.id }), 'Marked as not done');
    await reload();
    setBusy(false);
  }

  return (
    <>
      <div className={`task ${done ? 'done' : ''} ${overdue ? 'overdue' : ''}`}>
        <button
          className={`check ${done ? 'on' : ''}`}
          disabled={!canToggle}
          aria-label={done ? `Undo ${t.title}` : `Complete ${t.title}`}
          onClick={() => (done ? undo() : complete())}
        >
          {done ? '✓' : ''}
        </button>
        <div className="grow">
          <div className="task-title">{t.title}</div>
          <div className="task-meta">
            {showDate && <span>{occ.due_date}</span>}
            {t.due_time && <span>🕒 {fmtTime(t.due_time)}</span>}
            {pet && <span>🐾 {pet.name}</span>}
            {!isSitter && (
              <span className="row" style={{ gap: 4 }}>
                <Avatar member={assignee} /> {assignee ? assignee.display_name : 'Anyone'}
              </span>
            )}
            {overdue && <span className="pill red">Overdue</span>}
            {done && completer && (
              <span>
                ✓ {completer.display_name}
                {occ.completed_at ? ` · ${fmtDateTime(occ.completed_at)}` : ''}
              </span>
            )}
          </div>
          {t.instructions && !done && <div className="task-meta">{t.instructions}</div>}
          {done && occ.note && <div className="task-meta">📝 {occ.note}</div>}
        </div>
        {!isSitter && t.points > 0 && t.points_eligible && <span className="pill">+{t.points}</span>}
        {!done && (t.guest_visible || isSitter) && (
          <button className="btn small ghost" disabled={busy} onClick={() => setNoteOpen(true)} aria-label="Complete with a note">
            📝
          </button>
        )}
      </div>
      {noteOpen && (
        <Modal title={t.title} onClose={() => setNoteOpen(false)}>
          <label>Add a note (optional)</label>
          <textarea
            autoFocus
            value={note}
            maxLength={500}
            placeholder="e.g. Ate everything · gave medication · low on food"
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn primary block"
            style={{ marginTop: 14 }}
            disabled={busy}
            onClick={async () => {
              if (await complete(note)) setNoteOpen(false);
            }}
          >
            Mark done
          </button>
        </Modal>
      )}
    </>
  );
}
