'use client';

import { useMemo, useState } from 'react';
import { CategoryManager } from '@/components/CategoryManager';
import { TaskFilterChips, matchesTaskFilter } from '@/components/TaskFilter';
import { TaskForm } from '@/components/TaskForm';
import { Avatar } from '@/components/ui';
import { canonicalCategory } from '@/lib/categories';
import { fmtTime } from '@/lib/dates';
import { useBlockSitter } from '@/lib/guards';
import { useHub } from '@/lib/hub';
import { describeRecurrence } from '@/lib/recurrence';
import { showsEarly } from '@/lib/upcoming';
import type { Task } from '@/lib/types';

export default function TasksPage() {
  const blocked = useBlockSitter();
  const { tasks, pets, isAdult, memberById } = useHub();
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [managing, setManaging] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  const filtered = useMemo(
    () => tasks.filter((t) => matchesTaskFilter(t, filter)),
    [tasks, filter],
  );
  const groups = useMemo(() => {
    const g = new Map<string, Task[]>();
    const names = tasks.map((t) => t.category);
    for (const t of filtered) {
      const key = t.routine ? (t.routine === 'morning' ? '🌅 Morning routine' : '🌙 Evening routine') : canonicalCategory(t.category, names);
      g.set(key, [...(g.get(key) ?? []), t]);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, tasks]);

  if (blocked) return null;

  return (
    <>
      <div className="topbar">
        <h1 className="page-title">Tasks & routines</h1>
        {isAdult && tasks.length > 0 && <button className="btn ghost small" onClick={() => setManaging(true)}>Categories</button>}
      </div>
      <TaskFilterChips value={filter} onChange={setFilter} />

      {tasks.length === 0 && (
        <div className="card empty">
          No tasks yet. {isAdult ? 'Tap + to add your first chore or routine.' : 'An adult can add some.'}
        </div>
      )}
      {groups.map(([name, list]) => (
        <div key={name}>
          <div className="section-title"><h2>{name}</h2><span className="muted small">{list.length}</span></div>
          {list.map((t) => {
            const a = memberById(t.assignee_member_id);
            const pet = pets.find((p) => p.id === t.pet_id);
            return (
              <div
                key={t.id}
                className="task"
                style={{ cursor: isAdult ? 'pointer' : 'default' }}
                onClick={() => isAdult && setEditing(t)}
                role={isAdult ? 'button' : undefined}
                tabIndex={isAdult ? 0 : undefined}
                onKeyDown={(e) => isAdult && e.key === 'Enter' && setEditing(t)}
              >
                <Avatar member={a} />
                <div className="grow">
                  <div className="task-title">{t.title}</div>
                  <div className="task-meta">
                    <span>🔁 {describeRecurrence(t.recurrence)}</span>
                    {t.due_time && <span>🕒 {fmtTime(t.due_time)}</span>}
                    {pet && <span>🐾 {pet.name}</span>}
                    <span>{a ? a.display_name : 'Anyone'}</span>
                    {showsEarly(t) && <span className="pill gray">Shows {t.visible_days_before}d early</span>}
                    {t.guest_visible && <span className="pill gray">Sitter-visible</span>}
                  </div>
                </div>
                {t.points_eligible && t.points > 0 && <span className="pill">+{t.points}</span>}
              </div>
            );
          })}
        </div>
      ))}

      {isAdult && (
        <button className="fab" aria-label="Add task" onClick={() => setEditing('new')}>+</button>
      )}
      {managing && <CategoryManager onClose={() => setManaging(false)} />}
      {editing && <TaskForm task={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
