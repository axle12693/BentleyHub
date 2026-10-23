'use client';

import { useEffect, useState } from 'react';
import { rpc } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtTime, hhmm, today } from '@/lib/dates';
import { useHub } from '@/lib/hub';
import type { OccWithTask } from '@/lib/types';
import { HideTaskModal } from './HideTaskModal';
import { attempt, Avatar, Modal, toast } from './ui';

/** One scheduled task occurrence with a check button. */
export function OccRow({ occ, showDate, missed = 0, canReset }: { occ: OccWithTask; showDate?: boolean; missed?: number; canReset?: boolean }) {
  const { me, isAdult, isSitter, pets, memberById, reload } = useHub();
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [note, setNote] = useState('');
  const t = occ.task;
  // Show the result of our own action immediately; the server copy catches up after the refetch.
  const [expect, setExpect] = useState<'done' | 'pending' | null>(null);
  useEffect(() => setExpect(null), [occ.status, occ.completed_at]);
  const done = (expect ?? occ.status) === 'done';
  const serverDone = occ.status === 'done';
  const covered = occ.status === 'covered';
  const assignee = memberById(t.assignee_member_id);
  const pet = pets.find((p) => p.id === t.pet_id);
  const completer = memberById(occ.completed_by);
  const overdue = !done && !covered && (occ.due_date < today() || (occ.due_date === today() && !!t.due_time && t.due_time.slice(0, 5) < hhmm(new Date())));
  const assignedToOther = !!t.assignee_member_id && t.assignee_member_id !== me.id;
  const lockedForMe = me.role === 'child' && assignedToOther;
  // Upcoming rows are preview-only: finishing a task ahead of its day would farm points.
  const upcoming = occ.due_date > today();
  const canToggle = !busy && !covered && (done ? isAdult : !lockedForMe && !upcoming);

  /** Adults get a heads-up before completing a task assigned to someone else. */
  function confirmNotMine() {
    if (isSitter || !assignedToOther) return true;
    const who = assignee ? assignee.display_name : 'someone else';
    return confirm(`This task is assigned to ${who}, not you. Mark it done anyway?`);
  }

  async function complete(withNote?: string) {
    setBusy(true);
    const ok = await attempt(async () => {
      const r = await rpc<{ points: number; family_bonus: number; covered: number }>('complete_occurrence', {
        p_occurrence: occ.id,
        p_note: withNote ?? null,
        p_today: today(),
      });
      setExpect('done');
      toast(r.points > 0 ? `+${r.points} points! 🎉` : r.covered > 0 ? `Done ✓ · caught up ${r.covered} missed` : 'Done ✓');
    });
    await reload(); // refresh either way (e.g. someone else got there first)
    setBusy(false);
    return ok;
  }

  async function resetOverdue() {
    if (!confirm(`Clear all overdue "${t.title}" up to today? No points will be earned.`)) return;
    setBusy(true);
    await attempt(async () => {
      const n = await rpc<number>('reset_task_overdue', { p_task: t.id, p_today: today() });
      toast(`Cleared ${n} overdue — fresh start`);
    });
    await reload();
    setBusy(false);
  }

  async function undo() {
    if (!confirm('Mark this as not done? Any points awarded will be reversed.')) return;
    setBusy(true);
    const ok = await attempt(() => rpc('uncomplete_occurrence', { p_occurrence: occ.id }), 'Marked as not done');
    if (ok) setExpect('pending');
    await reload();
    setBusy(false);
  }

  return (
    <>
      <div className={`task ${done || covered ? 'done' : ''} ${overdue ? 'overdue' : ''}`}>
        <button
          className={`check ${done ? 'on' : ''}`}
          disabled={!canToggle}
          title={upcoming && !done ? 'Not due yet' : undefined}
          aria-label={done ? `Undo ${t.title}` : `Complete ${t.title}`}
          onClick={() => (done ? undo() : confirmNotMine() && complete())}
        >
          {done ? '✓' : ''}
        </button>
        <div className="grow">
          <div className="task-title">{t.title}</div>
          <div className="task-meta">
            {showDate && <span>{fmtDate(occ.due_date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
            {missed > 0 && <span className="pill gray">+{missed} earlier missed · one check catches up</span>}
            {t.due_time && <span>🕒 {fmtTime(t.due_time)}</span>}
            {pet && <span>🐾 {pet.name}</span>}
            {!isSitter && (
              <span className="row" style={{ gap: 4 }}>
                <Avatar member={assignee} /> {assignee ? assignee.display_name : 'Anyone'}
              </span>
            )}
            {overdue && <span className="pill red">Overdue</span>}
            {canReset && isAdult && (
              <button className="linkbtn" disabled={busy} onClick={resetOverdue} aria-label={`Clear overdue ${t.title} without points`}>
                Clear overdue
              </button>
            )}
            {isAdult && !done && !covered && (
              <button className="linkbtn" disabled={busy} onClick={() => setHideOpen(true)} aria-label={`Hide ${t.title}`}>
                Hide task…
              </button>
            )}
            {covered && <span className="pill gray">Caught up</span>}
            {serverDone && completer && (
              <span>
                ✓ {completer.display_name}
                {occ.completed_at ? ` · ${fmtDateTime(occ.completed_at)}` : ''}
              </span>
            )}
          </div>
          {t.instructions && !done && <div className="task-meta">{t.instructions}</div>}
          {serverDone && occ.note && <div className="task-meta">📝 {occ.note}</div>}
        </div>
        {!isSitter && t.points > 0 && t.points_eligible && <span className="pill">+{t.points}</span>}
        {!done && !covered && !upcoming && (t.guest_visible || isSitter) && (
          <button className="btn small ghost" disabled={busy} onClick={() => confirmNotMine() && setNoteOpen(true)} aria-label="Complete with a note">
            📝
          </button>
        )}
      </div>
      {hideOpen && <HideTaskModal task={t} onClose={() => setHideOpen(false)} />}
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
