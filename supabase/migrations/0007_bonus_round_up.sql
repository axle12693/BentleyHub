-- The family jar bonus used integer division per task, so small tasks (1-2 pts at 20%) always gave 0.
-- Now the jar tracks the exact percentage over time: after each award, the jar should hold
-- floor(net points earned in the household * bonus %) from bonuses, and we add whatever is missing.
-- This also catches the jar up on the first completion after this migration, using past earnings.
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
    update occurrences set status = 'covered', covered_by = occ.id
    where task_id = occ.task_id and status = 'pending' and due_date < occ.due_date;
    get diagnostics covered = row_count;
  end if;

  return jsonb_build_object('points', pts, 'family_bonus', bonus, 'covered', covered);
end $$;
