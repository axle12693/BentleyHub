-- Bentley Home Hub — temporarily hide a task.
--  tasks.hidden_until:     while it is in the future the task and all its occurrences are left out of every list.
--  tasks.hidden_from_day / hidden_until_day: the "skip window", in the caller's LOCAL calendar (UTC day math would
--                          swallow today on an evening hide, or leave the last hidden day overdue on UTC+).
--                          It runs from the day the hide started up to, not including, the day the task shows again.
--  Hiding pauses the task; it does not clear its backlog. Occurrences that were already overdue when the hide
--  started stay pending and show up again, still overdue, when the hide ends (or is ended early).
--  Days inside the window are skipped, not left overdue: ensure_occurrences does not generate them, today's pending
--  row is settled as 'covered' (no points), and look-ahead rows for later hidden days are deleted.
--  The window is kept after the hide expires so the skipped days are never back-filled. When a later hide_task call
--  replaces it, the window's past days are first stored as 'covered' rows, so they stay skipped for good.
--  Ending a hide early drops the window; the days from today on are generated normally again, and today's row,
--  if the hide had skipped it, goes back to pending.
--  Completing an occurrence of a hidden task is rejected server-side (occurrences_no_done_while_hidden), so the
--  hide is not just a client-side filter (inserting an already-done row is rejected too).
--  A window outlives its hide, so a later schedule edit cannot generate occurrences for days inside it.
--  occurrences.hide_skipped marks rows settled as 'covered' by a hide, so ending or replacing a hide only gives back
--  those rows, never one that "Clear overdue" (reset_task_overdue) covered.
--  The window is in the hider's calendar, so members in other timezones may see the boundary day shift by one.
--  hide_task(task, until, until_day, today) hides; a null until shows the task again. Adults only.

alter table tasks add column hidden_until timestamptz;
alter table tasks add column hidden_from_day date;
alter table tasks add column hidden_until_day date;
alter table occurrences add column hide_skipped boolean not null default false;
alter table tasks add constraint tasks_hidden_window check (
  (hidden_from_day is null) = (hidden_until_day is null) and (hidden_until is null or hidden_until_day is not null));

create function hide_task(p_task uuid, p_until timestamptz, p_until_day date, p_today date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t tasks; today date;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if not is_adult(t.household_id) then raise exception 'Only adults can hide tasks'; end if;
  if t.archived then raise exception 'Task not found'; end if;

  if p_until is not null and (p_until <= now() or p_until > now() + interval '1000 days' or p_until_day is null
     or abs(p_until_day - (p_until at time zone 'UTC')::date) > 1) then  -- a local date is at most a day from the UTC one
    raise exception 'Invalid hide period';
  end if;

  -- p_today is the caller's local date; clamp it both ways so a bad client can't settle the far future or
  -- stretch the skip window (and the covered back-fill below) over years.
  today := greatest(least(coalesce(p_today, current_date), current_date + 1), current_date - 1);

  -- Keep the days of the previous window that are already behind us skipped for good.
  if t.hidden_from_day is not null then
    insert into occurrences (household_id, task_id, due_date, status, hide_skipped)
    select t.household_id, t.id, d::date, 'covered', true
    from generate_series(t.hidden_from_day::timestamp, (least(t.hidden_until_day, today) - 1)::timestamp, interval '1 day') d
    where task_due_on(t, d::date)
    on conflict (task_id, due_date) do nothing;
  end if;

  if p_until is null then
    -- Today's row was skipped by this hide (hide_skipped; a catch-up or overdue-clear cover isn't): showing
    -- the task again the same day gives it back.
    if t.hidden_from_day is not null and today >= t.hidden_from_day and today < t.hidden_until_day then
      update occurrences set status = 'pending', hide_skipped = false
      where task_id = t.id and due_date = today and status = 'covered' and hide_skipped;
    end if;
    update tasks set hidden_until = null, hidden_from_day = null, hidden_until_day = null where id = t.id;
    return;
  end if;

  -- Replacing a hide: today's row may have been skipped by the old window. Give it back first; the cover
  -- below skips it again if the new window still reaches past today.
  if t.hidden_from_day is not null and today >= t.hidden_from_day and today < t.hidden_until_day then
    update occurrences set status = 'pending', hide_skipped = false
    where task_id = t.id and due_date = today and status = 'covered' and hide_skipped;
  end if;

  update tasks set hidden_until = p_until, hidden_from_day = least(today, p_until_day), hidden_until_day = p_until_day
  where id = t.id;
  -- Today is skipped when the hide reaches past it; earlier days stay pending (overdue) for when it returns.
  update occurrences set status = 'covered', covered_by = null, hide_skipped = true
  where task_id = t.id and status = 'pending' and due_date = today and due_date < p_until_day;
  -- Rows already created for later hidden days (look-ahead views) would come back overdue when the hide ends;
  -- drop them instead, so showing the task again early regenerates them.
  delete from occurrences
  where task_id = t.id and status = 'pending' and due_date > today and due_date < p_until_day;
end $$;

revoke execute on function hide_task(uuid, timestamptz, date, date) from public, anon;
grant execute on function hide_task(uuid, timestamptz, date, date) to authenticated;

-- NOTE: this is the current definition of ensure_occurrences (0010's plus the hide-window filter). Any later
-- migration that redefines it must start from this version, or the hide filter is silently lost.
create or replace function ensure_occurrences(p_household uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_active_member(p_household) then raise exception 'Not authorized'; end if;
  if p_to < p_from or p_to - p_from > 70 then raise exception 'Invalid date range'; end if;
  insert into occurrences (household_id, task_id, due_date)
  select t.household_id, t.id, d::date
  from tasks t
  cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  where t.household_id = p_household and not t.archived and task_due_on(t, d::date)
    and (t.reset_through is null or d::date > t.reset_through)
    and (t.hidden_from_day is null or d::date < t.hidden_from_day or d::date >= t.hidden_until_day)  -- stays after expiry, so skipped days aren't back-filled
    and not (t.overdue_mode = 'catch_up' and exists (
      select 1 from occurrences o where o.task_id = t.id and o.status = 'done' and o.due_date > d::date))
  on conflict (task_id, due_date) do nothing;
end $$;

create function occurrences_no_done_while_hidden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done')
     and exists (select 1 from tasks t where t.id = new.task_id and t.hidden_until > now()) then
    raise exception 'This task is hidden right now. Reload if it should be showing.';
  end if;
  return new;
end $$;

create trigger occurrences_no_done_while_hidden before insert or update on occurrences
for each row execute function occurrences_no_done_while_hidden();

-- hide_task is the only way to change the hide columns: a direct update by a signed-in user would skip its checks
-- and its cover/delete of today's and look-ahead rows. SECURITY INVOKER on purpose, so current_user is the caller's
-- role (the definer-run hide_task, and admin/test connections, are not 'authenticated').
create function tasks_hidden_cols_guard() returns trigger
language plpgsql as $$
begin
  if current_user = 'authenticated' and (
       new.hidden_until is distinct from (case when tg_op = 'UPDATE' then old.hidden_until end)
    or new.hidden_from_day is distinct from (case when tg_op = 'UPDATE' then old.hidden_from_day end)
    or new.hidden_until_day is distinct from (case when tg_op = 'UPDATE' then old.hidden_until_day end)) then
    raise exception 'Use hide_task to hide or show a task';
  end if;
  return new;
end $$;

create trigger tasks_hidden_cols_guard before insert or update on tasks
for each row execute function tasks_hidden_cols_guard();
