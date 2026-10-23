import type { Task } from './types';

/** Whether a task is currently hidden. */
export const isHidden = (t: Pick<Task, 'hidden_until'>, now = Date.now()) => !!t.hidden_until && new Date(t.hidden_until).getTime() > now;

/** Milliseconds until the next hidden task reappears, or null if none are hidden. */
export function nextUnhideIn(tasks: Pick<Task, 'hidden_until'>[], now = Date.now()): number | null {
  const waits = tasks.filter((t) => isHidden(t, now)).map((t) => new Date(t.hidden_until!).getTime() - now);
  return waits.length ? Math.min(...waits) : null;
}

/** The clock value to use now: jumps forward when a hide expired since the clock last ticked (e.g. a refetch after a long sleep). */
export const refreshClock = (tasks: Pick<Task, 'hidden_until'>[], clock: number, now = Date.now()) =>
  tasks.some((t) => t.hidden_until && new Date(t.hidden_until).getTime() > clock && new Date(t.hidden_until).getTime() <= now) ? now : clock;
