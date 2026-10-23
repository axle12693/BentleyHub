import { useEffect, useRef, useState } from 'react';
import { nextUnhideIn, refreshClock } from './hidden';
import type { Task } from './types';

const MAX_TIMEOUT = 2 ** 31 - 1;

/** A clock that ticks when the soonest hide runs out, so hidden tasks come back without a reload. It can lag real time by a render after a long sleep until the wake handler or timer fires. */
export function useHiddenClock(tasks: Pick<Task, 'hidden_until'>[]) {
  const [now, setNow] = useState(() => Date.now());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  // Timers are throttled or paused while the tab sleeps, so re-check when it comes back.
  useEffect(() => {
    const wake = () => document.visibilityState === 'visible' && setNow((n) => refreshClock(tasksRef.current, n));
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);
  useEffect(() => {
    const fresh = refreshClock(tasks, now);
    if (fresh !== now) {
      setNow(fresh);
      return;
    }
    const wait = nextUnhideIn(tasks);
    if (wait == null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(wait, MAX_TIMEOUT) + 50);
    return () => clearTimeout(timer);
  }, [tasks, now]);
  return now;
}
