'use client';

import { useEffect, useMemo, useState } from 'react';
import { errMsg, must, rpc } from './api';
import { useHub } from './hub';
import { supabase } from './supabase';
import type { Occurrence, OccWithTask, Task } from './types';

/** Sort by due time (untimed last), then title. */
export const byDueTime = (a: Pick<Task, 'due_time' | 'title'>, b: Pick<Task, 'due_time' | 'title'>) =>
  (a.due_time ?? '99:99').localeCompare(b.due_time ?? '99:99') || a.title.localeCompare(b.title);
export const byOccTime = (a: OccWithTask, b: OccWithTask) => byDueTime(a.task, b.task);

/** Occurrences (with their tasks) between two dates, kept fresh via the hub's realtime revision. */
export function useOccurrences(from: string, to: string) {
  const { household, tasks, rev } = useHub();
  const [raw, setRaw] = useState<Occurrence[]>([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const key = `${household.id}|${from}|${to}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await rpc('ensure_occurrences', { p_household: household.id, p_from: from, p_to: to });
        const data = await must<Occurrence[]>(
          supabase().from('occurrences').select('*').eq('household_id', household.id).gte('due_date', from).lte('due_date', to),
        );
        if (!live) return;
        setRaw(data ?? []);
        setError('');
      } catch (e) {
        if (live) setError(errMsg(e));
      } finally {
        if (live) setLoadedKey(key);
      }
    })();
    return () => { live = false; };
  }, [household.id, from, to, rev, key]);

  // Joining with tasks is separate from fetching, so editing a task never re-queries occurrences.
  const rows = useMemo<OccWithTask[]>(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return raw.flatMap((o) => {
      const task = byId.get(o.task_id);
      return task ? [{ ...o, task }] : [];
    });
  }, [raw, tasks]);

  // "Loading" only when the range or household changed — not on every realtime refresh.
  return { rows, loading: loadedKey !== key, error };
}
