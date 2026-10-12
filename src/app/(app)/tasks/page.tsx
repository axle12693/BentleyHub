'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TaskForm } from '@/components/TaskForm';
import { Avatar } from '@/components/ui';
import { fmtTime } from '@/lib/dates';
import { useHub } from '@/lib/hub';
import { describeRecurrence } from '@/lib/recurrence';
import type { Task } from '@/lib/types';

export default function TasksPage() {
  const router = useRouter();
  const { tasks, members, pets, isAdult, isSitter, memberById } = useHub();
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (isSitter) router.replace('/');
  }, [isSitter, router]);

  const filtered = useMemo(
    () =>
      tasks.filter((t) =>
        filter === 'all' ? true : filter === 'open' ? !t.assignee_member_id : filter === 'pets' ? !!t.pet_id : t.assignee_member_id === filter,
      ),
    [tasks, filter],
  );
  const groups = useMemo(() => {
    const g = new Map<string, Task[]>();
    for (const t of filtered) {
      const key = t.routine ? (t.routine === 'morning' ? '🌅 Morning routine' : '🌙 Evening routine') : t.category;
      g.set(key, [...(g.get(key) ?? []), t]);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (isSitter) return null;

  return (
    <>
      <div className="topbar"><h1 className="page-title">Tasks & routines</h1></div>
      <div className="chips" style={{ marginBottom: 6 }}>
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
        <button className={`chip ${filter === 'open' ? 'on' : ''}`} onClick={() => setFilter('open')}>Open (anyone)</button>
        <button className={`chip ${filter === 'pets' ? 'on' : ''}`} onClick={() => setFilter('pets')}>🐾 Pets</button>
        {members.filter((m) => m.role !== 'sitter').map((m) => (
          <button key={m.id} className={`chip ${filter === m.id ? 'on' : ''}`} onClick={() => setFilter(m.id)}>{m.display_name}</button>
        ))}
      </div>

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
      {editing && <TaskForm task={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
