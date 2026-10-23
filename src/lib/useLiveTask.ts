import { useHub } from './hub';
import type { Task } from './types';

/** The hub's current copy of a task, falling back to the snapshot a form or modal was opened with. */
export function useLiveTask(snapshot: Task): Task;
export function useLiveTask(snapshot: Task | undefined): Task | undefined;
export function useLiveTask(snapshot: Task | undefined) {
  const { tasks } = useHub();
  return snapshot && (tasks.find((x) => x.id === snapshot.id) ?? snapshot);
}
