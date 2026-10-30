import { formatClock } from '../../lib/format.js';
import { formatWait } from '../../lib/queueEngine.js';

export default function BookedTable({ tickets, forecast, now, settings, busy, actions }) {
  if (tickets.length === 0) return null;
  const tz = settings.timezone;
  const graceMs = settings.appointment_grace_minutes * 60_000;

  return (
    <section className="card" aria-labelledby="booked-title">
      <div className="card-head">
        <h2 id="booked-title">Upcoming appointments</h2>
        <span className="muted small">booked, not checked in</span>
      </div>
      <div className="table-wrap">
        <table className="qtable">
          <thead>
            <tr><th>Token</th><th>Customer</th><th>Slot</th><th>Status</th><th>Est. call if on time</th><th className="actions">Actions</th></tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const slot = Date.parse(t.scheduled_at);
              const diff = Math.round((slot - now) / 60_000);
              const missed = now > slot + graceMs;
              const entry = forecast.byId.get(t.id);
              let status;
              if (missed) status = <span className="tag-warn">Missed slot by {-diff} min — will join as walk-in</span>;
              else if (diff < 0) status = <span className="tag-warn">Late {-diff} min (within grace)</span>;
              else status = <span className="muted">Due in {diff} min</span>;
              return (
                <tr key={t.id}>
                  <td data-label="Token"><span className="token">{t.token}</span></td>
                  <td data-label="Customer">{t.customer_name}{t.notes && <div className="muted small">{t.notes}</div>}</td>
                  <td data-label="Slot" className="mono">{formatClock(t.scheduled_at, tz)}</td>
                  <td data-label="Status">{status}</td>
                  <td data-label="Est. call">{entry ? `${formatWait(entry.waitMinutes)} (≈ ${formatClock(entry.startMs, tz)})` : '—'}</td>
                  <td className="actions">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-small btn-primary" disabled={!!busy} onClick={() => actions.checkIn(t)}>Check in</button>
                      <button className="btn btn-small btn-danger" disabled={!!busy} onClick={() => window.confirm(`Mark ${t.token} as no-show?`) && actions.close(t, 'no_show')}>No-show</button>
                      <button className="btn btn-small" disabled={!!busy} onClick={() => window.confirm(`Cancel appointment ${t.token}?`) && actions.close(t, 'cancelled')}>Cancel</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
