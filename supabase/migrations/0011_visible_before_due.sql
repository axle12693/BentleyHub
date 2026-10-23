-- Bentley Home Hub — "Visible before due date".
--  tasks.visible_days_before: how many days ahead of its due date an occurrence shows up as "Coming up".
--  NULL = only visible on the due date (the old behaviour).
--  Capped at 30 (keep in sync with MAX_VISIBLE_DAYS in src/lib/upcoming.ts) so the home page's 30-days-back + lead
--  window stays inside ensure_occurrences' 70-day limit.
--  Not applicable to catch_up tasks, which only ever show their current day.
--  complete_occurrence() now refuses occurrences dated after the caller's today, since the UI pre-creates future rows.

alter table tasks add column visible_days_before int check (visible_days_before is null or visible_days_before between 1 and 30),
  add constraint tasks_visible_early_not_catch_up check (visible_days_before is null or overdue_mode <> 'catch_up');

create or replace function complete_occurrence(p_occurrence uuid, p_note text default null, p_today date default null) returns jsonb
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
  -- Upcoming rows are preview-only. p_today is the caller's local date; allow up to a day of timezone slack, as below.
  if occ.due_date > greatest(current_date, least(coalesce(p_today, current_date), current_date + 1)) then
    raise exception 'This task is not due yet';
  end if;

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
