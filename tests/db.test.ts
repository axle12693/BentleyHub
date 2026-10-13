import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs the real migration against an in-process Postgres and impersonates Supabase users
// by setting the role + request.jwt.claim.sub (what auth.uid() reads).

const db = new PGlite();
// Every migration, in order — exactly what `supabase db push` would apply.
const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'));
// LEGACY_GRANTS=1 simulates an older Supabase project that auto-grants new tables (the situation
// when 0001 was applied there); default simulates the new opt-in behaviour with no automatic grants.
const legacyGrants = process.env.LEGACY_GRANTS === '1';

const U = {
  alice: '00000000-0000-0000-0000-00000000000a', // owner, household A
  bob: '00000000-0000-0000-0000-00000000000b', // adult, household A
  kid: '00000000-0000-0000-0000-00000000000c', // child with login, household A
  sitter: '00000000-0000-0000-0000-00000000000d', // active sitter, household A
  oldsitter: '00000000-0000-0000-0000-00000000000e', // expired sitter, household A
  eve: '00000000-0000-0000-0000-00000000000f', // owner of household B
};

async function as<T = any>(uid: string | null, sql: string, params: any[] = []): Promise<T[]> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const admin = async <T = any>(sql: string, params: any[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (uid: string, sql: string, params: any[] = []) => {
  await expect(as(uid, sql, params)).rejects.toThrow();
};

let A: string, B: string;
let mAlice: string, mBob: string, mKid: string, mSitter: string, mOld: string;
let tOpen: string, tAssignedKid: string, tGuest: string, tPrivate: string;

const occFor = async (task: string) =>
  (await admin<{ id: string }>('select id from occurrences where task_id=$1 and due_date=current_date', [task]))[0].id;
// member = member id, or null for the shared family pool
const balance = async (member: string | null) =>
  (await admin<{ b: number }>('select point_balance($1, $2) as b', [A, member]))[0].b;
const newTask = async (uid: string, title: string, cols = '', vals = '', params: any[] = []) =>
  (await as(uid, `insert into tasks (household_id, title, points ${cols}) values ($1, $2, 10 ${vals}) returning id`, [A, title, ...params]))[0].id as string;
const gen = (days = 0) => as(U.alice, `select ensure_occurrences($1, current_date, current_date + ${days})`, [A]);

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  if (legacyGrants) {
    await db.exec(`
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
  }
  for (const id of Object.values(U)) await db.query('insert into auth.users (id) values ($1)', [id]);
  for (const m of migrations) await db.exec(m);

  A = (await as(U.alice, `select create_household('Bentley', 'Alice') as id`))[0].id;
  B = (await as(U.eve, `select create_household('Eve House', 'Eve') as id`))[0].id;
  mAlice = (await admin(`select id from members where user_id=$1 and household_id=$2`, [U.alice, A]))[0].id;

  const invite = async (sql: string) => (await as(U.alice, sql, [A]))[0].c as string;
  await as(U.bob, `select accept_invite($1)`, [await invite(`select create_invite($1,'adult','Bob') as c`)]);
  await as(U.kid, `select accept_invite($1)`, [await invite(`select create_invite($1,'child','Kiddo') as c`)]);
  await as(U.sitter, `select accept_invite($1)`, [
    await invite(`select create_invite($1,'sitter','Sam', now(), now() + interval '3 days') as c`),
  ]);
  await as(U.oldsitter, `select accept_invite($1)`, [
    await invite(`select create_invite($1,'sitter','Olive', now(), now() + interval '3 days') as c`),
  ]);
  // Simulate a sitter whose window has since ended.
  await admin(`update members set sitter_start = now() - interval '10 days', sitter_end = now() - interval '2 days' where user_id=$1`, [U.oldsitter]);

  const ids = await admin<{ id: string; user_id: string }>(`select id, user_id from members where household_id=$1`, [A]);
  const by = (u: string) => ids.find((r) => r.user_id === u)!.id;
  mBob = by(U.bob); mKid = by(U.kid); mSitter = by(U.sitter); mOld = by(U.oldsitter);

  tOpen = await newTask(U.alice, 'Open chore');
  tAssignedKid = await newTask(U.alice, 'Kid chore', ', assignee_member_id', ', $3', [mKid]);
  tGuest = await newTask(U.alice, 'Feed dogs', ', guest_visible', ', true');
  tPrivate = await newTask(U.alice, 'Private chore');
  await gen();

  await as(U.alice, `insert into rewards (household_id, title, cost, kind) values ($1,'Ice cream',15,'individual'), ($1,'Movie night',2,'family')`, [A]);
  await as(U.alice, `insert into events (household_id, title, starts_at) values ($1,'Dentist', now())`, [A]);
  await as(U.alice, `insert into pets (household_id, name, species, guest_visible) values ($1,'Rex','dog',true), ($1,'Secret','cat',false)`, [A]);
});

describe('household isolation', () => {
  it('outsiders see nothing of another household', async () => {
    for (const t of ['tasks', 'members', 'occurrences', 'points_ledger', 'events', 'rewards', 'pets', 'households']) {
      const rows = await as(U.eve, `select * from ${t} where ${t === 'households' ? 'id' : 'household_id'} = $1`, [A]);
      expect(rows, t).toHaveLength(0);
    }
  });
  it("cannot call RPCs against someone else's household", async () => {
    await fails(U.eve, `select ensure_occurrences($1, current_date, current_date)`, [A]);
    await fails(U.eve, `select create_invite($1,'sitter','X', now(), now() + interval '1 day')`, [A]);
    await fails(U.eve, `select seed_starter_pets($1)`, [A]);
    await fails(U.eve, `select adjust_points($1, null, 50, 'free')`, [A]);
    await fails(U.eve, `select complete_occurrence($1)`, [await occFor(tOpen)]);
    await fails(U.eve, `insert into tasks (household_id, title) values ($1, 'sneaky')`, [A]);
  });
  it('signed-out callers get nothing', async () => {
    expect(await as(null, 'select * from tasks')).toHaveLength(0);
    await fails(U.eve, `select accept_invite('doesnotexist')`);
  });
  it("tasks cannot reference another household's members", async () => {
    const otherMember = (await admin(`select id from members where household_id=$1`, [B]))[0].id;
    await expect(
      as(U.alice, `insert into tasks (household_id, title, assignee_member_id) values ($1,'x',$2)`, [A, otherMember]),
    ).rejects.toThrow();
  });
});

describe('role & write protections', () => {
  it('clients cannot write members, points, occurrences, households or redemptions directly', async () => {
    await fails(U.bob, `update members set role='owner' where id=$1`, [mBob]);
    await fails(U.bob, `insert into points_ledger (household_id, scope, member_id, delta, kind) values ($1,'member',$2,999,'adjust')`, [A, mBob]);
    await fails(U.bob, `update occurrences set status='done' where household_id=$1`, [A]);
    await fails(U.bob, `update households set family_bonus_pct=100 where id=$1`, [A]);
    await fails(U.bob, `delete from points_ledger where household_id=$1`, [A]);
    await fails(U.bob, `insert into redemptions (household_id, reward_id, reward_title, cost, status) values ($1, gen_random_uuid(), 'x', 1, 'approved')`, [A]);
  });
  it('children and sitters cannot create tasks, rewards or points', async () => {
    await fails(U.kid, `insert into tasks (household_id, title) values ($1,'kid task')`, [A]);
    await fails(U.kid, `select adjust_points($1, $2, 100, 'hack')`, [A, mKid]);
    await fails(U.sitter, `insert into rewards (household_id, title, cost) values ($1,'free',1)`, [A]);
    await fails(U.sitter, `select adjust_points($1, $2, 100, 'hack')`, [A, mSitter]);
  });
  it('only the owner can invite adults; adults can invite sitters', async () => {
    await fails(U.bob, `select create_invite($1,'adult','Another')`, [A]);
    const c = await as(U.bob, `select create_invite($1,'sitter','Sit', now(), now() + interval '1 day') as c`, [A]);
    expect(c[0].c).toHaveLength(16);
    await fails(U.kid, `select create_invite($1,'sitter','Sit', now(), now() + interval '1 day')`, [A]);
  });
  it('invites are single-use', async () => {
    const code = (await as(U.alice, `select create_invite($1,'child','Tmp') as c`, [A]))[0].c;
    await as(U.eve, `select accept_invite($1)`, [code]);
    await fails(U.bob, `select accept_invite($1)`, [code]);
  });
  it('the owner cannot be removed, and children cannot remove anyone', async () => {
    await fails(U.bob, `select revoke_member($1)`, [mAlice]);
    await fails(U.kid, `select revoke_member($1)`, [mBob]);
  });
});

describe('pet-sitter access', () => {
  it('an active sitter sees only guest-visible tasks and pets, and no family data', async () => {
    const tasks = await as(U.sitter, `select title from tasks order by title`);
    expect(tasks.map((r) => r.title)).toEqual(['Feed dogs']);
    expect((await as(U.sitter, `select name from pets`)).map((r) => r.name)).toEqual(['Rex']);
    expect(await as(U.sitter, `select * from events`)).toHaveLength(0);
    expect(await as(U.sitter, `select * from rewards`)).toHaveLength(0);
    expect(await as(U.sitter, `select * from points_ledger`)).toHaveLength(0);
    expect(await as(U.sitter, `select * from invites`)).toHaveLength(0);
    expect((await as(U.sitter, `select id from members`)).map((m) => m.id)).toEqual([mSitter]);
    expect(await as(U.sitter, `select * from occurrences`)).toHaveLength(1);
  });
  it('a sitter can complete a guest task but earns no points, and cannot touch private tasks', async () => {
    const occ = await occFor(tGuest);
    await as(U.sitter, `select complete_occurrence($1, 'Fed at 7')`, [occ]);
    const row = (await admin(`select status, points_awarded, note from occurrences where id=$1`, [occ]))[0];
    expect(row).toMatchObject({ status: 'done', points_awarded: 0, note: 'Fed at 7' });
    expect(await admin(`select * from points_ledger where occurrence_id=$1`, [occ])).toHaveLength(0);
    await fails(U.sitter, `select complete_occurrence($1)`, [await occFor(tPrivate)]);
  });
  it('sitters can leave notes only on pets shared with them, as themselves', async () => {
    const shared = (await admin(`select id from pets where name='Rex'`))[0].id;
    const secret = (await admin(`select id from pets where name='Secret'`))[0].id;
    await as(U.sitter, `insert into pet_notes (household_id, pet_id, author_member_id, body) values ($1,$2,$3,'Rex was great')`, [A, shared, mSitter]);
    await fails(U.sitter, `insert into pet_notes (household_id, pet_id, author_member_id, body) values ($1,$2,$3,'x')`, [A, secret, mSitter]);
    await fails(U.sitter, `insert into pet_notes (household_id, pet_id, author_member_id, body) values ($1,$2,$3,'x')`, [A, shared, mAlice]);
  });
  it('an expired sitter loses all access', async () => {
    expect(await as(U.oldsitter, `select * from tasks`)).toHaveLength(0);
    expect(await as(U.oldsitter, `select * from pets`)).toHaveLength(0);
    expect(await as(U.oldsitter, `select * from households`)).toHaveLength(0);
    expect(await as(U.oldsitter, `select * from members`)).toHaveLength(0);
    await fails(U.oldsitter, `select complete_occurrence($1)`, [await occFor(tGuest)]);
    await fails(U.oldsitter, `select ensure_occurrences($1, current_date, current_date)`, [A]);
  });
  it('a sitter whose window has not started has no access either', async () => {
    await admin(`update members set sitter_start = now() + interval '1 day', sitter_end = now() + interval '3 days' where id=$1`, [mOld]);
    expect(await as(U.oldsitter, `select * from tasks`)).toHaveLength(0);
  });
  it('revoking cuts access immediately; setting a new window restores it', async () => {
    await as(U.alice, `select revoke_member($1)`, [mSitter]);
    expect(await as(U.sitter, `select * from tasks`)).toHaveLength(0);
    await as(U.alice, `select set_sitter_window($1, now() - interval '1 hour', now() + interval '2 days')`, [mSitter]);
    expect(await as(U.sitter, `select * from tasks`)).toHaveLength(1);
  });
});

describe('points: once only, to the right person', () => {
  it('an open chore pays whoever completes it, exactly once', async () => {
    const occ = await occFor(tOpen);
    const r = await as(U.bob, `select complete_occurrence($1) as r`, [occ]);
    expect(r[0].r).toEqual({ points: 10, family_bonus: 2 });
    await fails(U.alice, `select complete_occurrence($1)`, [occ]); // lost the race
    await fails(U.bob, `select complete_occurrence($1)`, [occ]); // double-tap
    expect(await balance(mBob)).toBe(10);
    expect(await balance(mAlice)).toBe(0);
    expect(await balance(null)).toBe(2);
  });
  it('concurrent completions award once', async () => {
    const t = await newTask(U.alice, 'Race');
    await gen();
    const occ = await occFor(t);
    const results = await Promise.allSettled([
      as(U.bob, `select complete_occurrence($1)`, [occ]),
      as(U.alice, `select complete_occurrence($1)`, [occ]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const n = (await admin(`select count(*)::int as n from points_ledger where occurrence_id=$1 and kind='earn'`, [occ]))[0].n;
    expect(n).toBe(1);
    // Either user may have won; neutralise so later tests start from known balances.
    for (const [m, target] of [[mAlice, 0], [mBob, 10]] as const) {
      const diff = target - (await balance(m));
      if (diff) await as(U.alice, `select adjust_points($1,$2,$3,'reset')`, [A, m, diff]);
    }
  });
  it("an assigned chore pays the assignee even when an adult does it; children cannot take others' chores", async () => {
    await as(U.bob, `select complete_occurrence($1)`, [await occFor(tAssignedKid)]);
    expect(await balance(mKid)).toBe(10);
    const t = await newTask(U.alice, 'Bob only', ', assignee_member_id', ', $3', [mBob]);
    await gen();
    await fails(U.kid, `select complete_occurrence($1)`, [await occFor(t)]);
  });
  it('tasks marked not point-eligible award nothing', async () => {
    const before = await balance(mAlice);
    const t = await newTask(U.alice, 'No pts', ', points_eligible', ', false');
    await gen();
    await as(U.alice, `select complete_occurrence($1)`, [await occFor(t)]);
    expect(await balance(mAlice)).toBe(before);
  });
  it('undo reverses points; re-completing awards again exactly once; only adults can undo', async () => {
    const occ = await occFor(tOpen);
    const family = await balance(null);
    await fails(U.kid, `select uncomplete_occurrence($1)`, [occ]);
    await as(U.alice, `select uncomplete_occurrence($1)`, [occ]);
    expect(await balance(mBob)).toBe(0);
    expect(await balance(null)).toBe(family - 2);
    await fails(U.alice, `select uncomplete_occurrence($1)`, [occ]); // no longer complete
    await as(U.alice, `select complete_occurrence($1)`, [occ]);
    expect(await balance(mAlice)).toBe(10);
    expect(await balance(mBob)).toBe(0);
    await fails(U.bob, `select complete_occurrence($1)`, [occ]);
  });
  it('children only see their own points plus the family pool', async () => {
    const rows = await as(U.kid, `select scope, member_id from points_ledger`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.scope === 'family' || r.member_id === mKid).toBe(true);
    const bal = await as(U.kid, `select * from point_balances`);
    expect(bal.every((b) => b.scope === 'family' || b.member_id === mKid)).toBe(true);
  });
});

describe('rewards', () => {
  it('needs enough points, adult approval, and cannot overspend', async () => {
    const ice = (await admin(`select id from rewards where title='Ice cream'`))[0].id;
    const movie = (await admin(`select id from rewards where title='Movie night'`))[0].id;
    await fails(U.bob, `select request_redemption($1)`, [ice]); // Bob has 0
    await as(U.alice, `select adjust_points($1,$2,20,'bonus')`, [A, mAlice]); // Alice: 10 + 20 = 30
    const r1 = (await as(U.alice, `select request_redemption($1) as id`, [ice]))[0].id;
    const r2 = (await as(U.alice, `select request_redemption($1) as id`, [ice]))[0].id; // 30 covers two
    await fails(U.alice, `select request_redemption($1)`, [ice]); // a third would overspend
    await fails(U.kid, `select decide_redemption($1, true)`, [r1]);
    await as(U.bob, `select decide_redemption($1, true)`, [r1]);
    await fails(U.bob, `select decide_redemption($1, true)`, [r1]); // already decided
    expect(await balance(mAlice)).toBe(15);
    await as(U.bob, `select decide_redemption($1, false)`, [r2]);
    expect(await balance(mAlice)).toBe(15);
    // Family reward spends the shared pool.
    const pool = await balance(null);
    const rf = (await as(U.kid, `select request_redemption($1) as id`, [movie]))[0].id;
    await as(U.alice, `select decide_redemption($1, true)`, [rf]);
    expect(await balance(null)).toBe(pool - 2);
    await fails(U.kid, `select request_redemption($1, $2)`, [ice, mAlice]); // not their points
    await fails(U.sitter, `select request_redemption($1)`, [movie]);
  });
});

describe('schedules', () => {
  it('generates only the occurrences a recurrence calls for, and never duplicates', async () => {
    const dow = new Date(Date.now() + 2 * 86400000).getUTCDay();
    const t = await newTask(U.alice, 'Sched', ', recurrence', ', $3::jsonb', [JSON.stringify({ type: 'weekdays', days: [dow] })]);
    await gen(13);
    await gen(13);
    const count = async (id: string) => (await admin(`select count(*)::int as n from occurrences where task_id=$1`, [id]))[0].n;
    expect(await count(t)).toBe(2);
    const t2 = await newTask(U.alice, 'Every3', ', recurrence', `, '{"type":"interval","every":3}'`);
    await gen(8);
    expect(await count(t2)).toBe(3);
  });
  it('completing one day does not complete another', async () => {
    const t = await newTask(U.alice, 'Daily');
    await gen(2);
    await as(U.alice, `select complete_occurrence($1)`, [await occFor(t)]);
    const rows = await admin(`select status from occurrences where task_id=$1 order by due_date`, [t]);
    expect(rows.map((r: any) => r.status)).toEqual(['done', 'pending', 'pending']);
  });
  it('changing a schedule regenerates upcoming pending occurrences', async () => {
    const t = await newTask(U.alice, 'Changing');
    await gen(6);
    await as(U.alice, `update tasks set recurrence='{"type":"interval","every":7}' where id=$1`, [t]);
    const count = async () => (await admin(`select count(*)::int as n from occurrences where task_id=$1`, [t]))[0].n;
    expect(await count()).toBe(0);
    await gen(6);
    expect(await count()).toBe(1);
  });
});

describe('starter pets', () => {
  it('seeds 3 dogs, 2 cats and 1 chicken with recurring care tasks, once', async () => {
    await as(U.eve, `select seed_starter_pets($1)`, [B]);
    const pets = await as(U.eve, `select species, count(*)::int as n from pets where household_id=$1 group by species order by species`, [B]);
    expect(pets).toEqual([{ species: 'cat', n: 2 }, { species: 'chicken', n: 1 }, { species: 'dog', n: 3 }]);
    expect((await as(U.eve, `select count(*)::int as n from tasks where guest_visible and household_id=$1`, [B]))[0].n).toBeGreaterThan(15);
    await fails(U.eve, `select seed_starter_pets($1)`, [B]);
  });
});

describe('audit fixes (migration 0003)', () => {
  it('my_memberships distinguishes active from ended access', async () => {
    await admin(`update members set sitter_start = now() - interval '10 days', sitter_end = now() - interval '2 days' where id=$1`, [mOld]);
    const old = await as(U.oldsitter, `select * from my_memberships()`);
    expect(old).toHaveLength(1);
    expect(old[0]).toMatchObject({ household_id: A, role: 'sitter', active: false });
    expect((await as(U.alice, `select * from my_memberships()`))[0]).toMatchObject({ household_id: A, active: true });
    const eve = (await as(U.eve, `select household_id from my_memberships()`)).map((r) => r.household_id);
    expect(eve).toContain(B);
    expect(await as(null, `select * from my_memberships()`)).toHaveLength(0);
  });

  it('a sitter cannot see or complete a shared task whose pet is hidden from sitters', async () => {
    const secret = (await admin(`select id from pets where name='Secret'`))[0].id;
    const t = await newTask(U.alice, 'Feed Secret', ', guest_visible, pet_id', ', true, $3', [secret]);
    await gen();
    expect((await as(U.sitter, `select id from tasks where id=$1`, [t]))).toHaveLength(0);
    await fails(U.sitter, `select complete_occurrence($1)`, [await occFor(t)]);
    expect((await as(U.alice, `select id from tasks where id=$1`, [t]))).toHaveLength(1);
  });

  it('an expired sitter can be re-invited, but an active member cannot re-join', async () => {
    await admin(`update members set revoked_at = null, sitter_start = now() - interval '10 days', sitter_end = now() - interval '2 days' where id=$1`, [mOld]);
    const code = (await as(U.alice, `select create_invite($1,'child','Olive') as c`, [A]))[0].c;
    await as(U.oldsitter, `select accept_invite($1)`, [code]);
    expect((await admin(`select role from members where id=$1`, [mOld]))[0].role).toBe('child');
    const again = (await as(U.alice, `select create_invite($1,'child','Bob again') as c`, [A]))[0].c;
    await fails(U.oldsitter, `select accept_invite($1)`, [again]);
  });

  it('archiving a pet archives its tasks in the same transaction', async () => {
    const pet = (await admin(`insert into pets (household_id, name) values ($1,'Temp') returning id`, [A]))[0].id;
    const t = await newTask(U.alice, 'Temp care', ', pet_id', ', $3', [pet]);
    await as(U.alice, `update pets set archived = true where id=$1`, [pet]);
    expect((await admin(`select archived from tasks where id=$1`, [t]))[0].archived).toBe(true);
  });

  it('member colours must be #RRGGBB', async () => {
    await fails(U.bob, `select update_member($1,'Bob','red')`, [mBob]);
    await as(U.bob, `select update_member($1,'Bob','#aabbcc')`, [mBob]);
  });
});

describe('progression fixes (migration 0004)', () => {
  it('removing a member opens up the tasks assigned to them', async () => {
    const kid2 = (await as(U.alice, `select add_child_profile($1,'Temp Kid') as id`, [A]))[0].id;
    const t = await newTask(U.alice, 'Temp kid chore', ', assignee_member_id', ', $3', [kid2]);
    await as(U.alice, `select revoke_member($1)`, [kid2]);
    expect((await admin(`select assignee_member_id from tasks where id=$1`, [t]))[0].assignee_member_id).toBeNull();
  });

  it('a schedule change drops older pending occurrences that no longer match', async () => {
    const t = await newTask(U.alice, 'Sched change');
    await as(U.alice, `select ensure_occurrences($1, current_date - 5, current_date)`, [A]);
    await admin(`update tasks set start_date = current_date - 5 where id=$1`, [t]); // purge + regen below
    await as(U.alice, `select ensure_occurrences($1, current_date - 5, current_date)`, [A]);
    expect((await admin(`select count(*)::int c from occurrences where task_id=$1`, [t]))[0].c).toBe(6);
    await admin(`update tasks set start_date = current_date where id=$1`, [t]);
    const left = await admin<{ due_date: string }>(`select due_date from occurrences where task_id=$1`, [t]);
    expect(left.length).toBeLessThanOrEqual(1);
  });

  it('starter pets can be added again after every pet was archived', async () => {
    await admin(`update pets set archived = true where household_id=$1`, [B]);
    await as(U.eve, `select seed_starter_pets($1)`, [B]);
    await fails(U.eve, `select seed_starter_pets($1)`, [B]);
    await admin(`update pets set archived = true where household_id=$1`, [B]);
    await as(U.eve, `select seed_starter_pets($1)`, [B]);
    expect((await admin(`select count(*)::int c from pets where household_id=$1 and not archived`, [B]))[0].c).toBe(6);
    expect((await admin(`select count(*)::int c from tasks where household_id=$1 and title='Scoop litter boxes' and not archived`, [B]))[0].c).toBe(1);
  });
});
