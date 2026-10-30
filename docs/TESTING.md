# Testing

## Automated (run `npm run test:all`)

| Suite | File | What it proves |
|---|---|---|
| Queue engine (18 tests) | `src/lib/queueEngine.test.js` | Walk-in FIFO; on-time appointment priority; overdue walk-in beats appointment; late appointment is treated as walk-in; early appointment served when counter idle; target 0 = pure arrival order; wait = position × avg; remaining time of current service; overrun never predicts the past; multi-counter spread; booked appointments reserve capacity; missed bookings dropped; "running late" flag; new walk-in quote; token parsing |
| Page rendering (6 tests) | `src/test/pages.test.jsx` | Every page renders from **real snapshots exported from the Postgres schema**; public board/token pages contain **no customer names**; unknown token handled; serving token shows counter; `/staff` redirects to login when signed out; dashboard shows names and "Call next" calls the `call_next` RPC |
| Database (12 tests) | `supabase/tests/schema.test.mjs` | Runs `schema.sql` (twice — idempotent) in PGlite, a real Postgres. Anon cannot read/write `tickets` or call staff RPCs; public snapshot strips names/notes; signed-in non-staff get nothing; staff can't bypass RPCs with direct `UPDATE`; `call_next` order is W-008 → A-010 → W-009 → W-011 for the demo seed (EDF) and auto-completes the counter's current customer; every change bumps the realtime signal; token numbering; input validation; full lifecycle (check-in, override, undo, no-show); late appointment ranked as walk-in |

Results at time of writing: **24/24 frontend tests and 12/12 database tests pass; `npm run build` succeeds.**

## Manual checklist on the deployed app (real Supabase + Vercel)

Run with two or three devices (e.g. laptop = staff counter 1, second browser/incognito = staff counter 2, phone = public board).

| # | Step | Expected |
|---|---|---|
| 1 | Open `/` on the phone before signing in anywhere | Board loads, badge says **Live** |
| 2 | Sign in at `/staff/login` with a staff account | Dashboard loads with names |
| 3 | Sign in with an account **not** in `staff` | "Not a staff account" screen |
| 4 | Settings → Load demo data | Phone board updates within ~1 s, no names visible |
| 5 | Add a walk-in on device A | Appears on device B and phone immediately with token and estimate |
| 6 | Press **Call next** on A and B at the same moment | Two *different* customers are called |
| 7 | Open `/t/<token>` of the 2nd person on the phone; call next on staff | Phone changes to "You're next", then "Please go to Counter N" |
| 8 | Add appointment "not here", slot in 5 min; then Check in | Shows in Upcoming → moves into queue at slot priority |
| 9 | Complete several services | "Avg service" moves from default toward real times; estimates update |
| 10 | Turn phone Wi-Fi off 30 s, make changes, turn on | Badge Offline → Reconnecting → Live; board catches up without reload |
| 11 | Refresh `/staff` and `/t/W-001` on Vercel | No 404 (SPA rewrite works) |
| 12 | DevTools → Network on public page | Responses contain no `customer_name`; only the anon/publishable key is sent |
| 13 | Resize to phone width on dashboard | Tables become cards; Call next button stays at top |

Record pass/fail and screenshots of steps 6, 7 and 10 for the submission.
