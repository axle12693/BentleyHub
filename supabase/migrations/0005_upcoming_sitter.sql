-- Bentley Home Hub — my_memberships() now reports when a not-yet-started sitter window opens,
-- so the app can say "access starts on …" instead of "access has ended".

drop function my_memberships();
create function my_memberships()
returns table (household_id uuid, household_name text, role member_role, active boolean, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.household_id, h.name, m.role,
         (m.revoked_at is null and (m.role <> 'sitter' or now() between m.sitter_start and m.sitter_end)),
         case when m.revoked_at is null and m.role = 'sitter' and now() < m.sitter_start then m.sitter_start end
  from members m join households h on h.id = m.household_id
  where m.user_id = auth.uid()
$$;

revoke execute on function my_memberships() from public, anon;
grant execute on function my_memberships() to authenticated;
