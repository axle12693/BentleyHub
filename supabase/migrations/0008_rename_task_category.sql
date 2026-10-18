-- Bentley Home Hub — bulk task-category rename (used by the Categories manager).
--
-- Done in SQL rather than with a client-side ilike so the match is a plain case-insensitive,
-- whitespace-trimmed equality: no LIKE/PostgREST wildcard characters (%, _, *) can leak in.
-- Moves archived tasks too. Returns the number of tasks changed. Safe to re-run.

create or replace function rename_task_category(p_household uuid, p_from text, p_to text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; ws constant text := E' \t\r\n'; dest text;
begin
  dest := btrim(coalesce(p_to, ''), ws);
  if not is_adult(p_household) then raise exception 'Not authorized'; end if;
  if dest = '' then raise exception 'Category name required'; end if;
  -- Keep in sync with MAX_CATEGORY_LENGTH in src/lib/categories.ts.
  if length(dest) > 40 then raise exception 'Category name too long (max 40)'; end if;
  update tasks set category = dest
  where household_id = p_household and lower(btrim(category, ws)) = lower(btrim(p_from, ws));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function rename_task_category(uuid, text, text) from public, anon;
grant execute on function rename_task_category(uuid, text, text) to authenticated;
