import { addDays, tsToDate } from './dates';
import { isHidden } from './hidden';
import type { Occurrence, Task } from './types';

/** Max "visible before due" lead. Home looks 30 days back + this ahead; ensure_occurrences allows 70 days total. */
export const MAX_VISIBLE_DAYS = 30;

/** Whether a task shows up as "Coming up" ahead of its due date. */
export const showsEarly = (t: Pick<Task, 'visible_days_before'>) => t.visible_days_before != null;

/** Furthest lookahead any task needs, in days. Hidden tasks don't count (pass the hub's hiddenClock as `now`). */
export const maxLead = (tasks: Pick<Task, 'visible_days_before' | 'archived' | 'hidden_until'>[], now = Date.now()) =>
  Math.min(MAX_VISIBLE_DAYS, Math.max(0, ...tasks.filter((x) => !x.archived && !isHidden(x, now) && showsEarly(x)).map((x) => x.visible_days_before ?? 0)));

/** Pending future occurrences inside their task's lead window — only the next one per task, soonest first. Tasks already on today's list are skipped. Occurrences on or before `after` (default: today) are left out and don't count as "next". */
export function upcomingOccs<T extends Occurrence & { task: Task }>(rows: T[], today: string, byTime: (a: T, b: T) => number, after = today): T[] {
  const next = new Map<string, T>();
  const onToday = new Set(rows.filter((r) => r.due_date === today).map((r) => r.task_id));
  for (const r of [...rows].sort((a, b) => a.due_date.localeCompare(b.due_date))) {
    if (r.due_date <= after || r.status !== 'pending' || !showsEarly(r.task) || onToday.has(r.task_id)) continue;
    if (r.due_date > addDays(today, r.task.visible_days_before!)) continue;
    if (!next.has(r.task_id)) next.set(r.task_id, r);
  }
  return [...next.values()].sort((a, b) => a.due_date.localeCompare(b.due_date) || byTime(a, b));
}

/** The day an occurrence belongs on once finished: the day it was done, which may be later than its due date. */
export const doneOn = (o: Occurrence) => (o.completed_at ? tsToDate(o.completed_at) : o.due_date);
