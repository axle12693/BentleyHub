-- Bentley Home Hub — per-task overdue handling.
--  tasks.overdue_mode:
--    'each'     (default, previous behaviour) every missed occurrence stays open; each must be done and earns points.
--    'catch_up' doing the task once also settles every earlier still-pending occurrence of it. Those become
--               'covered' (no points for them) and are restored if the completion is undone.

alter table tasks add column overdue_mode text not null default 'each' check (overdue_mode in ('each', 'catch_up'));

alter table occurrences drop constraint occurrences_status_check;
alter table occurrences add constraint occurrences_status_check check (status in ('pending', 'done', 'covered'));
alter table occurrences add column covered_by uuid references occurrences (id) on delete set null;
create index occurrences_covered_by on occurrences (covered_by) where covered_by is not null;

create or replace function complete_occurrence(p_occurrence uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  occ occurrences; t tasks; me members; hh households; recipient members;
  pts int := 0; bonus int := 0; rnd int; covered int := 0;
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
    bonus := (pts * hh.family_bonus_pct) / 100;
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
    update occurrences set status = 'covered', covered_by = occ.id
    where task_id = occ.task_id and status = 'pending' and due_date < occ.due_date;
    get diagnostics covered = row_count;
  end if;

  return jsonb_build_object('points', pts, 'family_bonus', bonus, 'covered', covered);
end $$;

create or replace function uncomplete_occurrence(p_occurrence uuid) returns void
language plpgsql security definer set search_path = public as $$
declare occ occurrences; me uuid;
begin
  select * into occ from occurrences where id = p_occurrence for update;
  if not found then raise exception 'Task not found'; end if;
  me := my_member_id(occ.household_id);
  if not is_adult(occ.household_id) then raise exception 'Only adults can undo a completion'; end if;
  if occ.status <> 'done' then raise exception 'Not completed'; end if;

  insert into points_ledger (household_id, scope, member_id, delta, kind, occurrence_id, round, note, created_by)
  select household_id, scope, member_id, -delta, 'reverse', occurrence_id, round, 'Reversed: ' || coalesce(note, ''), me
  from points_ledger
  where occurrence_id = occ.id and round = occ.completion_round and kind in ('earn', 'family_bonus');

  update occurrences set status = 'pending', completed_by = null, completed_at = null, note = null,
    points_awarded = 0, awarded_to = null where id = occ.id;
  update occurrences set status = 'pending', covered_by = null where covered_by = occ.id and status = 'covered';
end $$;

revoke execute on function complete_occurrence(uuid, text), uncomplete_occurrence(uuid) from public, anon;
grant execute on function complete_occurrence(uuid, text), uncomplete_occurrence(uuid) to authenticated;
