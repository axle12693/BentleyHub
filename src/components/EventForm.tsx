'use client';

import { useState } from 'react';
import { deleteRow, saveRow } from '@/lib/api';
import { hhmm, iso, localToTs } from '@/lib/dates';
import { useHub } from '@/lib/hub';
import type { CalEvent } from '@/lib/types';
import { useSubmit } from '@/lib/useSubmit';
import { FormError, Modal, toast } from './ui';

export function EventForm({ event, date, onClose }: { event?: CalEvent; date: string; onClose: () => void }) {
  const { household, reload } = useHub();
  const start = event ? new Date(event.starts_at) : null;
  const [title, setTitle] = useState(event?.title ?? '');
  const [day, setDay] = useState(start ? iso(start) : date);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [time, setTime] = useState(start && !event?.all_day ? hhmm(start) : '09:00');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const { busy, error, run } = useSubmit();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const row = { title: title.trim(), starts_at: localToTs(day, allDay ? '00:00' : time), all_day: allDay, notes: notes.trim() };
    const ok = await run(async () => {
      await saveRow('events', row, { id: event?.id, household: household.id });
      await reload();
    });
    if (ok) onClose();
  }

  async function remove() {
    if (!event || !confirm('Delete this event?')) return;
    const ok = await run(async () => {
      await deleteRow('events', event.id);
      await reload();
    });
    if (ok) {
      toast('Event deleted');
      onClose();
    }
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
        <FormError error={error} />
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary grow" disabled={busy || !title.trim()}>Save</button>
          {event && <button type="button" className="btn danger" disabled={busy} onClick={remove}>Delete</button>}
        </div>
      </form>
    </Modal>
  );
}
