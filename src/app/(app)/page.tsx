'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { OccRow } from '@/components/OccRow';
import { TaskFilterChips, matchesTaskFilter } from '@/components/TaskFilter';
import { Avatar } from '@/components/ui';
import { addDays, fmtDate, fmtDateTime, greeting, tsToDate, today } from '@/lib/dates';
import { useHub } from '@/lib/hub';
import { byOccTime, useOccurrences } from '@/lib/occurrences';

export default function Home() {
  const { isSitter } = useHub();
  return isSitter ? <SitterHome /> : <FamilyHome />;
}

function FamilyHome() {
  const { me, household, members, events, rewards, balances, redemptions, isAdult } = useHub();
  const t = today();
  const { rows: allRows, loading } = useOccurrences(addDays(t, -30), t);
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => allRows.filter((r) => matchesTaskFilter(r.task, filter)), [allRows, filter]);

  const { overdue, morning, evening, other, done } = useMemo(() => {
    const todays = rows.filter((r) => r.due_date === t);
    return {
      overdue: rows.filter((r) => r.due_date < t && r.status === 'pending').sort((a, b) => a.due_date.localeCompare(b.due_date)),
      morning: todays.filter((r) => r.task.routine === 'morning' && r.status === 'pending').sort(byOccTime),
      evening: todays.filter((r) => r.task.routine === 'evening' && r.status === 'pending').sort(byOccTime),
      other: todays.filter((r) => !r.task.routine && r.status === 'pending').sort(byOccTime),
      done: todays.filter((r) => r.status === 'done').sort(byOccTime),
    };
  }, [rows, t]);

  // "Do it once" tasks missed on several days show once (latest miss) with a count, since one
  // completion settles them all. "Each one counts" tasks keep a row per missed day.
  const overdueGroups = useMemo(() => {
    const catchUp = new Map<string, typeof overdue>();
    const groups: { occ: (typeof overdue)[number]; missed: number }[] = [];
    for (const o of overdue) {
      if (o.task.overdue_mode === 'catch_up') catchUp.set(o.task_id, [...(catchUp.get(o.task_id) ?? []), o]);
      else groups.push({ occ: o, missed: 0 });
    }
    for (const list of catchUp.values()) groups.push({ occ: list[list.length - 1], missed: list.length - 1 });
    return groups.sort((a, b) => a.occ.due_date.localeCompare(b.occ.due_date) || byOccTime(a.occ, b.occ));
  }, [overdue]);

  // Summary tiles are household totals, so they ignore the chip filter.
  const todays = allRows.filter((r) => r.due_date === t);
  const left = todays.filter((r) => r.status === 'pending').length;
  const petDue = todays.filter((r) => r.status === 'pending' && r.task.pet_id).length;
  const todaysEvents = events.filter((e) => tsToDate(e.starts_at) === t);
  const nextFamily = rewards.filter((r) => r.kind === 'family').sort((a, b) => a.cost - b.cost)[0];
  const pendingApprovals = redemptions.filter((r) => r.status === 'pending').length;
  const myPoints = balances.member[me.id] ?? 0;

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">
            {greeting()}, {me.display_name} ☀️
          </h1>
          <div className="muted">{fmtDate(t)} · {household.name}</div>
        </div>
        <Avatar member={me} large />
      </div>

      <div className="tiles">
        <div className="tile"><b>{loading ? '–' : left}</b><span>Tasks left</span></div>
        <div className="tile"><b>{myPoints}</b><span>My points</span></div>
        <div className="tile"><b>{loading ? '–' : petDue}</b><span>Pet tasks due</span></div>
      </div>

      {isAdult && pendingApprovals > 0 && (
        <Link href="/rewards" className="notice" style={{ display: 'block', textDecoration: 'none' }}>
          🎁 {pendingApprovals} reward request{pendingApprovals > 1 ? 's' : ''} waiting for approval →
        </Link>
      )}

      {todaysEvents.length > 0 && (
        <>
          <div className="section-title"><h2>Today on the calendar</h2><Link href="/calendar">Open</Link></div>
          {todaysEvents.map((e) => (
            <div className="card flat" key={e.id} style={{ marginBottom: 8 }}>
              <b>{e.title}</b>
              <div className="muted small">{e.all_day ? 'All day' : fmtDateTime(e.starts_at)}</div>
            </div>
          ))}
        </>
      )}

      <TaskFilterChips value={filter} onChange={setFilter} />

      {overdueGroups.length > 0 && (
        <>
          <div className="section-title"><h2>⚠️ Still to do from earlier</h2></div>
          {overdueGroups.map(({ occ, missed }) => <OccRow key={occ.id} occ={occ} showDate missed={missed} />)}
        </>
      )}

      <div className="section-title">
        <h2>Today’s tasks</h2>
        <Link href="/tasks">Manage</Link>
      </div>
      {morning.length > 0 && (<><div className="section-title"><h2>🌅 Morning routine</h2></div>{morning.map((o) => <OccRow key={o.id} occ={o} />)}</>)}
      {!loading && other.length === 0 && morning.length + evening.length === 0 && done.length === 0 && (
        <div className="card empty">
          {overdue.length > 0 ? 'Nothing else scheduled today.' : 'Nothing scheduled today.'} {isAdult ? <><Link href="/tasks">Add a task</Link> or <Link href="/pets">set up your pets</Link>.</> : 'Enjoy the day!'}
        </div>
      )}
      {other.map((o) => <OccRow key={o.id} occ={o} />)}
      {evening.length > 0 && (<><div className="section-title"><h2>🌙 Evening routine</h2></div>{evening.map((o) => <OccRow key={o.id} occ={o} />)}</>)}

      {done.length > 0 && (<><div className="section-title"><h2>Done today 🎉</h2></div>{done.map((o) => <OccRow key={o.id} occ={o} />)}</>)}

      {nextFamily && (
        <>
          <div className="section-title"><h2>Family reward jar</h2><Link href="/rewards">Rewards</Link></div>
          <div className="card sage">
            <div className="spread"><b>{nextFamily.title}</b><span>{Math.min(balances.family, nextFamily.cost)} / {nextFamily.cost}</span></div>
            <div className="progress" style={{ marginTop: 8 }}>
              <i style={{ width: `${Math.min(100, (balances.family / nextFamily.cost) * 100)}%` }} />
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              {household.family_bonus_pct}% of every point you earn also goes into the jar.
            </div>
          </div>
        </>
      )}
      {members.length > 1 && <div style={{ height: 4 }} />}
    </>
  );
}

function SitterHome() {
  const { me, household, pets } = useHub();
  const t = today();
  const { rows, loading } = useOccurrences(t, addDays(t, 2));
  const days = [t, addDays(t, 1), addDays(t, 2)];

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">Hi {me.display_name} 🐾</h1>
          <div className="muted">Pet care for {household.name}</div>
        </div>
      </div>
      {me.sitter_end && (
        <div className="notice">Your access runs until {fmtDateTime(me.sitter_end)}.</div>
      )}
      {household.sitter_info && (
        <div className="card sage" style={{ whiteSpace: 'pre-wrap' }}>
          <h3>📞 Important info</h3>
          <p>{household.sitter_info}</p>
        </div>
      )}
      <div className="tiles" style={{ marginTop: 12, gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="tile"><b>{loading ? '–' : rows.filter((r) => r.due_date === t && r.status === 'pending').length}</b><span>Care tasks left today</span></div>
        <div className="tile"><b>{pets.length}</b><span>Animals</span></div>
      </div>
      {days.map((d, i) => {
        const list = rows.filter((r) => r.due_date === d).sort(byOccTime);
        if (i > 0 && list.length === 0) return null;
        return (
          <div key={d}>
            <div className="section-title"><h2>{i === 0 ? 'Today' : fmtDate(d)}</h2></div>
            {list.map((o) => <OccRow key={o.id} occ={o} />)}
            {!loading && list.length === 0 && <div className="card empty">No care tasks scheduled.</div>}
          </div>
        );
      })}
      <p className="muted small" style={{ textAlign: 'center' }}>
        Tap 📝 on a task to add a note, like “ate everything”.
      </p>
    </>
  );
}
