-- Bentley Home Hub — audit fixes.
--  * my_memberships(): lets the app tell "no household yet" apart from "access ended"
--    (expired / revoked members are invisible to normal queries by design).
--  * Sitters can no longer see a task whose pet is hidden from sitters.
--  * accept_invite(): an expired sitter can be re-invited (previously "already in this household").
--  * Archiving a pet archives its tasks atomically, in the database.
--  * members.color must be a #RRGGBB value.

-- ---------------------------------------------------------------- my_memberships
create function my_memberships()
returns table (household_id uuid, household_name text, role member_role, active boolean)
language sql stable security definer set search_path = public as $$
  select m.household_id, h.name, m.role,
         (m.revoked_at is null and (m.role <> 'sitter' or now() between m.sitter_start and m.sitter_end))
  from members m join households h on h.id = m.household_id
  where m.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- sitter visibility
create or replace function can_see_task(t tasks) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when my_role(t.household_id) is null then false
    when my_role(t.household_id) = 'sitter' then t.guest_visible and (t.pet_id is null or can_see_pet(t.pet_id))
    else true end
$$;

create or replace function complete_occurrence(p_occurrence uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  occ occurrences; t tasks; me members; hh households; recipient members;
  pts int := 0; bonus int := 0; rnd int;
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

  return jsonb_build_object('points', pts, 'family_bonus', bonus);
end $$;

-- ---------------------------------------------------------------- invites
create or replace function accept_invite(p_code text, p_display_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv invites; existing members; nm text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into inv from invites where code = p_code for update;
  if not found or inv.used_at is not null or inv.expires_at <= now() then
    raise exception 'This invite is invalid or has expired';
  end if;
  nm := coalesce(nullif(trim(p_display_name), ''), inv.display_name);
  select * into existing from members where household_id = inv.household_id and user_id = auth.uid();
  if found then
    -- Only a membership that still works blocks re-joining; an expired sitter window does not.
    if existing.revoked_at is null
       and not (existing.role = 'sitter' and now() > existing.sitter_end) then
      raise exception 'You are already in this household';
    end if;
    if existing.role = 'owner' then raise exception 'Not allowed'; end if;
    update members set revoked_at = null, role = inv.role, display_name = nm,
      sitter_start = inv.sitter_start, sitter_end = inv.sitter_end where id = existing.id;
  else
    insert into members (household_id, user_id, display_name, role, sitter_start, sitter_end)
    values (inv.household_id, auth.uid(), nm, inv.role, inv.sitter_start, inv.sitter_end);
  end if;
  update invites set used_at = now(), used_by = auth.uid() where id = inv.id;
  return inv.household_id;
end $$;

-- ---------------------------------------------------------------- pets
create function pets_archive_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived and not old.archived then
    update tasks set archived = true where pet_id = new.id and household_id = new.household_id and not archived;
  end if;
  return new;
end $$;
create trigger pets_archive_tasks after update on pets
  for each row execute function pets_archive_tasks();

-- ---------------------------------------------------------------- members
alter table members add constraint members_color_hex check (color ~ '^#[0-9a-fA-F]{6}$');

-- ---------------------------------------------------------------- grants
revoke execute on function my_memberships() from public, anon;
grant execute on function my_memberships() to authenticated;
revoke execute on function pets_archive_tasks() from public, anon, authenticated;
