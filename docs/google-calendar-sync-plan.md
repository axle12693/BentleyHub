# Google Calendar two-way sync — implementation plan

Status: **v2 — decisions recorded, ready for Phase 0.** Nothing is implemented yet.

## 1. Requirements (agreed)

| # | Requirement |
|---|---|
| R1 | Two-way sync of **events only**. Tasks/occurrences are never synced. |
| R2 | Event created in the hub → pushed to Google. |
| R3 | Event created in Google → pulled into the hub. |
| R4 | **Visibility follows Google.** Event on A's calendar *and* shared with B → both see it in the hub. Event only on A's calendar → only A sees it. |
| R5 | Hub-created events go on the **creator's** Google calendar, with the other linked family members added as **guests** (this is also what makes R4 work for them). Members who link Google later are not retro-added (accepted for v1). |
| R6 | **Only an event's owner can delete it.** Owner = the creator of a hub-created event, or the Google organizer of a Google-sourced event. Owner deletes → deleted everywhere (hub + Google). |
| R7 | **Anyone else who "deletes" it** gets an in-app message — *"Since you did not create this event, you cannot delete it. It has instead been hidden from your calendar."* — and the event is **hidden for them only** (everyone else still sees it) **and removed from their own Google calendar** (their copy only; the organizer's event is untouched). |
| R8 | Events a member **declines** in Google (or deletes from their own Google calendar) are hidden from that member in the hub. Accepting again un-hides. |
| R9 | Any member with their own login (owner / adult / child — not sitters) can link their own Google account. |
| R10 | **Members can be in different time zones.** Timed events are absolute instants shown in each viewer's own zone; all-day events are floating dates that read the same everywhere. |
| R11 | Sync freshness: Google webhooks + daily Vercel cron (Hobby tier) + a throttled refresh when the app is opened. |

## 2. Core model

**An event's viewers are exactly the members whose Google token can read it.**
The hub never inspects Google's sharing settings; it just records *which linked calendars the event was found on*.

* Event C (A shares with B): found via A's token and via B's token. Both copies carry the same `iCalUID`, so the hub keeps **one** `events` row with **two** viewer rows (A, B).
* Event D (A only): found only via A's token → one viewer row (A). B cannot see it.
* Whole-calendar shares work the same way if that calendar is enabled for sync in the member's settings.
* **Hub-created events:** `source = 'hub'`, visible to the **whole family** (including profile-only kids and members who never link Google) **except members who have hidden it** (R7/R8). A guest's returning copy is matched by `iCalUID` and never *restricts* visibility; it only records the link and carries decline/removal signals.
* **Hiding is per member** (`event_hides`). It applies to both kinds of event and overrides everything else in the read policy.

## 3. Constraints found in the current codebase

* `events` is written **directly from the browser** (`saveRow('events')`, `deleteRow('events')`, `EventForm.tsx`). RLS lets *any adult* insert/update/delete *any* event. That cannot stay: ownership (R6/R7) and Google-owned rows must be enforced in the database. → Move event writes to RPCs (§4.3).
* The README promises "this app needs no secret key". Sync needs a server that (a) holds Google refresh tokens and (b) writes events for members who aren't logged in. → Introduce a **server-only** Supabase secret key (`SUPABASE_SECRET_KEY`, never `NEXT_PUBLIC_`). README, `.env.example` and the security section must be updated honestly.
* **All-day events are currently stored as local midnight in whoever's browser saved them** (`localToTs(day,'00:00')`). With members in different zones that shifts the day for other viewers, and Google's all-day events are timezone-less dates anyway. → Store all-day events as dates (§4.1, §6).
* The form never sets `ends_at`, there is no timezone/location field, and no recurrence. Google needs an end, and Google calendars contain recurring events. See §6.
* Deployed on Vercel. **Hobby cron runs at most daily**, so webhooks do the real-time work, the cron is only a safety net, and opening the app triggers a throttled refresh (§4.5). Local dev can't receive Google webhooks without a tunnel → dev relies on the refresh-on-open path.
* The Supabase session lives in the browser. A plain redirect to our API doesn't carry it → OAuth start is an authenticated `fetch` that returns the Google URL (§4.2).
* Sitters are excluded from events by `is_family()` today; that must stay true for Google-sourced events (tested).

## 4. Design

### 4.1 Schema — migration `0008_google_calendar.sql`

```
members   (+ column)
  timezone          text      -- IANA name, refreshed from the browser on each app load (set_my_timezone RPC, validated vs pg_timezone_names)

events    (+ columns)
  source            text not null default 'hub'             -- 'hub' | 'google'
  created_member    uuid references members                 -- hub: creator (backfilled from created_by); google: null
  dedupe_key        text                                    -- iCalUID || '|' || instance original start (recurring); null for legacy rows
  organizer_email   text                                    -- Google organizer, for display / "organizer isn't a hub member"
  location          text not null default ''
  start_date        date                                    -- all_day only: floating date (same for every viewer)
  end_date          date                                    -- all_day only: INCLUSIVE last day (>= start_date)
  updated_at        timestamptz not null default now()
  starts_at         -- stays for timed events; for all-day rows it is derived (start_date at 00:00 UTC) so existing ordering/queries keep working
  unique (household_id, dedupe_key) where dedupe_key is not null

event_viewers                                               -- source='google' only: who can see it (R4)
  event_id, household_id, member_id        pk (event_id, member_id), composite FK like other tables

event_hides                                                 -- R7/R8: per-member hide, any source
  event_id, household_id, member_id, reason ('hidden'|'declined'|'removed_in_google'), created_at
  pk (event_id, member_id)

google_accounts                                             -- one per member
  member_id pk, household_id, google_sub, email, refresh_token_enc bytea, scopes,
  status ('active'|'needs_reauth'|'revoked'), connected_at, last_error

google_calendars                                            -- calendars enabled for sync
  id, member_id, google_calendar_id, summary, is_primary, enabled,
  sync_token, window_synced_at, locked_until,
  channel_id, channel_token, channel_resource_id, channel_expires_at

event_google_links                                          -- one hub event ↔ many Google copies
  event_id, member_id, google_calendar_id, google_event_id, etag,
  is_organizer, response_status, last_seen_at              pk (event_id, member_id)

google_outbox                                               -- hub→Google work queue
  id, household_id, event_id (nullable), op ('upsert'|'delete'|'remove_my_copy'),
  payload jsonb (what's needed when the row is already gone), attempts, run_after, last_error
```

* **Backfill:** `created_member` from `created_by`→`members`. Existing all-day rows get `start_date/end_date` from `starts_at` with a UTC-hour heuristic (local midnight is 00:00–12:00 UTC for the Americas → same date, and ≥12:00 UTC for Europe/Asia → next date); I'll sanity-check your real all-day events before applying it.
* **Security grants** (following the 0002 "state grants explicitly" convention): `google_accounts`, `google_calendars`, `event_google_links`, `google_outbox` have **no grants to `anon` or `authenticated`** — server (secret key) only. The client learns link state via a narrow RPC `my_google_status()` for *your own* member. `event_viewers`/`event_hides`: select limited to your own rows, no client writes.
* **Tokens** encrypted at rest with AES-256-GCM, key in `GOOGLE_TOKEN_ENC_KEY` (server env). Never logged.

### 4.2 Authorization and OAuth flow

* **Scopes:** `openid email`, `calendar.events`, `calendar.calendarlist.readonly`; offline access with `prompt=consent` so a refresh token is always issued.
* **Connect:** client calls `POST /api/google/connect` with its Supabase JWT → server verifies (`auth.getUser`), requires an active non-sitter member, returns the Google consent URL. `state` = HMAC-signed `{member_id, nonce, exp}`.
* **Callback:** `GET /api/google/callback` is hit by Google (no Supabase session); it trusts only the signed `state`, exchanges the code, stores the encrypted token, lists calendars (primary on by default), starts the first sync, redirects to the Family page.
* **Disconnect:** revoke the token at Google, stop watch channels, delete that member's account/calendar/link rows and viewer rows; delete Google-sourced events left with no viewers. Hub-created events and their copies **in Google are left alone** (stated in the confirm dialog).
* Every route derives the member from the verified JWT or signed state — **never from a client-supplied member/household id**.

### 4.3 Event writes move behind RPCs (DB-enforced)

Revoke direct `insert/update/delete` on `events` from `authenticated` and add SECURITY DEFINER RPCs that identify the caller via `auth.uid()`:

* `save_event(...)` — adults only (as today). **Create:** stamps `created_member`, `source='hub'`, accepts the browser's IANA `timezone` for the push. **Update:** hub-created → any adult (as today); Google-sourced → organizer only, otherwise rejected ("Read-only — this lives on someone else's Google Calendar").
* `delete_event(id)` returns `{result: 'deleted' | 'hidden'}`:
  1. **Caller is the owner** (hub: `created_member = caller`; Google: caller's link has `is_organizer`; legacy hub events with no active creator: any adult) → delete the row, enqueue Google `delete` via the organizer's token. `result='deleted'`.
  2. **Anyone else** → insert `event_hides(reason='hidden')` for the caller, enqueue `remove_my_copy` if they have a link, `result='hidden'`. The UI shows the R7 message.
  Hiding only touches the caller's own view, so any non-sitter family member may do it (not just adults).
* Pulls go through `service_role`-only functions (`apply_google_event`, `apply_google_removal`, …). They set a transaction-local flag (`hub.sync = on`) so the outbox trigger does **not** echo pulled changes back to Google.
* Trigger on `events` (hub-source rows, flag off) → enqueue `google_outbox`.
* **Read policy:** `events_select` = `is_family(household_id)` **and** no row in `event_hides` for `my_member_id(household_id)` **and** (`source = 'hub'` **or** a row in `event_viewers` for me).
* `EventForm.tsx` / `api.ts` move to the RPCs; the form shows read-only notes and a **Hide** (not Delete) action for non-owners, followed by the R7 message.

### 4.4 Push (hub → Google)

1. Outbox row is created by the trigger/RPC. The client also pings `POST /api/google/flush` after saving for low latency; a failed ping is harmless because webhook/cron/refresh-on-open drain the outbox too (never lost, never trusts the client).
2. **upsert:** `events.insert` on the creator's primary calendar with `attendees` = the other linked members' Google emails (R5), `extendedProperties.private.hubEventId`, `sendUpdates='all'`. Timed events use the creator's `timeZone`; all-day events use `date` (hub's inclusive `end_date` + 1 for Google's exclusive end). No `ends_at` → +1 hour. Store the link (`is_organizer=true`, etag). Later updates use `events.patch` with `If-Match`; on 412, re-pull then re-apply (newer of Google `updated` vs hub `updated_at` wins).
3. **delete:** `events.delete` with `sendUpdates='all'` through the organizer's token.
4. **remove_my_copy (R7):** `events.delete` on the *caller's own copy* (removes it from their calendar; the organizer sees them as gone/declined). Only if they have a link; no-op for unlinked members.
5. Creator hasn't linked Google → the event stays hub-only and the UI says so.
6. Retry with backoff; `401/invalid_grant` ⇒ account `needs_reauth`, surfaced in the UI.

### 4.5 Pull (Google → hub)

* Per enabled calendar: `events.list` with `singleEvents=true`, window = 1 month back → 12 months forward. First run is a full list (store `nextSyncToken`); afterwards incremental. `410 Gone` ⇒ full resync. A full resync of the window also runs weekly (sync tokens can't be combined with a moving window).
* Per item:
  * `cancelled` → drop this member's link and viewer row. For a **Google-sourced** event with no viewers left → delete the row. For a **hub-created** event on a **guest's** calendar → `event_hides(reason='removed_in_google')` for that guest; on the **organizer's** calendar → the organizer deleted it in Google → delete the hub row.
  * Otherwise compute `dedupe_key`. Existing → update fields (Google-sourced rows; for hub-created rows only organizer edits newer than the hub's `updated_at`). New → insert `source='google'`. Always upsert this member's link; add a viewer row for Google-sourced events only.
  * **`responseStatus = declined`** → `event_hides(reason='declined')` for that member (R8). Any other status removes a `declined`/`removed_in_google` hide (re-accepting un-hides) but **never** removes an explicit `hidden` hide from R7.
  * Private/confidential Google events are imported as-is for people who can already read them in Google.
* **Triggers (R11):** Google push → `POST /api/google/webhook` (validate `X-Goog-Channel-Token` against the stored per-channel secret, return 200 immediately, pull that calendar); daily Vercel cron renews watch channels expiring within 48 h, drains the outbox and re-pulls everything; and when the app opens or regains focus the client calls `POST /api/google/sync`, throttled server-side to once per ~60 s per member. Per-calendar `locked_until` prevents concurrent pulls.

## 5. UI changes

* **Family page → "Google Calendar" card** per person: Connect / status (email, last sync, error) / calendar checklist / Disconnect. Only you can connect your own account.
* **Calendar page:** Google badge on Google-sourced events; read-only styling with explanation; non-owners see **Hide** with the R7 message (a toast/dialog that also says if their Google copy was removed); location and end time fields in the event form; optional "mine / everyone" filter. Un-hiding a hidden event is **out of scope for v1** (and a removed Google copy can't be recreated automatically).
* **Health:** "Sync now", `needs_reauth` banner, last error.
* Browser timezone is reported silently on load (`set_my_timezone`).

## 6. Hard parts and how they're handled

| Topic | Plan |
|---|---|
| **Time zones (R10)** | Timed events are `timestamptz` instants; every viewer sees them in their own device zone (as the app already does), so "7 pm for A" is correctly a different clock time for B. Pushed to Google with the creator's current IANA zone (from `members.timezone` / the form). **All-day events are floating `date`s** (`start_date`/`end_date`) — same date for every viewer, no off-by-one when one member is traveling. Month view buckets timed events by the viewer's local day and all-day events by their stored date (multi-day all-day events appear on every day in range). |
| Missing end times | Hub event with no `ends_at`: pushed as +1 hour (timed) / single day (all-day). Pulled events keep Google's end. |
| Recurring Google events | Pulled as expanded instances (`singleEvents=true`), keyed by iCalUID + original start. Editing an instance in the hub changes that instance only (organizer only). The hub still can't create recurrences. |
| Attendee delivery | **Spike:** confirm a guest added with `sendUpdates='all'` gets the event on their calendar (needs-action) so their token pulls it, what `sendUpdates='none'` does, and that `events.delete` on a guest copy removes it cleanly. R4/R5/R7 all depend on this. |
| Echo loops | Broken by: transaction flag on pulls, `hubEventId` extended property, etag compare. Tested explicitly. |
| Concurrent edits | Last-writer-wins by timestamp, with etag guards on writes. |
| OAuth verification | `calendar.events` is a sensitive scope. Testing-mode tokens expire after 7 days, so publish the consent screen to **Production (unverified)**: "unverified app" warning, 100-user cap, long-lived tokens — fine for one family. Confirm against Google's current policy in Phase 0. |
| Quota / rate limits | Generous for a family; exponential backoff on 403 `rateLimitExceeded` / 429. |

## 7. Phases

**Phase 0 — Prerequisites & spike (½–1 day)**
* You: create the Google Cloud project, enable the Calendar API, configure the consent screen, create an OAuth web client (redirect URIs: production + `http://localhost:3000`), add the family as test users. I'll write exact click-by-click steps in the README.
* Me: throwaway script on real calendars verifying attendee behavior, `iCalUID` equality across copies, guest-copy deletion, sync tokens, watch channels, declined/private events.
* **Exit:** the §2 model and R7's "remove my copy" are confirmed.

**Phase 1 — Foundations (1.5–2 days)**
* Migration 0008 (tables, columns, all-day date migration + backfill, read policy, RPCs, outbox trigger, grants, realtime).
* Server plumbing: env validation, admin client, token crypto, JWT helper, `GoogleClient` interface (real + fake for tests), `set_my_timezone`.
* Move `EventForm`/`api.ts`/calendar page to RPCs and date-based all-day events; legacy events keep working.
* **Tests (pglite, same style as `tests/db.test.ts`):** scenarios C and D; sitter sees nothing; cross-household isolation; direct writes to events/tokens denied; non-owner delete ⇒ hidden for them only, still visible to others; owner delete ⇒ gone for all; guest can't edit Google-sourced event; service-only RPCs not callable by `authenticated`; all-day date identical across timezones.

**Phase 2 — Link / unlink (1 day)**
* `/api/google/connect`, `/callback`, disconnect, `my_google_status()`, Family-page card, calendar picker. Tests: state tampering/replay, sitter rejected.

**Phase 3 — Pull (1.5–2 days)**
* Mapper (Google item ↔ event row, including all-day dates and zones), full + incremental sync, `410` handling, dedupe/viewers, cancelled/declined handling, weekly resync. Fake-Google tests for C and D end-to-end, recurring instances, declined/un-declined, token expiry.

**Phase 4 — Push (1.5–2 days)**
* Outbox worker, guest list from linked members, create/update/delete/remove-my-copy, etag conflicts, retries, no-echo test, full delete matrix (owner / non-owner / Google organizer / Google guest).

**Phase 5 — Real time & resilience (1 day)**
* Webhook endpoint, watch-channel create/renew/stop, daily cron (`vercel.json`), throttled sync-on-open, locks, `needs_reauth` handling.

**Phase 6 — UI polish, docs, rollout (1 day)**
* Badges, read-only/Hide UX and message, Sync-now/health, README section (setup, the honest "secret key now exists" security note, limitations), `.env.example`. Feature flag `NEXT_PUBLIC_GOOGLE_SYNC=on` keeps the UI hidden until configured. Roll out to Alex first, then the family.

Total ≈ 9–11 working days with tests. Phases 1–2 are shippable on their own.

## 8. Risks

* **Secret key in the app** is a real change to the security posture → isolate in a few route handlers, never import from client code (test), encrypt tokens, revoke table access from client roles.
* **Consent-screen limbo** (7-day token expiry) if left in Testing → publish to Production early.
* **Guest-copy semantics** may differ from assumption → caught in Phase 0.
* **All-day/timezone migration** can mis-date legacy events → heuristic backfill, reviewed against real data before applying.
* **Hosting limits** (daily cron, function timeouts) → webhook-driven, sync-on-open, chunked initial syncs.

## 9. Decisions log

| Question | Decision |
|---|---|
| Non-creator deletes a hub-created event | Can't delete. Shown message; hidden for them only; their own Google copy removed. |
| Members who link Google after an event exists | Not added retroactively (v1). |
| Time zones | Per-member; instants in viewer's zone, all-day as floating dates. |
| Declined events | Hidden from that member in the hub. |
| Cron | Vercel Hobby daily + webhooks + sync-on-open. |

## 10. Remaining assumptions to confirm (cheap to change)

1. R7's "remove from their Google calendar" also applies when a guest hides a **Google-sourced** event they were only invited to (same rule, applied uniformly). Say so if you'd rather leave their Google copy alone in that case.
2. Any **adult** can still edit a hub-created event (as today); only deletion is owner-restricted.
3. Any non-sitter family member (including children) may **hide** an event from their own view, even though only adults create events.
4. No "un-hide" in v1.
