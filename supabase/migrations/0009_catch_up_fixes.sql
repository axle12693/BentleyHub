-- Bentley Home Hub — "Do it once" (catch_up) fixes.
--  * complete_occurrence() now also settles the task's still-pending occurrences up to and including today
--    (the caller's local date, p_today), not only earlier ones: doing an overdue catch-up task also clears today's copy.
--  * ensure_occurrences() no longer back-fills past days of a catch_up task that a later completion already settled.
--    Occurrences are created lazily, so days nobody had loaded yet used to appear as fresh pending "overdue" rows.
--  * tasks_purge_pending() reaches back one more day so a UTC/local date difference can't leave stale rows.

drop function complete_occurrence(uuid, text);

create function complete_occurrence(p_occurrence uuid, p_note text default null, p_today date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  occ occurrences; t tasks; me members; hh households; recipient members;
  pts int := 0; bonus int := 0; rnd int; covered int := 0; upto date;
begin
  select * into occ from occurrences where id = p_occurrence for update;  -- serialises racing completions
  if not found then raise exception 'Task not found'; end if;

  select * into me from members
  where household_id = occ.household_id and user_id = auth.uid() and revoked_at is null
    and (role <> 'sitter' or now() between sitter_start and sitter_end);
  if not found then raise exception 'Not authorized'; end if;

  select * into t from tasks where id = occ.task_id;
  if me.role = 'sitter' and not can_see_task(t) then raise exception 'Not authorized'; end if;
  if me.role = 'child' and t.assignee_member_id is not null and t.assignee_member_id <> me.id then
    raise exception 'That task belongs to someone else';
  end if;
  if occ.status = 'done' then raise exception 'Someone already completed this'; end if;
  if occ.status = 'covered' then raise exception 'This was already caught up by a later completion'; end if;

  select * into hh from households where id = occ.household_id;
  rnd := occ.completion_round + 1;

  if t.points_eligible and t.points > 0 and me.role <> 'sitter' then
    select * into recipient from members
    where id = coalesce(t.assignee_member_id, me.id) and revoked_at is null and role <> 'sitter';
    if not found then recipient := me; end if;
    pts := t.points;
    insert into points_ledger (household_id, scope, member_id, delta, kind, occurrence_id, round, note, created_by)
    values (occ.household_id, 'member', recipient.id, pts, 'earn', occ.id, rnd, t.title, me.id);
    perform pg_advisory_xact_lock(hashtext(occ.household_id::text));  -- bonus is derived from running totals
    select greatest(0, floor(
      coalesce((select sum(delta) from points_ledger
                where household_id = occ.household_id and scope = 'member' and kind in ('earn', 'reverse')), 0)
      * hh.family_bonus_pct / 100.0)::int
      - coalesce((select sum(delta) from points_ledger
                  where household_id = occ.household_id and scope = 'family' and kind in ('family_bonus', 'reverse')), 0))
    into bonus;
    if bonus > 0 then
      insert into points_ledger (household_id, scope, member_id, delta, kind, occurrence_id, round, note, created_by)
      values (occ.household_id, 'family', null, bonus, 'family_bonus', occ.id, rnd, t.title, me.id);
    end if;
  end if;

  update occurrences set status = 'done', completed_by = me.id, completed_at = now(),
    note = nullif(trim(coalesce(p_note, '')), ''), completion_round = rnd,
    points_awarded = pts, awarded_to = case when pts > 0 then recipient.id end
  where id = occ.id;

  if t.overdue_mode = 'catch_up' then
    -- p_today is the caller's local date; clamp it so a bad client can't settle the future.
    upto := greatest(occ.due_date, least(coalesce(p_today, current_date), current_date + 1));
    update occurrences set status = 'covered', covered_by = occ.id
    where task_id = occ.task_id and status = 'pending' and id <> occ.id and due_date <= upto;
    get diagnostics covered = row_count;
  end if;

  return jsonb_build_object('points', pts, 'family_bonus', bonus, 'covered', covered);
end $$;

revoke execute on function complete_occurrence(uuid, text, date) from public, anon;
grant execute on function complete_occurrence(uuid, text, date) to authenticated;

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
    and not (t.overdue_mode = 'catch_up' and exists (
      select 1 from occurrences o where o.task_id = t.id and o.status = 'done' and o.due_date > d::date))
  on conflict (task_id, due_date) do nothing;
end $$;

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
  end if;
  return new;
end $$;
