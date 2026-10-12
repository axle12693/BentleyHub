-- Bentley Home Hub — schema, row-level security, and atomic functions.
-- Run in the Supabase SQL editor (or `supabase db push`).
--
-- Design rules:
--  * Every table has RLS enabled. Reads are scoped by household membership.
--  * Sitter access is time-boxed: a sitter row only counts as "active" between
--    sitter_start and sitter_end and while not revoked — enforced in the database.
--  * Members, points, occurrences, redemptions and households are NEVER written
--    directly by clients. They change only through SECURITY DEFINER functions
--    that look up the caller from auth.uid() and never trust client-supplied
--    user ids, roles, or point amounts.

-- ---------------------------------------------------------------- types
create type member_role as enum ('owner', 'adult', 'child', 'sitter');

-- ---------------------------------------------------------------- tables
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  -- % of every earned point that is ALSO added to the shared family pool (bonus, not deducted)
  family_bonus_pct int not null default 20 check (family_bonus_pct between 0 and 100),
  -- emergency contacts, vet, door codes etc. Visible to active pet sitters.
  sitter_info text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null, -- null = profile-only (e.g. young child)
  display_name text not null check (char_length(display_name) between 1 and 40),
  role member_role not null,
  color text not null default '#8BA888',
  sitter_start timestamptz,
  sitter_end timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  check (role <> 'sitter' or (sitter_start is not null and sitter_end is not null and sitter_end > sitter_start)),
  check (role <> 'sitter' or user_id is not null)
);
create unique index members_household_user on members (household_id, user_id) where user_id is not null;
create index members_user on members (user_id);

create table invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  code text not null unique,
  role member_role not null check (role <> 'owner'),
  display_name text not null,
  sitter_start timestamptz,
  sitter_end timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  check (role <> 'sitter' or (sitter_start is not null and sitter_end is not null and sitter_end > sitter_start))
);

create table pets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  species text not null default 'dog' check (species in ('dog', 'cat', 'chicken', 'other')),
  breed text not null default '',
  instructions text not null default '',
  guest_visible boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'Chores',
  routine text check (routine in ('morning', 'evening')),
  assignee_member_id uuid,           -- null = open: anyone eligible can complete it
  pet_id uuid,
  points int not null default 0 check (points between 0 and 1000),
  points_eligible boolean not null default true,
  instructions text not null default '',
  due_time time,
  -- {"type":"once"} | {"type":"daily"} | {"type":"weekdays","days":[0..6]} | {"type":"interval","every":N}
  recurrence jsonb not null default '{"type":"daily"}'
    check (recurrence->>'type' in ('once', 'daily', 'weekdays', 'interval')),
  start_date date not null default current_date,
  end_date date,
  guest_visible boolean not null default false,
  archived boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (assignee_member_id, household_id) references members (id, household_id) on delete set null (assignee_member_id),
  foreign key (pet_id, household_id) references pets (id, household_id) on delete cascade
);
create index tasks_household on tasks (household_id) where not archived;

-- One row per scheduled occurrence, so finishing today's task never finishes tomorrow's.
create table occurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  task_id uuid not null,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  completed_by uuid references members (id) on delete set null,
  completed_at timestamptz,
  note text,
  completion_round int not null default 0,  -- bumps each time it is (re)completed
  points_awarded int not null default 0,
  awarded_to uuid references members (id) on delete set null,
  unique (task_id, due_date),
  foreign key (task_id, household_id) references tasks (id, household_id) on delete cascade
);
create index occurrences_household_date on occurrences (household_id, due_date);

create table events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  notes text not null default '',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index events_household_start on events (household_id, starts_at);

create table rewards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  cost int not null check (cost > 0),
  kind text not null default 'individual' check (kind in ('individual', 'family')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create table redemptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  reward_id uuid not null,
  member_id uuid references members (id) on delete set null,  -- null = family reward
  reward_title text not null,
  cost int not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_by uuid references members (id) on delete set null,
  decided_by uuid references members (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (reward_id, household_id) references rewards (id, household_id) on delete cascade
);
create index redemptions_household on redemptions (household_id, status);

-- Append-only audit trail. Balances are always the sum of this table.
create table points_ledger (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  scope text not null check (scope in ('member', 'family')),
  member_id uuid references members (id) on delete set null,
  delta int not null,
  kind text not null check (kind in ('earn', 'family_bonus', 'reverse', 'redeem', 'adjust')),
  occurrence_id uuid references occurrences (id) on delete set null,
  round int,
  redemption_id uuid references redemptions (id) on delete set null,
  note text,
  created_by uuid references members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ledger_household on points_ledger (household_id, created_at desc);
-- Points can be earned only once per occurrence completion round, and reversed only once.
create unique index ledger_one_earn on points_ledger (occurrence_id, round) where kind = 'earn';
create unique index ledger_one_bonus on points_ledger (occurrence_id, round) where kind = 'family_bonus';
create unique index ledger_one_reverse on points_ledger (occurrence_id, round, scope) where kind = 'reverse';
create unique index ledger_one_redeem on points_ledger (redemption_id) where kind = 'redeem';

create table pet_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  pet_id uuid not null,
  author_member_id uuid not null references members (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (pet_id, household_id) references pets (id, household_id) on delete cascade
);
create index pet_notes_pet on pet_notes (pet_id, created_at desc);

-- ---------------------------------------------------------------- helpers
-- "Active" = signed in as a non-revoked member; sitters only inside their date window.
create function my_member_id(h uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.id from members m
  where m.household_id = h and m.user_id = auth.uid() and m.revoked_at is null
    and (m.role <> 'sitter' or now() between m.sitter_start and m.sitter_end)
$$;

create function my_role(h uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select m.role from members m
  where m.household_id = h and m.user_id = auth.uid() and m.revoked_at is null
    and (m.role <> 'sitter' or now() between m.sitter_start and m.sitter_end)
$$;

create function is_active_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select my_role(h) is not null
$$;

create function is_family(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role(h) in ('owner', 'adult', 'child'), false)
$$;

create function is_adult(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role(h) in ('owner', 'adult'), false)
$$;

create function can_see_task(t tasks) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when my_role(t.household_id) is null then false
    when my_role(t.household_id) = 'sitter' then t.guest_visible
    else true end
$$;

create function can_see_pet(p_pet uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pets p
    where p.id = p_pet
      and case
            when my_role(p.household_id) is null then false
            when my_role(p.household_id) = 'sitter' then p.guest_visible
            else true end)
$$;

create function task_due_on(t tasks, d date) returns boolean
language sql stable as $$
  select d >= t.start_date and (t.end_date is null or d <= t.end_date) and
  case t.recurrence->>'type'
    when 'once' then d = t.start_date
    when 'daily' then true
    when 'weekdays' then exists (
      select 1 from jsonb_array_elements_text(t.recurrence->'days') x
      where x::int = extract(dow from d)::int)
    when 'interval' then ((d - t.start_date) % greatest((t.recurrence->>'every')::int, 1)) = 0
    else false
  end
$$;

-- When a schedule changes, drop not-yet-done upcoming occurrences so they regenerate correctly.
create function tasks_purge_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recurrence is distinct from old.recurrence
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or (new.archived and not old.archived) then
    delete from occurrences
    where task_id = new.id and status = 'pending' and due_date >= current_date - 1;
  end if;
  return new;
end $$;
create trigger tasks_purge_pending after update on tasks
  for each row execute function tasks_purge_pending();

-- ---------------------------------------------------------------- RLS
alter table households enable row level security;
alter table members enable row level security;
alter table invites enable row level security;
alter table pets enable row level security;
alter table tasks enable row level security;
alter table occurrences enable row level security;
alter table events enable row level security;
alter table rewards enable row level security;
alter table redemptions enable row level security;
alter table points_ledger enable row level security;
alter table pet_notes enable row level security;

create policy households_select on households for select to authenticated
  using (is_active_member(id));

create policy members_select on members for select to authenticated
  using (is_active_member(household_id)
         and (my_role(household_id) <> 'sitter' or user_id = auth.uid()));

create policy invites_select on invites for select to authenticated
  using (is_adult(household_id));
create policy invites_delete on invites for delete to authenticated
  using (is_adult(household_id));

create policy pets_select on pets for select to authenticated using (can_see_pet(id));
create policy pets_insert on pets for insert to authenticated with check (is_adult(household_id));
create policy pets_update on pets for update to authenticated
  using (is_adult(household_id)) with check (is_adult(household_id));
create policy pets_delete on pets for delete to authenticated using (is_adult(household_id));

create policy tasks_select on tasks for select to authenticated using (can_see_task(tasks));
create policy tasks_insert on tasks for insert to authenticated with check (is_adult(household_id));
create policy tasks_update on tasks for update to authenticated
  using (is_adult(household_id)) with check (is_adult(household_id));
create policy tasks_delete on tasks for delete to authenticated using (is_adult(household_id));

-- Occurrences are readable when the underlying task is; NEVER writable directly.
create policy occurrences_select on occurrences for select to authenticated
  using (exists (select 1 from tasks t where t.id = occurrences.task_id and can_see_task(t)));

create policy events_select on events for select to authenticated using (is_family(household_id));
create policy events_insert on events for insert to authenticated with check (is_adult(household_id));
create policy events_update on events for update to authenticated
  using (is_adult(household_id)) with check (is_adult(household_id));
create policy events_delete on events for delete to authenticated using (is_adult(household_id));

create policy rewards_select on rewards for select to authenticated using (is_family(household_id));
create policy rewards_insert on rewards for insert to authenticated with check (is_adult(household_id));
create policy rewards_update on rewards for update to authenticated
  using (is_adult(household_id)) with check (is_adult(household_id));
create policy rewards_delete on rewards for delete to authenticated using (is_adult(household_id));

create policy redemptions_select on redemptions for select to authenticated
  using (is_adult(household_id)
         or (is_family(household_id) and (member_id is null or member_id = my_member_id(household_id))));

create policy ledger_select on points_ledger for select to authenticated
  using (is_adult(household_id)
         or (is_family(household_id) and (scope = 'family' or member_id = my_member_id(household_id))));

create policy pet_notes_select on pet_notes for select to authenticated using (can_see_pet(pet_id));
create policy pet_notes_insert on pet_notes for insert to authenticated
  with check (can_see_pet(pet_id) and author_member_id = my_member_id(household_id));
create policy pet_notes_delete on pet_notes for delete to authenticated using (is_adult(household_id));

-- Defense in depth: even if a policy were added by mistake, these tables have no client write grants.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on households, members, occurrences, points_ledger, redemptions
  from authenticated;
revoke insert, update, delete, truncate on invites from authenticated;
revoke truncate on all tables in schema public from authenticated;
-- Invites can only be deleted (revoked) directly; they're created through create_invite().
grant delete on invites to authenticated;

-- Balances respect the caller's RLS on points_ledger.
create view point_balances with (security_invoker = true) as
  select household_id, scope, member_id, coalesce(sum(delta), 0)::int as balance
  from points_ledger
  group by household_id, scope, member_id;
grant select on point_balances to authenticated;

-- ---------------------------------------------------------------- functions (RPC)
create function create_household(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into households (name, created_by) values (trim(p_name), auth.uid()) returning id into h;
  insert into members (household_id, user_id, display_name, role)
  values (h, auth.uid(), trim(p_display_name), 'owner');
  return h;
end $$;

create function update_household(p_household uuid, p_name text, p_bonus_pct int, p_sitter_info text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_adult(p_household) then raise exception 'Not authorized'; end if;
  update households set name = trim(p_name), family_bonus_pct = p_bonus_pct,
    sitter_info = coalesce(p_sitter_info, '') where id = p_household;
end $$;

create function create_invite(
  p_household uuid, p_role member_role, p_display_name text,
  p_sitter_start timestamptz default null, p_sitter_end timestamptz default null
) returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_adult(p_household) then raise exception 'Not authorized'; end if;
  if p_role = 'owner' then raise exception 'Cannot invite another owner'; end if;
  if p_role = 'adult' and my_role(p_household) <> 'owner' then
    raise exception 'Only the owner can invite adults';
  end if;
  if p_role = 'sitter' and (p_sitter_start is null or p_sitter_end is null or p_sitter_end <= p_sitter_start) then
    raise exception 'Sitters need a valid start and end date';
  end if;
  c := replace(gen_random_uuid()::text, '-', '') ;
  c := substr(c, 1, 16);
  insert into invites (household_id, code, role, display_name, sitter_start, sitter_end, created_by)
  values (p_household, c, p_role, trim(p_display_name), p_sitter_start, p_sitter_end, auth.uid());
  return c;
end $$;

create function peek_invite(p_code text) returns table (household_name text, role member_role, display_name text)
language sql security definer set search_path = public as $$
  select h.name, i.role, i.display_name
  from invites i join households h on h.id = i.household_id
  where i.code = p_code and i.used_at is null and i.expires_at > now() and auth.uid() is not null
$$;

create function accept_invite(p_code text, p_display_name text default null) returns uuid
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
    if existing.revoked_at is null then raise exception 'You are already in this household'; end if;
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

create function add_child_profile(p_household uuid, p_name text, p_color text default '#C9A87C') returns uuid
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  if not is_adult(p_household) then raise exception 'Not authorized'; end if;
  insert into members (household_id, display_name, role, color)
  values (p_household, trim(p_name), 'child', p_color) returning id into m;
  return m;
end $$;

create function update_member(p_member uuid, p_name text, p_color text) returns void
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where id = p_member;
  if not found then raise exception 'Not found'; end if;
  if not (is_adult(m.household_id) or m.user_id = auth.uid()) then raise exception 'Not authorized'; end if;
  if my_role(m.household_id) is null then raise exception 'Not authorized'; end if;
  update members set display_name = trim(p_name), color = p_color where id = p_member;
end $$;

create function revoke_member(p_member uuid) returns void
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
end $$;

create function set_sitter_window(p_member uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where id = p_member;
  if not found or m.role <> 'sitter' then raise exception 'Not a pet sitter'; end if;
  if not is_adult(m.household_id) then raise exception 'Not authorized'; end if;
  if p_end <= p_start then raise exception 'End must be after start'; end if;
  update members set sitter_start = p_start, sitter_end = p_end, revoked_at = null where id = p_member;
end $$;

create function ensure_occurrences(p_household uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_active_member(p_household) then raise exception 'Not authorized'; end if;
  if p_to < p_from or p_to - p_from > 70 then raise exception 'Invalid date range'; end if;
  insert into occurrences (household_id, task_id, due_date)
  select t.household_id, t.id, d::date
  from tasks t
  cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  where t.household_id = p_household and not t.archived and task_due_on(t, d::date)
  on conflict (task_id, due_date) do nothing;
end $$;

create function complete_occurrence(p_occurrence uuid, p_note text default null) returns jsonb
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
  if me.role = 'sitter' and not t.guest_visible then raise exception 'Not authorized'; end if;
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

create function uncomplete_occurrence(p_occurrence uuid) returns void
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
end $$;

create function point_balance(p_household uuid, p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from points_ledger
  where household_id = p_household
    and case when p_member is null then scope = 'family' else (scope = 'member' and member_id = p_member) end
$$;

create function request_redemption(p_reward uuid, p_member uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare rw rewards; me members; target uuid; held int; rid uuid;
begin
  select * into rw from rewards where id = p_reward and active;
  if not found then raise exception 'Reward not available'; end if;
  select * into me from members where household_id = rw.household_id and user_id = auth.uid()
    and revoked_at is null and role <> 'sitter';
  if not found then raise exception 'Not authorized'; end if;

  if rw.kind = 'individual' then
    target := coalesce(p_member, me.id);
    if me.role = 'child' and target <> me.id then raise exception 'Not authorized'; end if;
    if not exists (select 1 from members where id = target and household_id = rw.household_id
                   and revoked_at is null and role <> 'sitter') then
      raise exception 'Unknown family member';
    end if;
  else
    target := null;
  end if;

  perform pg_advisory_xact_lock(hashtext(rw.household_id::text || coalesce(target::text, 'family')));
  select coalesce(sum(cost), 0) into held from redemptions
  where household_id = rw.household_id and status = 'pending' and member_id is not distinct from target;
  if point_balance(rw.household_id, target) - held < rw.cost then
    raise exception 'Not enough points';
  end if;

  insert into redemptions (household_id, reward_id, member_id, reward_title, cost, requested_by)
  values (rw.household_id, rw.id, target, rw.title, rw.cost, me.id) returning id into rid;
  return rid;
end $$;

create function decide_redemption(p_redemption uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r redemptions; me uuid;
begin
  select * into r from redemptions where id = p_redemption for update;
  if not found then raise exception 'Not found'; end if;
  if not is_adult(r.household_id) then raise exception 'Not authorized'; end if;
  if r.status <> 'pending' then raise exception 'Already decided'; end if;
  me := my_member_id(r.household_id);

  if p_approve then
    perform pg_advisory_xact_lock(hashtext(r.household_id::text || coalesce(r.member_id::text, 'family')));
    if point_balance(r.household_id, r.member_id) < r.cost then raise exception 'Not enough points'; end if;
    insert into points_ledger (household_id, scope, member_id, delta, kind, redemption_id, note, created_by)
    values (r.household_id, case when r.member_id is null then 'family' else 'member' end,
            r.member_id, -r.cost, 'redeem', r.id, r.reward_title, me);
  end if;
  update redemptions set status = case when p_approve then 'approved' else 'denied' end,
    decided_by = me, decided_at = now() where id = r.id;
end $$;

create function adjust_points(p_household uuid, p_member uuid, p_delta int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_adult(p_household) then raise exception 'Not authorized'; end if;
  if p_delta = 0 or abs(p_delta) > 10000 then raise exception 'Invalid amount'; end if;
  if p_member is not null and not exists (
    select 1 from members where id = p_member and household_id = p_household and role <> 'sitter') then
    raise exception 'Unknown family member';
  end if;
  insert into points_ledger (household_id, scope, member_id, delta, kind, note, created_by)
  values (p_household, case when p_member is null then 'family' else 'member' end, p_member,
          p_delta, 'adjust', nullif(trim(coalesce(p_note, '')), ''), my_member_id(p_household));
end $$;

-- Starter data: 3 dogs, 2 cats, 1 chicken and a sensible set of recurring care tasks.
create function seed_starter_pets(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p record; pid uuid; i int;
begin
  if not is_adult(p_household) then raise exception 'Not authorized'; end if;
  if exists (select 1 from pets where household_id = p_household) then
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

  insert into tasks (household_id, title, category, points, due_time, guest_visible, instructions)
  values
    (p_household, 'Refresh dog water bowls', 'Animal care', 3, '08:00', true, 'Dump, rinse, refill'),
    (p_household, 'Refresh cat water', 'Animal care', 3, '08:00', true, 'Dump, rinse, refill'),
    (p_household, 'Scoop litter boxes', 'Animal care', 4, '18:00', true, 'Scoop and top up if needed');
  insert into tasks (household_id, title, category, points, due_time, guest_visible, instructions, recurrence)
  values
    (p_household, 'Clean chicken coop', 'Animal care', 10, '10:00', true, 'Replace bedding, scrub waterer',
     '{"type":"weekdays","days":[6]}');
end $$;

-- Only signed-in users may call the RPCs.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- Trigger/internal-only helpers don't need to be callable at all.
revoke execute on function tasks_purge_pending() from authenticated;

-- ---------------------------------------------------------------- realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      households, members, pets, tasks, occurrences, events, rewards, redemptions, points_ledger, pet_notes;
  end if;
end $$;
