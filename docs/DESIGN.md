# QueueFlow: design decisions, assumptions and queue logic

## 1. The problem and the conflict

The brief asks for two things that can't always both hold:

1. **Fairness:** customers are served *in order*, first come, first served.
2. **Punctuality:** appointments are served *at their scheduled time*.

Here's an example. Five walk-ins are waiting when a 14:00 appointment arrives on time:
- Strict arrival order makes the appointment wait behind all five, so the booking means nothing.
- Strict appointment priority lets it jump ahead. On a busy day, walk-ins could then be pushed back again and again with no limit.

There is also no service-duration data, so every waiting-time estimate is a model.

Rather than pick one side, I made the trade-off **explicit, bounded and adjustable**.

## 2. Assumptions (stated, because the brief leaves them open)

| # | Assumption | Why |
|---|---|---|
| A1 | One shared queue is served by *N* interchangeable counters (chairs or rooms). There is no per-staff specialisation. | Simplest model that fits both a clinic and a salon. *N* is a setting. |
| A2 | All services take about the same time, and we learn that time from real data. | No service-type durations were provided. |
| A3 | An appointment is only callable once it has **checked in**, meaning the person is physically present. | You can't call someone who isn't there. |
| A4 | An appointment that checks in within a **grace period** (default 10 min) after its slot keeps its slot priority. Later than that, it joins as a walk-in from its check-in time. | Common clinic and salon policy. It stops one late customer from disrupting everyone. |
| A5 | Walk-ins have an implicit **target wait** (default 30 min). This is the promise to a walk-in, in the same way a slot is the promise to an appointment. | Gives walk-ins a guarantee that appointments can't override indefinitely. |
| A6 | An early appointment may be served early if nobody with an earlier promise is waiting. A counter never sits idle while someone is present. | Idle staff help nobody. |
| A7 | Staff can override the order (for example for an urgent medical case). Overrides are recorded (`called_out_of_order`). | Real clinics need this. Recording overrides keeps fairness auditable. |
| A8 | Tokens reset daily per business time zone (`W-001`, `A-002`). The letter shows the booking type and the number shows the order of issue. | Short and readable on a TV across the room. |
| A9 | The staff device's local time zone equals the business time zone when entering appointment times. Display always uses the business time zone. | Avoids a time-zone picker on every booking. |
| A10 | Customers identify themselves by token only. Names are never shown publicly. | The brief: no customer login, and privacy. |

## 3. Queue-handling logic: earliest promise first

Every present customer carries a **promised time** (`priority_deadline`), computed in one place, `public.ticket_deadline()` in Postgres:

```
appointment that checked in by slot + grace   →  promise = scheduled slot time
walk-in, or appointment that arrived too late →  promise = arrival time + walk-in target (30 min)
```

**"Call next" picks the waiting customer with the earliest promise.** Ties go to whoever arrived first, then to the lower token number. This is *earliest-deadline-first* scheduling: when every promise can be kept, it keeps them all, and when they can't, it spreads the delay instead of hitting one group.

How this resolves the conflict:

- **Walk-ins are strictly FIFO among themselves.** Every walk-in gets the same +30 offset, so promise order equals arrival order. A later walk-in can never overtake an earlier one.
- **Appointments are honoured on time.** A 14:00 appointment beats any walk-in who arrived after 13:30, because their promise is later than 14:00.
- **Walk-ins can't be pushed back without limit.** A walk-in who arrived at 13:25 has a 13:55 promise and is served *before* the 14:00 appointment. An appointment can therefore overtake a walk-in by at most about 30 minutes of waiting.
- **One setting tunes the trade-off.** The "walk-in target" setting:
  - `0` gives pure arrival-order fairness, with an appointment treated as arriving at its slot
  - a large value gives strict appointment priority
  - the default of 30 sits in between
  
  The business can turn this dial without any code change.

**What the business gives up:** on very busy days an appointment can run late. The staff table flags this ("running ~X min behind slot"), and the customer's page says so with an apology, rather than hiding it.

**Implementation:**
- The rule is applied inside `call_next()` with `ORDER BY ticket_deadline(...) … FOR UPDATE SKIP LOCKED`, which is atomic across devices.
- The snapshot ships each ticket's `priority_deadline`, so the UI shows exactly the order the database will use. There aren't two copies of the rule that could drift apart.
- Other lifecycle steps are separate RPCs:
  - `check_in_ticket`
  - `call_ticket` (the override)
  - `complete_ticket`
  - `close_ticket` (no-show or cancel)
  - `return_to_queue` (undo a mistaken call)

## 4. Waiting-time calculation

**Average service duration (in `get_queue_snapshot`)**
- Take the last 20 completed services (up to 7 days old). Each duration is `completed_at − called_at`.
- Drop durations under 1 min (mis-clicks) or over 3 h (forgotten tickets).
- Smooth toward the configured default with a prior of 3 virtual samples:

  `avg = (default × 3 + Σ durations) / (3 + n)`

  At opening time, with no data, this equals the default (15 min). As real services complete, it converges to the observed reality without swinging after one unusually long haircut.

**Forecast (in `src/lib/queueEngine.js`, a pure, unit-tested function).** The engine is a small discrete-event simulation:

1. There are `N = max(open counters, currently serving)` counters. A busy counter frees at `max(now, called_at + avg)`, so an overrunning service is never predicted to have finished in the past.
2. Present customers are available now. **Booked appointments not yet checked in are assumed to arrive at their slot.** They reserve capacity, so walk-in quotes aren't over-optimistic. An appointment more than the grace period late is dropped from the forecast.
3. Repeat until everyone is placed:
   - take the earliest-free counter
   - from the customers available at that moment, assign the one with the earliest promise (the same rule as the database)
   - that counter is next free at `t + avg`

Each customer's **estimated wait** is `start time − now`, shown as "~12 min (≈ 14:40)". Their **position** is their rank among present customers. Staff also see a **quote for a new walk-in**: the wait a person arriving right now would get, which helps reception set expectations.

Estimates count down locally every 10–15 s and recalculate on every change from any device. All of this uses server time (the snapshot's `server_time`), so a wrong device clock doesn't matter.

**Known limitations:**
- one average for all service types
- assumes appointments arrive on time
- no model of no-show probability

Each of these would be an easy extension once real data exists.

## 5. Other decisions and trade-offs

- **Supabase as the single source of truth, with a "signal then re-fetch" model.** Realtime pushes only a version bump. Every client then fetches a fresh snapshot, so names never go over a public realtime channel and clients can't drift out of sync. The cost is one small fetch per change, which is negligible at clinic scale.
- **Writes only through RPCs.** Tables reject direct writes from any browser role. This centralises validation, makes multi-device actions atomic, and makes RLS easy to reason about.
- **A staff allow-list instead of "any signed-in user".** This protects against a misconfigured sign-up setting.
- **Polling fallback on top of realtime.** Polling runs every 5 s while realtime is degraded and every 30 s while live, so a dropped websocket can't leave a screen silently stale.
- **No customer accounts.** The brief says a public status view is sufficient, and token codes are enough to look someone up without exposing identity.
- **Out of scope** (within the 3.5 h budget): SMS notifications, per-service durations, multi-branch support, and booking appointments for future days in a calendar UI. The schema already supports future-day bookings; the UI shows today.
