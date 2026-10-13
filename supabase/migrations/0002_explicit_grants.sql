-- Bentley Home Hub — explicit table grants.
--
-- 0001 relied on Supabase's automatic table grants (anon/authenticated got everything on new tables,
-- and 0001 then revoked a few). Supabase is changing the platform default so new tables get NO
-- automatic grants; on such a project 0001 alone would leave the signed-in role unable to read
-- anything ("permission denied", code 42501).
--
-- This migration states exactly what each role may do, so the result is identical on projects with
-- or without automatic grants. It is safe to run on a database where 0001 is already applied, and
-- safe to re-run. Row-level security (0001) still decides WHICH rows; these grants decide WHETHER
-- the role can touch the table at all.

-- Start from nothing. (Covers tables and views, including point_balances — re-granted below.)
revoke all on all tables in schema public from anon, authenticated;

-- Read-only from the client. All writes to these go through the SECURITY DEFINER functions.
grant select on households, members, occurrences, redemptions, points_ledger to authenticated;
grant select on point_balances to authenticated;

-- Invites are created via create_invite(); adults may only list and cancel (delete) them.
grant select, delete on invites to authenticated;

-- Directly editable by adults (the RLS policies enforce "adult only").
grant select, insert, update, delete on pets, tasks, events, rewards to authenticated;

-- Anyone who can see a pet may add a note; adults may delete notes (RLS enforces both).
grant select, insert, delete on pet_notes to authenticated;
