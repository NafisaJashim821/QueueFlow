# AI usage log: Task 6 (QueueFlow)

**Tool:** Claude Code (Claude Opus 5.5) in the VS Code extension, working directly in the project folder.
**Developer role:** set the requirements, reviewed the analysis and the code, made the final decisions, and set up Supabase, GitHub and Vercel.

> The prompts below are the ones actually used. Add any later prompts you use for debugging or deployment fixes in the same format.

## Prompt 1: understanding the brief

> "understand the task first" *(with the full Task 6 brief pasted)*

**AI output:**
- A breakdown of what is graded.
- Identified the core conflict (FIFO fairness against appointment punctuality) and that no service-duration data was given.
- Proposed an appointment-window rule with a starvation guard, a rolling-average wait estimate, and staff and public screens.
- Asked about storage (localStorage or a hosted database), branding and the docs format.

**Accepted or changed:**
- Accepted the analysis.
- **Changed the storage decision:** I rejected the localStorage option and required Supabase as the single source of truth with global realtime sync (see Prompt 2).

## Prompt 2: build the application

> "Build a complete, responsive Queue Management App for assessment using React, Vite, Supabase, and Vercel. Features: walk-ins and appointments; staff login, add customers, view the queue, call next, mark complete; public token/position/estimated wait without login; clearly handle appointment priority versus FIFO fairness. Critical: Supabase must be the single source of truth … Supabase Realtime or reliable subscriptions/refetching, with loading and error handling. Provide complete code, SQL schema and RLS policies, .env.example, setup and Vercel steps. Never expose service-role keys or customer names publicly. Document assumptions, queue logic, waiting-time calculation, and testing."

**What the AI produced:**
- `supabase/schema.sql`:
  - tables
  - RLS with no direct writes from the browser
  - SECURITY DEFINER RPCs checked against a staff allow-list
  - the priority rule `ticket_deadline()`
  - an atomic `call_next()` using `FOR UPDATE SKIP LOCKED`
  - the realtime signal table and its triggers
  - a fictional demo seed
- The React app:
  - public board
  - token page
  - staff login
  - dashboard
- `useQueueSnapshot`: realtime with polling, reconnect handling and a server-clock offset.
- A pure forecasting engine.
- Docs, tests and Vercel config.

**Design decisions made during this step, and why:**
- **Replaced the "appointment window + starvation guard" idea with earliest-deadline-first** (a walk-in's promise is arrival + target; an appointment's promise is its slot). It expresses the trade-off as one adjustable setting, keeps walk-ins strictly FIFO, and is simple to simulate for wait estimates.
- **"Signal then re-fetch" realtime instead of streaming ticket rows.** Anonymous viewers can't be sent names over realtime, and a re-fetch is always consistent.
- **Priority computed only in Postgres and shipped as `priority_deadline`**, so the UI order can't drift from what `call_next()` does.

**Issues found and fixed during AI-assisted development:**

| Issue | How it was found | Fix |
|---|---|---|
| Docker daemon not running, so the SQL couldn't be tested in a container | Command failed | Switched to **PGlite** (real Postgres in WASM) and turned the checks into `npm run test:sql` |
| `create extension pgcrypto` isn't needed (`gen_random_uuid` is built into PG13+) | PGlite run | Removed |
| The public explanation said a walk-in at the target wait is "never pushed back again", which is inaccurate under EDF | Reviewing the wording against the algorithm | Rewrote it as the "promised time" explanation |
| The settings form would reset while a user typed, because every snapshot re-fetch creates a new object | Code review | Re-sync keyed on the serialised values |
| `vercel.json` rewrite contained an invalid JSON escape (`\.`) | Reading the generated file | Simplified to a catch-all rewrite (Vercel serves real files first) |
| `supabase-js@2.45` predates the new `sb_publishable_…` keys | Checking the Supabase key format | Upgraded to `2.117.3` (released over 3 weeks earlier). Rebuilt and retested. |

**How the behaviour was tested:** see [TESTING.md](TESTING.md).
- 18 engine unit tests.
- 6 page render tests using real snapshots exported from the database.
- 12 database tests: RLS, privacy, call order, lifecycle and validation.
- A manual multi-device checklist for the deployed app.

## Prompts 3+ (fill in as you go)

| Prompt | Purpose | Accepted / changed | Verified by |
|---|---|---|---|
| | e.g. deployment error on Vercel | | |
| | e.g. UI tweak after testing on a phone | | |
