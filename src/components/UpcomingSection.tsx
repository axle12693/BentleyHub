'use client';

import type { OccWithTask } from '@/lib/types';
import { OccRow } from './OccRow';

/** "Coming up" list of preview-only future occurrences; renders nothing when empty. */
export function UpcomingSection({ rows }: { rows: OccWithTask[] }) {
  if (rows.length === 0) return null;
  return (<><div className="section-title"><h2>📅 Coming up</h2></div>{rows.map((o) => <OccRow key={o.id} occ={o} showDate />)}</>);
}
