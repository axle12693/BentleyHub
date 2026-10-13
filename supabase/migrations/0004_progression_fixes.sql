-- Bentley Home Hub — task progression fixes.
--  * revoke_member(): tasks assigned to the removed member become open to anyone
--    (otherwise children could never complete them).
--  * tasks_purge_pending(): a schedule change also drops older pending occurrences
--    that no longer match the new schedule (they showed up as phantom "overdue" items).
--  * seed_starter_pets(): archived pets no longer block the starter set.

create or replace function revoke_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m members; caller member_role;
begin
  select * into m from members where id = p_member;
  if not found then raise exception 'Not found'; end if;
  caller := my_role(m.household_id);
  if caller not in ('owner', 'adult') then raise exception 'Not authorized'; end if;
  if m.role = 'owner' then raise exception 'The owner cannot be removed'; end if;
  if m.role = 'adult' and caller <> 'owner' then raise exception 'Only the owner can remove adults'; end if;
  update members set revoked_at = now() where id = p_member;
  update tasks set assignee_member_id = null where assignee_member_id = p_member and household_id = m.household_id;
end $$;

create or replace function tasks_purge_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recurrence is distinct from old.recurrence
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or (new.archived and not old.archived) then
    delete from occurrences
    where task_id = new.id and status = 'pending'
      and (due_date >= current_date - 1 or new.archived or not task_due_on(new, due_date));
  end if;
  return new;
end $$;

create or replace function seed_starter_pets(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid; i int;
begin
  if not is_adult(p_household) then raise exception 'Not authorized'; end if;
  if exists (select 1 from pets where household_id = p_household and not archived) then
    raise exception 'This household already has pets';
  end if;

  for i in 1..3 loop
    insert into pets (household_id, name, species) values (p_household, 'Dog ' || i, 'dog') returning id into pid;
    insert into tasks (household_id, title, category, pet_id, points, due_time, guest_visible, instructions)
    values
      (p_household, 'Feed Dog ' || i || ' (morning)', 'Animal care', pid, 5, '07:30', true, 'Morning meal'),
      (p_household, 'Feed Dog ' || i || ' (evening)', 'Animal care', pid, 5, '17:30', true, 'Evening meal'),
      (p_household, 'Walk / outside time: Dog ' || i, 'Animal care', pid, 5, '12:00', true, 'Potty break and exercise');
  end loop;
  for i in 1..2 loop
    insert into pets (household_id, name, species) values (p_household, 'Cat ' || i, 'cat') returning id into pid;
    insert into tasks (household_id, title, category, pet_id, points, due_time, guest_visible, instructions)
    values
      (p_household, 'Feed Cat ' || i || ' (morning)', 'Animal care', pid, 3, '07:30', true, 'Morning meal'),
      (p_household, 'Feed Cat ' || i || ' (evening)', 'Animal care', pid, 3, '17:30', true, 'Evening meal');
  end loop;
  insert into pets (household_id, name, species) values (p_household, 'Chicken', 'chicken') returning id into pid;
  insert into tasks (household_id, title, category, pet_id, points, due_time, guest_visible, instructions)
  values
    (p_household, 'Feed Chicken & check water', 'Animal care', pid, 3, '08:00', true, 'Fill feeder and refill waterer'),
    (p_household, 'Collect eggs', 'Animal care', pid, 3, '17:00', true, 'Check the nesting box');

  -- Household-wide chores: skip any the family already has (e.g. after archiving all pets).
  insert into tasks (household_id, title, category, points, due_time, guest_visible, instructions)
  select p_household, v.title, 'Animal care', v.points, v.due_time::time, true, v.instructions
  from (values
    ('Refresh dog water bowls', 3, '08:00', 'Dump, rinse, refill'),
    ('Refresh cat water', 3, '08:00', 'Dump, rinse, refill'),
    ('Scoop litter boxes', 4, '18:00', 'Scoop and top up if needed')
  ) as v(title, points, due_time, instructions)
  where not exists (select 1 from tasks t where t.household_id = p_household and t.title = v.title and not t.archived);
  insert into tasks (household_id, title, category, points, due_time, guest_visible, instructions, recurrence)
  select p_household, 'Clean chicken coop', 'Animal care', 10, '10:00', true, 'Replace bedding, scrub waterer',
     '{"type":"weekdays","days":[6]}'
  where not exists (select 1 from tasks t where t.household_id = p_household and t.title = 'Clean chicken coop' and not t.archived);
end $$;

revoke execute on function revoke_member(uuid), seed_starter_pets(uuid) from public, anon;
grant execute on function revoke_member(uuid), seed_starter_pets(uuid) to authenticated;
revoke execute on function tasks_purge_pending() from public, anon, authenticated;
