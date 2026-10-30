import { TypeBadge } from '../ui.jsx';
import { formatWait } from '../../lib/queueEngine.js';
import { formatClock, minutesBetween } from '../../lib/format.js';

export default function WaitingTable({ entries, now, settings, counter, busy, actions }) {
  const tz = settings.timezone;

  const callOutOfOrder = (entry) => {
    const skipped = entry.position - 1;
    if (skipped > 0 && !window.confirm(`Call ${entry.ticket.token} now? This skips ${skipped} customer(s) ahead in the queue.`)) return;
    actions.callTicket(entry.ticket);
  };
  const remove = (t, status) => {
    const word = status === 'no_show' ? 'a no-show' : 'cancelled';
    if (window.confirm(`Mark ${t.token} (${t.customer_name}) as ${word}?`)) actions.close(t, status);
  };

  return (
    <section className="card" aria-labelledby="waiting-title">
      <div className="card-head">
        <h2 id="waiting-title">Waiting queue</h2>
        <span className="muted small">in call order · {entries.length} waiting</span>
      </div>
      {entries.length === 0 ? (
        <div className="empty">Nobody is waiting. Add a walk-in or check in an appointment.</div>
      ) : (
        <div className="table-wrap">
          <table className="qtable">
            <thead>
              <tr>
                <th>#</th><th>Token</th><th>Customer</th><th>Type</th><th>Arrived</th><th>Est. call</th><th>Why here</th><th className="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const t = e.ticket;
                const waited = minutesBetween(t.checked_in_at, now);
                return (
                  <tr key={t.id} className={e.position === 1 ? 'is-next' : ''}>
                    <td data-label="Position" className="mono"><strong>{e.position}</strong></td>
                    <td data-label="Token"><span className="token">{t.token}</span></td>
                    <td data-label="Customer">
                      <div>{t.customer_name}</div>
                      {t.notes && <div className="muted small">{t.notes}</div>}
                    </td>
                    <td data-label="Type">
                      <TypeBadge type={t.booking_type} />
                      {t.scheduled_at && <div className="muted small">slot {formatClock(t.scheduled_at, tz)}</div>}
                    </td>
                    <td data-label="Arrived">
                      <div className="mono">{formatClock(t.checked_in_at, tz)}</div>
                      <div className="muted small">waiting {waited} min</div>
                    </td>
                    <td data-label="Est. call">
                      <div><strong>{formatWait(e.waitMinutes)}</strong></div>
                      <div className="muted small">≈ {formatClock(e.startMs, tz)}</div>
                    </td>
                    <td data-label="Why here">
                      <ReasonTag entry={e} />
                    </td>
                    <td className="actions">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-small" disabled={!!busy} onClick={() => callOutOfOrder(e)}
                                title={e.position === 1 ? `Call to counter ${counter}` : `Call out of order to counter ${counter}`}>
                          {e.position === 1 ? 'Call' : 'Call now'}
                        </button>
                        <button className="btn btn-small btn-danger" disabled={!!busy} onClick={() => remove(t, 'no_show')}>No-show</button>
                        <button className="btn btn-small" disabled={!!busy} onClick={() => remove(t, 'cancelled')}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReasonTag({ entry }) {
  const { kind, label } = entry.reason;
  const cls = kind === 'overdue_walkin' || kind === 'appointment' ? 'tag-prio' : kind === 'late_appointment' ? 'tag-warn' : 'muted small';
  return (
    <>
      <div className={cls}>{label}</div>
      {entry.lateByMinutes > 0 && <div className="tag-warn">running ~{entry.lateByMinutes} min behind slot</div>}
    </>
  );
}
