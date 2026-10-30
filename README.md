# QueueFlow: token queue for clinics and salons

QueueFlow is a live, token-based queue for **walk-ins and scheduled appointments**.
- **Staff** sign in and use it to issue tokens, see the queue in call order, call the next customer and mark services complete.
- **Customers** open a public board, or their own token page, to see their position and estimated wait. They don't need to log in, and the public view never shows a name.

**Stack:** React 18 + Vite 5 · Supabase (Postgres, Auth, Realtime) · deployed on Vercel.

| Page | URL | Who |
|---|---|---|
| Public queue board | `/` | Waiting-room TV, anyone |
| My token status | `/t/W-012` | Customer's phone (no login) |
| Staff sign-in | `/staff/login` | Staff |
| Staff dashboard | `/staff` | Staff (must be on the `staff` allow-list) |

The design reasoning (assumptions, queue priority rule, waiting-time model and trade-offs) is in **[docs/DESIGN.md](docs/DESIGN.md)**. Testing is in **[docs/TESTING.md](docs/TESTING.md)**, and the AI usage log is in **[docs/AI_USAGE_LOG.md](docs/AI_USAGE_LOG.md)**.

---

## Architecture: Supabase is the single source of truth

```
 Staff dashboard (any device) ──rpc(call_next / add_ticket / …)──▶ Postgres functions (SECURITY DEFINER, staff-checked)
                                                                    │  writes tickets
                                                                    ▼
                                         trigger bumps queue_signal.version (one row, no personal data)
                                                                    │  Supabase Realtime (postgres_changes)
          ┌──────────────────────────────┬──────────────────────────┴─────────────┐
          ▼                              ▼                                        ▼
  every staff dashboard          public board  /                         token page /t/:token
          └──────── each re-fetches rpc(get_queue_snapshot) — names included only for staff ────────┘
```

- **The browser never holds queue state of its own.** Every screen shows the latest `get_queue_snapshot()` result. After a mutation the screen fetches again; it never patches its local copy.
- **Sync that survives dropped connections.** A screen fetches the snapshot again when:
  - a realtime signal arrives
  - the realtime channel (re)subscribes, which catches changes missed while offline
  - the tab becomes visible again
  - the browser comes back online
  - a poll timer fires: every 30 s while live, every 5 s while realtime is down
  
  A badge shows *Live / Reconnecting / Offline*.
- **Calling is atomic.** `call_next()` selects the next customer with `FOR UPDATE SKIP LOCKED`, so two staff pressing "Call next" at the same moment get two different customers. Token numbers are allocated under an advisory lock.
- **Estimates use server time.** Each snapshot carries `server_time`, so a wrong device clock can't distort waits.
- The only thing kept in `localStorage` is **which counter this screen is**, a per-device preference. No queue data is stored there.

### Security

- Only the **anon / publishable key** reaches the browser. The service-role (secret) key is never used by the app and must never be added to Vercel or the repo.
- RLS is enabled on every table. The `anon` and `authenticated` roles have **no insert/update/delete privileges** on any table. All writes go through functions that call `is_staff()`.
- `anon` has no access at all to the `tickets` table. Public screens get data only through `get_queue_snapshot()`, which removes `customer_name`, `notes` and `created_by` for anyone who is not staff.
- **Staff means "on the `public.staff` allow-list"**, not merely "signed in". An accidental sign-up therefore grants nothing. Also disable public sign-ups (step 3 below).
- The realtime channel carries only a version counter, so it can't leak personal data.

---

## Setup

### 1. Create the Supabase project
1. Create a free project at <https://supabase.com>. A region close to your users is best.
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It is safe to run again.
3. Check that Realtime is on for the signal table: **Database → Publications → `supabase_realtime`** should list `queue_signal`. The script adds it; if your project has no `supabase_realtime` publication, toggle Realtime on for `queue_signal` under **Table Editor → queue_signal**.

### 2. Create a staff account
1. **Authentication → Users → Add user → Create new user**: enter an email and password, and tick **Auto Confirm User**.
2. Edit the email in [`supabase/add_staff.sql`](supabase/add_staff.sql) and run it in the SQL Editor.
3. Repeat for each staff member.

### 3. Lock down sign-ups (recommended)
**Authentication → Sign In / Providers → Email:** turn off **Allow new users to sign up**. Staff accounts are then created only by an admin, as in step 2.

### 4. Run locally
```bash
cp .env.example .env.local      # then fill in the two values
npm install
npm run dev                     # http://localhost:5173
```
Find both values under **Project Settings → API / API Keys**:
- `VITE_SUPABASE_URL`: the project URL
- `VITE_SUPABASE_ANON_KEY`: the **anon** (legacy) or **publishable** (`sb_publishable_…`) key

Sign in at `/staff/login`, open **Settings & demo data → Load demo data**, then open `/` in another window to see live sync.

### 5. Deploy to Vercel
1. Push the repo to GitHub:
   ```bash
   git init && git add . && git commit -m "QueueFlow"
   gh repo create queueflow --public --source . --push   # or create the repo on github.com and push
   ```
2. At <https://vercel.com/new>, import the repo. Vercel detects **Vite**: the build command is `npm run build` and the output directory is `dist`. [`vercel.json`](vercel.json) also sets these, plus the SPA rewrite so `/staff` and `/t/W-012` work on refresh.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for **Production, Preview and Development**. Then click **Deploy**.
   - `VITE_` variables are baked in at build time. After changing them, **redeploy**.
4. In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to your Vercel URL, for example `https://queueflow-xyz.vercel.app`.
5. Smoke test production:
   - open `/` on your phone and `/staff` on a laptop
   - call the next customer
   - check that the phone updates within about a second

CLI alternative:
```bash
npx vercel
npx vercel env add VITE_SUPABASE_URL
npx vercel env add VITE_SUPABASE_ANON_KEY
npx vercel --prod
```

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build to `dist/` |
| `npm test` | Unit tests for the queue engine, plus page render tests (jsdom) |
| `npm run test:sql` | Runs `schema.sql` in PGlite (real Postgres in WASM) and tests RLS, privacy and queue order |
| `npm run test:all` | Both suites |

## Project layout

```
supabase/schema.sql          tables, RLS, priority rule, RPCs, realtime signal, demo seed
supabase/add_staff.sql       grant staff access to an auth user
supabase/tests/              database tests (PGlite) + Supabase stubs
src/lib/queueEngine.js       pure forecasting (positions, waits)
src/hooks/useQueueSnapshot   realtime + polling + reconnect sync with Supabase
src/hooks/useAuth.jsx        Supabase Auth session + staff check
src/pages/                   PublicBoard, TokenStatus, StaffLogin, StaffDashboard
src/components/staff/        counter panel, add form, queue tables, settings
docs/                        design notes, testing, AI usage log
```

## Sample data
"Load demo data" fills today's queue with **fictional** names, such as "Juniper Okafor" and "Bastian Rook", timed relative to now. No real customer data is used.
