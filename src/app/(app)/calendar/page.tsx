'use client';

import { useMemo, useState } from 'react';
import { EventForm } from '@/components/EventForm';
import { OccRow } from '@/components/OccRow';
import { addDays, DAY_NAMES, fmtDate, fmtDateTime, iso, parseISO, startOfMonthGrid, today } from '@/lib/dates';
import { useBlockSitter } from '@/lib/guards';
import { useHub } from '@/lib/hub';
import { byOccTime, useOccurrences } from '@/lib/occurrences';
import type { CalEvent } from '@/lib/types';

const eventDay = (e: CalEvent) => iso(new Date(e.starts_at));

export default function CalendarPage() {
  const blocked = useBlockSitter();
  const { events, isAdult } = useHub();
  const [selected, setSelected] = useState(today());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return iso(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [editing, setEditing] = useState<CalEvent | 'new' | null>(null);

  const gridStart = startOfMonthGrid(month);
  const gridEnd = addDays(gridStart, 41);
  const { rows } = useOccurrences(gridStart, gridEnd);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const monthNum = parseISO(month).getMonth();

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) m.set(eventDay(e), [...(m.get(eventDay(e)) ?? []), e]);
    return m;
  }, [events]);
  const pendingByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.status === 'pending') m.set(r.due_date, (m.get(r.due_date) ?? 0) + 1);
    return m;
  }, [rows]);

  const dayEvents = eventsByDay.get(selected) ?? [];
  const dayOccs = rows.filter((r) => r.due_date === selected).sort(byOccTime);

  const shift = (n: number) => {
    const d = parseISO(month);
    setMonth(iso(new Date(d.getFullYear(), d.getMonth() + n, 1)));
  };

  if (blocked) return null;

  return (
    <>
      <div className="topbar"><h1 className="page-title">Calendar</h1></div>
      <div className="cal-head">
        <button className="btn small" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <h2>{parseISO(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button className="btn small" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid">
        {DAY_NAMES.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map((d) => {
          const ev = eventsByDay.get(d)?.length ?? 0;
          const tk = pendingByDay.get(d) ?? 0;
          return (
            <button
              key={d}
              className={`cal-day ${parseISO(d).getMonth() !== monthNum ? 'dim' : ''} ${d === today() ? 'today' : ''} ${d === selected ? 'sel' : ''}`}
              onClick={() => setSelected(d)}
              aria-label={fmtDate(d)}
            >
              {parseISO(d).getDate()}
              <span className="dots">
                {ev > 0 && <i className="dot" />}
                {tk > 0 && <i className="dot t" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="muted small" style={{ margin: '6px 2px 0' }}>
        <i className="dot" style={{ display: 'inline-block' }} /> events &nbsp; <i className="dot t" style={{ display: 'inline-block' }} /> tasks to do
      </div>

      <div className="section-title">
        <h2>{fmtDate(selected)}</h2>
        {isAdult && <button className="btn small primary" onClick={() => setEditing('new')}>+ Event</button>}
      </div>
      {dayEvents.map((e) => (
        <div
          key={e.id}
          className="card flat"
          style={{ marginBottom: 8, cursor: isAdult ? 'pointer' : 'default' }}
          onClick={() => isAdult && setEditing(e)}
        >
          <div className="spread"><b>📌 {e.title}</b><span className="muted small">{e.all_day ? 'All day' : fmtDateTime(e.starts_at)}</span></div>
          {e.notes && <div className="muted small">{e.notes}</div>}
        </div>
      ))}
      {dayOccs.map((o) => <OccRow key={o.id} occ={o} />)}
      {dayEvents.length === 0 && dayOccs.length === 0 && <div className="card empty">Nothing planned for this day.</div>}

      {editing && (
        <EventForm event={editing === 'new' ? undefined : editing} date={selected} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
