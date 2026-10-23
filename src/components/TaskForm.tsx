'use client';

import { useState } from 'react';
import { patchRow, saveRow } from '@/lib/api';
import { DAY_LETTERS, FULL_DAY_NAMES, today } from '@/lib/dates';
import { useHub } from '@/lib/hub';
import type { Recurrence, Task } from '@/lib/types';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY, PET_CATEGORY, MAX_CATEGORY_LENGTH, canonicalCategory, uniqueCategories } from '@/lib/categories';
import { MAX_VISIBLE_DAYS } from '@/lib/upcoming';
import { useSubmit } from '@/lib/useSubmit';
import { FormError, Modal, SegControl } from './ui';

const NEW = '__new__';

type RecType = Recurrence['type'];

export function TaskForm({ task, presetPetId, onClose }: { task?: Task; presetPetId?: string; onClose: () => void }) {
  const { household, family, pets, tasks, reload } = useHub();
  const r = task?.recurrence;
  const [title, setTitle] = useState(task?.title ?? '');
  const [category, setCategory] = useState(() => {
    if (task) return task.category;
    // Prefer the usual default, but only if the household still uses it (deleted categories shouldn't resurface).
    const inUse = uniqueCategories(tasks.map((t) => t.category));
    const preferred = presetPetId ? PET_CATEGORY : DEFAULT_CATEGORY;
    const match = inUse.find((c) => c.toLowerCase() === preferred.toLowerCase());
    // Pet tasks always default to PET_CATEGORY; others fall back to any category still in use.
    return presetPetId ? match ?? preferred : match ?? inUse[0] ?? preferred;
  });
  const [routine, setRoutine] = useState<string>(task?.routine ?? '');
  const [assignee, setAssignee] = useState<string>(task?.assignee_member_id ?? '');
  const [petId, setPetId] = useState<string>(task?.pet_id ?? presetPetId ?? '');
  const [points, setPoints] = useState(String(task?.points ?? 5));
  const [eligible, setEligible] = useState(task?.points_eligible ?? true);
  const [instructions, setInstructions] = useState(task?.instructions ?? '');
  const [dueTime, setDueTime] = useState(task?.due_time?.slice(0, 5) ?? '');
  const [recType, setRecType] = useState<RecType>(r?.type ?? 'daily');
  const [days, setDays] = useState<number[]>(r?.type === 'weekdays' ? r.days : [1, 2, 3, 4, 5]);
  const [every, setEvery] = useState(String(r?.type === 'interval' ? r.every : 2));
  const [overdueMode, setOverdueMode] = useState<Task['overdue_mode']>(task?.overdue_mode ?? 'each');
  const [start, setStart] = useState(task?.start_date ?? today());
  const [end, setEnd] = useState(task?.end_date ?? '');
  const [early, setEarly] = useState(task?.visible_days_before != null);
  const [earlyDays, setEarlyDays] = useState(String(task?.visible_days_before ?? 3));
  const [guest, setGuest] = useState(task?.guest_visible ?? !!presetPetId);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const categoryOptions = uniqueCategories([
    // The built-in list only seeds an empty household; otherwise categories are whatever tasks use (so deletes/renames stick).
    ...(tasks.length === 0 ? DEFAULT_CATEGORIES : []),
    ...tasks.map((t) => t.category),
    task?.category ?? '',
    category,
  ]);
  const selectedCategory = canonicalCategory(category, categoryOptions);

  function recurrence(): Recurrence {
    if (recType === 'weekdays') return { type: 'weekdays', days: [...days].sort() };
    if (recType === 'interval') return { type: 'interval', every: Math.max(1, Math.min(365, Number(every) || 1)) };
    return { type: recType } as Recurrence;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (recType === 'weekdays' && days.length === 0) return setError('Pick at least one day.');
    if (early && !(Number.isInteger(Number(earlyDays)) && Number(earlyDays) >= 1 && Number(earlyDays) <= MAX_VISIBLE_DAYS))
      return setError(`"How long before?" must be between 1 and ${MAX_VISIBLE_DAYS} days.`);
    if (recType !== 'once' && end && end < start) return setError('The end date is before the start date.');
    let finalCategory = selectedCategory;
    if (adding) {
      const typed = newName.trim().replace(/\s+/g, ' ');
      if (!typed) return setError('Enter a name for the new category, or pick an existing one.');
      finalCategory = canonicalCategory(typed, categoryOptions);
    }
    const row = {
      title: title.trim(),
      category: finalCategory || DEFAULT_CATEGORY,
      routine: routine || null,
      assignee_member_id: assignee || null,
      pet_id: petId || null,
      points: Math.max(0, Math.min(1000, Math.round(Number(points) || 0))),
      points_eligible: eligible,
      instructions: instructions.trim(),
      due_time: dueTime || null,
      recurrence: recurrence(),
      overdue_mode: recType === 'once' ? 'each' : overdueMode,
      start_date: start,
      end_date: recType === 'once' ? null : end || null,
      visible_days_before: early ? Number(earlyDays) : null,
      guest_visible: guest,
    };
    const ok = await run(async () => {
      await saveRow('tasks', row, { id: task?.id, household: household.id });
      await reload();
    });
    if (ok) onClose();
  }

  async function archive() {
    if (!task || !confirm(`Remove “${task.title}”? Past history stays, future occurrences are removed.`)) return;
    const ok = await run(async () => {
      await patchRow('tasks', task.id, { archived: true });
      await reload();
    });
    if (ok) onClose();
  }

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <form onSubmit={save}>
        <label>What needs doing?</label>
        <input required autoFocus={!task} value={title} maxLength={120} placeholder="e.g. Take out the trash" onChange={(e) => setTitle(e.target.value)} />

        <div className="two">
          <div>
            <label>Who</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Anyone (first to finish)</option>
              {family.map((m) => (
                <option key={m.id} value={m.id}>{m.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Points</label>
            <input type="number" min={0} max={1000} value={points} onChange={(e) => setPoints(e.target.value)} />
          </div>
        </div>

        <label>Repeats</label>
        <SegControl
          value={recType}
          onChange={setRecType}
          options={[['once', 'Once'], ['daily', 'Daily'], ['weekdays', 'Days'], ['interval', 'Every N']]}
        />
        {recType === 'weekdays' && (
          <div className="daypick" style={{ marginTop: 10 }}>
            {DAY_LETTERS.map((l, i) => (
              <button
                type="button"
                key={i}
                aria-label={FULL_DAY_NAMES[i]}
                className={days.includes(i) ? 'on' : ''}
                onClick={() => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {recType === 'interval' && (
          <div className="row" style={{ marginTop: 10 }}>
            <span>Every</span>
            <input style={{ width: 80 }} type="number" min={1} max={365} value={every} onChange={(e) => setEvery(e.target.value)} />
            <span>days</span>
          </div>
        )}

        {recType !== 'once' && (
          <>
            <label>If it gets missed</label>
            <SegControl
              value={overdueMode}
              onChange={setOverdueMode}
              options={[['each', 'Each one counts'], ['catch_up', 'Do it once']]}
            />
            <div className="muted small" style={{ marginTop: 6 }}>
              {overdueMode === 'each'
                ? 'Every missed day stays on the list. Each one must be done and earns points.'
                : 'Doing it once catches up all the missed days. Only that one earns points.'}
            </div>
          </>
        )}

        <div className="two">
          <div>
            <label>{recType === 'once' ? 'Date' : 'Starts'}</label>
            <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label>Time (optional)</label>
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
        </div>
        {recType !== 'once' && (
          <>
            <label>Ends (optional)</label>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </>
        )}

        <div className="check-row">
          <input id="visible-early" type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} />
          <label htmlFor="visible-early">Visible before due date?</label>
        </div>
        {early && (
          <div className="row" style={{ marginTop: 10 }}>
            <span>How long before?</span>
            <input style={{ width: 80 }} type="number" step={1} min={1} max={MAX_VISIBLE_DAYS} value={earlyDays} onChange={(e) => setEarlyDays(e.target.value)} />
            <span>days</span>
          </div>
        )}

        <div className="two">
          <div>
            <label>Category</label>
            <select
              value={adding ? NEW : selectedCategory}
              onChange={(e) => {
                if (e.target.value === NEW) {
                  setAdding(true);
                } else {
                  setAdding(false);
                  setNewName('');
                  setCategory(e.target.value);
                }
              }}
            >
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value={NEW}>＋ Add new category…</option>
            </select>
            {adding && (
              <input
                autoFocus
                style={{ marginTop: 6 }}
                value={newName}
                maxLength={MAX_CATEGORY_LENGTH}
                placeholder="New category name"
                onChange={(e) => setNewName(e.target.value)}
              />
            )}
          </div>
          <div>
            <label>Routine</label>
            <select value={routine} onChange={(e) => setRoutine(e.target.value)}>
              <option value="">None</option>
              <option value="morning">Morning routine</option>
              <option value="evening">Evening routine</option>
            </select>
          </div>
        </div>

        <label>For a pet?</label>
        <select value={petId} onChange={(e) => setPetId(e.target.value)}>
          <option value="">Not pet-specific</option>
          {pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label>Instructions / notes</label>
        <textarea value={instructions} maxLength={500} onChange={(e) => setInstructions(e.target.value)} />

        <div className="check-row">
          <input id="el" type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />
          <label htmlFor="el">Earns points</label>
        </div>
        <div className="check-row">
          <input id="gv" type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
          <label htmlFor="gv">Visible to pet sitters</label>
        </div>

        <FormError error={error} />
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary grow" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          {task && (
            <button type="button" className="btn danger" disabled={busy} onClick={archive}>Remove</button>
          )}
        </div>
      </form>
    </Modal>
  );
}
