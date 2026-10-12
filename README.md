# Bentley Home Hub 🏡

A cozy family planner (cream + sage green) that works as an installable web app on iPhone and Android:
shared calendar, chores & routines, recurring pet care (3 dogs, 2 cats, 1 chicken to start), assignable or
"anyone" tasks, individual points + a shared family reward jar, and temporary pet-sitter accounts.

Stack: **Next.js 15 + TypeScript** (UI) · **Supabase** (auth, Postgres, row-level security, realtime) · PWA.

## What's in the box

| Area | How it works |
|---|---|
| Sign-in | Supabase Auth, email + password. Roles: **owner**, **adult**, **child**, **pet sitter**. |
| Sync | Every change is pushed to every signed-in device through Supabase Realtime (plus a refresh when the app returns to the foreground). |
| Tasks | Once / daily / chosen weekdays / every-N-days. One *occurrence row per day* is generated, so finishing today never finishes tomorrow. Assigned to a person or **open** (first to finish gets the points). Morning/evening routines, due times, notes, categories. |
| Calendar | Month view with events **and** the day's chores/routines together. |
| Pets | Per-animal profile, instructions, care schedule, notes. One tap seeds 3 dogs + 2 cats + 1 chicken with sensible recurring tasks (rename them afterwards). |
| Points | Append-only ledger. Points are awarded **once** per completion (database unique index + row lock). Undo reverses them. A configurable % of every earn also drops into the shared **family jar**. |
| Rewards | Individual and whole-family rewards, redemption requests that an adult approves, overspend protection, manual adjustments, full history. |
| Pet sitters | Invite with a start/end date. They see *only* tasks and animals flagged "visible to sitters" plus your sitter info (vet, door code…). Access ends automatically at the end date, and you can revoke any time. Their completions never earn points. |

### Security model (enforced in the database, not the browser)
* Every table has row-level security; reads are scoped to your household.
* Members, points, occurrences, redemptions and household settings **cannot be written directly** by the app — only via `SECURITY DEFINER` functions that identify you with `auth.uid()` and ignore any client-supplied user id, role, or point value.
* A sitter's access is checked in SQL against `sitter_start`/`sitter_end`/`revoked_at` on every request.
* Only the public **anon** key is used in the browser. **Never** put the `service_role` key in this app.

`npm test` runs 26 tests that apply the real migration to an in-process Postgres and attack it:
cross-household reads/writes, expired / not-yet-started / revoked sitters, duplicate and concurrent completions,
direct point inserts, role escalation, invite replay, reward overspending, and more.

> Honest status: the database layer is test-verified. The UI compiles, builds and is styled, but I could not exercise
> the signed-in screens against a live Supabase project from here — do the checklist at the bottom on your own
> project before inviting anyone real.

## Setup (about 10 minutes, all free tier)

### 1. Create the database
1. Go to <https://supabase.com> → **New project** (any name, pick a region near you, save the DB password somewhere).
2. In the project: **SQL Editor → New query**, paste the whole of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), click **Run**. It should finish with "Success".
3. **Authentication → Providers → Email**: keep it enabled. (While testing you can turn **Confirm email** off so sign-up logs you straight in; turn it back on for production.)
4. **Authentication → URL Configuration**: set **Site URL** to your deployed address once you have one (and add `http://localhost:3000` for local testing). Invite/password-reset emails use this.
5. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Run it on your computer
```bash
copy .env.example .env.local      # Windows  (macOS/Linux: cp .env.example .env.local)
# edit .env.local and paste your Project URL + anon key
npm install
npm run dev
```
Open <http://localhost:3000>, create an account, then **Start a household**.

### 3. Put it online (so both phones can use it)
1. Push this folder to a GitHub repository.
2. On <https://vercel.com> → **Add New → Project** → import the repo.
3. Under **Environment Variables** add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy, then put the Vercel URL into Supabase **Site URL** (step 1.4).

### 4. Install on the phones
* **iPhone** – open the site in Safari → Share → **Add to Home Screen**.
* **Android** – open in Chrome → ⋮ → **Install app**.

## First-run checklist (please do this before real use)
1. Create your account → *Start a household* → **Pets** → *Add my 6 animals*.
2. Rename the animals, add care instructions, and confirm tasks appear on **Home**.
3. **Family → Invite someone → Adult** for your husband; open the link on his Android phone, sign up, join.
4. Check a chore off on one phone — it should tick on the other within a second or two, and points should appear under **Rewards**.
5. Add a reward (e.g. "Movie night", family, 100) and watch the jar fill; redeem it and approve.
6. **Family → Invite → Pet sitter** with dates, open the link in a private window and confirm the sitter sees *only* the pet checklist, then use **Revoke** and confirm access disappears.
7. In Supabase **Database → Replication**, confirm the tables are listed under `supabase_realtime` (the migration does this automatically).

## Project layout
```
supabase/migrations/0001_init.sql   schema, RLS policies, RPC functions
tests/db.test.ts                    security + points tests (npm test)
src/lib/hub.tsx                     auth gate, household data, realtime sync
src/app/(app)/*                     Home, Calendar, Tasks, Pets, Rewards, Family
src/app/{login,welcome,join}        sign-in and onboarding
public/sw.js                        service worker (installable; never caches family data)
```

## Known limits / ideas for later
* Reminders/push notifications are not built (browser push on iOS has extra requirements).
* Sitter windows end at the stored timestamp; the UI notices on its next refresh (≤ a few minutes, or any tap) while the database blocks them instantly.
* Sitter and child accounts use email + password; a child *profile* with no login is also supported.
* Deleting realtime events needs `REPLICA IDENTITY FULL` on a table if you want instant removal sync for that table; edits and inserts sync as-is and every refresh reconciles deletions.
