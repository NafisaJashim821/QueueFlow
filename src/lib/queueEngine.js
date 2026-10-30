// Pure queue forecasting logic — no React, no Supabase. Unit-tested in queueEngine.test.js.
//
// The *priority* of each ticket (`priority_deadline`) is computed by Postgres
// (public.ticket_deadline) and shipped in the snapshot, so the order shown here
// is exactly the order public.call_next() will use. This module only simulates
// the future to estimate when each person will be called.

const MIN = 60_000;

const ACTIVE = new Set(['waiting', 'serving', 'booked']);

const ts = (v) => (v ? new Date(v).getTime() : null);

/** Comparator identical to the ORDER BY in public.call_next(). */
export function comparePriority(a, b) {
  return (
    a.deadlineMs - b.deadlineMs ||
    (a.arrivalMs ?? Infinity) - (b.arrivalMs ?? Infinity) ||
    a.ticket.token_number - b.ticket.token_number
  );
}

/** Classifies why a ticket sits where it does — shown to staff and customers. */
export function priorityReason(ticket, settings, nowMs) {
  const scheduled = ts(ticket.scheduled_at);
  const arrived = ts(ticket.checked_in_at);
  const deadline = ts(ticket.priority_deadline);
  if (ticket.booking_type === 'appointment') {
    const graceMs = settings.appointment_grace_minutes * MIN;
    if (arrived && arrived > scheduled + graceMs) return { kind: 'late_appointment', label: 'Arrived late — queued as walk-in' };
    if (!arrived) return { kind: 'booked', label: 'Appointment (not arrived)' };
    if (arrived < scheduled && nowMs < scheduled) return { kind: 'early_appointment', label: 'Early for appointment' };
    return { kind: 'appointment', label: 'Appointment slot' };
  }
  if (deadline <= nowMs) return { kind: 'overdue_walkin', label: 'Waited past target — priority' };
  return { kind: 'walkin', label: 'Walk-in, first come first served' };
}

/**
 * Estimates average service minutes on the client from a snapshot. Normally
 * the server value (`avg_service_minutes`) is used; this is the fallback.
 */
export function serviceMinutes(snapshot) {
  const v = Number(snapshot?.avg_service_minutes);
  if (Number.isFinite(v) && v > 0) return v;
  return Number(snapshot?.settings?.default_service_minutes) || 15;
}

/**
 * Simulates the queue forward in time.
 *
 * Model (see docs/DESIGN.md):
 *  - `servers` = number of staffed counters (at least the number currently serving).
 *  - Every service takes the rolling-average duration `avg` minutes.
 *  - A counter that is serving someone becomes free at max(now, called_at + avg).
 *  - Present customers (status waiting) are available immediately.
 *  - Booked appointments not yet arrived are assumed to arrive at their slot,
 *    so they reserve capacity and walk-in estimates stay honest; once they are
 *    more than the grace period late they are dropped from the forecast.
 *  - Whenever a counter frees up, the available ticket with the earliest
 *    priority deadline is taken (same rule as the database).
 *
 * @returns {{ entries: Array, byId: Map, avg: number, servers: number }}
 *   entries: forecast for every waiting/booked ticket in projected call order.
 *   Each entry: { ticket, position (waiting only, 1-based, else null), startMs,
 *   waitMinutes, lateByMinutes (appointments projected past their slot), reason }
 */
export function forecastQueue(snapshot, nowMs, extraTickets = []) {
  const settings = snapshot.settings;
  const avg = serviceMinutes(snapshot);
  const avgMs = avg * MIN;
  const graceMs = settings.appointment_grace_minutes * MIN;
  const tickets = [...(snapshot.tickets || []), ...extraTickets];

  const serving = tickets.filter((t) => t.status === 'serving');
  const servers = Math.max(1, settings.active_counters || 1, serving.length);

  const free = serving
    .map((t) => Math.max(nowMs, (ts(t.called_at) ?? nowMs) + avgMs))
    .sort((a, b) => a - b);
  while (free.length < servers) free.unshift(nowMs);
  free.sort((a, b) => a - b);

  const pending = [];
  for (const t of tickets) {
    if (t.status === 'waiting') {
      pending.push({ ticket: t, availableMs: nowMs, deadlineMs: ts(t.priority_deadline), arrivalMs: ts(t.checked_in_at) });
    } else if (t.status === 'booked' && t.booking_type === 'appointment') {
      const slot = ts(t.scheduled_at);
      if (slot + graceMs > nowMs) {
        pending.push({ ticket: t, availableMs: Math.max(nowMs, slot), deadlineMs: slot, arrivalMs: Math.max(nowMs, slot) });
      }
    }
  }

  const entries = [];
  let position = 0;
  while (pending.length) {
    let t = free[0];
    let candidates = pending.filter((p) => p.availableMs <= t);
    if (!candidates.length) {
      t = Math.min(...pending.map((p) => p.availableMs));
      candidates = pending.filter((p) => p.availableMs <= t);
    }
    candidates.sort(comparePriority);
    const pick = candidates[0];
    pending.splice(pending.indexOf(pick), 1);
    free[0] = t + avgMs;
    free.sort((a, b) => a - b);

    const isWaiting = pick.ticket.status === 'waiting';
    const slot = ts(pick.ticket.scheduled_at);
    const reason = priorityReason(pick.ticket, settings, nowMs);
    const honoursSlot = pick.ticket.booking_type === 'appointment' && reason.kind !== 'late_appointment';
    entries.push({
      ticket: pick.ticket,
      position: isWaiting ? ++position : null,
      startMs: t,
      waitMinutes: Math.max(0, Math.round((t - nowMs) / MIN)),
      lateByMinutes: honoursSlot && t > slot + graceMs ? Math.round((t - slot) / MIN) : 0,
      reason,
    });
  }

  return { entries, byId: new Map(entries.map((e) => [e.ticket.id, e])), avg, servers };
}

/** What a brand-new walk-in arriving now would wait — used for the staff "quote". */
export function quoteNewWalkIn(snapshot, nowMs) {
  const ghost = {
    id: '__quote__',
    token_number: Number.MAX_SAFE_INTEGER,
    booking_type: 'walk_in',
    status: 'waiting',
    checked_in_at: new Date(nowMs).toISOString(),
    priority_deadline: new Date(nowMs + snapshot.settings.walkin_target_minutes * MIN).toISOString(),
  };
  return forecastQueue(snapshot, nowMs, [ghost]).byId.get('__quote__')?.waitMinutes ?? 0;
}

/** Splits a snapshot into the groups the UI shows. */
export function groupTickets(snapshot) {
  const out = { waiting: [], serving: [], booked: [], done: [] };
  for (const t of snapshot?.tickets || []) {
    if (t.status === 'waiting') out.waiting.push(t);
    else if (t.status === 'serving') out.serving.push(t);
    else if (t.status === 'booked') out.booked.push(t);
    else if (!ACTIVE.has(t.status)) out.done.push(t);
  }
  out.serving.sort((a, b) => (a.counter ?? 0) - (b.counter ?? 0));
  out.booked.sort((a, b) => ts(a.scheduled_at) - ts(b.scheduled_at));
  out.done.sort((a, b) => ts(b.completed_at) - ts(a.completed_at));
  return out;
}

export function normaliseToken(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = raw.match(/^([AW])0*(\d{1,4})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(3, '0')}`;
}

export function formatWait(minutes) {
  if (minutes <= 0) return 'Now';
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `~${h} h${m ? ` ${m} min` : ''}`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
