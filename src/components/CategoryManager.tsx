'use client';

import { useMemo, useState } from 'react';
import { renameTaskCategory } from '@/lib/api';
import { FALLBACK_CATEGORY, MAX_CATEGORY_LENGTH, canonicalCategory } from '@/lib/categories';
import { useHub } from '@/lib/hub';
import { Modal, attempt } from './ui';

type Cat = { name: string; count: number };

/** Lists the categories in use and lets adults rename, merge or remove them. */
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { tasks, household, reload } = useHub();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // Case-insensitive grouping; first spelling wins.
  const cats = useMemo(() => {
    const m = new Map<string, Cat>();
    for (const t of tasks) {
      const name = t.category.trim();
      if (!name) continue;
      const k = name.toLowerCase();
      const e = m.get(k) ?? { name, count: 0 };
      e.count++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  async function move(from: string, to: string, msg: string) {
    if (busy) return;
    setBusy(true);
    const ok = await attempt(async () => {
      await renameTaskCategory(household.id, from, to);
      await reload();
    }, msg);
    setBusy(false);
    if (ok) setRenaming(null);
  }

  function rename(c: Cat) {
    const typed = draft.trim().replace(/\s+/g, ' ');
    if (!typed || typed === c.name) return setRenaming(null);
    const others = cats.filter((x) => x.name !== c.name).map((x) => x.name);
    const target = canonicalCategory(typed, others);
    const merging = others.includes(target);
    void move(c.name, target, merging ? `Merged into ${target}` : 'Category renamed');
  }

  function remove(c: Cat) {
    if (!confirm(`Delete "${c.name}"? Its ${c.count} active task${c.count === 1 ? '' : 's'} (plus any archived ones) will move to "${FALLBACK_CATEGORY}".`)) return;
    const target = canonicalCategory(FALLBACK_CATEGORY, cats.map((x) => x.name));
    void move(c.name, target, `Moved to ${target}`);
  }

  return (
    <Modal title="Manage categories" onClose={onClose}>
      {cats.length === 0 && <div className="muted">No categories yet.</div>}
      {cats.map((c) => (
        <div key={c.name} className="task" style={{ alignItems: 'center' }}>
          {renaming === c.name ? (
            <>
              <input
                className="grow"
                autoFocus
                value={draft}
                maxLength={MAX_CATEGORY_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); rename(c); }
                  // Escape cancels the edit instead of closing the whole dialog.
                  else if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); }
                }}
              />
              <button type="button" className="btn small" disabled={busy} onClick={() => rename(c)}>Save</button>
              <button type="button" className="btn ghost small" onClick={() => setRenaming(null)}>Cancel</button>
            </>
          ) : (
            <>
              <div className="grow">
                <div className="task-title">{c.name}</div>
                <div className="task-meta"><span>{c.count} task{c.count === 1 ? '' : 's'}</span></div>
              </div>
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setRenaming(c.name); setDraft(c.name); }}>Rename</button>
              <button type="button" className="btn ghost small" disabled={busy || c.name.toLowerCase() === FALLBACK_CATEGORY.toLowerCase()} onClick={() => remove(c)}>Delete</button>
            </>
          )}
        </div>
      ))}
      <p className="muted small">Renaming to an existing category merges them. Deleting moves tasks to “{FALLBACK_CATEGORY}”. New categories are added from the task form.</p>
    </Modal>
  );
}
