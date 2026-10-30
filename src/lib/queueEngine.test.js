import { describe, expect, it } from 'vitest';
import { forecastQueue, normaliseToken, quoteNewWalkIn, formatWait, ordinal } from './queueEngine.js';

const MIN = 60_000;
const NOW = Date.parse('2026-10-30T08:00:00Z');
const at = (m) => new Date(NOW + m * MIN).toISOString();

const SETTINGS = {
  active_counters: 1,
  default_service_minutes: 15,
  walkin_target_minutes: 30,
  appointment_grace_minutes: 10,
};

// Test-only mirror of public.ticket_deadline() so fixtures look like real snapshots.
function deadline(t, s) {
  if (t.booking_type === 'appointment') {
    const slot = Date.parse(t.scheduled_at);
    if (!t.checked_in_at || Date.parse(t.checked_in_at) <= slot + s.appointment_grace_minutes * MIN) return t.scheduled_at;
  }
  return new Date(Date.parse(t.checked_in_at) + s.walkin_target_minutes * MIN).toISOString();
}

let n = 0;
function walkIn(arrivedMin, extra = {}) {
  n += 1;
  return { id: `w${n}`, token: `W-${n}`, token_number: n, booking_type: 'walk_in', status: 'waiting', checked_in_at: at(arrivedMin), ...extra };
}
function appt(slotMin, arrivedMin, extra = {}) {
  n += 1;
  return {
    id: `a${n}`, token: `A-${n}`, token_number: n, booking_type: 'appointment',
    status: arrivedMin == null ? 'booked' : 'waiting',
    scheduled_at: at(slotMin), checked_in_at: arrivedMin == null ? null : at(arrivedMin), ...extra,
  };
}
function snap(tickets, settings = {}, avg = 15) {
  const s = { ...SETTINGS, ...settings };
  return { settings: s, avg_service_minutes: avg, tickets: tickets.map((t) => ({ ...t, priority_deadline: deadline(t, s) })) };
}
const order = (f) => f.entries.map((e) => e.ticket.token);

describe('forecastQueue — ordering', () => {
  it('serves walk-ins strictly first-come-first-served', () => {
    const a = walkIn(-5), b = walkIn(-20), c = walkIn(-10);
    expect(order(forecastQueue(snap([a, b, c]), NOW))).toEqual([b.token, c.token, a.token]);
  });

  it('gives an on-time appointment its slot ahead of recently arrived walk-ins', () => {
    const w1 = walkIn(-10); // promise = +20
    const w2 = walkIn(-2);  // promise = +28
    const ap = appt(0, -5); // promise = slot = now
    expect(order(forecastQueue(snap([w1, w2, ap]), NOW))).toEqual([ap.token, w1.token, w2.token]);
  });

  it('does not let an appointment push back a walk-in who has waited past the target', () => {
    const longWait = walkIn(-40); // promise = -10, already overdue
    const ap = appt(0, -5);
    expect(order(forecastQueue(snap([ap, longWait]), NOW))).toEqual([longWait.token, ap.token]);
  });

  it('treats an appointment that arrives after the grace period as a walk-in', () => {
    const w = walkIn(-6);                     // promise = +24
    const late = appt(-30, -1);               // 29 min late > 10 grace → promise = -1 + 30 = +29
    const f = forecastQueue(snap([late, w]), NOW);
    expect(order(f)).toEqual([w.token, late.token]);
    expect(f.byId.get(late.id).reason.kind).toBe('late_appointment');
  });

  it('serves an early appointment early when nobody else is waiting (no idle counter)', () => {
    const ap = appt(60, -5);
    const f = forecastQueue(snap([ap]), NOW);
    expect(f.entries[0].waitMinutes).toBe(0);
  });

  it('does not serve an early appointment ahead of walk-ins whose promise is sooner', () => {
    const w = walkIn(0);    // promise +30
    const ap = appt(60, 0); // promise +60
    expect(order(forecastQueue(snap([ap, w]), NOW))).toEqual([w.token, ap.token]);
  });

  it('walk-in target 0 reduces to pure arrival order (appointment counts as arriving at its slot)', () => {
    const w = walkIn(-5);
    const ap = appt(0, -20);
    expect(order(forecastQueue(snap([ap, w], { walkin_target_minutes: 0 }), NOW))).toEqual([w.token, ap.token]);
  });
});

describe('forecastQueue — waiting time', () => {
  it('multiplies position by average service time on one counter', () => {
    const f = forecastQueue(snap([walkIn(-3), walkIn(-2), walkIn(-1)]), NOW);
    expect(f.entries.map((e) => e.waitMinutes)).toEqual([0, 15, 30]);
    expect(f.entries.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it('accounts for the remaining time of the customer currently being served', () => {
    const serving = walkIn(-30, { status: 'serving', called_at: at(-5) });
    const f = forecastQueue(snap([serving, walkIn(-3)]), NOW);
    expect(f.entries[0].waitMinutes).toBe(10);
  });

  it('never predicts a counter frees in the past when service overruns', () => {
    const serving = walkIn(-60, { status: 'serving', called_at: at(-40) });
    const f = forecastQueue(snap([serving, walkIn(-3)]), NOW);
    expect(f.entries[0].waitMinutes).toBe(0);
  });

  it('spreads the queue across multiple counters', () => {
    const f = forecastQueue(snap([walkIn(-4), walkIn(-3), walkIn(-2), walkIn(-1)], { active_counters: 2 }), NOW);
    expect(f.entries.map((e) => e.waitMinutes)).toEqual([0, 0, 15, 15]);
  });

  it('reserves capacity for booked appointments that have not arrived yet', () => {
    const booked = appt(10, null);
    const w1 = walkIn(-2), w2 = walkIn(-1);
    const f = forecastQueue(snap([booked, w1, w2]), NOW);
    // w1 now (0-15), booked takes the counter at 15 (its promise +10 beats w2's +29), w2 at 30
    expect(f.byId.get(w1.id).waitMinutes).toBe(0);
    expect(f.byId.get(booked.id).startMs).toBe(NOW + 15 * MIN);
    expect(f.byId.get(w2.id).waitMinutes).toBe(30);
    expect(f.byId.get(booked.id).position).toBeNull();
  });

  it('drops a booked appointment that is past its grace period from the forecast', () => {
    const missed = appt(-20, null);
    const f = forecastQueue(snap([missed, walkIn(-1)]), NOW);
    expect(f.byId.has(missed.id)).toBe(false);
  });

  it('flags appointments the queue will serve later than their slot', () => {
    const overdue1 = walkIn(-50), overdue2 = walkIn(-45);
    const ap = appt(0, -5);
    const f = forecastQueue(snap([overdue1, overdue2, ap]), NOW);
    expect(f.byId.get(ap.id).lateByMinutes).toBe(30);
  });

  it('quotes a new walk-in behind the existing queue', () => {
    expect(quoteNewWalkIn(snap([walkIn(-2), walkIn(-1)]), NOW)).toBe(30);
    expect(quoteNewWalkIn(snap([]), NOW)).toBe(0);
  });

  it('ignores completed and cancelled tickets', () => {
    const done = walkIn(-50, { status: 'completed', called_at: at(-40), completed_at: at(-30) });
    const f = forecastQueue(snap([done, walkIn(-1)]), NOW);
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0].waitMinutes).toBe(0);
  });
});

describe('helpers', () => {
  it('normalises token input', () => {
    expect(normaliseToken('w7')).toBe('W-007');
    expect(normaliseToken(' a-012 ')).toBe('A-012');
    expect(normaliseToken('W0042')).toBe('W-042');
    expect(normaliseToken('hello')).toBeNull();
  });
  it('formats waits and ordinals', () => {
    expect(formatWait(0)).toBe('Now');
    expect(formatWait(12)).toBe('~12 min');
    expect(formatWait(75)).toBe('~1 h 15 min');
    expect([1, 2, 3, 4, 11, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '22nd']);
  });
});
