import { supabase } from './supabase';
import type { PetNote } from './types';

/** Supabase errors are plain objects, not Error instances — normalise to a readable string. */
export const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
};

type Result = PromiseLike<{ data: any; error: { message: string } | null }>;

/** Await a Supabase call and throw a real Error if it failed. */
export async function must<T = unknown>(p: Result): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Call a database function (all privileged writes go through these). */
export const rpc = <T = unknown>(fn: string, args: Record<string, unknown> = {}) => must<T>(supabase().rpc(fn, args));

// Tables adults may edit directly (row-level security enforces who).
type EditableTable = 'tasks' | 'pets' | 'events' | 'rewards';

/** Insert (no id) or update (with id) a row; inserts are stamped with the household. */
export const saveRow = (table: EditableTable, row: Record<string, unknown>, opts: { id?: string; household: string }) =>
  must(
    opts.id
      ? supabase().from(table).update(row).eq('id', opts.id)
      : supabase().from(table).insert({ ...row, household_id: opts.household }),
  );

/** Partial update, e.g. soft-delete flags. */
export const patchRow = (table: EditableTable, id: string, patch: Record<string, unknown>) =>
  must(supabase().from(table).update(patch).eq('id', id));

export const deleteRow = (table: 'events' | 'invites', id: string) => must(supabase().from(table).delete().eq('id', id));

export type Invite = {
  id: string;
  code: string;
  role: string;
  display_name: string;
  sitter_start: string | null;
  sitter_end: string | null;
  expires_at: string;
  used_at: string | null;
};

export const listInvites = (household: string) =>
  must<Invite[]>(
    supabase()
      .from('invites')
      .select('id,code,role,display_name,sitter_start,sitter_end,expires_at,used_at')
      .eq('household_id', household)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false }),
  );

export const listPetNotes = (household: string) =>
  must<PetNote[]>(
    supabase()
      .from('pet_notes')
      .select('id,pet_id,author_member_id,body,created_at')
      .eq('household_id', household)
      .order('created_at', { ascending: false })
      .limit(200),
  );

export const addPetNote = (household: string, pet: string, author: string, body: string) =>
  must(supabase().from('pet_notes').insert({ household_id: household, pet_id: pet, author_member_id: author, body }));

export type MembershipRow = { household_id: string; household_name: string; role: string; active: boolean };
export const myMemberships = () => rpc<MembershipRow[]>('my_memberships');
