'use client';

import { useState, type FormEvent } from 'react';
import { rpc } from '@/lib/api';
import { addDays, fmtDateTime, localToTs, today, tsToDate } from '@/lib/dates';
import { isHidden } from '@/lib/hidden';
import { useHub } from '@/lib/hub';
import type { Task } from '@/lib/types';
import { useLiveTask } from '@/lib/useLiveTask';
import { useSubmit } from '@/lib/useSubmit';
import { FormError, Modal, SegControl } from './ui';

type Unit = 'hours' | 'days' | 'date';

const MAX_COUNT = 999;
const validCount = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_COUNT;

/** Hide a task, and every occurrence of it, for a while. The task reappears on its own. */
export function HideTaskModal({ task: snapshot, onClose }: { task: Task; onClose: () => void }) {
  const { reload, hiddenClock } = useHub();
  const task = useLiveTask(snapshot);
  const [unit, setUnit] = useState<Unit>('days');
  const [count, setCount] = useState('1');
  const [date, setDate] = useState(() => addDays(today(), 1));
  const { busy, error, setError, run } = useSubmit();
  const hidden = isHidden(task, hiddenClock);
  // Hours that run past midnight skip today's occurrence entirely (the server covers every day before the return day).
  const hours = Number(count);
  const skipsToday = unit === 'hours' && validCount(hours) && tsToDate(new Date(Date.now() + hours * 36e5).toISOString()) > today();

  async function save(until: string | null) {
    const ok = await run(async () => {
      // The server needs the caller's local calendar to know which days the hide covers.
      await rpc('hide_task', { p_task: task.id, p_until: until, p_until_day: until && tsToDate(until), p_today: today() });
      await reload();
    });
    if (ok) onClose();
  }

  function hide(e: FormEvent) {
    e.preventDefault();
    let until: Date;
    if (unit === 'date') {
      if (date <= today()) return setError('Pick a day after today.');
      until = new Date(localToTs(date));
    } else {
      const n = Number(count);
      if (!validCount(n)) return setError(`Enter a whole number from 1 to ${MAX_COUNT}.`);
      until = new Date();
      if (unit === 'hours') until.setTime(until.getTime() + n * 36e5);
      else until.setDate(until.getDate() + n); // calendar days, so a DST change doesn't shift the time of day
    }
    return save(until.toISOString());
  }

  return (
    <Modal title={`Hide “${task.title}”`} onClose={onClose}>
      {hidden && (
        <div className="notice">
          Hidden until {fmtDateTime(task.hidden_until!)}.{' '}
          <button type="button" className="linkbtn" disabled={busy} onClick={() => save(null)}>Show it again now</button>
          <div className="muted small">Today's occurrence stays skipped if the hide reached past it.</div>
        </div>
      )}
      <form onSubmit={hide}>
        <div className="muted small" style={{ marginBottom: 10 }}>
          The task and all its occurrences disappear from every list, then come back on their own. Days it was hidden are skipped, not left overdue. Anything already overdue stays overdue and comes back when the task does.
        </div>
        <label>Hide for</label>
        <SegControl value={unit} onChange={setUnit} options={[['hours', 'Hours'], ['days', 'Days'], ['date', 'Until a date']]} />
        {unit === 'date' ? (
          <div style={{ marginTop: 10 }}>
            <label>Shows again on (start of day)</label>
            <input type="date" required min={addDays(today(), 1)} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        ) : (
          <div className="row" style={{ marginTop: 10 }}>
            <input style={{ width: 90 }} type="number" step={1} min={1} max={MAX_COUNT} value={count} onChange={(e) => setCount(e.target.value)} />
            <span>{Number(count) === 1 ? unit.slice(0, -1) : unit}</span>
          </div>
        )}
        {skipsToday && <div className="muted small" style={{ marginTop: 8 }}>That runs past midnight, so today's occurrence is skipped, not just delayed.</div>}
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 18 }} disabled={busy}>{busy ? 'Saving…' : hidden ? 'Change' : 'Hide'}</button>
      </form>
    </Modal>
  );
}
