'use client';

import { useEffect } from 'react';
import { useHub } from '@/lib/hub';
import type { Task } from '@/lib/types';

export const matchesTaskFilter = (t: Task, filter: string) =>
  filter === 'all' ? true : filter === 'open' ? !t.assignee_member_id : filter === 'pets' ? !!t.pet_id : t.assignee_member_id === filter;

export function TaskFilterChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { members, me } = useHub();
  const known = value === 'all' || value === 'open' || value === 'pets' || members.some((m) => m.id === value);

  // The selected member can disappear (removed, sitter access ended); don't leave an invisible filter on.
  useEffect(() => {
    if (!known) onChange('all');
  }, [known, onChange]);

  const chip = (id: string, label: string) => (
    <button key={id} className={`chip ${value === id ? 'on' : ''}`} onClick={() => onChange(id)}>{label}</button>
  );
  return (
    <div className="chips" style={{ marginBottom: 6 }}>
      {chip('all', 'All')}
      {chip('open', 'Open (anyone)')}
      {chip('pets', '🐾 Pets')}
      {members.map((m) => chip(m.id, m.id === me.id ? `${m.display_name} (me)` : m.display_name))}
    </div>
  );
}
