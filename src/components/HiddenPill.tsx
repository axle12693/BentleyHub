'use client';

import type { CSSProperties } from 'react';
import { fmtDateTime } from '@/lib/dates';
import { isHidden } from '@/lib/hidden';
import { useHub } from '@/lib/hub';
import type { Task } from '@/lib/types';

/** "Hidden until …" badge; renders nothing for a task that isn't hidden. */
export function HiddenPill({ task, style }: { task: Task; style?: CSSProperties }) {
  const { hiddenClock, isAdult } = useHub();
  if (!isAdult || !task.hidden_until || !isHidden(task, hiddenClock)) return null;
  return <span className="pill gray" style={style}>Hidden until {fmtDateTime(task.hidden_until)}</span>;
}
