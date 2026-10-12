'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { OccRow } from '@/components/OccRow';
import { attempt, Modal } from '@/components/ui';
import { addDays, DAY_NAMES, fmtDate, fmtDateTime, iso, parseISO, startOfMonthGrid, today } from '@/lib/dates';
import { useHub, useOccurrences } from '@/lib/hub';
import { supabase } from '@/lib/supabase';
import type { CalEvent } from '@/lib/types';

const eventDay = (e: CalEvent) => iso(new Date(e.starts_at));

export default function CalendarPage() {
  const router = useRouter();
  const { events, isAdult, isSitter, reload } = useHub();
  const [selected, setSelected] = useState(today());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return iso(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [editing, setEditing] = useState<CalEvent | 'new' | null>(null);

  useEffect(() => {
    if (isSitter) router.replace('/');
  }, [isSitter, router]);

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
  const dayOccs = rows
    .filter((r) => r.due_date === selected)
    .sort((a, b) => (a.task.due_time ?? '99').localeCompare(b.task.due_time ?? '99') || a.task.title.localeCompare(b.task.title));

  const shift = (n: number) => {
    const d = parseISO(month);
    setMonth(iso(new Date(d.getFullYear(), d.getMonth() + n, 1)));
  };

  if (isSitter) return null;

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
        <EventForm
          event={editing === 'new' ? undefined : editing}
          date={selected}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await reload();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function EventForm({ event, date, onClose, onSaved }: { event?: CalEvent; date: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { household } = useHub();
  const start = event ? new Date(event.starts_at) : null;
  const [title, setTitle] = useState(event?.title ?? '');
  const [day, setDay] = useState(start ? iso(start) : date);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [time, setTime] = useState(start && !event?.all_day ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : '09:00');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const [y, m, d] = day.split('-').map(Number);
    const [hh, mm] = allDay ? [0, 0] : time.split(':').map(Number);
    const row = { title: title.trim(), starts_at: new Date(y, m - 1, d, hh, mm).toISOString(), all_day: allDay, notes: notes.trim() };
    const sb = supabase();
    const { error: err } = event
      ? await sb.from('events').update(row).eq('id', event.id)
      : await sb.from('events').insert({ ...row, household_id: household.id });
    if (err) {
      setError(err.message);
      setBusy(false);
    } else await onSaved();
  }

  async function remove() {
    if (!event || !confirm('Delete this event?')) return;
    setBusy(true);
    const ok = await attempt(async () => {
      const { error: err } = await supabase().from('events').delete().eq('id', event.id);
      if (err) throw err;
    }, 'Event deleted');
    if (ok) await onSaved();
    else setBusy(false);
  }

  return (
    <Modal title={event ? 'Edit event' : 'New event'} onClose={onClose}>
      <form onSubmit={save}>
        <label>Title</label>
        <input required autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <div className="two">
          <div>
            <label>Date</label>
            <input type="date" required value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div>
            <label>Time</label>
            <input type="time" disabled={allDay} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="check-row">
          <input id="ad" type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <label htmlFor="ad">All day</label>
        </div>
        <label>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary grow" disabled={busy || !title.trim()}>Save</button>
          {event && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete</button>}
        </div>
      </form>
    </Modal>
  );
}
