-- Bentley Home Hub — "Clear overdue" reset for a task.
--  reset_task_overdue() settles every still-pending occurrence of a task dated before the caller's today as
--  'covered' (no points, no family bonus) so a badly behind task can start fresh. Adults only.
--  tasks.reset_through remembers the cutoff so ensure_occurrences() doesn't lazily re-create those past days.

alter table tasks add column reset_through date;

create function reset_task_overdue(p_task uuid, p_today date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  t tasks; upto date; n int;
begin
  select * into t from tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if not is_adult(t.household_id) then raise exception 'Only adults can clear overdue tasks'; end if;

  -- p_today is the caller's local date; clamp it so a bad client can't settle the future.
  upto := least(coalesce(p_today, current_date), current_date + 1) - 1;
  update tasks set reset_through = greatest(coalesce(reset_through, upto), upto) where id = t.id;

  update occurrences set status = 'covered', covered_by = null
  where task_id = t.id and status = 'pending' and due_date <= upto;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function reset_task_overdue(uuid, date) from public, anon;
grant execute on function reset_task_overdue(uuid, date) to authenticated;

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
    and not (t.overdue_mode = 'catch_up' and exists (
      select 1 from occurrences o where o.task_id = t.id and o.status = 'done' and o.due_date > d::date))
  on conflict (task_id, due_date) do nothing;
end $$;

-- A schedule edit purges pending rows from 2 days back, so the cutoff must not suppress those days when they
-- are regenerated under the new schedule. Older cleared days stay cleared, even if the edit moves start_date
-- earlier (the "fresh start" wins over back-filling).
create or replace function tasks_purge_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recurrence is distinct from old.recurrence
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or (new.archived and not old.archived) then
    -- 2 days back, not 1: occurrences carry the creator's local date, which can trail or lead UTC current_date by a day.
    delete from occurrences
    where task_id = new.id and status = 'pending'
      and (due_date >= current_date - 2 or new.archived or not task_due_on(new, due_date));
    if new.reset_through > current_date - 3 then
      update tasks set reset_through = current_date - 3 where id = new.id;
    end if;
  end if;
  return new;
end $$;
